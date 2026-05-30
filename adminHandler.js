import { readDB, writeDB, setBotState, getBotState } from '../db/database.js';
import { getKeyStats } from '../services/keyRotation.js';
import { generateLearningSummary } from '../services/geminiService.js';
import { generateAnnouncement } from '../services/groqService.js';

const ADMIN_ID = parseInt(process.env.ADMIN_CHAT_ID);

export function isAdmin(userId) {
  return userId === ADMIN_ID;
}

// Send admin alert to private chat
export async function alertAdmin(bot, message, level = 'INFO') {
  const emoji = { INFO: 'ℹ️', WARNING: '⚠️', ERROR: '🚨', SUCCESS: '✅' }[level] || 'ℹ️';
  try {
    await bot.sendMessage(ADMIN_ID, `${emoji} ${message}`);
  } catch (err) {
    console.error('[ALERT] Failed to send admin alert:', err.message);
  }
}

// Handle admin commands in private chat
export async function handleAdminCommand(bot, msg) {
  const text = msg.text || '';
  const chatId = msg.chat.id;

  // /on - Turn bot on
  if (text === '/on') {
    await setBotState(true, ADMIN_ID);
    await bot.sendMessage(chatId, '✅ Bot is now ON\nGroq ይናገራል + Gemini ይማራል');
    return;
  }

  // /off - Turn bot off
  if (text === '/off') {
    await setBotState(false, ADMIN_ID);
    await bot.sendMessage(chatId, '❌ Bot is now OFF\nGemini ብቻ ይማራል (silent mode)');
    return;
  }

  // /status - Bot status
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

  // /summary - Learning summary
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

  // /list - Show lottery registration list
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

  // /announce <text> - Make bot post announcement in group
  if (text.startsWith('/announce ')) {
    const topic = text.replace('/announce ', '');
    await bot.sendMessage(chatId, '⏳ Groq announcement እየሰራ ነው...');
    const announcement = await generateAnnouncement(topic, '');
    const GROUP_ID = process.env.GROUP_CHAT_ID;
    await bot.sendMessage(GROUP_ID, announcement);
    await bot.sendMessage(chatId, '✅ Announcement ተላከ:\n\n' + announcement);
    return;
  }

  // /approve <response> - Approve a pending bot response
  if (text.startsWith('/approve ')) {
    // Handled in main index.js via pendingResponses map
    return;
  }

  // /knowledge - Show knowledge base summary
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

  // Help menu
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
