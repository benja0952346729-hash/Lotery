// payment_bot.js — Payment verification functions (no bot instance)
// index.js ውስጥ import ይሆናል

import Groq from 'groq-sdk';
import fetch from 'node-fetch';
import {
  saveSmsPayment,
  saveScreenshotPayment,
  cleanupPayments,
  saveLotteryResult,
  saveLotteryLiveEvent,
} from './database.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

// ===== SMS WEBHOOK =====
export async function handleSmsWebhook(rawSms) {
  console.log('[SMS] Received:', rawSms);

  const parsed = await parseSms(rawSms);
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

  return { success: true, matched: result.matched || null, ...parsed };
}

// ===== PAYMENT PHOTO HANDLER — index.js ከ bot.on('message') ይጠራዋል =====
export async function handlePaymentPhoto(bot, msg) {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  console.log(`[Payment] 📸 Photo received from ${telegramId} in chat ${chatId}`);

  if (chatId.toString() !== GROUP_CHAT_ID.toString()) {
    console.log(`[Payment] ❌ Wrong chat — expected ${GROUP_CHAT_ID}, got ${chatId}`);
    return;
  }

  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileUrl = await getPhotoUrl(bot, fileId);
    const imageBase64 = await downloadImageAsBase64(fileUrl);

    await bot.sendMessage(chatId, '⏳ Screenshot እየተረጋገጠ ነው...', {
      reply_to_message_id: msg.message_id,
    });

    const analysis = await analyzeScreenshot(imageBase64);
    console.log(`[Payment] Screenshot analysis for ${telegramId}:`, analysis);

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
      await notifyMatch(bot, saved.matched, msg.message_id, chatId);
    } else {
      await bot.sendMessage(
        chatId,
        `✅ Screenshot ተቀብሏል። SMS ሲረጋገጥ ይወጣዋል...\n🔖 Ref: ${analysis.refNo}`,
        { reply_to_message_id: msg.message_id }
      );
    }

  } catch (err) {
    console.error('[Payment] Photo handler error:', err.message);
    await bot.sendMessage(chatId, '❌ Error ተፈጥሯል። እንደገና ይሞክሩ።', {
      reply_to_message_id: msg.message_id,
    });
  }
}

// ===== LOTTERY PHOTO HANDLER =====
export async function handleLotteryPhoto(bot, msg) {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  console.log(`[Lottery] 📸 Photo received from ${telegramId}`);

  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileUrl = await getPhotoUrl(bot, fileId);
    const imageBase64 = await downloadImageAsBase64(fileUrl);

    await bot.sendMessage(chatId, '⏳ ዕጣ እየተተነተነ ነው...', {
      reply_to_message_id: msg.message_id,
    });

    const result = await analyzeLotteryPhoto(imageBase64);
    console.log(`[Lottery] Analysis:`, result);

    if (result.type !== 'lottery') {
      await bot.sendMessage(
        chatId,
        `❌ የሎተሪ ቲኬት አይደለም።`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    // DB ላይ ያስቀምጣል
    await saveLotteryResult({
      telegramId,
      series: result.series,
      first: result.first,
      second: result.second,
      third: result.third,
      announcedAt: new Date().toISOString(),
      status: 'ውጤት ታወጀ',
    });

    console.log(`[Lottery] ✅ Saved — Series: ${result.series} | 1ኛ: ${result.first} | 2ኛ: ${result.second} | 3ኛ: ${result.third}`);

    await bot.sendMessage(
      chatId,
      `✅ ውጤት ታወጀ!\n` +
      `📋 Series: ${result.series}\n` +
      `🏆 1ኛ ዕጣ: ${result.first}\n` +
      `🥈 2ኛ ዕጣ: ${result.second}\n` +
      `🥉 3ኛ ዕጣ: ${result.third}`,
      { reply_to_message_id: msg.message_id }
    );

  } catch (err) {
    console.error('[Lottery] Photo handler error:', err.message);
    await bot.sendMessage(chatId, '❌ Error ተፈጥሯል። እንደገና ይሞክሩ።', {
      reply_to_message_id: msg.message_id,
    });
  }
}

// ===== LOTTERY STICKER HANDLER =====
export async function handleLotterySticker(bot, msg) {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  console.log(`[Lottery] 🔴 Live sticker from ${telegramId}`);

  try {
    // DB ላይ live event ያስቀምጣል
    await saveLotteryLiveEvent({
      telegramId,
      isLive: true,
      triggeredAt: new Date().toISOString(),
    });

    console.log(`[Lottery] ✅ Live event saved`);

    await bot.sendMessage(chatId, '🔴 Live — ዕጣ እየወጣ ነው!', {
      reply_to_message_id: msg.message_id,
    });

  } catch (err) {
    console.error('[Lottery] Sticker handler error:', err.message);
  }
}

// ===== SMS PARSER =====
async function parseSms(sms) {

  // 1️⃣ CBE Credit SMS — Ref ቀጥታ አለ
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

  // 2️⃣ CBE Transfer SMS — Ref URL ውስጥ ነው
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

  // 3️⃣ Telebirr SMS — transaction number ቀጥታ አለ
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

// ===== GROQ — PAYMENT SCREENSHOT ANALYZER =====
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
- photoType "other" = anything else
- refNo: For CBE: "VAT Receipt No", "Reference No", or "Ref No" | For Telebirr: "transaction number"
- If not a payment receipt, set refNo to null`;

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

// ===== GROQ — LOTTERY PHOTO ANALYZER =====
async function analyzeLotteryPhoto(imageBase64) {
  const prompt = `You are a lottery ticket analyzer. Look at this image carefully.

The image contains lottery tickets stacked vertically.
- TOP ticket = 1ኛ ዕጣ (first prize)
- MIDDLE ticket = 2ኛ ዕጣ (second prize)
- BOTTOM ticket = 3ኛ ዕጣ (third prize)

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "type": "lottery" | "other",
  "series": "the Amharic/text label on the tickets or null",
  "first": "top ticket number or null",
  "second": "middle ticket number or null",
  "third": "bottom ticket number or null"
}

Rules:
- type "lottery" = image contains lottery tickets
- series = the label printed on all tickets (e.g. ቢኤ, ብሀ, etc.)
- first/second/third = the number on each ticket
- If not lottery tickets, set all fields to null`;

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
    max_tokens: 200,
    temperature: 0.1,
  });

  try {
    const text = response.choices[0].message.content.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { type: 'other', series: null, first: null, second: null, third: null };
  }
}

// ===== MATCH NOTIFICATION =====
async function notifyMatch(bot, matchData, replyToMsgId = null, chatId = null) {
  const { telegramId, amount, type } = matchData;

  const message =
    `✅ ክፍያ ተረጋግጧል!\n` +
    `💰 Amount: ETB ${amount}\n` +
    `🏦 Via: ${type}\n` +
    `👤 Telegram ID: ${telegramId}`;

  console.log('[Payment] Approved:', matchData);

  if (chatId && replyToMsgId) {
    await bot.sendMessage(chatId, message, { reply_to_message_id: replyToMsgId });
  } else if (GROUP_CHAT_ID) {
    await bot.sendMessage(GROUP_CHAT_ID, message);
  }
}

// ===== HELPERS =====
async function getPhotoUrl(bot, fileId) {
  const file = await bot.getFile(fileId);
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
}

async function downloadImageAsBase64(url) {
  const res = await fetch(url);
  const buffer = await res.buffer();
  return buffer.toString('base64');
}

// ===== CRON — 6 ሰዓት አሮጌ records ይሰርዛሉ =====
setInterval(async () => {
  const result = await cleanupPayments();
  console.log('[Payment] Cleanup result:', result);
}, 1000 * 60 * 60 * 6);
