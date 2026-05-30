import {
  readKnowledge, updateKnowledge, saveHistory, getHistory,
  registerMember, getLotteryList, getBotState, setBotState,
  initDB, query,
} from './database.js';
import { learnFromMessage, learnLotteryRules, generateLearningSummary } from './geminiService.js';
import { generateResponse, handleRegistration, generateAnnouncement } from './groqService.js';

// ============================================================
// 🔑 KEY ROTATION
// ============================================================

function loadKeys(prefix) {
  const keys = [];
  let i = 1;
  while (process.env[`${prefix}_${i}`] && i <= 50) {
    keys.push(process.env[`${prefix}_${i}`]);
    i++;
  }
  return keys;
}

const GEMINI_KEYS = loadKeys('GEMINI_KEY');
const GROQ_KEYS = loadKeys('GROQ_KEY');
let geminiIndex = 0;
let groqIndex = 0;

export function getNextGeminiKey() {
  if (GEMINI_KEYS.length === 0) throw new Error('No Gemini API keys found in .env');
  const key = GEMINI_KEYS[geminiIndex];
  geminiIndex = (geminiIndex + 1) % GEMINI_KEYS.length;
  return key;
}

export function getNextGroqKey() {
  if (GROQ_KEYS.length === 0) throw new Error('No Groq API keys found in .env');
  const key = GROQ_KEYS[groqIndex];
  groqIndex = (groqIndex + 1) % GROQ_KEYS.length;
  return key;
}

export function rotateGeminiKey() {
  geminiIndex = (geminiIndex + 1) % GEMINI_KEYS.length;
  return GEMINI_KEYS[geminiIndex];
}

export function rotateGroqKey() {
  groqIndex = (groqIndex + 1) % GROQ_KEYS.length;
  return GROQ_KEYS[groqIndex];
}

export function getKeyStats() {
  return {
    gemini: { total: GEMINI_KEYS.length, currentIndex: geminiIndex },
    groq: { total: GROQ_KEYS.length, currentIndex: groqIndex },
  };
}

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
    await bot.sendMessage(chatId, '✅ Bot is now ON\nGroq ይናገራል + Gemini ይማራል');
    return;
  }

  if (text === '/off') {
    await setBotState(false, ADMIN_ID);
    await bot.sendMessage(chatId, '❌ Bot is now OFF\nGemini ብቻ ይማራል (silent mode)');
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
  • Gemini: ${keyStats.gemini.total} keys
  • Groq: ${keyStats.groq.total} keys
    `;
    await bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
    return;
  }

  if (text === '/summary') {
    await bot.sendMessage(chatId, '⏳ Gemini summary እየሰራ ነው...');
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

  // Save to DB always
  await saveHistory(msg);

  // Gemini always learns
  learnFromMessage(msg, isAdminMessage).catch(err =>
    console.error('[LEARN] Error:', err.message)
  );

  if (isAdminMessage) {
    learnLotteryRules(text).catch(err =>
      console.error('[RULES] Error:', err.message)
    );
    return;
  }

  // Bot OFF → silent
  const isOn = await getBotState();
  if (!isOn) return;

  // Detect registration
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

  // General response
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

// Init DB on startup
await initDB();
