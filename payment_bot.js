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
  cleanupLotteryResults,
  getSmsPaymentByRef,
  isRefMatchedAlready,
} from './database.js';
import { learnFromMessage, addToBuffer } from './aiService.js';

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

  // ── Used REF check ──
  const existing = await getSmsPaymentByRef(refNo);
  if (existing) {
    console.log(`[SMS] Ref ${refNo} already used — skipping`);
    return { success: false, reason: 'ref_already_used', refNo };
  }

  // ── Bot ይማራል — SMS መጣ ──
  setImmediate(() => {
    learnFromMessage({
      text: `[PAYMENT_FLOW] SMS received — Type: ${type} | Amount: ETB ${amount} | Time: ${new Date().toLocaleString()} | Status: SMS ደረሰ፣ Screenshot ይጠበቃል`
    }, true).catch(() => {});
  });

  const result = await saveSmsPayment(refNo, amount, type, rawSms);
  return { success: true, matched: result.matched || null, ...parsed };
}

// ===== PAYMENT PHOTO HANDLER =====
export async function handlePaymentPhoto(bot, msg) {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const username = msg.from?.username || msg.from?.first_name || 'Unknown';

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

    if (analysis.photoType !== 'CBE' && analysis.photoType !== 'Telebirr') {
      const amharicDesc = await describePhotoInAmharic(analysis.description);
      await bot.sendMessage(chatId, amharicDesc, { reply_to_message_id: msg.message_id });
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

    // ── Match ከሆነ በኋላ ድጋሚ screenshot ሲላኩ ──
    const alreadyMatched = await isRefMatchedAlready(analysis.refNo);
    if (alreadyMatched) {
      await bot.sendMessage(
        chatId,
        `⚠️ ይህ ክፍያ ቀደም ሲል ተረጋግጧል።`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    // ── Bot ይማራል — Screenshot መጣ ──
    setImmediate(() => {
      learnFromMessage({
        text: `[PAYMENT_FLOW] Screenshot received — TelegramID: ${telegramId} | Username: @${username} | Type: ${analysis.photoType} | Time: ${new Date().toLocaleString()} | Status: Screenshot ደረሰ፣ SMS ይጠበቃል`
      }, true).catch(() => {});
    });

    const saved = await saveScreenshotPayment(
      telegramId,
      analysis.refNo,
      analysis.photoType,
      analysis.description
    );

    if (saved.matched) {
      await notifyMatch(bot, saved.matched, msg.message_id, chatId);
    } else {
      await bot.sendMessage(
        chatId,
        `✅ Screenshot ተቀብሏል። SMS ሲረጋገጥ ይወጣዋል...\n🔖 Ref: ${analysis.refNo}`,
        { reply_to_message_id: msg.message_id }
      );

      // ── Bot ይማራል — Pending ──
      setImmediate(() => {
        learnFromMessage({
          text: `[PAYMENT_FLOW] Payment pending — TelegramID: ${telegramId} | Username: @${username} | Type: ${analysis.photoType} | Ref: ${analysis.refNo} | Status: Screenshot አለ፣ SMS አልደረሰም — ይጠበቃል`
        }, true).catch(() => {});
      });
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
      console.log(`[Lottery] Not a lottery ticket — passing to payment handler`);
      await handlePaymentPhoto(bot, msg);
      return;
    }

    await saveLotteryResult({
      telegramId,
      series: result.series,
      first: result.first,
      second: result.second,
      third: result.third,
      announcedAt: new Date().toISOString(),
      status: 'ውጤት ታወጀ',
    });

    // ── Bot ይማራል — Lottery result ──
    setImmediate(() => {
      learnFromMessage({
        text: `[LOTTERY_FLOW] Lottery result announced — Series: ${result.series} | 1ኛ: ${result.first} | 2ኛ: ${result.second} | 3ኛ: ${result.third} | Time: ${new Date().toLocaleString()}`
      }, true).catch(() => {});
    });

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
    await saveLotteryLiveEvent({
      telegramId,
      isLive: true,
      triggeredAt: new Date().toISOString(),
    });

    await bot.sendMessage(chatId, '🔴 Live — ዕጣ እየወጣ ነው!', {
      reply_to_message_id: msg.message_id,
    });

  } catch (err) {
    console.error('[Lottery] Sticker handler error:', err.message);
  }
}

// ===== SMS PARSER =====
async function parseSms(sms) {

  // 1️⃣ CBE Credit SMS
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

  // 2️⃣ CBE Transfer SMS
  const cbeTransfer = sms.match(
    /(?:received|transferred) ETB ([\d,]+\.?\d*).+(https:\/\/Mbreciept\S+)/si
  );
  if (cbeTransfer) {
    const amount = parseFloat(cbeTransfer[1].replace(',', ''));
    const receiptUrl = cbeTransfer[2].trim();
    console.log(`[SMS] CBE Transfer detected — fetching ref from URL: ${receiptUrl}`);
    const refNo = await fetchRefFromUrl(receiptUrl);
    return { type: 'CBE', amount, refNo };
  }

  // 3️⃣ Telebirr to CBE
  const telebirrToCbe = sms.match(
    /transferred ETB ([\d,]+\.?\d*).+?bank transaction number is\s+([A-Z0-9]+)/s
  );
  if (telebirrToCbe) {
    return {
      type: 'Telebirr',
      amount: parseFloat(telebirrToCbe[1].replace(',', '')),
      refNo: telebirrToCbe[2],
    };
  }

  // 4️⃣ Telebirr Received
  const telebirrReceived = sms.match(
    /received ETB ([\d,]+\.?\d*).+?transaction number is\s+([A-Z0-9]+)/s
  );
  if (telebirrReceived) {
    return {
      type: 'Telebirr',
      amount: parseFloat(telebirrReceived[1].replace(',', '')),
      refNo: telebirrReceived[2],
    };
  }

  return null;
}

// ===== CBE RECEIPT URL =====
async function fetchRefFromUrl(url) {
  try {
    console.log('[RefFetch] Using Jina AI reader for:', url);

    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 20000,
    });

    console.log('[RefFetch] Jina status:', res.status);

    if (!res.ok) {
      console.log('[RefFetch] Jina failed:', res.status);
      return null;
    }

    const text = await res.text();
    console.log('[RefFetch] Jina text snippet:', text.slice(0, 500));

    const patterns = [
      /VAT Receipt No[:\s]+([A-Z0-9]+)/i,
      /Reference No\.\s*\(VAT Invoice No\)[:\s]+([A-Z0-9]+)/i,
      /Reference No[:\s]+([A-Z0-9]+)/i,
      /Ref No[:\s]+([A-Z0-9]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        console.log('[RefFetch] ✅ Found ref:', match[1]);
        return match[1];
      }
    }

    console.log('[RefFetch] ❌ Ref not found in Jina response');
    return null;

  } catch (err) {
    console.error('[RefFetch] Fatal error:', err.message);
    return null;
  }
}

// ===== GROQ — በአማርኛ ምስሉን ያብራራል =====
async function describePhotoInAmharic(description) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'user',
        content: `ይህ ምስል "${description}" ነው። በአማርኛ በ2-3 emoji ተጠቅሞ ምስሉ ምን እንደሆነ ብቻ አስረዳ። "አይደለም" ወይም "አልሆነም" አትበል። ምን እንደሆነ ብቻ ግለጽ። አጭር ሁን።`,
      },
    ],
    max_tokens: 100,
    temperature: 0.3,
  });
  return response.choices[0].message.content.trim();
}

// ===== GROQ — PAYMENT SCREENSHOT ANALYZER =====
async function analyzeScreenshot(imageBase64) {
  const prompt = `You are a payment receipt analyzer. Look at this image and extract information.

CRITICAL: Read the reference number with extreme care.
- Go character by character slowly
- These characters are easily confused — check each one carefully:
  * Number 0 (zero) vs Letter O
  * Number 1 (one) vs Letter I
  * Number 5 (five) vs Letter S
- After reading, double-check the full reference number once more before returning it

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
  const prompt = `You are a lottery ticket analyzer for Ethiopian lottery.

A REAL Ethiopian lottery ticket:
- Small physical cube or block shaped paper tickets
- Printed with Amharic series label (e.g. ቢኤ, ብሀ, ቢሀ, ቢሉ)
- 3 cubes/blocks stacked vertically — TOP=1st prize, MIDDLE=2nd prize, BOTTOM=3rd prize
- Physical paper/cardboard material, photographed on a surface or held in hand
- Contains only a short Amharic label and a number (e.g. "ቢኤ 75")

NOT a lottery ticket → MUST return type "other":
- CBE bank SMS or notification
- Telebirr payment screenshot
- Any phone screen or digital content
- Any bank receipt, document, or paper with long text
- Screenshots of any kind

IMPORTANT: If the image shows a phone screen or contains bank/payment text → type MUST be "other"

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "type": "lottery" | "other",
  "series": "Amharic label on the tickets or null",
  "first": "top cube number or null",
  "second": "middle cube number or null",
  "third": "bottom cube number or null"
}`;

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
  const { telegramId, amount, type, refNo } = matchData;

  const message =
    `✅ ክፍያ ተረጋግጧል!\n` +
    `💰 Amount: ETB ${amount}\n` +
    `🏦 Via: ${type}\n` +
    `👤 Telegram ID: ${telegramId}`;

  console.log('[Payment] Approved:', matchData);

  // ── Bot ይማራል — Match ሆነ ──
  setImmediate(() => {
    learnFromMessage({
      text: `[PAYMENT_FLOW] ✅ Payment approved — TelegramID: ${telegramId} | Amount: ETB ${amount} | Via: ${type} | Time: ${new Date().toLocaleString()} | Flow: SMS ደረሰ + Screenshot ተላከ = Match ሆነ → Approved`
    }, true).catch(() => {});

    // Buffer ውስጥም ይጨምር — DeepLearning ጋር አንድ ላይ
    addToBuffer({
      text: `[PAYMENT_FLOW] Payment completed — ETB ${amount} via ${type} | TelegramID: ${telegramId}`
    }, true).catch(() => {});
  });

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

  const lotteryClean = await cleanupLotteryResults();
  console.log('[Lottery] Cleanup result:', lotteryClean);
}, 1000 * 60 * 60 * 6);
