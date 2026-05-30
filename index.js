import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import {
  handleGroupMessage,
  handleAdminCommand,
  isAdmin,
  alertAdmin,
  pendingResponses,
} from './core.js';
import { generateLearningSummary } from './geminiService.js';

// ===== VALIDATE ENV =====
const required = ['TELEGRAM_BOT_TOKEN', 'ADMIN_CHAT_ID', 'GROUP_CHAT_ID'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env var: ${key}`);
    process.exit(1);
  }
}

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
