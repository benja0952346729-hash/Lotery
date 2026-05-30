import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import {
  handleGroupMessage,
  handleAdminCommand,
  isAdmin,
  alertAdmin,
  pendingResponses,
} from './core.js';
import { generateLearningSummary, learningEvents } from './geminiService.js';
import { readKnowledge } from './database.js';

// ===== VALIDATE ENV =====
const required = ['TELEGRAM_BOT_TOKEN', 'ADMIN_CHAT_ID', 'GROUP_CHAT_ID'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ===== EXPRESS SERVER =====
const app = express();
const PORT = process.env.PORT || 3000;

// Simple home page — no html file needed
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

  // SSE live events
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Learning status API
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

// Real-time SSE events
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

// ===== BOT =====
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const ADMIN_ID = parseInt(process.env.ADMIN_CHAT_ID);
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

// Daily summary at 9 PM
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
  await alertAdmin(bot, `✅ Bot started!\n@${me.username} is online.\n\nType /status`, 'SUCCESS');
}).catch(err => {
  console.error('❌ Bot failed to start:', err.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await alertAdmin(bot, '🛑 Bot shutting down...', 'WARNING').catch(() => {});
  process.exit(0);
});
