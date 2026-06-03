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

  // ── Used REF check — ዳግም አይስራ ──
  const existing = await getSmsPaymentByRef(refNo);
  if (existing) {
    console.log(`[SMS] Ref ${refNo} already used — skipping`);
    return { success: false, reason: 'ref_already_used', refNo };
  }

  const result = await saveSmsPayment(refNo, amount, type, rawSms);
  return { success: true, matched: result.matched || null, ...parsed };
}

// ===== PAYMENT PHOTO HANDLER =====
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
    /(?:received|transferred) ETB ([\d,]+\.?\d*).+(https:\/\/Mbreciept\S+)/si
  );
  if (cbeTransfer) {
    const amount = parseFloat(cbeTransfer[1].replace(',', ''));
    const receiptUrl = cbeTransfer[2].trim();
    console.log(`[SMS] CBE Transfer detected — fetching ref from URL: ${receiptUrl}`);
    const refNo = await fetchRefFromUrl(receiptUrl);
    return { type: 'CBE', amount, refNo };
  }

  // 3️⃣ Telebirr to CBE — bank transaction number
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

  // 4️⃣ Telebirr Received — transaction number ቀጥታ አለ
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

  // REF ከሌለ → null → ignore
  return null;
}

// ===== CBE RECEIPT URL — Ref ያወጣል (FIXED) =====
async function fetchRefFromUrl(url) {
  try {
    const token = url.split('/').pop();
    console.log('[RefFetch] Token:', token);

    // CBE React app የሚጠቀማቸው possible API endpoints
    const endpoints = [
      `https://Mbreciept.cbe.com.et/api/receipts/${token}`,
      `https://Mbreciept.cbe.com.et/api/receipt/${token}`,
      `https://Mbreciept.cbe.com.et/api/transaction/${token}`,
      `https://Mbreciept.cbe.com.et/api/v1/receipt/${token}`,
      `https://Mbreciept.cbe.com.et/api/v1/receipts/${token}`,
      `https://Mbreciept.cbe.com.et/api/v1/transaction/${token}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Android 13; Mobile)',
          },
          timeout: 10000,
        });

        console.log(`[RefFetch] ${endpoint} → ${res.status}`);

        if (res.ok) {
          const data = await res.json();
          console.log('[RefFetch] Response data:', JSON.stringify(data).slice(0, 300));

          // ሁሉም possible field names
          const ref =
            data?.vatReceiptNo ||
            data?.refNo ||
            data?.referenceNo ||
            data?.reference ||
            data?.transactionRef ||
            data?.transactionId ||
            data?.receiptNo ||
            data?.data?.vatReceiptNo ||
            data?.data?.refNo ||
            data?.data?.referenceNo ||
            data?.receipt?.refNo ||
            data?.receipt?.vatReceiptNo;

          if (ref) {
            console.log('[RefFetch] ✅ Found ref:', ref);
            return ref;
          }

          // nested object ውስጥ ref ፈልግ
          const refFromNested = findRefInObject(data);
          if (refFromNested) {
            console.log('[RefFetch] ✅ Found nested ref:', refFromNested);
            return refFromNested;
          }
        }
      } catch (e) {
        console.log(`[RefFetch] Endpoint failed: ${endpoint} →`, e.message);
      }
    }

    // ── Fallback: JS bundle ውስጥ API path ፈልጎ ቀጥታ ጠራ ──
    console.log('[RefFetch] All API endpoints failed — trying JS bundle scan');
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    });
    const html = await pageRes.text();

    const scriptMatches = html.match(/src="([^"]+\.js[^"]*)"/g) || [];
    for (const scriptTag of scriptMatches.slice(0, 5)) {
      const scriptPath = scriptTag.replace(/src="|"/g, '');
      const scriptUrl = scriptPath.startsWith('http')
        ? scriptPath
        : `https://Mbreciept.cbe.com.et${scriptPath}`;

      try {
        const scriptRes = await fetch(scriptUrl, { timeout: 10000 });
        const scriptText = await scriptRes.text();

        // ሁሉም /api/ paths ፈልግ
        const apiMatches = scriptText.match(/["'`](\/api\/[^"'`\s]{3,80})["'`]/g) || [];
        for (const match of apiMatches) {
          const apiPath = match.replace(/["'`]/g, '');
          console.log('[RefFetch] Found API path in JS bundle:', apiPath);

          // ── ያገኘውን endpoint ቀጥታ ጠራ ──
          const fullEndpoint = `https://Mbreciept.cbe.com.et${apiPath}/${token}`;
          try {
            const apiRes = await fetch(fullEndpoint, {
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0',
              },
              timeout: 10000,
            });
            console.log(`[RefFetch] JS-found endpoint → ${apiRes.status}: ${fullEndpoint}`);

            if (apiRes.ok) {
              const data = await apiRes.json();
              console.log('[RefFetch] JS-found data:', JSON.stringify(data).slice(0, 300));
              const ref = findRefInObject(data);
              if (ref) {
                console.log('[RefFetch] ✅ Found ref via JS bundle:', ref);
                return ref;
              }
            }
          } catch (e) {
            console.log('[RefFetch] JS-found endpoint failed:', e.message);
          }
        }
      } catch (e) {
        // ignore script fetch errors
      }
    }

    console.log('[RefFetch] ❌ Could not find ref from any source');
    return null;

  } catch (err) {
    console.error('[RefFetch] Fatal error:', err.message);
    return null;
  }
}

// ===== HELPER — nested object ውስጥ ref ያወጣል =====
function findRefInObject(obj, depth = 0) {
  if (depth > 4 || !obj || typeof obj !== 'object') return null;

  const refKeys = ['vatReceiptNo', 'refNo', 'referenceNo', 'reference',
                   'transactionRef', 'transactionId', 'receiptNo', 'ref'];

  for (const key of Object.keys(obj)) {
    if (refKeys.includes(key) && typeof obj[key] === 'string' && obj[key].length > 3) {
      return obj[key];
    }
    if (typeof obj[key] === 'object') {
      const found = findRefInObject(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
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
- CBE bank SMS or notification (contains words like "Credited", "ETB", "Ref No", "Account", "Balance")
- Telebirr payment screenshot (contains "received ETB", "transaction")
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

  const lotteryClean = await cleanupLotteryResults();
  console.log('[Lottery] Cleanup result:', lotteryClean);
}, 1000 * 60 * 60 * 6);
