import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import {
  readKnowledge, updateKnowledge, saveHistory, getHistory,
  getLotteryList, getBotState, setBotState,
  initDB, query,
  removeMember, clearLottery,
  saveBoardMessage, getBoardMessage, updateBoardMessageText,
  saveBoardEdit, getUnlearnedEdits, markEditLearned,
  saveDeletedMessage, getDeletedMessages,
  cleanupOldData,
} from './database.js';
import {
  learnFromMessage, learnLotteryRules, generateLearningSummary,
  learningEvents, getTokenStats, testNvidiaConnection,
  learnQAPair, learnFromRating,
  addToBuffer, deepNightLearning,
  generateResponse, generateAnnouncement,
  learnFromEdit, learnFromDelete, decideBotAction,
  learnAction,
  handleIncomingMessage,
  handlePrivateTeaching,
  clearPrivateHistory,
} from './aiService.js';
import { getKeyStats } from './keys.js';
import { handlePaymentPhoto, handleSmsWebhook, handleLotteryPhoto, handleLotterySticker } from './payment_bot.js';
import {
  learnBoardAction,
  handlePrivateBoardTeaching,
  onBoardCreated,
  onBoardEdited,
  onBoardReplaced,
  onAdminReply,
  decideBoardAction,
  nightlyBoardReview,
} from './boardLearning.js';

// ============================================================
// 👑 ADMIN HANDLER
// ============================================================
const ADMIN_ID = parseInt(process.env.ADMIN_CHAT_ID);

function isAdmin(userId) {
  return userId === ADMIN_ID;
}

async function alertAdmin(bot, message, level = 'INFO') {
  const emoji = { INFO: 'ℹ️', WARNING: '⚠️', ERROR: '🚨', SUCCESS: '✅' }[level] || 'ℹ️';
  try {
    await bot.sendMessage(ADMIN_ID, `${emoji} ${message}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[ALERT] Failed:', err.message);
  }
}

const pendingResponses = new Map();

// ============================================================
// 📦 MESSAGE CACHE — delete detection ለማድረግ
// ============================================================
const messageCache = new Map();
const MAX_CACHE_SIZE = 500;

function cacheMessage(messageId, text, userId, chatId) {
  if (messageCache.size >= MAX_CACHE_SIZE) {
    const firstKey = messageCache.keys().next().value;
    messageCache.delete(firstKey);
  }
  messageCache.set(messageId, { text, userId, chatId, time: Date.now() });
}

// ============================================================
// 👑 ADMIN COMMANDS
// ============================================================
async function handleAdminCommand(bot, msg) {
  const text = msg.text || '';
  const chatId = msg.chat.id;

  if (text === '/ratingon') {
    ratingEnabled = true;
    await bot.sendMessage(chatId, '🔔 Rating ተከፈተ');
    return;
  }
  if (text === '/ratingoff') {
    ratingEnabled = false;
    await bot.sendMessage(chatId, '🔕 Rating ጠፋ');
    return;
  }

  if (text === '/on') {
    await setBotState(true, ADMIN_ID);
    await bot.sendMessage(chatId, '✅ Bot is now ON');
    return;
  }
  if (text === '/off') {
    await setBotState(false, ADMIN_ID);
    await bot.sendMessage(chatId, '❌ Bot is now OFF');
    return;
  }

  if (text.startsWith('/threshold ')) {
    const value = parseFloat(text.replace('/threshold ', ''));
    if (isNaN(value) || value < 0 || value > 1) {
      await bot.sendMessage(chatId, '❌ 0 እና 1 መካከል ስጥ\nምሳሌ: /threshold 0.5');
      return;
    }
    CONFIDENCE_THRESHOLD = value;
    await bot.sendMessage(chatId, `✅ Threshold → ${Math.round(value * 100)}%`);
    return;
  }

  if (text === '/status') {
    const isOn = await getBotState();
    const keyStats = getKeyStats();
    const knowledge = await readKnowledge();
    const lotteryList = await getLotteryList();
    const boardMsg = await getBoardMessage();

    await bot.sendMessage(chatId, `
📊 *BOT STATUS*
━━━━━━━━━━━━━━
🔛 State: ${isOn ? '✅ ON' : '❌ OFF'}
🧠 Knowledge:
  • Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
  • Rules learned: ${knowledge.rules?.length || 0}
  • Intents: ${knowledge.intents?.length || 0}
📋 Board:
  • Current message ID: ${boardMsg?.message_id || 'None'}
  • Last updated: ${boardMsg?.sent_at ? new Date(boardMsg.sent_at).toLocaleString() : 'Never'}
🎰 Lottery: ${lotteryList.length} registered
🔑 Keys:
  • DeepSeek/NVIDIA: ${keyStats.deepseek.total} keys
  • Groq: ${keyStats.groq.total} keys
    `, { parse_mode: 'Markdown' });
    return;
  }

  if (text === '/list') {
    const lotteryList = await getLotteryList();
    if (lotteryList.length === 0) {
      await bot.sendMessage(chatId, '📋 ምንም ሰው አልተመዘገበም');
      return;
    }
    const listText = lotteryList.map(m =>
      `${String(m.number).padStart(2, '0')}. ${m.username}`
    ).join('\n');
    await bot.sendMessage(chatId, `📋 *LOTTERY LIST* (${lotteryList.length})\n━━━━━━━━\n${listText}`, {
      parse_mode: 'Markdown'
    });
    return;
  }

  if (text === '/summary') {
    await bot.sendMessage(chatId, '⏳ DeepSeek summary እየሰራ ነው...');
    const summary = await generateLearningSummary();
    if (!summary) {
      await bot.sendMessage(chatId, '❌ Summary ሰራ አልቻለም');
      return;
    }
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
    return;
  }

  if (text.startsWith('/announce ')) {
    const topic = text.replace('/announce ', '');
    await bot.sendMessage(chatId, '⏳ Announcement እየሰራ ነው...');
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
    const ds = t['nvidia-deepseek'] || { calls: 0, input: 0, output: 0, total: 0 };
    const gr = t.groq || { calls: 0, input: 0, output: 0, total: 0 };
    await bot.sendMessage(chatId, `
🔢 *TOKEN USAGE*
━━━━━━━━━━━━━━
🧠 *NVIDIA DeepSeek*
  • Calls: ${ds.calls.toLocaleString()}
  • Total: ${ds.total.toLocaleString()} tokens

⚡ *Groq*
  • Calls: ${gr.calls.toLocaleString()}
  • Total: ${gr.total.toLocaleString()} tokens

📊 *Grand Total: ${(ds.total + gr.total).toLocaleString()} tokens*
    `, { parse_mode: 'Markdown' });
    return;
  }

  if (text === '/history') {
    const history = await getHistory(5);
    await bot.sendMessage(chatId, `📜 Last 5 days: ${history.length} messages in DB`);
    return;
  }

  if (text === '/cleanup') {
    const cleaned = await cleanupOldData();
    await bot.sendMessage(chatId, `
🗑️ *CLEANUP DONE*
━━━━━━━━━━━━━━
History: ${cleaned.history} deleted
Board edits: ${cleaned.boardEdits} deleted
Deleted msgs: ${cleaned.deletedMessages} deleted
Board msgs: ${cleaned.boardMessages} deleted
Action logs: ${cleaned.actionLogs} deleted
QA pairs: ${cleaned.qaPairs} deleted
    `, { parse_mode: 'Markdown' });
    return;
  }

  await bot.sendMessage(chatId, `
🤖 *ADMIN COMMANDS*
━━━━━━━━━━━━━━
/on — Bot ያብራ
/off — Bot ያጥፋ
/threshold <0-1> — Confidence threshold
/ratingon — Rating ያብራ ⭐
/ratingoff — Rating ያጥፋ 🔕
/status — Bot status
/list — የተመዘገቡ ዝርዝር
/summary — Learning summary
/knowledge — Knowledge base
/history — History stats
/tokens — Token usage
/announce <text> — Announcement
/cleanup — Manual cleanup
  `, { parse_mode: 'Markdown' });
}

// ============================================================
// 👥 GROUP HANDLER
// ============================================================
let CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.50');

async function handleGroupMessage(bot, msg) {
  const text = msg.text || '';
  const userId = msg.from?.id;
  const username = msg.from?.username || msg.from?.first_name || 'User';
  const chatId = msg.chat.id;
  const isAdminMessage = userId === ADMIN_ID;

  msg._isAdmin = isAdminMessage;
  await saveHistory(msg);

  // ── Message cache ──
  if (text && msg.message_id) {
    cacheMessage(msg.message_id, text, userId, chatId);
  }

// ── STICKER ──
if (msg.sticker) {
  if (isAdmin(userId)) {
    await handleLotterySticker(bot, msg);
  }
  return;
}

// ── ADMIN PHOTO ──
if (msg.photo) {
  if (isAdmin(userId)) {
    await handleLotteryPhoto(bot, msg);
    const caption = msg.caption || "";
      if (caption) {
        learnFromMessage({ ...msg, text: caption }, true).catch(() => {});
        learnLotteryRules(caption).catch(() => {});
      }

      setImmediate(() => {
        learnAction(
          "admin_sent_photo",
          caption || "photo_no_caption",
          "Admin sent a photo — AI should learn what type and what usually follows",
          {
            caption,
            hour: new Date().getHours(),
            minute: new Date().getMinutes(),
            dayOfWeek: new Date().getDay(),
            timestamp: Date.now(),
          }
        ).catch(() => {});
      });

      learningEvents.emit("activity", {
        type: "learn",
        msg: `📷 Admin photo learned — hour:${new Date().getHours()} day:${new Date().getDay()}${caption ? ` caption:"${caption.slice(0, 30)}"` : ""}`
      });
      return; // ← return ወደ ውስጥ ገባ
    }
    // User photo = payment screenshot ✅
    await handlePaymentPhoto(bot, msg);
    return;
  }

  // ── ADMIN MESSAGE ──
  if (isAdminMessage) {

    // ── Admin reply → Q&A learning ──
    if (msg.reply_to_message) {
      const repliedMsg = msg.reply_to_message;
      const userText = repliedMsg.text || '';
      const repliedUserId = repliedMsg.from?.id;

      if (repliedUserId !== ADMIN_ID && userText) {
        setImmediate(() => {
  learnQAPair(userText, text, `Group reply by admin`).catch(() => {});
  onAdminReply(userText, text, username, 'reply').catch(() => {});
});

        addToBuffer(
          { text: `[BOT_CORRECTION] User ጠየቀ: "${userText}" — ትክክለኛ መልስ: "${text}"` },
          true,
          null
        );

        learningEvents.emit('activity', {
          type: 'learn',
          msg: `💬 Q&A learned — "${userText.slice(0, 30)}" → "${text.slice(0, 30)}"`
        });
      }

      if (text.includes('✅') || text.includes('confirmed') || text.includes('ተመዘገበ')) {
        const numberMatch = userText.match(/\d+/);
        if (numberMatch) {
          setImmediate(() => {
            learnAction(
              'confirm_registration',
              userText,
              'Admin confirmed registration via reply',
              {
                userRequest: userText,
                adminReply: text,
                registeredNumber: numberMatch[0],
                repliedUsername: repliedMsg.from?.username || repliedMsg.from?.first_name,
              }
            ).catch(() => {});
          });

          learningEvents.emit('activity', {
            type: 'learn',
            msg: `✅ Registration confirm pattern learned — #${numberMatch[0]}`
          });
        }
      }

      if (text.includes('❌') || text.includes('ተሰርዟል') || text.includes('አልተቀበለም')) {
        setImmediate(() => {
          learnAction(
            'reject_registration',
            userText,
            'Admin rejected registration',
            { userRequest: userText, adminReply: text }
          ).catch(() => {});
        });
      }
    }

    // ── Board detect — # 5+ ──
    const hashCount = (text.match(/#/g) || []).length;
    if (hashCount >= 5) {
      const existingBoard = await getBoardMessage();
      await updateKnowledge({ boardTemplate: text });
      await saveBoardMessage(msg.message_id, chatId, text);
      await onBoardCreated(msg.message_id, chatId, text, userId);
      
      if (existingBoard?.message_id && existingBoard.message_id !== msg.message_id) {
        setImmediate(() => {
  learnFromDelete(existingBoard.text, 'admin_replaced_board').catch(() => {});
  onBoardReplaced(existingBoard.message_id, existingBoard.text, text, userId).catch(() => {});
  learnAction(
            'board_replaced',
            existingBoard.text?.slice(0, 100) || '',
            'Admin posted new board — bot must learn: when admin replaces board, bot should do same with its own message',
            {
              oldMessageId: existingBoard.message_id,
              newText: text.slice(0, 200),
              lesson: 'bot sends its own board message and edits it — never edits admin message',
            }
          ).catch(() => {});
        });
      }

      setImmediate(() => {
        const now = new Date();
        learnAction(
          'admin_posted_board',
          text.slice(0, 100),
          'Admin posted board — bot learns timing, structure, and that it must send its OWN board to be able to edit it',
          {
            hour: now.getHours(),
            minute: now.getMinutes(),
            dayOfWeek: now.getDay(),
            slotCount: hashCount,
            boardLength: text.length,
            boardText: text,
            lesson: 'when bot decides to post board, it sends its own message and saves that message_id so it can edit it later',
          }
        ).catch(() => {});
        learnFromMessage(msg, true).catch(() => {});
        learnLotteryRules(text).catch(() => {});
      });

      learningEvents.emit('activity', {
        type: 'learn',
        msg: `📋 Board learned from admin — day:${new Date().getDay()} hour:${new Date().getHours()} slots:${hashCount}`
      });

      addToBuffer(msg, true);
      return;
    }

    // ── ⏳ → ✅ payment confirmation detect ──
    if ((text.includes('⏳') || text.includes('✅')) && text.includes('#')) {
      setImmediate(() => {
        learnAction(
          'payment_status_update',
          text.slice(0, 100),
          'Admin updated payment status on board',
          { statusText: text }
        ).catch(() => {});
      });
    }

    // ── Bot mention ካለ → AI teaching/command ──
    const botMentioned = text.toLowerCase().includes(
      (process.env.BOT_TRIGGER || 'bot').toLowerCase()
    );

    if (botMentioned) {
      const boardMsg = await getBoardMessage();
      const result = await handleIncomingMessage(
        msg, userId, username, boardMsg?.text || ''
      );

      if (!result) return;

      // ── send_board action ──
      if (result.action === 'send_board' && result.boardText) {
        const sent = await bot.sendMessage(chatId, result.boardText);
        await saveBoardMessage(sent.message_id, chatId, result.boardText);
        await alertAdmin(bot, `📋 Bot board ላከ!\nTriggered by admin: "${text}"`, 'SUCCESS');
        return;
      }

      // ── teaching/command response ──
      if (result.response) {
        await bot.sendMessage(chatId, result.response);
      }
      return;
    }

    addToBuffer(msg, true);
    learnLotteryRules(text).catch(() => {});
    learnFromMessage(msg, true).catch(() => {});
    return;
  }

  // ── USER MESSAGE — bot off ከሆነ ዝም ──
  const isOn = await getBotState();
  if (!isOn) return;

  // ── AI RESPONSE ──
try {
  const boardMsg = await getBoardMessage();
  const currentBoardText = boardMsg?.text || '';

  await bot.sendChatAction(chatId, 'typing');

  const result = await handleIncomingMessage(
      msg, userId, username, currentBoardText
    );

    if (!result) return;

    // ── ACTION EXECUTOR ──

    // Send board — AI ተምሮ ሲወስን ራሱ ይልካል
    if (result.action === 'send_board') {
      const boardText = result.boardText;
      if (boardText) {
        const sent = await bot.sendMessage(chatId, boardText);
        await saveBoardMessage(sent.message_id, chatId, boardText);

        learningEvents.emit('activity', {
          type: 'learn',
          msg: `📋 Bot ራሱ board ላከ ✅`
        });

        await alertAdmin(bot, `📋 Bot ራሱ board ላከ!\nTriggered by: "${text}"`, 'INFO');
      }
    }

    // Register slot — bot ራሱ የላከው board ስለሆነ edit ይሰራል
    if (result.action === 'register_slot' && result.slotNumber) {
      const boardMsg = await getBoardMessage();
      if (boardMsg?.message_id) {
        const beforeText = boardMsg.text || '';
        const decision = await decideBoardAction(text, username, beforeText);

if (!decision) {
  await bot.sendMessage(chatId, '❌ አሁን ለጊዜው አልተሳካም። እንደገና ሞክር።', {
    reply_to_message_id: msg.message_id,
  });
  await alertAdmin(bot, `⚠️ Board edit failed — NVIDIA connection error\nUser: @${username}\nMessage: "${text}"`, 'WARNING');
  return;
}

const newEntry = decision?.boardEdit?.newEntry;

const newLines = beforeText.split('\n').map(line =>
  (newEntry && line.includes(`${result.slotNumber}#`))
    ? newEntry
    : line
);
const newBoardText = newLines.join('\n');

        try {
          await bot.editMessageText(newBoardText, {
            chat_id: chatId,
            message_id: boardMsg.message_id,
          });
          await saveBoardEdit(boardMsg.message_id, chatId, beforeText, newBoardText);
          await updateBoardMessageText(boardMsg.message_id, newBoardText);

          setImmediate(() => {
            learnAction(
  'auto_register_slot',
  text,
  `Bot auto-edited board`,
  {
    userMessage: text,
    boardBefore: beforeText.slice(0, 200),
    aiDecision: decision?.boardEdit || {},
  }
            ).catch(() => {});
          });

          learningEvents.emit('activity', {
            type: 'learn',
            msg: `✅ Bot registered @${username} → slot ${result.slotNumber}`
          });
        } catch (editErr) {
  if (editErr.message?.includes('message is not modified')) {
    // AI ምንም አልቀየረም — ዝም በል
    console.log('[BOARD EDIT] No change detected');
  } else if (editErr.message?.includes("message can't be edited")) {
    learningEvents.emit('activity', {
      type: 'eval',
      msg: `⚠️ Board edit skipped — not bot's message`
    });
  } else {
    console.error('[BOARD EDIT] Error:', editErr.message);
  }
}
      await alertAdmin(bot, `✅ Bot board edit አደረገ — slot ${result.slotNumber}`, 'SUCCESS');
      }
    }

    // Send response — ሁልጊዜ ይምለስ
    if (result.response) {
  // ወዲያው User ላክ
  const sentMsg = await bot.sendMessage(chatId, result.response, {
    reply_to_message_id: msg.message_id,
  });

  // ከዛ በኋላ background
  setImmediate(async () => {
    try {
      addToBuffer(msg, false, result.response);

      const ratingId = `rate_${sentMsg.message_id}_${Date.now()}`;
      pendingRatings.set(ratingId, {
        userText: text,
        botResponse: result.response,
        chatId,
        messageId: sentMsg.message_id,
      });

      if (ratingEnabled) {
        await alertAdmin(
          bot,
          `🤖 Bot ተናገረ:
👤 @${username}: "${text}"
🤖 Bot: "${result.response}" (${Math.round((result.confidence||0)*100)}%)`,
          'INFO'
        );
        await bot.sendMessage(ADMIN_ID, '⭐ Rating:', {
          reply_markup: {
            inline_keyboard: [[
              { text: '👎', callback_data: `${ratingId}:1` },
              { text: '😐', callback_data: `${ratingId}:2` },
              { text: '👍', callback_data: `${ratingId}:3` },
              { text: '🔥', callback_data: `${ratingId}:4` },
            ], [
              { text: '🔕 Rating አጥፋ', callback_data: 'toggle_rating:off' },
            ]]
          }
        });
      }

      if (result.confidence < CONFIDENCE_THRESHOLD) {
        await alertAdmin(
          bot,
          `⚠️ Low confidence (${Math.round(result.confidence * 100)}%)
@${username}: "${text}"
Bot: "${result.response}"`,
          'WARNING'
        );
      }
    } catch (err) {
      console.error('[BACKGROUND]', err.message);
      await alertAdmin(bot, `⚠️ Background error: ${err.message}`, 'WARNING');
    }
  });
}
  } catch (err) {
    console.error('[GROUP] Error:', err.message);
    await alertAdmin(bot, `🚨 Error: ${err.message}`, 'ERROR');
  }
}

// ============================================================
// ⭐ RATING SYSTEM
// ============================================================
let ratingEnabled = true;
const pendingRatings = new Map();
const RATING_LABELS = { 1: "👎 ዝቅተኛ", 2: "😐 መካከለኛ", 3: "👍 አሪፍ", 4: "🔥 በጣም አሪፍ" };

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
  .conf-bar { height:8px; background:#1e1e2e; border-radius:4px; overflow:hidden; }
  .conf-fill { height:100%; border-radius:4px; background:linear-gradient(90deg,#00ff9d,#7c3aed); transition:width 1s ease; }
  .conf-pct { font-size:28px; font-weight:700; color:#00ff9d; margin-top:6px; }
  .log-box { background:#070710; border:1px solid #1e1e2e; border-radius:10px; padding:16px; height:280px; overflow-y:auto; }
  .log-entry { font-size:12px; line-height:1.9; display:flex; gap:10px; }
  .t { color:#4a5568; min-width:80px; }
  .learn { color:#00ff9d; }
  .eval { color:#7c3aed; }
  .rule { color:#ff6b35; }
  .error { color:#ff4757; }
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
    <div class="stat-label">Board Edits</div>
    <div class="stat-value" id="v4">—</div>
    <div class="stat-sub">learned</div>
  </div>
  <div class="stat">
    <div class="stat-label">Registered</div>
    <div class="stat-value" id="v5">—</div>
    <div class="stat-sub">members</div>
  </div>
</div>

<div class="confidence">
  <div style="font-size:10px;color:#4a5568;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Bot Confidence</div>
  <div class="conf-bar"><div class="conf-fill" id="confBar" style="width:0%"></div></div>
  <div class="conf-pct" id="confPct">0%</div>
  <div style="font-size:13px;margin-top:8px" id="readyText">⏳ እየተማረ...</div>
</div>

<div class="log-box">
  <div style="font-size:10px;color:#00ff9d;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px">⚡ Live Activity</div>
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

  async function fetchStats() {
    try {
      const r = await fetch('/learn-status');
      const d = await r.json();
      document.getElementById('v1').textContent = d.adminPhrases || 0;
      document.getElementById('v2').textContent = d.rules || 0;
      document.getElementById('v3').textContent = d.intents || 0;
      document.getElementById('v4').textContent = d.boardEdits || 0;
      document.getElementById('v5').textContent = d.registered || 0;
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
  es.onerror = () => addLog('error', 'Reconnecting...');

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
// ── SMS Webhook ──
app.post('/sms', express.text({ type: '*/*' }), async (req, res) => {
  res.json({ success: true, received: true });
  try {
    await handleSmsWebhook(req.body);
  } catch (err) {
    console.error('[SMS] Webhook error:', err.message);
  }
});
app.get('/learn-status', async (req, res) => {
  try {
    const knowledge = await readKnowledge();
    const lotteryList = await getLotteryList();
    const edits = await query(`SELECT COUNT(*) FROM board_edits`);

    res.json({
      adminPhrases: knowledge.adminStyle?.responses?.length || 0,
      rules: knowledge.rules?.length || 0,
      intents: knowledge.intents?.length || 0,
      boardEdits: parseInt(edits.rows[0]?.count) || 0,
      registered: lotteryList.length,
      confidence: knowledge.confidence || 0,
      readyToReplace: knowledge.readyToReplace || false,
      lastUpdated: knowledge.lastUpdated || null,
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

// ── REGULAR MESSAGES ──
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text || '';

    // ── PRIVATE (admin) ──
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
            await bot.sendMessage(ADMIN_ID, '✅ Response sent');
          } else {
            await bot.sendMessage(ADMIN_ID, '❌ Not found or expired');
          }
          return;
        }

        if (text.startsWith('/reject_')) {
          const pendingId = text.replace('/reject_', '');
          pendingResponses.delete(pendingId);
          await bot.sendMessage(ADMIN_ID, '🗑️ Rejected');
          return;
        }

        // ── /clear — history ሰርዝ ──
        if (text === '/clear') {
          clearPrivateHistory(userId);
          await bot.sendMessage(chatId, '🗑️ Conversation history ጠፋ — አዲስ ጀምር!');
          return;
        }

        // ── /commands ──
        if (text.startsWith('/')) {
          await handleAdminCommand(bot, msg);
          return;
        }

        // ── Interactive teaching mode ──
        await bot.sendChatAction(chatId, 'typing');
        const [reply] = await Promise.all([
  handlePrivateTeaching(userId, text),
  handlePrivateBoardTeaching(userId, text),
]);
await bot.sendMessage(chatId, reply);

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
    console.error('[BOT] Error:', err.message);
    await alertAdmin(bot, `🚨 Error: ${err.message}`, 'ERROR').catch(() => {});
  }
});

// ── EDITED MESSAGES ──
bot.on('edited_message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (String(chatId) !== String(GROUP_ID) && msg.chat.type !== 'supergroup') return;

    const afterText = msg.text || '';
    const messageId = msg.message_id;

    const cached = messageCache.get(messageId);
    const boardMsg = await getBoardMessage();
    const beforeText = boardMsg?.message_id === messageId
      ? boardMsg.text
      : cached?.text || null;

    await saveBoardEdit(messageId, chatId, beforeText, afterText);

    if (boardMsg?.message_id === messageId) {
      await updateBoardMessageText(messageId, afterText);
    }

    cacheMessage(messageId, afterText, userId, chatId);

    if (beforeText && afterText) {
      const hadPending = beforeText.includes('⏳');
      const nowConfirmed = afterText.includes('✅');
      const hadConfirmed = beforeText.includes('✅');
      const nowRemoved = !afterText.includes('✅') && hadConfirmed;

      if (hadPending && nowConfirmed) {
        setImmediate(() => {
          learnAction(
            'payment_confirmed_via_edit',
            beforeText.slice(0, 100),
            'Admin changed ⏳ to ✅ — payment confirmed',
            { beforeText: beforeText.slice(0, 200), afterText: afterText.slice(0, 200) }
          ).catch(() => {});
        });

        learningEvents.emit('activity', {
          type: 'learn',
          msg: `💰 Payment confirm pattern learned — ⏳ → ✅`
        });
      }

      if (nowRemoved) {
        setImmediate(() => {
          learnAction(
            'member_removed_via_edit',
            beforeText.slice(0, 100),
            'Admin removed member from board',
            { beforeText: beforeText.slice(0, 200), afterText: afterText.slice(0, 200) }
          ).catch(() => {});
        });

        learningEvents.emit('activity', {
          type: 'learn',
          msg: `❌ Member removal pattern learned`
        });
      }
    }

    setImmediate(() => {
      learnFromEdit(messageId, beforeText, afterText)
        .catch(err => console.error('[EDIT] Learn error:', err.message));
    });
    await onBoardEdited(messageId, beforeText, afterText, userId);
    learningEvents.emit('activity', {
      type: 'learn',
      msg: `✏️ Edit detected & learned — message ${messageId}`
    });

    if (isAdmin(userId)) {
      await alertAdmin(
        bot,
        `✏️ Board edit learned!\nMsg ID: ${messageId}`,
        'INFO'
      );
    }

  } catch (err) {
    console.error('[EDIT] Handler error:', err.message);
  }
});

// ============================================================
// ⭐ CALLBACK QUERIES
// ============================================================
bot.on('callback_query', async (query) => {
  const data = query.data;
  const userId = query.from?.id;

  if (!isAdmin(userId)) {
    await bot.answerCallbackQuery(query.id, { text: 'Admin ብቻ 🚫' });
    return;
  }

  if (data === 'toggle_rating:off') {
    ratingEnabled = false;
    await bot.answerCallbackQuery(query.id, { text: '🔕 Rating ጠፋ' });
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: '🔔 Rating አብራ', callback_data: 'toggle_rating:on' }]] },
      { chat_id: query.message.chat.id, message_id: query.message.message_id }
    );
    return;
  }

  if (data === 'toggle_rating:on') {
    ratingEnabled = true;
    await bot.answerCallbackQuery(query.id, { text: '🔔 Rating ተከፈተ' });
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: '🔕 Rating አጥፋ', callback_data: 'toggle_rating:off' }]] },
      { chat_id: query.message.chat.id, message_id: query.message.message_id }
    );
    return;
  }

  if (data.startsWith('rate_')) {
    const lastColon = data.lastIndexOf(':');
    const rId = data.substring(0, lastColon);
    const score = parseInt(data.substring(lastColon + 1));
    const pending = pendingRatings.get(rId);

    if (!pending) {
      await bot.answerCallbackQuery(query.id, { text: '⏰ Expired' });
      return;
    }

    const label = RATING_LABELS[score] || '?';

    learnFromRating(pending.userText, pending.botResponse, score)
      .then(() => {
        learningEvents.emit('activity', {
          type: score >= 3 ? 'learn' : 'eval',
          msg: `⭐ Rating: ${label} — "${pending.userText.slice(0, 30)}"`
        });
      }).catch(() => {});

    pendingRatings.delete(rId);

    await bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: `✅ ${label}`, callback_data: 'done' }]] },
      { chat_id: query.message.chat.id, message_id: query.message.message_id }
    );
    await bot.answerCallbackQuery(query.id, { text: `${label} ✅` });
    return;
  }

  await bot.answerCallbackQuery(query.id);
});

// ============================================================
// ⏰ CRON JOBS
// ============================================================

// ── ሌሊት 11 PM — Deep Learning + Cleanup ──
cron.schedule('0 23 * * *', async () => {
  try {
    await alertAdmin(bot, '🌙 24hr Deep Learning እየጀመረ...', 'INFO');

    const result = await deepNightLearning();
    await nightlyBoardReview();
    if (result) {
      await bot.sendMessage(
        ADMIN_ID,
        `🌙 *DEEP LEARNING ተጠናቀቀ!*\n━━━━━━━━━━━━━━\n` +
        `📚 ${result.dailySummary}\n\n` +
        `🎯 Patterns: ${result.totalPatternsLearned}\n` +
        `💪 Confidence: ${Math.round((result.newConfidence || 0) * 100)}%\n` +
        `⚠️ Gaps: ${result.gaps?.slice(0, 3).join(', ') || 'None'}`,
        { parse_mode: 'Markdown' }
      );
    }

    const cleaned = await cleanupOldData();
    await alertAdmin(
      bot,
      `🗑️ Cleanup done:\nHistory: ${cleaned.history} | Edits: ${cleaned.boardEdits} | QA: ${cleaned.qaPairs}`,
      'INFO'
    );

  } catch (err) {
    console.error('[CRON] Night error:', err.message);
  }
});

// ── 9 PM — Daily Summary ──
cron.schedule('0 21 * * *', async () => {
  try {
    const summary = await generateLearningSummary();
    if (summary) {
      await bot.sendMessage(
        ADMIN_ID,
        `📊 *DAILY REPORT*\n━━━━━━━━━━━━━━\n${summary.summary}\n\n` +
        `💪 Confidence: ${Math.round(summary.confidence * 100)}%\n` +
        `🎯 Ready: ${summary.readyToReplace ? 'YES ✅' : 'Not yet'}`,
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
  await alertAdmin(
    bot,
    `✅ Bot started!\n@${me.username} online.\n🧠 NVIDIA: ${nvidiaOk ? '✅' : '❌'}`,
    'SUCCESS'
  );
}).catch(err => {
  console.error('❌ Bot failed:', err.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await alertAdmin(bot, '🛑 Bot shutting down...', 'WARNING').catch(() => {});
  process.exit(0);
});
