import 'dotenv/config';
import fs from 'fs-extra';
import { learnFromMessage, learnLotteryRules, generateLearningSummary } from './services/geminiService.js';
import { generateResponse, handleRegistration, generateAnnouncement } from './services/groqService.js';

// ============================================================
// 🔑 KEY ROTATION
// ============================================================

function loadKeys(prefix) {
  const keys = [];
  let i = 1;
  while (process.env[`${prefix}_${i}`]) {
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
  console.log(`[KEY] Gemini key ${geminiIndex} hit limit, rotating...`);
  geminiIndex = (geminiIndex + 1) % GEMINI_KEYS.length;
  return GEMINI_KEYS[geminiIndex];
}

export function rotateGroqKey() {
  console.log(`[KEY] Groq key ${groqIndex} hit limit, rotating...`);
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
// 💾 DATABASE
// ============================================================

const DB_DIR = './db/data';
const FILES = {
  knowledge: `${DB_DIR}/knowledge.json`,
  members: `${DB_DIR}/members.json`,
  history: `${DB_DIR}/history.json`,
  lottery: `${DB_DIR}/lottery.json`,
  botState: `${DB_DIR}/bot_state.json`,
  keyUsage: `${DB_DIR}/key_usage.json`,
};

await fs.ensureDir(DB_DIR);
for (const [key, filepath] of Object.entries(FILES)) {
  if (!await fs.pathExists(filepath)) {
    const defaults = {
      knowledge: {
        adminStyle: { greetings: [], warnings: [], announcements: [], responses: [] },
        userPatterns: {},
        rules: [],
        intents: [],
        writingStyle: { amharic: [], tone: '', commonPhrases: [] },
        lastUpdated: null,
      },
      members: { registered: {}, waitlist: [] },
      history: { messages: [] },
      lottery: {
        isActive: false,
        list: {},
        totalSlots: 100,
        rules: [],
      },
      botState: { isOn: false, lastToggled: null, toggledBy: null },
      keyUsage: { gemini: {}, groq: {} },
    };
    await fs.writeJson(filepath, defaults[key], { spaces: 2 });
  }
}

export async function readDB(name) {
  return await fs.readJson(FILES[name]);
}

export async function writeDB(name, data) {
  await fs.writeJson(FILES[name], data, { spaces: 2 });
}

export async function saveHistory(message) {
  const db = await readDB('history');
  const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
  db.messages = db.messages.filter(m => m.timestamp > fiveDaysAgo);
  db.messages.push({
    id: message.message_id,
    from: {
      id: message.from?.id,
      username: message.from?.username,
      firstName: message.from?.first_name,
    },
    text: message.text || '',
    timestamp: Date.now(),
    date: new Date().toISOString(),
    isAdmin: message._isAdmin || false,
  });
  await writeDB('history', db);
}

function deepMergeArrays(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (Array.isArray(source[key]) && Array.isArray(target[key])) {
      result[key] = [...new Set([...target[key], ...source[key]])];
    } else if (typeof source[key] === 'object' && source[key] !== null) {
      result[key] = deepMergeArrays(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export async function updateKnowledge(updates) {
  const db = await readDB('knowledge');
  const merged = deepMergeArrays(db, updates);
  merged.lastUpdated = new Date().toISOString();
  await writeDB('knowledge', merged);
  return merged;
}

export async function registerMember(userId, username, number) {
  const db = await readDB('lottery');
  if (db.list[number]) return { success: false, reason: 'number_taken' };
  if (Object.values(db.list).find(m => m.userId === userId)) {
    return { success: false, reason: 'already_registered' };
  }
  db.list[number] = { userId, username, registeredAt: new Date().toISOString() };
  await writeDB('lottery', db);
  return { success: true, number };
}

export async function getLotteryList() {
  const db = await readDB('lottery');
  return db.list;
}

export async function getBotState() {
  const db = await readDB('botState');
  return db.isOn;
}

export async function setBotState(isOn, adminId) {
  await writeDB('botState', { isOn, lastToggled: new Date().toISOString(), toggledBy: adminId });
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
    await bot.sendMessage(ADMIN_ID, `${emoji} ${message}`);
  } catch (err) {
    console.error('[ALERT] Failed to send admin alert:', err.message);
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
    const knowledge = await readDB('knowledge');
    const lottery = await readDB('lottery');
    const status = `
📊 *BOT STATUS*
━━━━━━━━━━━━━━
🔛 State: ${isOn ? '✅ ON' : '❌ OFF'}
🧠 Knowledge:
  • Admin phrases: ${knowledge.adminStyle.responses.length}
  • Rules learned: ${knowledge.rules.length}
  • Intents: ${knowledge.intents.length}
🎰 Lottery:
  • Registered: ${Object.keys(lottery.list).length}/100
  • Active: ${lottery.isActive ? 'Yes' : 'No'}
🔑 Keys:
  • Gemini: ${keyStats.gemini.total} keys (current: #${keyStats.gemini.currentIndex + 1})
  • Groq: ${keyStats.groq.total} keys (current: #${keyStats.groq.currentIndex + 1})
    `;
    await bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
    return;
  }

  if (text === '/summary') {
    await bot.sendMessage(chatId, '⏳ Gemini summary እየሰራ ነው...');
    const summary = await generateLearningSummary();
    if (summary) {
      const msg2 = `
📚 *LEARNING SUMMARY*
━━━━━━━━━━━━━━
${summary.summary}

✅ New things learned:
${summary.newThingsLearned.map(t => `• ${t}`).join('\n')}

⚠️ Weak areas:
${summary.weakAreas.map(a => `• ${a}`).join('\n')}

💪 Confidence: ${Math.round(summary.confidence * 100)}%
🎯 Ready to replace admin: ${summary.readyToReplace ? 'YES ✅' : 'Not yet ❌'}
      `;
      await bot.sendMessage(chatId, msg2, { parse_mode: 'Markdown' });
    }
    return;
  }

  if (text === '/list') {
    const lottery = await readDB('lottery');
    const entries = Object.entries(lottery.list);
    if (entries.length === 0) {
      await bot.sendMessage(chatId, '📋 ምንም ሰው አልተመዘገበም');
      return;
    }
    const listText = entries
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([num, data]) => `${num}. @${data.username || data.userId}`)
      .join('\n');
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
    const knowledge = await readDB('knowledge');
    const kb = `
🧠 *KNOWLEDGE BASE*
━━━━━━━━━━━━━━
Admin phrases: ${knowledge.adminStyle.responses.length}
Greetings: ${knowledge.adminStyle.greetings.length}
Warnings: ${knowledge.adminStyle.warnings.length}
Rules: ${knowledge.rules.length}
Intents: ${knowledge.intents.length}
Amharic phrases: ${knowledge.writingStyle?.amharic?.length || 0}
Last updated: ${knowledge.lastUpdated || 'Never'}

Top rules:
${knowledge.rules.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join('\n')}
    `;
    await bot.sendMessage(chatId, kb, { parse_mode: 'Markdown' });
    return;
  }

  await bot.sendMessage(chatId, `
🤖 *ADMIN COMMANDS*
━━━━━━━━━━━━━━
/on - Bot ያብራ (Groq + Gemini)
/off - Bot ያጥፋ (Gemini only)
/status - Bot status
/summary - Learning summary
/list - Lottery list
/knowledge - Knowledge base
/announce <text> - Group announcement
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

  // Bot OFF → silent learning only
  const isOn = await getBotState();
  if (!isOn) {
    console.log('[BOT] Bot is OFF - silent learning mode');
    return;
  }

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
      console.log(`[BOT] Responded with confidence ${result.confidence}`);
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
        await alertAdmin(bot, `✅ @${username} registered → number ${requestedNumber}`, 'INFO');
      }
    } else {
      await bot.sendMessage(chatId, result.response, { reply_to_message_id: msg.message_id });
    }
  } catch (err) {
    console.error('[REGISTRATION] Error:', err.message);
  }
}
