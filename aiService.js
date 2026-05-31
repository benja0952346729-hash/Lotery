import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { EventEmitter } from 'events';
import { getNextGroqKey, rotateGroqKey, getNextDeepSeekKey, rotateDeepSeekKey } from './keys.js';
import {
  readKnowledge, updateKnowledge, getHistory,
  getLotteryList, getTokenUsage, addTokenUsage,
  getBoardState, updateBoardState,
  saveActionLog, updateActionConfidence, getActionLogs,
  saveQAPair, updateQAConfidence, findSimilarQA, getBestQAPairs,
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
// BOARD PARSER
// ─────────────────────────────────────────
export function parseBoard(text) {
  const lines = text.split('\n');
  const slots = {};
  const bankInfo = {};
  const prizeInfo = {};

  for (const line of lines) {
    const prizeMatch = line.match(/([123]ኛ)[^\d]*([\d,]+)\s*ብር/);
    if (prizeMatch) {
      prizeInfo[prizeMatch[1]] = prizeMatch[2].replace(',', '');
    }
  }

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

  for (const line of lines) {
    const slotMatch = line.match(/^(\d{1,3})#\s*(.*)?$/);
    if (slotMatch) {
      const number = parseInt(slotMatch[1]);
      const rest = (slotMatch[2] || '').trim();

      let status = 'open';
      let name = null;

      if (rest.includes('✅')) {
        status = 'paid';
        name = rest.replace('✅', '').trim() || null;
      } else if (rest.includes('⏳')) {
        status = 'pending';
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
// BOARD RENDERER — board text ይሰራል
// ─────────────────────────────────────────
export function renderBoard(boardState, knowledge) {
  const slots = boardState?.slots || {};
  const rules = knowledge?.boardRules || {};
  const price = rules.price || 400;
  const halfPrice = rules.halfPrice || 200;
  const prizes = rules.prizes || { '1st': 5000, '2nd': 1000, '3rd': 400 };

  let board = `በ ${price} ብር 5 ቁጥሮችን በተከታታይ በመያዝ እድሎን ይሞክሩ ለ 20 ሰው ብቻ ፈጣን ዕድል መልካም ዕድል\n\n`;
  board += `መደብ 👉በ ${price} ብር\n`;
  board += `       👉ግማሽ ${halfPrice} ብር\n\n`;
  board += `1ኛ 🥇${prizes['1st']?.toLocaleString() || 5000} ብር\n`;
  board += `2ኛ 🥈${prizes['2nd'] || 1000}\n`;
  board += `3ኛ 🥇${prizes['3rd'] || 400}\n\n`;

  for (let i = 1; i <= 100; i++) {
    const slot = slots[i];
    let line = `${String(i).padStart(2, '0')}#`;
    if (slot?.name) {
      const statusEmoji = slot.status === 'paid' ? '✅' : '⏳';
      line += ` ${slot.name} ${statusEmoji}`;
    }
    board += line + '\n';
    if (i % 5 === 0) board += '\n';
  }

  if (rules.banks) {
    board += '\n';
    for (const [bank, account] of Object.entries(rules.banks)) {
      board += `${bank} ${account}\n`;
    }
  }

  return board;
}

// ─────────────────────────────────────────
// ACTION LEARNING — ሁሉም admin actions ይማራሉ
// ─────────────────────────────────────────
export async function learnAction(actionType, trigger, reason, details = {}) {
  try {
    // DB ያስቀምጣል
    await saveActionLog(actionType, trigger, reason, details, true);

    // DeepSeek ያስተምራል — context ይረዳል
    const prompt = `
You are a learning AI. An admin just performed an action in a Telegram lottery group.

Action: "${actionType}"
Trigger (what caused it): "${trigger}"
Reason: "${reason}"
Details: ${JSON.stringify(details)}

Extract the pattern — when should the bot do this action automatically?

Return ONLY valid JSON:
{
  "pattern": "when this happens",
  "action": "do this",
  "reason": "because of this",
  "automate": true,
  "confidence": 0.9,
  "rule": "rule to remember"
}`;

    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (parsed.rule) {
      await updateKnowledge({ rules: [parsed.rule] });
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `⚡ Action ተማረ: ${actionType} — "${reason.slice(0, 40)}"`
    });

    return parsed;
  } catch (err) {
    console.error('[ACTION] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// Q&A PAIR LEARNING — ሰው + admin reply pair
// ─────────────────────────────────────────
export async function learnQAPair(userMessage, adminReply, context = '') {
  try {
    // DB ያስቀምጣል — admin verified
    await saveQAPair(userMessage, adminReply, context, '', true);

    // DeepSeek intent ይረዳል
    const prompt = `
Analyze this Q&A pair from an Amharic lottery Telegram group.

User said: "${userMessage}"
Admin replied: "${adminReply}"
Context: "${context}"

Understand the intent and pattern.

Return ONLY valid JSON:
{
  "intent": "what user wanted",
  "pattern": "similar messages to match",
  "response_style": "how admin responds",
  "key_info": "important info in the reply",
  "rule": "rule to remember if any, else null"
}`;

    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Intent DB ውስጥ ያስቀምጣል
    if (parsed.intent) {
      await updateKnowledge({
        intents: [{
          pattern: userMessage,
          meaning: parsed.intent,
          response: adminReply,
          betterResponse: adminReply,
        }]
      });
    }

    if (parsed.rule) {
      await updateKnowledge({ rules: [parsed.rule] });
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `💬 Q&A pair ተማረ — "${userMessage.slice(0, 30)}" → "${adminReply.slice(0, 30)}"`
    });

    return parsed;
  } catch (err) {
    console.error('[QA] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// BOARD LEARNING
// ─────────────────────────────────────────
export async function learnFromBoard(boardText, adminCaption = '') {
  const parsed = parseBoard(boardText);
  const totalSlots = Object.keys(parsed.slots).length;
  const filledSlots = Object.values(parsed.slots).filter(s => s.name).length;
  const paidSlots = Object.values(parsed.slots).filter(s => s.status === 'paid').length;
  const pendingSlots = Object.values(parsed.slots).filter(s => s.status === 'pending').length;

  await updateBoardState(parsed);

  // Board action ያስቀምጣል
  if (adminCaption) {
    await learnAction('board_sent', adminCaption, 'admin sent board to group', {
      filledSlots,
      paidSlots,
      pendingSlots,
    });
  }

  const prompt = `
You are a learning AI analyzing an Amharic lottery board.

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
  "rules": [],
  "boardRules": {
    "price": 400,
    "halfPrice": 200,
    "maxSlots": 100,
    "prizes": {"1st": 5000, "2nd": 1000, "3rd": 400},
    "banks": {},
    "statusSymbols": {"open": "#", "pending": "⏳", "paid": "✅"}
  },
  "adminPatterns": [],
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
      msg: `📋 Board ተማረ — ${filledSlots}/${totalSlots} slots, ${paidSlots} ✅`
    });

    return parsed_knowledge;
  } catch (err) {
    console.error('[BOARD] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// LEARN FROM MESSAGE — ሰው + admin messages
// ─────────────────────────────────────────
export async function learnFromMessage(message, isAdmin = false) {
  const knowledge = await readKnowledge();

  const prompt = `
You are a learning AI analyzing Telegram messages from an Amharic lottery group.

Current knowledge:
- Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
- Rules: ${knowledge.rules?.length || 0}
- Intents: ${knowledge.intents?.length || 0}

New message:
- From: ${isAdmin ? 'ADMIN' : 'USER'}
- Text: "${message.text}"

Return ONLY valid JSON:
{
  "adminStyle": {
    "responses": ${isAdmin ? '["phrase if useful"]' : '[]'},
    "greetings": [],
    "warnings": [],
    "announcements": []
  },
  "rules": [],
  "intents": [{"pattern": "", "meaning": "", "response": ""}],
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
      msg: `📩 Message ተማረ — ${isAdmin ? 'ADMIN' : 'USER'}: "${message.text?.slice(0, 40)}"`
    });
    return parsed;
  } catch (err) {
    console.error('[NVIDIA] Learn error:', err.message);
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
  const bestPairs = await getBestQAPairs(15);
  const actionLogs = await getActionLogs(0.7);

  const prompt = `
You are a strict trainer AI. Evaluate if this bot response matches the real admin's style.

Admin style:
- Phrases: ${JSON.stringify(knowledge.adminStyle?.responses?.slice(0, 15))}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Amharic phrases: ${JSON.stringify(knowledge.writingStyle?.amharic?.slice(0, 10))}
- Rules: ${JSON.stringify(knowledge.rules?.slice(0, 10))}
- Board rules: ${JSON.stringify(knowledge.boardRules || {})}
- Intents: ${JSON.stringify(knowledge.intents?.slice(0, 10))}

Best Q&A pairs learned from admin:
${bestPairs.slice(0, 10).map(p => `Q: "${p.user_message}" → A: "${p.admin_reply}"`).join('\n')}

Actions learned:
${actionLogs.slice(0, 5).map(a => `${a.action_type}: ${a.reason}`).join('\n')}

Context: ${context}
User said: "${userMessage}"
Bot responded: "${groqResponse}"

Return ONLY valid JSON:
{
  "score": 0.85,
  "isCorrect": true,
  "issues": [],
  "correction": "correct response",
  "ruleToAdd": null,
  "shouldTeach": false,
  "teachingNote": ""
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const evaluation = JSON.parse(clean);

    learningEvents.emit('activity', {
      type: 'eval',
      msg: `📊 Score: ${Math.round((evaluation.score || 0) * 100)}% ${evaluation.isCorrect ? '✅' : '⚠️'}`
    });

    if (evaluation.ruleToAdd) {
      await updateKnowledge({ rules: [evaluation.ruleToAdd] });
    }

    // Q&A confidence ያዘምናል
    await updateQAConfidence(userMessage, evaluation.isCorrect).catch(() => {});

    return evaluation;
  } catch (err) {
    console.error('[NVIDIA] Evaluate error:', err.message);
    return { score: 0.5, isCorrect: true, issues: [], correction: groqResponse };
  }
}

// ─────────────────────────────────────────
// CORRECTION LOOP
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

    if (evaluation.isCorrect && evaluation.score >= CONFIDENCE_THRESHOLD) {
      learningEvents.emit('activity', {
        type: 'eval',
        msg: `✅ Round ${round + 1}: ${Math.round(evaluation.score * 100)}% — Accepted`
      });
      break;
    }

    if (!evaluation.isCorrect || evaluation.score < CONFIDENCE_THRESHOLD) {
      corrections.push(evaluation);

      const teachingMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
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
          msg: `🔄 Round ${round + 1}: Groq ተስተካከለ`
        });
      } catch (err) {
        console.error('[CORRECTION] Error:', err.message);
        break;
      }

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
    wasCorrected: corrections.length > 0,
  };
}

// ─────────────────────────────────────────
// SYSTEM PROMPT BUILDER — Q&A pairs + actions ያካትታል
// ─────────────────────────────────────────
async function buildSystemPrompt() {
  const knowledge = await readKnowledge();
  const lotteryList = await getLotteryList();
  const boardState = await getBoardState().catch(() => null);
  const bestPairs = await getBestQAPairs(20);
  const actionLogs = await getActionLogs(0.6);

  const filledSlots = boardState
    ? Object.values(boardState.slots || {}).filter(s => s.name).length
    : lotteryList.length;

  return `You are ${BOT_NAME}, admin of an Amharic Telegram lottery group. Respond EXACTLY like the real admin.

ADMIN STYLE:
- Phrases: ${knowledge.adminStyle?.responses?.slice(0, 15).join(' | ') || 'friendly'}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Amharic phrases: ${knowledge.writingStyle?.amharic?.join(', ') || ''}
- Common phrases: ${knowledge.writingStyle?.commonPhrases?.join(' | ') || ''}

LOTTERY RULES:
${knowledge.rules?.map((r, i) => `${i + 1}. ${r}`).join('\n') || 'No rules yet'}

BOARD RULES:
- Price: ${knowledge.boardRules?.price || 400} ብር
- Half price: ${knowledge.boardRules?.halfPrice || 200} ብር
- Slots: 1–${knowledge.boardRules?.maxSlots || 100}
- Filled: ${filledSlots}/100
- Status: ⏳ = ተመዝግቦ ያልከፈለ, ✅ = ከፍሎ confirmed, # = ክፍት

REAL Q&A PAIRS (from admin — use these as guide):
${bestPairs.map(p => `Q: "${p.user_message}" → A: "${p.admin_reply}"`).join('\n') || 'None yet'}

ACTIONS LEARNED:
${actionLogs.map(a => `- ${a.action_type}: ${a.reason} (confidence: ${Math.round(a.confidence * 100)}%)`).join('\n') || 'None yet'}

INTENTS:
${knowledge.intents?.slice(0, 20).map(i => `- "${i.pattern}" → "${i.betterResponse || i.response}"`).join('\n') || ''}

CRITICAL:
1. Always respond in Amharic
2. Be natural — exactly like the real admin
3. Keep responses short and direct
4. Use emojis like the admin does
5. Never give wrong lottery info`;
}

// ─────────────────────────────────────────
// GENERATE RESPONSE (main)
// ─────────────────────────────────────────
export async function generateResponse(userMessage, userId, username) {
  const systemPrompt = await buildSystemPrompt();

  // ተመሳሳይ Q&A pair ፈልግ — ካለ directly ተጠቀምበት
  const similarPairs = await findSimilarQA(userMessage, 3);
  const exactMatch = similarPairs.find(p =>
    p.user_message === userMessage && p.confidence >= 0.9
  );

  if (exactMatch) {
    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🎯 Exact Q&A match — confidence: ${Math.round(exactMatch.confidence * 100)}%`
    });
    return {
      response: exactMatch.admin_reply,
      confidence: exactMatch.confidence,
      needsAdminApproval: false,
      fromCache: true,
    };
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${username}: ${userMessage}` },
  ];

  const initialResponse = await callGroq(messages);

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
  if (!validRange) situation = `Invalid number ${requestedNumber}`;
  else if (alreadyRegistered) situation = `Already registered with number ${alreadyRegistered.number}`;
  else if (numberTaken) situation = `Number ${requestedNumber} taken by ${numberTaken.username}`;
  else situation = `Number ${requestedNumber} available for ${username}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Situation: ${situation}. @${username} wants number ${requestedNumber}. Respond as admin in Amharic.`
    },
  ];

  const initialResponse = await callGroq(messages);

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
      content: `Write announcement about: ${topic}. ${details}. Admin Amharic style with emojis.`
    },
  ];
  const response = await callGroq(messages);

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
  const history = await getHistory(7);
  const actionLogs = await getActionLogs(0.0);
  const bestPairs = await getBestQAPairs(10);

  const prompt = `
Summarize learning from this Telegram lottery group.

Knowledge: ${JSON.stringify(knowledge)}
Messages in last 7 days: ${history.length}
Actions learned: ${actionLogs.length}
Q&A pairs: ${bestPairs.length}

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
      msg: `📊 Summary — confidence: ${Math.round((parsed.confidence || 0) * 100)}%`
    });
    return parsed;
  } catch (err) {
    console.error('[NVIDIA] Summary error:', err.message);
    return null;
  }
}
