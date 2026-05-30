import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import {
  readKnowledge, updateKnowledge, saveHistory, getHistory,
  registerMember, getLotteryList, getBotState, setBotState,
  initDB, query,
} from './database.js';
import {
  learnFromMessage, learnLotteryRules, generateLearningSummary,
  learningEvents, getTokenStats, testNvidiaConnection
} from './aiService.js';
import { generateResponse, handleRegistration, generateAnnouncement } from './aiService.js';
import { getKeyStats } from './keys.js';

// ============================================================
// 🔑 KEY ROTATION
// ============================================================
export { getNextDeepSeekKey, rotateDeepSeekKey, getNextGroqKey, rotateGroqKey } from './keys.js';

// ============================================================
// 👑 ADMIN HANDLER
// ============================================================

const ADMIN_ID = parseInt(process.env.ADMIN_CHAT_ID);

export function isAdmin(userId) {
  return userId === ADMIN_ID;
}

export async function alertAdmin(bot, message, level = 'INFO') {
  const emoji = { INFO: 'ℹ️', WARNING: '⚠️', ERROR: '🚨', SUCCESS: '✅' }[level] || 'ℹ️';
  try {
    await bot.sendMessage(ADMIN_ID, `${emoji} ${message}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[ALERT] Failed:', err.message);
  }
}

export async function handleAdminCommand(bot, msg) {
  const text = msg.text || '';
  const chatId = msg.chat.id;

  if (text === '/on') {
    await setBotState(true, ADMIN_ID);
    await bot.sendMessage(chatId, '✅ Bot is now ON\nGroq ይናገራል + DeepSeek ይማራል');
    return;
  }

  if (text === '/off') {
    await setBotState(false, ADMIN_ID);
    await bot.sendMessage(chatId, '❌ Bot is now OFF\nDeepSeek ብቻ ይማራል (silent mode)');
    return;
  }

  if (text === '/status') {
    const isOn = await getBotState();
    const keyStats = getKeyStats();
    const knowledge = await readKnowledge();
    const lotteryList = await getLotteryList();
    const status = `
📊 *BOT STATUS*
━━━━━━━━━━━━━━
🔛 State: ${isOn ? '✅ ON' : '❌ OFF'}
🧠 Knowledge:
  • Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
  • Rules learned: ${knowledge.rules?.length || 0}
  • Intents: ${knowledge.intents?.length || 0}
🎰 Lottery:
  • Registered: ${lotteryList.length}/100
🔑 Keys:
  • DeepSeek/NVIDIA: ${keyStats.deepseek.total} keys
  • Groq: ${keyStats.groq.total} keys
    `;
    await bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
    return;
  }

  if (text === '/summary') {
    await bot.sendMessage(chatId, '⏳ DeepSeek summary እየሰራ ነው...');
    const summary = await generateLearningSummary();
    if (summary) {
      await bot.sendMessage(chatId, `
📚 *LEARNING SUMMARY*
━━━━━━━━━━━━━━
${summary.summary}

✅ New things learned:
${summary.newThingsLearned?.map(t => `• ${t}`).join('\n')}

⚠️ Weak areas:
${summary.weakAreas?.map(a => `• ${a}`).join('\n')}

💪 Confidence: ${Math.round((summary.confidence || 0) * 100)}%
🎯 Ready to replace: ${summary.readyToReplace ? 'YES ✅' : 'Not yet ❌'}
      `, { parse_mode: 'Markdown' });
    }
    return;
  }

  if (text === '/list') {
    const list = await getLotteryList();
    if (list.length === 0) {
      await bot.sendMessage(chatId, '📋 ምንም ሰው አልተመዘገበም');
      return;
    }
    const listText = list.map(r => `${r.number}. @${r.username || r.user_id}`).join('\n');
    await bot.sendMessage(chatId, `📋 *LOTTERY LIST*\n━━━━━━━━\n${listText}`, { parse_mode: 'Markdown' });
    return;
  }

  if (text.startsWith('/announce ')) {
    const topic = text.replace('/announce ', '');
    await bot.sendMessage(chatId, '⏳ Groq announcement እየሰራ ነው...');
    const announcement = await generateAnnouncement(topic, '');
    await bot.sendMessage(process.env.GROUP_CHAT_ID, announcement);
    await bot.sendMessage(chatId, '✅ Announcement ተላከ:\n\n' + announcement);
    return;
  }

  if (text === '/knowledge') {
    const knowledge = await readKnowledge();
    await bot.sendMessage(chatId, `
🧠 *KNOWLEDGE BASE*
━━━━━━━━━━━━━━
Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
Rules: ${knowledge.rules?.length || 0}
Intents: ${knowledge.intents?.length || 0}
Amharic phrases: ${knowledge.writingStyle?.amharic?.length || 0}
Last updated: ${knowledge.lastUpdated || 'Never'}

Top rules:
${knowledge.rules?.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join('\n') || 'None yet'}
    `, { parse_mode: 'Markdown' });
    return;
  }

  if (text === '/tokens') {
    const t = await getTokenStats();
    const ds = t['nvidia-deepseek'] || t.deepseek || { calls:0, input:0, output:0, total:0 };
    const gr = t.groq     || { calls:0, input:0, output:0, total:0 };
    await bot.sendMessage(chatId, `
🔢 *TOKEN USAGE*
━━━━━━━━━━━━━━
🧠 *NVIDIA DeepSeek V4 Flash*
  • Calls: ${ds.calls.toLocaleString()}
  • Input:  ${ds.input.toLocaleString()} tokens
  • Output: ${ds.output.toLocaleString()} tokens
  • Total:  ${ds.total.toLocaleString()} tokens

⚡ *Groq*
  • Calls: ${gr.calls.toLocaleString()}
  • Input:  ${gr.input.toLocaleString()} tokens
  • Output: ${gr.output.toLocaleString()} tokens
  • Total:  ${gr.total.toLocaleString()} tokens

📊 *Grand Total: ${(ds.total + gr.total).toLocaleString()} tokens*
━━━━━━━━━━━━━━
_Bot restart ቢሆን DB ውስጥ ይቆያል ✅_
    `, { parse_mode: 'Markdown' });
    return;
  }

  if (text === '/history') {
    const history = await getHistory(10);
    await bot.sendMessage(chatId, `📜 Last 10 days: ${history.length} messages saved in DB`);
    return;
  }

  await bot.sendMessage(chatId, `
🤖 *ADMIN COMMANDS*
━━━━━━━━━━━━━━
/on - Bot ያብራ
/off - Bot ያጥፋ
/status - Bot status
/summary - Learning summary
/list - Lottery list
/knowledge - Knowledge base
/history - History stats
/tokens - Token usage
/announce <text> - Announcement
  `, { parse_mode: 'Markdown' });
}

// ============================================================
// 👥 GROUP HANDLER
// ============================================================

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.90');
export const pendingResponses = new Map();

export async function handleGroupMessage(bot, msg) {
  const text = msg.text || '';
  const userId = msg.from?.id;
  const username = msg.from?.username || msg.from?.first_name || 'User';
  const chatId = msg.chat.id;
  const isAdminMessage = userId === ADMIN_ID;

  msg._isAdmin = isAdminMessage;

  await saveHistory(msg);

  learnFromMessage(msg, isAdminMessage).catch(err =>
    console.error('[LEARN] Error:', err.message)
  );

  if (isAdminMessage) {
    learnLotteryRules(text).catch(err =>
      console.error('[RULES] Error:', err.message)
    );
    return;
  }

  const isOn = await getBotState();
  if (!isOn) return;

  const registrationMatch = text.match(/(\d+)/);
  const isRegistrationRequest =
    text.includes('ምዝገባ') ||
    text.includes('register') ||
    text.includes('መዝገብ') ||
    text.includes('እፈልጋለሁ') ||
    (registrationMatch && text.length < 50);

  if (isRegistrationRequest && registrationMatch) {
    const requestedNumber = parseInt(registrationMatch[1]);
    if (requestedNumber >= 1 && requestedNumber <= 100) {
      await handleLotteryRegistration(bot, msg, userId, username, requestedNumber, chatId);
      return;
    }
  }

  try {
    const result = await generateResponse(text, userId, username);

    if (result.confidence >= CONFIDENCE_THRESHOLD) {
      await bot.sendMessage(chatId, result.response, {
        reply_to_message_id: msg.message_id,
      });
    } else {
      const pendingId = `${userId}_${Date.now()}`;
      pendingResponses.set(pendingId, {
        chatId,
        messageId: msg.message_id,
        response: result.response,
        userId,
        username,
        originalText: text,
      });
      await alertAdmin(
        bot,
        `⚠️ *Low confidence* (${Math.round(result.confidence * 100)}%)\n\n` +
        `@${username}: "${text}"\n\nBot: "${result.response}"\n\n` +
        `/approve_${pendingId} ✅ | /reject_${pendingId} ❌`,
        'WARNING'
      );
    }
  } catch (err) {
    console.error('[GROUP] Error:', err.message);
    await alertAdmin(bot, `🚨 Error: ${err.message}`, 'ERROR');
  }
}

async function handleLotteryRegistration(bot, msg, userId, username, requestedNumber, chatId) {
  try {
    const result = await handleRegistration(userId, username, requestedNumber);
    if (result.available) {
      const regResult = await registerMember(userId, username, requestedNumber);
      if (regResult.success) {
        await bot.sendMessage(chatId, result.response, { reply_to_message_id: msg.message_id });
        await alertAdmin(bot, `✅ @${username} → number ${requestedNumber}`, 'INFO');
      }
    } else {
      await bot.sendMessage(chatId, result.response, { reply_to_message_id: msg.message_id });
    }
  } catch (err) {
    console.error('[REGISTRATION] Error:', err.message);
  }
}

// Init DB
await initDB();

// ============================================================
// 🌐 EXPRESS SERVER
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🤖 Lottery Bot — Live Learning</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a0f; color:#e2e8f0; font-family:'Courier New',monospace; padding:20px; }
  h1 { color:#00ff9d; font-size:18px; margin-bottom:6px; letter-spacing:2px; }
  p.sub { color:#4a5568; font-size:12px; margin-bottom:24px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:24px; }
  .stat { background:#11111a; border:1px solid #1e1e2e; border-radius:10px; padding:16px; }
  .stat-label { font-size:10px; color:#4a5568; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px; }
  .stat-value { font-size:32px; font-weight:700; color:#00ff9d; }
  .stat-sub { font-size:11px; color:#4a5568; margin-top:2px; }
  .confidence { background:#11111a; border:1px solid #1e1e2e; border-radius:10px; padding:16px; margin-bottom:24px; }
  .conf-label { font-size:10px; color:#4a5568; text-transform:uppercase; letter-spacing:2px; margin-bottom:8px; }
  .conf-bar { height:8px; background:#1e1e2e; border-radius:4px; overflow:hidden; }
  .conf-fill { height:100%; border-radius:4px; background:linear-gradient(90deg,#00ff9d,#7c3aed); transition:width 1s ease; }
  .conf-pct { font-size:28px; font-weight:700; color:#00ff9d; margin-top:6px; }
  .ready { font-size:13px; margin-top:8px; }
  .log-box { background:#070710; border:1px solid #1e1e2e; border-radius:10px; padding:16px; height:320px; overflow-y:auto; }
  .log-title { font-size:10px; color:#00ff9d; text-transform:uppercase; letter-spacing:2px; margin-bottom:12px; }
  .log-entry { font-size:12px; line-height:1.9; display:flex; gap:10px; }
  .t { color:#4a5568; min-width:80px; }
  .learn { color:#00ff9d; }
  .eval { color:#7c3aed; }
  .rule { color:#ff6b35; }
  .error { color:#ff4757; }
  .ping { color:#1e1e2e; }
  .dot { width:8px; height:8px; border-radius:50%; background:#00ff9d; display:inline-block; margin-right:6px; animation:blink 1.5s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
  ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#1e1e2e} ::-webkit-scrollbar-thumb{background:#00ff9d;border-radius:2px}
</style>
</head>
<body>
<h1>🤖 LOTTERY BOT <span class="dot"></span></h1>
<p class="sub">Real-time AI Learning Monitor</p>

<div class="stats">
  <div class="stat">
    <div class="stat-label">Admin Phrases</div>
    <div class="stat-value" id="v1">—</div>
    <div class="stat-sub">learned</div>
  </div>
  <div class="stat">
    <div class="stat-label">Rules</div>
    <div class="stat-value" id="v2">—</div>
    <div class="stat-sub">lottery rules</div>
  </div>
  <div class="stat">
    <div class="stat-label">Intents</div>
    <div class="stat-value" id="v3">—</div>
    <div class="stat-sub">user patterns</div>
  </div>
  <div class="stat">
    <div class="stat-label">Style</div>
    <div class="stat-value" id="v4">—</div>
    <div class="stat-sub">phrases</div>
  </div>
</div>

<div class="confidence">
  <div class="conf-label">Bot Confidence — Admin ሊተካ የሚችልበት ደረጃ</div>
  <div class="conf-bar"><div class="conf-fill" id="confBar" style="width:0%"></div></div>
  <div class="conf-pct" id="confPct">0%</div>
  <div class="ready" id="readyText">⏳ እየተማረ...</div>
</div>

<div class="log-box">
  <div class="log-title">⚡ Live Activity</div>
  <div id="logs"></div>
</div>

<script>
  function addLog(type, msg) {
    const t = new Date().toTimeString().slice(0,8);
    if (type === 'ping') return;
    const el = document.createElement('div');
    el.className = 'log-entry';
    el.innerHTML = '<span class="t">'+t+'</span><span class="'+type+'">['+type.toUpperCase()+']</span><span style="color:#e2e8f0;margin-left:6px">'+msg+'</span>';
    const logs = document.getElementById('logs');
    logs.appendChild(el);
    logs.scrollTop = logs.scrollHeight;
    if (logs.children.length > 100) logs.removeChild(logs.firstChild);
  }

  async function fetchStats() {
    try {
      const r = await fetch('/learn-status');
      const d = await r.json();
      document.getElementById('v1').textContent = d.adminPhrases || 0;
      document.getElementById('v2').textContent = d.rules || 0;
      document.getElementById('v3').textContent = d.intents || 0;
      document.getElementById('v4').textContent = d.writingStyle || 0;
      const pct = Math.round((d.confidence || 0) * 100);
      document.getElementById('confBar').style.width = pct + '%';
      document.getElementById('confPct').textContent = pct + '%';
      document.getElementById('readyText').textContent = d.readyToReplace
        ? '✅ Admin ሊተካ ይችላል!'
        : '⏳ እየተማረ... ' + pct + '%';
    } catch(e) { addLog('error', 'Stats fetch failed'); }
  }

  const es = new EventSource('/events');
  es.onmessage = e => {
    const d = JSON.parse(e.data);
    addLog(d.type, d.msg);
    if (d.type !== 'ping') fetchStats();
  };
  es.onerror = () => addLog('error', 'Connection lost, reconnecting...');

  fetchStats();
  setInterval(fetchStats, 15000);
</script>
</body>
</html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/learn-status', async (req, res) => {
  try {
    const knowledge = await readKnowledge();
    res.json({
      adminPhrases: knowledge.adminStyle?.responses?.length || 0,
      rules: knowledge.rules?.length || 0,
      intents: knowledge.intents?.length || 0,
      writingStyle: knowledge.writingStyle?.commonPhrases?.length || 0,
      confidence: knowledge.confidence || 0,
      readyToReplace: knowledge.readyToReplace || false,
      lastUpdated: knowledge.lastUpdated || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    res.write('data: {"type":"ping","msg":"..."}\n\n');
  }, 30000);

  const listener = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  learningEvents.on('activity', listener);
  req.on('close', () => {
    clearInterval(heartbeat);
    learningEvents.off('activity', listener);
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ============================================================
// 🤖 TELEGRAM BOT
// ============================================================

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const GROUP_ID = process.env.GROUP_CHAT_ID;

console.log('🤖 Lottery Bot starting...');

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text || '';

    if (msg.chat.type === 'private') {
      if (isAdmin(userId)) {
        if (text.startsWith('/approve_')) {
          const pendingId = text.replace('/approve_', '');
          const pending = pendingResponses.get(pendingId);
          if (pending) {
            await bot.sendMessage(pending.chatId, pending.response, {
              reply_to_message_id: pending.messageId,
            });
            pendingResponses.delete(pendingId);
            await bot.sendMessage(ADMIN_ID, '✅ Response sent to group');
          } else {
            await bot.sendMessage(ADMIN_ID, '❌ Pending response not found or expired');
          }
          return;
        }

        if (text.startsWith('/reject_')) {
          const pendingId = text.replace('/reject_', '');
          pendingResponses.delete(pendingId);
          await bot.sendMessage(ADMIN_ID, '🗑️ Response rejected');
          return;
        }

        await handleAdminCommand(bot, msg);
      } else {
        await bot.sendMessage(chatId, 'ይህ bot ለ admin ብቻ ነው።');
      }
      return;
    }

    if (String(chatId) === String(GROUP_ID) || msg.chat.type === 'supergroup') {
      await handleGroupMessage(bot, msg);
    }

  } catch (err) {
    console.error('[BOT] Unhandled error:', err.message);
    await alertAdmin(bot, `🚨 Unhandled error: ${err.message}`, 'ERROR').catch(() => {});
  }
});

// Daily summary — 9 PM
cron.schedule('0 21 * * *', async () => {
  try {
    const summary = await generateLearningSummary();
    if (summary) {
      await bot.sendMessage(
        ADMIN_ID,
        `📊 *DAILY REPORT*\n━━━━━━━━━━━━━━\n${summary.summary}\n\n` +
        `💪 Confidence: ${Math.round(summary.confidence * 100)}%\n` +
        `🎯 Ready to replace: ${summary.readyToReplace ? 'YES ✅' : 'Not yet'}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    console.error('[CRON] Summary error:', err.message);
  }
});

bot.getMe().then(async (me) => {
  console.log(`✅ Bot started: @${me.username}`);

  // NVIDIA + DeepSeek connection test
  const nvidiaOk = await testNvidiaConnection();
  if (!nvidiaOk) {
    console.warn('⚠️ NVIDIA connection failed — learning ላይቀሰቀስ ይችላል');
  }

  await alertAdmin(
    bot,
    `✅ Bot started!\n@${me.username} is online.\n\n` +
    `🧠 NVIDIA DeepSeek: ${nvidiaOk ? '✅ Online' : '❌ Offline'}\n\nType /status`,
    'SUCCESS'
  );
}).catch(err => {
  console.error('❌ Bot failed to start:', err.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await alertAdmin(bot, '🛑 Bot shutting down...', 'WARNING').catch(() => {});
  process.exit(0);
});
