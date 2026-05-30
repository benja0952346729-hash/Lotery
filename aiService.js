import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { EventEmitter } from 'events';
import { getNextGroqKey, rotateGroqKey, getNextDeepSeekKey, rotateDeepSeekKey } from './keys.js';
import {
  readKnowledge, updateKnowledge, getHistory,
  getLotteryList, getTokenUsage, addTokenUsage,
  getBoardState, updateBoardState,
} from './database.js';

// ─────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────
export const learningEvents = new EventEmitter();

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.90');
const BOT_NAME = process.env.BOT_NAME || 'Admin';
const MAX_CORRECTION_ROUNDS = 3;

// ─────────────────────────────────────────
// TOKEN TRACKER
// ─────────────────────────────────────────
async function trackTokens(service, inputTokens, outputTokens) {
  await addTokenUsage(service, inputTokens, outputTokens).catch(err =>
    console.error('[TOKENS] Save error:', err.message)
  );
}

export async function getTokenStats() {
  return await getTokenUsage();
}

// ─────────────────────────────────────────
// NVIDIA / DeepSeek CALLER
// ─────────────────────────────────────────
async function callDeepSeek(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const key = getNextDeepSeekKey();
      const client = new OpenAI({
        apiKey: key,
        baseURL: 'https://integrate.api.nvidia.com/v1',
      });
      const completion = await client.chat.completions.create({
        model: 'deepseek-ai/deepseek-v4-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.7,
      });
      await trackTokens(
        'nvidia-deepseek',
        completion.usage?.prompt_tokens || 0,
        completion.usage?.completion_tokens || 0
      );
      return completion.choices[0]?.message?.content || '';
    } catch (err) {
      if (err.status === 429 || err.message?.includes('quota') || err.message?.includes('rate limit')) {
        console.log('[NVIDIA] Rate limit — rotating key...');
        rotateDeepSeekKey();
        await new Promise(res => setTimeout(res, 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('All NVIDIA keys exhausted');
}

// ─────────────────────────────────────────
// GROQ CALLER
// ─────────────────────────────────────────
async function callGroq(messages, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const key = getNextGroqKey();
      const groq = new Groq({ apiKey: key });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 500,
        temperature: 0.7,
      });
      await trackTokens(
        'groq',
        completion.usage?.prompt_tokens || 0,
        completion.usage?.completion_tokens || 0
      );
      return completion.choices[0]?.message?.content || '';
    } catch (err) {
      if (err.status === 429 || err.message?.includes('rate limit')) {
        console.log('[GROQ] Rate limit — rotating key...');
        rotateGroqKey();
        continue;
      }
      throw err;
    }
  }
  throw new Error('All Groq keys exhausted');
}

// ─────────────────────────────────────────
// STARTUP TEST
// ─────────────────────────────────────────
export async function testNvidiaConnection() {
  try {
    console.log('🔌 NVIDIA NIM እየተገናኘ...');
    const key = getNextDeepSeekKey();
    const client = new OpenAI({
      apiKey: key,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });
    const completion = await client.chat.completions.create({
      model: 'deepseek-ai/deepseek-v4-flash',
      messages: [{ role: 'user', content: 'say "ok" only' }],
      max_tokens: 5,
      temperature: 0,
    });
    const reply = completion.choices[0]?.message?.content || '';
    console.log('✅ NVIDIA NIM Online — DeepSeek V4 Flash ዝግጁ ነው!');
    console.log(`🧠 Test response: "${reply.trim()}"`);
    learningEvents.emit('activity', {
      type: 'learn',
      msg: '✅ NVIDIA NIM Online — DeepSeek V4 Flash ዝግጁ ነው!'
    });
    return true;
  } catch (err) {
    console.error('❌ NVIDIA NIM connection failed:', err.message);
    learningEvents.emit('activity', {
      type: 'error',
      msg: `❌ NVIDIA connection failed: ${err.message}`
    });
    return false;
  }
}

// ─────────────────────────────────────────
// BOARD PARSER — Board text → structured data
// ─────────────────────────────────────────
export function parseBoard(text) {
  const lines = text.split('\n');
  const slots = {};
  const bankInfo = {};
  const prizeInfo = {};

  // Prize lines — 1ኛ 🥇5,000 ብር etc
  for (const line of lines) {
    const prizeMatch = line.match(/([123]ኛ)[^\d]*([\d,]+)\s*ብር/);
    if (prizeMatch) {
      prizeInfo[prizeMatch[1]] = prizeMatch[2].replace(',', '');
    }
  }

  // Bank lines
  const bankPatterns = [
    { name: 'CBE', pattern: /CBE\s+([\d]+)/ },
    { name: 'አዋሽ', pattern: /አዋሽ\s+([\d]+)/ },
    { name: 'ዳሽን', pattern: /ዳሽን\s+([\d]+)/ },
    { name: 'ቴሌ', pattern: /ቴሌ ብር\s+([\d]+)/ },
  ];
  for (const line of lines) {
    for (const b of bankPatterns) {
      const m = line.match(b.pattern);
      if (m) bankInfo[b.name] = m[1];
    }
  }

  // Slot lines — 01# / 96# ቢንያም ⏳ / 15# ዮሐንስ ✅
  for (const line of lines) {
    const slotMatch = line.match(/^(\d{1,3})#\s*(.*)?$/);
    if (slotMatch) {
      const number = parseInt(slotMatch[1]);
      const rest = (slotMatch[2] || '').trim();

      let status = 'open';      // # → ክፍት
      let name = null;

      if (rest.includes('✅')) {
        status = 'paid';
        name = rest.replace('✅', '').trim() || null;
      } else if (rest.includes('⏳')) {
        status = 'pending';     // ተመዝግቦ — ገና አልከፈለም
        name = rest.replace('⏳', '').trim() || null;
      } else if (rest.length > 0) {
        status = 'pending';
        name = rest;
      }

      slots[number] = { number, name, status };
    }
  }

  return { slots, bankInfo, prizeInfo, raw: text };
}

// ─────────────────────────────────────────
// BOARD LEARNING — DeepSeek board ያነባዋል + ይማራል
// ─────────────────────────────────────────
export async function learnFromBoard(boardText, adminCaption = '') {
  const parsed = parseBoard(boardText);
  const totalSlots = Object.keys(parsed.slots).length;
  const filledSlots = Object.values(parsed.slots).filter(s => s.name).length;
  const paidSlots = Object.values(parsed.slots).filter(s => s.status === 'paid').length;
  const pendingSlots = Object.values(parsed.slots).filter(s => s.status === 'pending').length;

  // DB ላይ board state ይቀምጣል
  await updateBoardState(parsed);

  const prompt = `
You are a learning AI analyzing an Amharic lottery board. Extract and understand all rules, patterns and admin behavior.

Board text:
"""
${boardText}
"""

Admin caption: "${adminCaption}"

Board analysis:
- Total slots: ${totalSlots}
- Filled: ${filledSlots}
- Paid (✅): ${paidSlots}
- Pending (⏳): ${pendingSlots}
- Banks: ${JSON.stringify(parsed.bankInfo)}
- Prizes: ${JSON.stringify(parsed.prizeInfo)}

Return ONLY valid JSON (no markdown):
{
  "rules": [
    "ምዝገባ ዋጋ 400 ብር ነው",
    "ግማሽ 200 ብር ነው",
    "1ኛ ሽልማት 5000 ብር ነው"
  ],
  "boardRules": {
    "price": 400,
    "halfPrice": 200,
    "maxSlots": 100,
    "prizes": {"1st": 5000, "2nd": 1000, "3rd": 400},
    "banks": {},
    "statusSymbols": {"open": "#", "pending": "⏳", "paid": "✅"}
  },
  "adminPatterns": [
    "board ስትልክ caption ይጻፋሉ",
    "⏳ = ተመዝግቦ ያልከፈለ",
    "✅ = ከፍሎ confirmed"
  ],
  "shouldUpdate": true
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed_knowledge = JSON.parse(clean);

    if (parsed_knowledge.shouldUpdate) {
      await updateKnowledge({
        rules: parsed_knowledge.rules || [],
        boardRules: parsed_knowledge.boardRules || {},
        adminPatterns: parsed_knowledge.adminPatterns || [],
      });
    }

    learningEvents.emit('activity', {
      type: 'rule',
      msg: `📋 Board ተማረ — ${filledSlots}/${totalSlots} slots, ${paidSlots} ✅, ${pendingSlots} ⏳`
    });

    return parsed_knowledge;
  } catch (err) {
    console.error('[BOARD] Learn error:', err.message);
    learningEvents.emit('activity', {
      type: 'error',
      msg: `Board learn error: ${err.message}`
    });
    return null;
  }
}

// ─────────────────────────────────────────
// LEARN FROM MESSAGE
// ─────────────────────────────────────────
export async function learnFromMessage(message, isAdmin = false) {
  const knowledge = await readKnowledge();

  const prompt = `
You are a learning AI analyzing Telegram messages to understand admin behavior in an Amharic lottery group.

Current knowledge:
- Admin phrases known: ${knowledge.adminStyle?.responses?.length || 0}
- Rules known: ${knowledge.rules?.length || 0}
- Intents known: ${knowledge.intents?.length || 0}
- Board rules: ${JSON.stringify(knowledge.boardRules || {})}

New message:
- From: ${isAdmin ? 'ADMIN' : 'USER'}
- Username: ${message.from?.username || 'unknown'}
- Text: "${message.text}"

Return ONLY valid JSON (no markdown):
{
  "adminStyle": {
    "responses": ${isAdmin ? '["phrase if useful, else empty"]' : '[]'},
    "greetings": [],
    "warnings": [],
    "announcements": []
  },
  "rules": [],
  "intents": [{"pattern": "user said", "meaning": "what they want", "response": "how admin replied"}],
  "writingStyle": {
    "amharic": [],
    "commonPhrases": [],
    "tone": "",
    "emojiUsage": ""
  },
  "shouldUpdate": true
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (parsed.shouldUpdate) {
      await updateKnowledge(parsed);
    }
    learningEvents.emit('activity', {
      type: 'learn',
      msg: `አዲስ message ተማረ — ${isAdmin ? 'ADMIN' : 'USER'}: "${message.text?.slice(0, 40)}"`
    });
    return parsed;
  } catch (err) {
    console.error('[NVIDIA] Learn error:', err.message);
    learningEvents.emit('activity', {
      type: 'error',
      msg: `Learn error: ${err.message}`
    });
    return null;
  }
}

// ─────────────────────────────────────────
// LEARN LOTTERY RULES
// ─────────────────────────────────────────
export async function learnLotteryRules(adminMessage) {
  const prompt = `
Extract lottery rules from this admin message: "${adminMessage}"

Return ONLY valid JSON:
{
  "rules": [],
  "registrationInfo": "",
  "numberRange": {"min": 1, "max": 100},
  "eligibility": "",
  "isRule": false
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (parsed.isRule && parsed.rules.length > 0) {
      await updateKnowledge({ rules: parsed.rules });
      learningEvents.emit('activity', {
        type: 'rule',
        msg: `ህግ ተወሰደ: "${parsed.rules[0]?.slice(0, 50)}"`
      });
    }
    return parsed;
  } catch (err) {
    console.error('[NVIDIA] Rule error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// DEEPSEEK EVALUATOR + CORRECTOR
// ─────────────────────────────────────────
async function deepSeekEvaluate(userMessage, groqResponse, context = '') {
  const knowledge = await readKnowledge();

  const prompt = `
You are a strict trainer AI. You must evaluate if this bot response matches the real admin's style exactly.

Admin style learned:
- Phrases: ${JSON.stringify(knowledge.adminStyle?.responses?.slice(0, 15))}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Amharic phrases: ${JSON.stringify(knowledge.writingStyle?.amharic?.slice(0, 10))}
- Emoji usage: ${knowledge.writingStyle?.emojiUsage || 'moderate'}
- Rules: ${JSON.stringify(knowledge.rules?.slice(0, 10))}
- Board rules: ${JSON.stringify(knowledge.boardRules || {})}
- Intents: ${JSON.stringify(knowledge.intents?.slice(0, 10))}

Context: ${context}
User said: "${userMessage}"
Bot responded: "${groqResponse}"

Evaluate strictly. Admin writes in Amharic, uses emojis naturally, is concise and direct.

Return ONLY valid JSON:
{
  "score": 0.85,
  "isCorrect": true,
  "issues": ["issue1", "issue2"],
  "correction": "the correct response the real admin would give",
  "ruleToAdd": "new rule to remember if any, else null",
  "shouldTeach": false,
  "teachingNote": "what to tell Groq to do better"
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const evaluation = JSON.parse(clean);

    learningEvents.emit('activity', {
      type: 'eval',
      msg: `Response ተገምግሟል — score: ${Math.round((evaluation.score || 0) * 100)}% ${evaluation.isCorrect ? '✅' : '⚠️ → ያስተምራል'}`
    });

    // ህግ ካለ ይጨምራል
    if (evaluation.ruleToAdd) {
      await updateKnowledge({ rules: [evaluation.ruleToAdd] });
      learningEvents.emit('activity', {
        type: 'rule',
        msg: `አዲስ ህግ ተጨመረ: "${evaluation.ruleToAdd.slice(0, 50)}"`
      });
    }

    return evaluation;
  } catch (err) {
    console.error('[NVIDIA] Evaluate error:', err.message);
    return { score: 0.5, isCorrect: true, issues: [], correction: groqResponse };
  }
}

// ─────────────────────────────────────────
// CORRECTION LOOP — DeepSeek ያስተካክላል Groq-ን
// ─────────────────────────────────────────
async function correctionLoop(userMessage, initialResponse, systemPrompt, context = '') {
  let currentResponse = initialResponse;
  let bestScore = 0;
  let bestResponse = initialResponse;
  const corrections = [];

  for (let round = 0; round < MAX_CORRECTION_ROUNDS; round++) {
    const evaluation = await deepSeekEvaluate(userMessage, currentResponse, context);

    if (evaluation.score > bestScore) {
      bestScore = evaluation.score;
      bestResponse = currentResponse;
    }

    // ከፍቶ ከሆነ ወይም threshold ላይ ከደረሰ ይቆማል
    if (evaluation.isCorrect && evaluation.score >= CONFIDENCE_THRESHOLD) {
      learningEvents.emit('activity', {
        type: 'eval',
        msg: `✅ Round ${round + 1}: Score ${Math.round(evaluation.score * 100)}% — Accepted`
      });
      break;
    }

    // ስህተት ካለ — Groq ያስተምራል + ያስተካክላል
    if (!evaluation.isCorrect || evaluation.score < CONFIDENCE_THRESHOLD) {
      corrections.push(evaluation);

      learningEvents.emit('activity', {
        type: 'eval',
        msg: `⚠️ Round ${round + 1}: Score ${Math.round(evaluation.score * 100)}% — Groq ያስተምራል...`
      });

      // Groq ን ያስተምራል
      const teachingMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${userMessage}` },
        { role: 'assistant', content: currentResponse },
        {
          role: 'user',
          content: `❌ ስህተት ነው። ምክንያት: ${evaluation.issues?.join(', ') || 'style አይሆንም'}
${evaluation.teachingNote ? `\n📚 ማስተካከያ: ${evaluation.teachingNote}` : ''}
${evaluation.correction ? `\n✅ እንዲህ መሆን አለበት: "${evaluation.correction}"` : ''}

አሁን እንደ admin ትክክለኛ response ስጥ:`
        },
      ];

      try {
        currentResponse = await callGroq(teachingMessages);
        learningEvents.emit('activity', {
          type: 'learn',
          msg: `🔄 Round ${round + 1}: Groq response ተስተካከለ`
        });
      } catch (err) {
        console.error('[CORRECTION] Groq retry error:', err.message);
        break;
      }

      // ማስተማሪያ → knowledge ውስጥ ይቀምጣል
      if (evaluation.teachingNote) {
        await updateKnowledge({
          intents: [{
            pattern: userMessage,
            meaning: 'needs correction',
            betterResponse: evaluation.correction || currentResponse,
            teachingNote: evaluation.teachingNote,
          }]
        }).catch(() => {});
      }
    }
  }

  return {
    response: bestResponse,
    confidence: bestScore,
    correctionRounds: corrections.length,
    wasCorreected: corrections.length > 0,
  };
}

// ─────────────────────────────────────────
// SYSTEM PROMPT BUILDER
// ─────────────────────────────────────────
async function buildSystemPrompt() {
  const knowledge = await readKnowledge();
  const lotteryList = await getLotteryList();
  const boardState = await getBoardState().catch(() => null);

  const filledSlots = boardState
    ? Object.values(boardState.slots || {}).filter(s => s.name).length
    : lotteryList.length;

  return `You are ${BOT_NAME}, admin of an Amharic Telegram lottery group. Respond EXACTLY like the real admin — same tone, same Amharic style, same emoji usage.

ADMIN STYLE:
- Phrases: ${knowledge.adminStyle?.responses?.slice(0, 15).join(' | ') || 'friendly'}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Amharic phrases: ${knowledge.writingStyle?.amharic?.join(', ') || ''}
- Emoji usage: ${knowledge.writingStyle?.emojiUsage || 'moderate'}
- Common phrases: ${knowledge.writingStyle?.commonPhrases?.join(' | ') || ''}

LOTTERY RULES:
${knowledge.rules?.map((r, i) => `${i + 1}. ${r}`).join('\n') || 'No rules yet'}

BOARD RULES:
- Price: ${knowledge.boardRules?.price || 400} ብር
- Half price: ${knowledge.boardRules?.halfPrice || 200} ብር
- Slots: 1–${knowledge.boardRules?.maxSlots || 100}
- Filled: ${filledSlots} slots
- Status symbols: ⏳ = ተመዝግቦ ያልከፈለ, ✅ = ከፍሎ confirmed, # = ክፍት

BANKS:
${knowledge.boardRules?.banks ? Object.entries(knowledge.boardRules.banks).map(([k, v]) => `${k}: ${v}`).join('\n') : 'See board'}

INTENTS:
${knowledge.intents?.slice(0, 20).map(i => `- "${i.pattern}" → "${i.betterResponse || i.response}"`).join('\n') || ''}

ADMIN PATTERNS:
${knowledge.adminPatterns?.slice(0, 10).map((p, i) => `${i + 1}. ${p}`).join('\n') || ''}

CRITICAL RULES:
1. Always respond in Amharic
2. Be natural, not robotic — exactly like the real admin
3. Keep responses short and direct
4. Use emojis like the admin does
5. Never give wrong info about lottery rules`;
}

// ─────────────────────────────────────────
// GENERATE RESPONSE (main)
// ─────────────────────────────────────────
export async function generateResponse(userMessage, userId, username) {
  const systemPrompt = await buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${username}: ${userMessage}` },
  ];

  // Groq — initial response
  const initialResponse = await callGroq(messages);

  // DeepSeek — evaluate + correction loop
  const result = await correctionLoop(
    userMessage,
    initialResponse,
    systemPrompt,
    `User: ${username}`
  );

  return {
    response: result.response,
    confidence: result.confidence,
    needsAdminApproval: result.confidence < CONFIDENCE_THRESHOLD,
    correctionRounds: result.correctionRounds,
    wasCorrected: result.wasCorrected,
  };
}

// ─────────────────────────────────────────
// HANDLE REGISTRATION
// ─────────────────────────────────────────
export async function handleRegistration(userId, username, requestedNumber) {
  const systemPrompt = await buildSystemPrompt();
  const lotteryList = await getLotteryList();

  const numberTaken = lotteryList.find(m => m.number === requestedNumber);
  const alreadyRegistered = lotteryList.find(m => m.user_id === userId);
  const validRange = requestedNumber >= 1 && requestedNumber <= 100;

  let situation = '';
  if (!validRange) situation = `Invalid number ${requestedNumber} (must be 1-100)`;
  else if (alreadyRegistered) situation = `Already registered with number ${alreadyRegistered.number}`;
  else if (numberTaken) situation = `Number ${requestedNumber} already taken by ${numberTaken.username}`;
  else situation = `Number ${requestedNumber} is available for ${username}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Situation: ${situation}. @${username} wants number ${requestedNumber}. Respond as admin in Amharic.`
    },
  ];

  const initialResponse = await callGroq(messages);

  // Correction loop for registration too
  const result = await correctionLoop(
    `ምዝገባ ቁጥር ${requestedNumber}`,
    initialResponse,
    systemPrompt,
    situation
  );

  return {
    response: result.response,
    available: !numberTaken && validRange && !alreadyRegistered,
    confidence: result.confidence,
  };
}

// ─────────────────────────────────────────
// GENERATE ANNOUNCEMENT
// ─────────────────────────────────────────
export async function generateAnnouncement(topic, details) {
  const systemPrompt = await buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Write an announcement about: ${topic}. ${details}. Write in admin's Amharic style with emojis.`
    },
  ];
  const response = await callGroq(messages);

  // Evaluate announcement quality
  const evaluation = await deepSeekEvaluate(
    `announcement: ${topic}`,
    response,
    'generating announcement'
  );

  if (!evaluation.isCorrect && evaluation.correction) {
    return evaluation.correction;
  }

  return response;
}

// ─────────────────────────────────────────
// GENERATE LEARNING SUMMARY
// ─────────────────────────────────────────
export async function generateLearningSummary() {
  const knowledge = await readKnowledge();
  const history = await getHistory(10);

  const prompt = `
Summarize learning from this Telegram lottery group.

Knowledge: ${JSON.stringify(knowledge)}
Messages in last 10 days: ${history.length}

Return ONLY valid JSON:
{
  "summary": "brief summary in Amharic and English",
  "newThingsLearned": [],
  "weakAreas": [],
  "confidence": 0.75,
  "readyToReplace": false
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    learningEvents.emit('activity', {
      type: 'learn',
      msg: `Daily summary ተሰራ — confidence: ${Math.round((parsed.confidence || 0) * 100)}%`
    });
    return parsed;
  } catch (err) {
    console.error('[NVIDIA] Summary error:', err.message);
    return null;
  }
}
