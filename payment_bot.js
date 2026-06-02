// payment_bot.js — Telegram bot + Groq Vision payment verification
// Dependencies: npm install node-telegram-bot-api groq-sdk node-fetch

import TelegramBot from 'node-telegram-bot-api';
import Groq from 'groq-sdk';
import fetch from 'node-fetch';
import {
  initPaymentTables,
  saveSmsPayment,
  saveScreenshotPayment,
  tryMatch,
  cleanupPayments,
} from './payment_db.js';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

// ===== INIT =====
await initPaymentTables();
console.log('[Bot] Payment bot started ✅');

// ===== SMS WEBHOOK =====
export async function handleSmsWebhook(rawSms) {
  console.log('[SMS] Received:', rawSms);

  const parsed = await parseSms(rawSms); // async ሆነ (CBE Transfer URL fetch ስለሚያደርግ)
  if (!parsed) {
    console.log('[SMS] Could not parse SMS');
    return { success: false, reason: 'unparseable' };
  }

  const { refNo, amount, type } = parsed;
  console.log(`[SMS] Parsed → Type: ${type} | Ref: ${refNo} | Amount: ${amount}`);

  if (!refNo) {
    console.log('[SMS] Ref not found — skipping save');
    return { success: false, reason: 'no_ref' };
  }

  const result = await saveSmsPayment(refNo, amount, type, rawSms);

  if (result.matched) {
    await notifyMatch(result.matched);
  }

  return { success: true, ...parsed };
}

// ===== SMS PARSER (async — CBE Transfer URL fetch ያደርጋል) =====
async function parseSms(sms) {

  // 1️⃣ CBE Credit SMS — Ref ቀጥታ አለ
  // Example: "Credited with ETB 50.00...Ref No FT2615366QVD"
  const cbeCredit = sms.match(
    /Credited with ETB ([\d,]+\.?\d*).+?Ref No\s+([A-Z0-9]+)/s
  );
  if (cbeCredit) {
    return {
      type: 'CBE',
      amount: parseFloat(cbeCredit[1].replace(',', '')),
      refNo: cbeCredit[2],
    };
  }

  // 2️⃣ CBE Transfer SMS — Ref URL ውስጥ ነው (fetch ያስፈልጋል)
  // Example: "transferred ETB 50.61...https://Mbreciept.cbe.com.et/fHCxz66pCMvYxsKeDA"
  const cbeTransfer = sms.match(
    /transferred ETB ([\d,]+\.?\d*).+(https:\/\/\S+)/s
  );
  if (cbeTransfer) {
    const amount = parseFloat(cbeTransfer[1].replace(',', ''));
    const receiptUrl = cbeTransfer[2].trim();
    console.log(`[SMS] CBE Transfer detected — fetching ref from URL: ${receiptUrl}`);
    const refNo = await fetchRefFromUrl(receiptUrl);
    return { type: 'CBE', amount, refNo };
  }

  // 3️⃣ Telebirr SMS — transaction number ቀጥታ አለ (URL አያስፈልግም)
  // Example: "received ETB 180.00...transaction number is DF22JHUTOS"
  const telebirr = sms.match(
    /received ETB ([\d,]+\.?\d*).+?transaction number is\s+([A-Z0-9]+)/s
  );
  if (telebirr) {
    return {
      type: 'Telebirr',
      amount: parseFloat(telebirr[1].replace(',', '')),
      refNo: telebirr[2],
    };
  }

  return null;
}

// ===== CBE RECEIPT URL — Ref ያወጣል =====
async function fetchRefFromUrl(url) {
  try {
    const res = await fetch(url, {
      headers: {
        // Mobile browser እንዳለ ያስመስላል (CBE site mobile-first ነው)
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 10000,
    });

    if (!res.ok) {
      console.error(`[RefFetch] HTTP ${res.status} for URL: ${url}`);
      return null;
    }

    const html = await res.text();

    // VAT Receipt No ወይም Reference No ይፈልጋል
    // Page ላይ: "VAT Receipt No: FT261539G8ZN" ወይም "Reference No. (VAT No): FT261539G8ZN"
    const match = html.match(
      /(?:VAT\s*Receipt\s*No|Reference\s*No)[^A-Z0-9]*([A-Z]{2}\d{6,}[A-Z0-9]*)/i
    );

    if (match) {
      console.log(`[RefFetch] Found ref: ${match[1]}`);
      return match[1];
    }

    console.log('[RefFetch] Ref not found in page HTML');
    return null;

  } catch (err) {
    console.error('[RefFetch] Failed:', err.message);
    return null;
  }
}

// ===== TELEGRAM — Screenshot handler =====
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  // Group ውስጥ ብቻ ይቀበላል
  if (chatId.toString() !== GROUP_CHAT_ID.toString()) return;

  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileUrl = await getPhotoUrl(fileId);
    const imageBase64 = await downloadImageAsBase64(fileUrl);

    await bot.sendMessage(chatId, '⏳ Screenshot እየተረጋገጠ ነው...', {
      reply_to_message_id: msg.message_id,
    });

    const analysis = await analyzeScreenshot(imageBase64);
    console.log(`[Bot] Screenshot analysis for ${telegramId}:`, analysis);

    const saved = await saveScreenshotPayment(
      telegramId,
      analysis.refNo,
      analysis.photoType,
      analysis.description
    );

    if (analysis.photoType !== 'CBE' && analysis.photoType !== 'Telebirr') {
      await bot.sendMessage(
        chatId,
        `❌ ይህ የክፍያ ደረሰኝ አይደለም።\n📋 ምስሉ: ${analysis.description}`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    if (!analysis.refNo) {
      await bot.sendMessage(
        chatId,
        `⚠️ Reference number ሊነበብ አልቻለም። ግልጽ screenshot ይላኩ።`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    if (saved.matched) {
      await notifyMatch(saved.matched, msg.message_id, chatId);
    } else {
      await bot.sendMessage(
        chatId,
        `✅ Screenshot ተቀብሏል። SMS ሲረጋገጥ ይወጣዋል...\n🔖 Ref: ${analysis.refNo}`,
        { reply_to_message_id: msg.message_id }
      );
    }

  } catch (err) {
    console.error('[Bot] Photo handler error:', err.message);
    await bot.sendMessage(chatId, '❌ Error ተፈጥሯል። እንደገና ይሞክሩ።', {
      reply_to_message_id: msg.message_id,
    });
  }
});

// ===== GROQ VISION — Screenshot ይተነትናል =====
async function analyzeScreenshot(imageBase64) {
  const prompt = `You are a payment receipt analyzer. Look at this image and extract information.

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "photoType": "CBE" | "Telebirr" | "other",
  "refNo": "reference number or null",
  "description": "brief description of what the image shows in Amharic or English"
}

Rules:
- photoType "CBE" = Commercial Bank of Ethiopia receipt
- photoType "Telebirr" = Telebirr payment receipt  
- photoType "other" = anything else (food, selfie, document, etc.)
- refNo: 
    For CBE: look for "VAT Receipt No", "Reference No", or "Ref No"
    For Telebirr: look for "transaction number"
- If not a payment receipt, set refNo to null
- description: describe what the image actually shows`;

  const response = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
    max_tokens: 300,
    temperature: 0.1,
  });

  try {
    const text = response.choices[0].message.content.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { photoType: 'other', refNo: null, description: 'Could not analyze image' };
  }
}

// ===== MATCH NOTIFICATION =====
async function notifyMatch(matchData, replyToMsgId = null, chatId = null) {
  const { telegramId, amount, type } = matchData;

  const message =
    `✅ ክፍያ ተረጋግጧል!\n` +
    `💰 Amount: ETB ${amount}\n` +
    `🏦 Via: ${type}\n` +
    `👤 Telegram ID: ${telegramId}`;

  console.log('[Bot] Payment approved:', matchData);

  if (chatId && replyToMsgId) {
    await bot.sendMessage(chatId, message, { reply_to_message_id: replyToMsgId });
  } else if (GROUP_CHAT_ID) {
    await bot.sendMessage(GROUP_CHAT_ID, message);
  }
}

// ===== HELPERS =====
async function getPhotoUrl(fileId) {
  const file = await bot.getFile(fileId);
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
}

async function downloadImageAsBase64(url) {
  const res = await fetch(url);
  const buffer = await res.buffer();
  return buffer.toString('base64');
}

// ===== CRON — ሁልቀት 6 ሰዓት አሮጌ records ይሰርዛሉ =====
setInterval(async () => {
  const result = await cleanupPayments();
  console.log('[Cron] Cleanup result:', result);
}, 1000 * 60 * 60 * 6);
