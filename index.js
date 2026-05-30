import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import {
  readKnowledge, updateKnowledge, saveHistory, getHistory,
  registerMember, getLotteryList, getBotState, setBotState,
  initDB, query, getBoardState, updateBoardState, removeMember, clearLottery,
} from './database.js';
import {
  learnFromMessage, learnLotteryRules, generateLearningSummary,
  learningEvents, getTokenStats, testNvidiaConnection,
  learnFromBoard, parseBoard,
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

// ─────────────────────────────────────────
// BOARD RENDERER — DB state → text board
// ─────────────────────────────────────────
function renderBoard(boardState, knowledge) {
  const slots = boardState?.slots || {};
  const rules = knowledge?.boardRules || {};
  const price = rules.price || 400;
  const halfPrice = rules.halfPrice || 200;
  const prizes = rules.prizes || { '1st': 5000, '2nd': 1000, '3rd': 400 };

  let board = `በ ${price} ብር 5 ቁጥሮችን በተከታታይ በመያዝ እድሎን ይሞክሩ ለ 20 ሰው ብቻ ፈጣን ዕድል መልካም ዕድል\n\n`;
  board += `መደብ 👉በ ${price} ብር\n`;
  board += `       👉ግማሽ ${halfPrice} ብር\n\n`;
  board += `1ኛ 🥇${prizes['1st']?.toLocaleString() || 5000} ብር\n`;
  board += `2ኛ 🥈${prizes['2nd'] || 1000}\n`;
  board += `3ኛ 🥇${prizes['3rd'] || 400}\n\n`;

  // ቁጥሮቹ 1-100 — groups of 5
  for (let i = 1; i <= 100; i++) {
    const slot = slots[i];
    let line = `${String(i).padStart(2, '0')}#`;

    if (slot?.name) {
      const statusEmoji = slot.status === 'paid' ? '✅' : '⏳';
      line += ` ${slot.name} ${statusEmoji}`;
    }

    board += line + '\n';

    // ክፍት ያለ blank line after every 5
    if (i % 5 === 0) board += '\n';
  }

  // Banks
  if (rules.banks) {
    board += '\n';
    for (const [bank, account] of Object.entries(rules.banks)) {
      board += `${bank} ${account}\n`;
    }
  }

  return board;
}

// ─────────────────────────────────────────
// ADMIN COMMANDS
// ─────────────────────────────────────────
export const pendingResponses = new Map();

export async function handleAdminCommand(bot, msg) {
  const text = msg.text || '';
  const chatId = msg.chat.id;

  // ── BOT ON/OFF ──
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

  // ── STATUS ──
  if (text === '/status') {
    const isOn = await getBotState();
    const keyStats = getKeyStats();
    const knowledge = await readKnowledge();
    const lotteryList = await getLotteryList();
    const boardState = await getBoardState().catch(() => null);
    const filledSlots = boardState
      ? Object.values(boardState.slots || {}).filter(s => s.name).length
      : lotteryList.length;
    const paidSlots = boardState
      ? Object.values(boardState.slots || {}).filter(s => s.status === 'paid').length
      : 0;

    await bot.sendMessage(chatId, `
📊 *BOT STATUS*
━━━━━━━━━━━━━━
🔛 State: ${isOn ? '✅ ON' : '❌ OFF'}
🧠 Knowledge:
  • Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
  • Rules learned: ${knowledge.rules?.length || 0}
  • Board rules: ${knowledge.boardRules ? '✅' : '❌'}
  • Intents: ${knowledge.intents?.length || 0}
🎰 Board:
  • Filled: ${filledSlots}/100
  • Paid ✅: ${paidSlots}
  • Pending ⏳: ${filledSlots - paidSlots}
🔑 Keys:
  • DeepSeek/NVIDIA: ${keyStats.deepseek.total} keys
  • Groq: ${keyStats.groq.total} keys
    `, { parse_mode: 'Markdown' });
    return;
  }

  // ── BOARD — ወደ group ይልካል ──
  if (text === '/board') {
    const knowledge = await readKnowledge();
    const boardState = await getBoardState().catch(() => null);
    if (!boardState) {
      await bot.sendMessage(chatId, '❌ Board እስካሁን አልተማረም። Board ፎቶ ወይም text ልክ።');
      return;
    }
    const boardText = renderBoard(boardState, knowledge);
    await bot.sendMessage(process.env.GROUP_CHAT_ID, boardText);
    await bot.sendMessage(chatId, '✅ Board ወደ group ተላከ');
    return;
  }

  // ── BOARD PREVIEW (admin only) ──
  if (text === '/boardpreview') {
    const knowledge = await readKnowledge();
    const boardState = await getBoardState().catch(() => null);
    if (!boardState) {
      await bot.sendMessage(chatId, '❌ Board data የለም');
      return;
    }
    const boardText = renderBoard(boardState, knowledge);
    await bot.sendMessage(chatId, boardText);
    return;
  }

  // ── UPDATE SLOT — /update 96 ቢንያም paid ──
  if (text.startsWith('/update ')) {
    const parts = text.replace('/update ', '').trim().split(' ');
    const number = parseInt(parts[0]);
    const name = parts[1] || null;
    const status = parts[2] || 'pending'; // paid | pending | open

    if (isNaN(number) || number < 1 || number > 100) {
      await bot.sendMessage(chatId, '❌ ትክክለኛ ቁጥር ስጥ (1-100)');
      return;
    }

    const boardState = await getBoardState().catch(() => ({ slots: {} }));
    boardState.slots = boardState.slots || {};
    boardState.slots[number] = { number, name, status };
    await updateBoardState(boardState);

    const statusText = status === 'paid' ? '✅ ተከፍሏል' : status === 'pending' ? '⏳ ተመዝግቧል' : '# ክፍት';
    await bot.sendMessage(chatId, `✅ Slot ${number} updated:\n${name || 'ክፍት'} — ${statusText}`);

    // ወደ group ያዘምናል
    const knowledge = await readKnowledge();
    const boardText = renderBoard(boardState, knowledge);
    await bot.sendMessage(process.env.GROUP_CHAT_ID, `📋 Board ታድሷል\n\n${boardText}`);
    return;
  }

  // ── REMOVE SLOT — /remove 96 ──
  if (text.startsWith('/remove ')) {
    const number = parseInt(text.replace('/remove ', '').trim());
    if (isNaN(number) || number < 1 || number > 100) {
      await bot.sendMessage(chatId, '❌ ትክክለኛ ቁጥር ስጥ');
      return;
    }

    const boardState = await getBoardState().catch(() => ({ slots: {} }));
    if (boardState.slots?.[number]) {
      const name = boardState.slots[number].name;
      boardState.slots[number] = { number, name: null, status: 'open' };
      await updateBoardState(boardState);
      await removeMember(number).catch(() => {});
      await bot.sendMessage(chatId, `✅ Slot ${number} (${name || 'unknown'}) ወጣ`);

      // Board update
      const knowledge = await readKnowledge();
      const boardText = renderBoard(boardState, knowledge);
      await bot.sendMessage(process.env.GROUP_CHAT_ID, `📋 Board ታድሷል\n\n${boardText}`);
    } else {
      await bot.sendMessage(chatId, `❌ Slot ${number} ክፍት ነው`);
    }
    return;
  }

  // ── PAY — /pay 96 ── (pending → paid)
  if (text.startsWith('/pay ')) {
    const number = parseInt(text.replace('/pay ', '').trim());
    const boardState = await getBoardState().catch(() => ({ slots: {} }));
    const slot = boardState.slots?.[number];

    if (!slot || !slot.name) {
      await bot.sendMessage(chatId, `❌ Slot ${number} ምዝገባ የለም`);
      return;
    }

    boardState.slots[number].status = 'paid';
    await updateBoardState(boardState);
    await bot.sendMessage(chatId, `✅ ${slot.name} — ቁጥር ${number} ክፍያ confirmed!`);

    // ወደ group ያሳውቃል
    const knowledge = await readKnowledge();
    await bot.sendMessage(
      process.env.GROUP_CHAT_ID,
      `✅ ${slot.name} ቁጥር ${number} ክፍያ ተረጋግጧል! 🎉`
    );
    return;
  }

  // ── CLEAR BOARD ──
  if (text === '/clearboard') {
    await updateBoardState({ slots: {} });
    await clearLottery();
    await bot.sendMessage(chatId, '🗑️ Board cleared — ሁሉም slots ወጡ');
    return;
  }

  // ── LIST ──
  if (text === '/list') {
    const boardState = await getBoardState().catch(() => null);
    if (!boardState || Object.keys(boardState.slots || {}).length === 0) {
      await bot.sendMessage(chatId, '📋 ምንም ሰው አልተመዘገበም');
      return;
    }
    const filled = Object.values(boardState.slots).filter(s => s.name);
    const listText = filled.map(s =>
      `${String(s.number).padStart(2, '0')}. ${s.name} ${s.status === 'paid' ? '✅' : '⏳'}`
    ).join('\n');
    await bot.sendMessage(chatId, `📋 *LOTTERY LIST* (${filled.length}/100)\n━━━━━━━━\n${listText}`, {
      parse_mode: 'Markdown'
    });
    return;
  }

  // ── SUMMARY ──
  if (text === '/summary') {
    await bot.sendMessage(chatId, '⏳ DeepSeek summary እየሰራ ነው...');
    const summary = await generateLearningSummary();
    if (summary) {
      await bot.sendMessage(chatId, `
📚 *LEARNING SUMMARY*
━━━━━━━━━━━━━━
${summary.summary}

✅ New things learned:
${summary.newThingsLearned?.map(t => `• ${t}`).join('\n') || 'None'}

⚠️ Weak areas:
${summary.weakAreas?.map(a => `• ${a}`).join('\n') || 'None'}

💪 Confidence: ${Math.round((summary.confidence || 0) * 100)}%
🎯 Ready to replace: ${summary.readyToReplace ? 'YES ✅' : 'Not yet ❌'}
      `, { parse_mode: 'Markdown' });
    }
    return;
  }

  // ── ANNOUNCE ──
  if (text.startsWith('/announce ')) {
    const topic = text.replace('/announce ', '');
    await bot.sendMessage(chatId, '⏳ Groq announcement እየሰራ ነው...');
    const announcement = await generateAnnouncement(topic, '');
    await bot.sendMessage(process.env.GROUP_CHAT_ID, announcement);
    await bot.sendMessage(chatId, '✅ Announcement ተላከ:\n\n' + announcement);
    return;
  }

  // ── KNOWLEDGE ──
  if (text === '/knowledge') {
    const knowledge = await readKnowledge();
    await bot.sendMessage(chatId, `
🧠 *KNOWLEDGE BASE*
━━━━━━━━━━━━━━
Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
Rules: ${knowledge.rules?.length || 0}
Board rules: ${knowledge.boardRules ? '✅ Learned' : '❌ Not learned'}
Intents: ${knowledge.intents?.length || 0}
Amharic phrases: ${knowledge.writingStyle?.amharic?.length || 0}
Admin patterns: ${knowledge.adminPatterns?.length || 0}
Last updated: ${knowledge.lastUpdated || 'Never'}

Top rules:
${knowledge.rules?.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join('\n') || 'None yet'}

Board rules:
Price: ${knowledge.boardRules?.price || '?'} ብር
Slots: ${knowledge.boardRules?.maxSlots || 100}
    `, { parse_mode: 'Markdown' });
    return;
  }

  // ── TOKENS ──
  if (text === '/tokens') {
    const t = await getTokenStats();
    const ds = t['nvidia-deepseek'] || { calls: 0, input: 0, output: 0, total: 0 };
    const gr = t.groq || { calls: 0, input: 0, output: 0, total: 0 };
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

  // ── HISTORY ──
  if (text === '/history') {
    const history = await getHistory(10);
    await bot.sendMessage(chatId, `📜 Last 10 days: ${history.length} messages saved in DB`);
    return;
  }

  // ── HELP ──
  await bot.sendMessage(chatId, `
🤖 *ADMIN COMMANDS*
━━━━━━━━━━━━━━
/on — Bot ያብራ
/off — Bot ያጥፋ
/status — Bot status
/board — Board ወደ group ልካ
/boardpreview — Board preview (private)
/update <num> <name> <paid|pending|open> — Slot ቀይር
/pay <num> — ክፍያ confirm
/remove <num> — Slot አውጣ
/clearboard — ሁሉም ሰር
/list — የተመዘገቡ ዝርዝር
/summary — Learning summary
/knowledge — Knowledge base
/history — History stats
/tokens — Token usage
/announce <text> — Announcement
  `, { parse_mode: 'Markdown' });
}

// ============================================================
// 👥 GROUP HANDLER
// ============================================================

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.90');

export async function handleGroupMessage(bot, msg) {
  const text = msg.text || '';
  const userId = msg.from?.id;
  const username = msg.from?.username || msg.from?.first_name || 'User';
  const chatId = msg.chat.id;
  const isAdminMessage = userId === ADMIN_ID;

  msg._isAdmin = isAdminMessage;

  await saveHistory(msg);

  // ── PHOTO MESSAGE — board ሊሆን ይችላል ──
  if (msg.photo) {
    if (isAdminMessage) {
      const caption = msg.caption || '';

      // Caption ን ይማራል
      if (caption) {
        learnFromMessage({ ...msg, text: caption }, true).catch(() => {});
        learnLotteryRules(caption).catch(() => {});
      }

      // Caption board text ካለ → parse + learn
      if (caption && caption.includes('#')) {
        await learnFromBoard(caption, '').catch(err =>
          console.error('[BOARD] Caption parse error:', err.message)
        );
        await alertAdmin(bot, '📋 Board (caption) ተማረ ✅', 'SUCCESS');
      }

      learningEvents.emit('activity', {
        type: 'learn',
        msg: `📷 Admin photo ተላከ${caption ? ' + caption learned' : ''}`
      });
    }
    return;
  }

  // ── ADMIN MESSAGE ──
  if (isAdminMessage) {
    // Board text ይልካል (# ብዛት > 5 ካለ → board ነው)
    const hashCount = (text.match(/#/g) || []).length;
    if (hashCount >= 5) {
      learnFromBoard(text, '').catch(err =>
        console.error('[BOARD] Text parse error:', err.message)
      );
      await alertAdmin(bot, '📋 Board text ተማረ ✅', 'SUCCESS');
    }

    learnFromMessage(msg, true).catch(err =>
      console.error('[LEARN] Error:', err.message)
    );
    learnLotteryRules(text).catch(err =>
      console.error('[RULES] Error:', err.message)
    );
    return;
  }

  // ── USER MESSAGE — bot off ከሆነ ሁሉም ዝም ──
  const isOn = await getBotState();
  if (!isOn) return;

  // DeepSeek background learning
  learnFromMessage(msg, false).catch(err =>
    console.error('[LEARN] Error:', err.message)
  );

  // ── REGISTRATION CHECK ──
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

  // ── GENERATE RESPONSE ──
  try {
    const result = await generateResponse(text, userId, username);

    if (result.confidence >= CONFIDENCE_THRESHOLD) {
      await bot.sendMessage(chatId, result.response, {
        reply_to_message_id: msg.message_id,
      });

      if (result.wasCorrected) {
        await alertAdmin(
          bot,
          `🔄 Response ተስተካከለ (${result.correctionRounds} rounds) → ${Math.round(result.confidence * 100)}% ✅`,
          'INFO'
        );
      }
    } else {
      // Low confidence → admin approval
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
        `⚠️ *Low confidence* (${Math.round(result.confidence * 100)}%) after ${result.correctionRounds} rounds\n\n` +
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
      // DB ምዝገባ
      const regResult = await registerMember(userId, username, requestedNumber);
      if (regResult.success) {
        // Board state ያዘምናል
        const boardState = await getBoardState().catch(() => ({ slots: {} }));
        boardState.slots = boardState.slots || {};
        boardState.slots[requestedNumber] = {
          number: requestedNumber,
          name: username,
          status: 'pending'
        };
        await updateBoardState(boardState);

        await bot.sendMessage(chatId, result.response, {
          reply_to_message_id: msg.message_id
        });
        await alertAdmin(
          bot,
          `✅ @${username} → ቁጥር ${requestedNumber} ⏳\n/pay ${requestedNumber} — ክፍያ ሲረጋገጥ`,
          'INFO'
        );
      }
    } else {
      await bot.sendMessage(chatId, result.response, {
        reply_to_message_id: msg.message_id
      });
    }
  } catch (err) {
    console.error('[REGISTRATION] Error:', err.message);
  }
}

// ============================================================
// 🗄️ INIT DB
// ============================================================
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
  .board-grid { display:grid; grid-template-columns:repeat(10,1fr); gap:4px; margin-bottom:24px; }
  .slot { background:#11111a; border:1px solid #1e1e2e; border-radius:6px; padding:6px 4px; text-align:center; font-size:10px; cursor:default; }
  .slot.paid { border-color:#00ff9d; background:#001a0d; color:#00ff9d; }
  .slot.pending { border-color:#f59e0b; background:#1a1200; color:#f59e0b; }
  .slot.open { color:#2d3748; }
  .log-box { background:#070710; border:1px solid #1e1e2e; border-radius:10px; padding:16px; height:280px; overflow-y:auto; }
  .log-title { font-size:10px; color:#00ff9d; text-transform:uppercase; letter-spacing:2px; margin-bottom:12px; }
  .log-entry { font-size:12px; line-height:1.9; display:flex; gap:10px; }
  .t { color:#4a5568; min-width:80px; }
  .learn { color:#00ff9d; }
  .eval { color:#7c3aed; }
  .rule { color:#ff6b35; }
  .error { color:#ff4757; }
  .dot { width:8px; height:8px; border-radius:50%; background:#00ff9d; display:inline-block; margin-right:6px; animation:blink 1.5s infinite; }
  .section-title { font-size:10px; color:#4a5568; text-transform:uppercase; letter-spacing:2px; margin-bottom:10px; }
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
    <div class="stat-label">Board Slots</div>
    <div class="stat-value" id="v5">—</div>
    <div class="stat-sub">filled / 100</div>
  </div>
  <div class="stat">
    <div class="stat-label">Paid ✅</div>
    <div class="stat-value" id="v6">—</div>
    <div class="stat-sub">confirmed</div>
  </div>
</div>

<div class="confidence">
  <div class="conf-label">Bot Confidence — Admin ሊተካ የሚችልበት ደረጃ</div>
  <div class="conf-bar"><div class="conf-fill" id="confBar" style="width:0%"></div></div>
  <div class="conf-pct" id="confPct">0%</div>
  <div class="ready" id="readyText">⏳ እየተማረ...</div>
</div>

<div class="section-title" style="margin-bottom:10px">📋 BOARD — Live Status</div>
<div class="board-grid" id="boardGrid"></div>

<div class="log-box">
  <div class="log-title">⚡ Live Activity</div>
  <div id="logs"></div>
</div>

<script>
  function addLog(type, msg) {
    if (type === 'ping') return;
    const t = new Date().toTimeString().slice(0,8);
    const el = document.createElement('div');
    el.className = 'log-entry';
    el.innerHTML = '<span class="t">'+t+'</span><span class="'+type+'">['+type.toUpperCase()+']</span><span style="color:#e2e8f0;margin-left:6px">'+msg+'</span>';
    const logs = document.getElementById('logs');
    logs.appendChild(el);
    logs.scrollTop = logs.scrollHeight;
    if (logs.children.length > 100) logs.removeChild(logs.firstChild);
  }

  function renderBoardGrid(slots) {
    const grid = document.getElementById('boardGrid');
    grid.innerHTML = '';
    for (let i = 1; i <= 100; i++) {
      const slot = slots[i];
      const div = document.createElement('div');
      div.className = 'slot ' + (slot?.status || 'open');
      const emoji = slot?.status === 'paid' ? '✅' : slot?.status === 'pending' ? '⏳' : '';
      div.textContent = String(i).padStart(2,'0') + (emoji ? ' '+emoji : '#');
      div.title = slot?.name || 'ክፍት';
      grid.appendChild(div);
    }
  }

  async function fetchStats() {
    try {
      const r = await fetch('/learn-status');
      const d = await r.json();
      document.getElementById('v1').textContent = d.adminPhrases || 0;
      document.getElementById('v2').textContent = d.rules || 0;
      document.getElementById('v3').textContent = d.intents || 0;
      document.getElementById('v5').textContent = d.filledSlots || 0;
      document.getElementById('v6').textContent = d.paidSlots || 0;
      const pct = Math.round((d.confidence || 0) * 100);
      document.getElementById('confBar').style.width = pct + '%';
      document.getElementById('confPct').textContent = pct + '%';
      document.getElementById('readyText').textContent = d.readyToReplace
        ? '✅ Admin ሊተካ ይችላል!'
        : '⏳ እየተማረ... ' + pct + '%';
      if (d.boardSlots) renderBoardGrid(d.boardSlots);
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
    const boardState = await getBoardState().catch(() => null);
    const slots = boardState?.slots || {};
    const filledSlots = Object.values(slots).filter(s => s.name).length;
    const paidSlots = Object.values(slots).filter(s => s.status === 'paid').length;

    res.json({
      adminPhrases: knowledge.adminStyle?.responses?.length || 0,
      rules: knowledge.rules?.length || 0,
      intents: knowledge.intents?.length || 0,
      writingStyle: knowledge.writingStyle?.commonPhrases?.length || 0,
      confidence: knowledge.confidence || 0,
      readyToReplace: knowledge.readyToReplace || false,
      lastUpdated: knowledge.lastUpdated || null,
      filledSlots,
      paidSlots,
      boardSlots: slots,
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

    // ── PRIVATE (admin) ──
    if (msg.chat.type === 'private') {
      if (isAdmin(userId)) {
        // Approve/Reject pending
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

        // Admin photo ለ board learning (private ውስጥ ቢልክ)
        if (msg.photo && msg.caption?.includes('#')) {
          await learnFromBoard(msg.caption, '');
          await bot.sendMessage(chatId, '📋 Board ተማረ ✅');
          return;
        }

        await handleAdminCommand(bot, msg);
      } else {
        await bot.sendMessage(chatId, 'ይህ bot ለ admin ብቻ ነው።');
      }
      return;
    }

    // ── GROUP ──
    if (String(chatId) === String(GROUP_ID) || msg.chat.type === 'supergroup') {
      await handleGroupMessage(bot, msg);
    }

  } catch (err) {
    console.error('[BOT] Unhandled error:', err.message);
    await alertAdmin(bot, `🚨 Unhandled error: ${err.message}`, 'ERROR').catch(() => {});
  }
});

// ── Daily summary — 9 PM ──
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

// ── Startup ──
bot.getMe().then(async (me) => {
  console.log(`✅ Bot started: @${me.username}`);
  const nvidiaOk = await testNvidiaConnection();
  if (!nvidiaOk) {
    console.warn('⚠️ NVIDIA connection failed');
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
