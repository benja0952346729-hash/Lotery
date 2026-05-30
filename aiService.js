import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { EventEmitter } from 'events';
import { getNextGroqKey, rotateGroqKey, getNextDeepSeekKey, rotateDeepSeekKey } from './keys.js';
import { readKnowledge, updateKnowledge, getHistory, getLotteryList, getTokenUsage, addTokenUsage } from './database.js';

// ─────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────
export const learningEvents = new EventEmitter();

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.90');
const BOT_NAME = process.env.BOT_NAME || 'Admin';

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
// NVIDIA NIM CALLER (DeepSeek V4 Flash)
// ─────────────────────────────────────────
async function callDeepSeek(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const key = getNextDeepSeekKey();
      const client = new OpenAI({
        apiKey: key,
        baseURL: 'https://integrate.api.nvidia.com/v1', // ← NVIDIA NIM
      });
      const completion = await client.chat.completions.create({
        model: 'deepseek-ai/deepseek-v4-flash', // ← DeepSeek V4 Flash
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.7,
      });
      await trackTokens('nvidia-deepseek', completion.usage?.prompt_tokens || 0, completion.usage?.completion_tokens || 0);
      return completion.choices[0]?.message?.content || '';
    } catch (err) {
      if (err.status === 429 || err.message?.includes('quota') || err.message?.includes('rate limit')) {
        console.log('[NVIDIA] Rate limit, rotating key...');
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
      await trackTokens('groq', completion.usage?.prompt_tokens || 0, completion.usage?.completion_tokens || 0);
      return completion.choices[0]?.message?.content || '';
    } catch (err) {
      if (err.status === 429 || err.message?.includes('rate limit')) {
        console.log('[GROQ] Rate limit, rotating key...');
        rotateGroqKey();
        continue;
      }
      throw err;
    }
  }
  throw new Error('All Groq keys exhausted');
}

// ─────────────────────────────────────────
// LEARNING — learnFromMessage
// ─────────────────────────────────────────
export async function learnFromMessage(message, isAdmin = false) {
  const knowledge = await readKnowledge();

  const prompt = `
You are a learning AI analyzing Telegram messages to understand admin behavior in an Amharic lottery group.

Current knowledge:
- Admin phrases known: ${knowledge.adminStyle?.responses?.length || 0}
- Rules known: ${knowledge.rules?.length || 0}
- Intents known: ${knowledge.intents?.length || 0}

New message:
- From: ${isAdmin ? 'ADMIN' : 'USER'}
- Username: ${message.from?.username || 'unknown'}
- Text: "${message.text}"

Return ONLY valid JSON (no markdown):
{
  "adminStyle": {
    "responses": ${isAdmin ? '["phrase if useful"]' : '[]'},
    "greetings": [],
    "warnings": [],
    "announcements": []
  },
  "rules": [],
  "intents": [{"pattern": "user said", "meaning": "what they want", "response": "how admin replied"}],
  "writingStyle": {
    "amharic": [],
    "commonPhrases": []
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
// EVALUATION — evaluateGroqResponse
// ─────────────────────────────────────────
export async function evaluateGroqResponse(userMessage, groqResponse) {
  const knowledge = await readKnowledge();

  const prompt = `
You are a trainer AI evaluating a bot's response in an Amharic Telegram lottery group.

Admin style: ${JSON.stringify(knowledge.adminStyle?.responses?.slice(0, 10))}
Rules: ${JSON.stringify(knowledge.rules)}

User said: "${userMessage}"
Bot responded: "${groqResponse}"

Return ONLY valid JSON:
{
  "score": 0.85,
  "isCorrect": true,
  "issues": [],
  "amharicIssues": [],
  "suggestion": "better response",
  "intentUpdate": {"pattern": "...", "meaning": "...", "betterResponse": "..."},
  "shouldLearn": false
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const evaluation = JSON.parse(clean);
    if (evaluation.shouldLearn && evaluation.intentUpdate) {
      await updateKnowledge({ intents: [evaluation.intentUpdate] });
    }
    learningEvents.emit('activity', {
      type: 'eval',
      msg: `Response ተገምግሟል — score: ${Math.round((evaluation.score || 0) * 100)}% ${evaluation.isCorrect ? '✅' : '⚠️'}`
    });
    return evaluation;
  } catch (err) {
    console.error('[NVIDIA] Evaluate error:', err.message);
    learningEvents.emit('activity', {
      type: 'error',
      msg: `Evaluate error: ${err.message}`
    });
    return { score: 0.5, isCorrect: true, issues: [] };
  }
}

// ─────────────────────────────────────────
// LOTTERY RULES — learnLotteryRules
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
    learningEvents.emit('activity', {
      type: 'error',
      msg: `Rule error: ${err.message}`
    });
    return null;
  }
}

// ─────────────────────────────────────────
// SUMMARY — generateLearningSummary
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
    learningEvents.emit('activity', {
      type: 'error',
      msg: `Summary error: ${err.message}`
    });
    return null;
  }
}

// ─────────────────────────────────────────
// GROQ — System Prompt Builder
// ─────────────────────────────────────────
async function buildSystemPrompt() {
  const knowledge = await readKnowledge();
  const lotteryList = await getLotteryList();

  return `You are ${BOT_NAME}, admin of an Amharic Telegram lottery group. Respond EXACTLY like the real admin.

ADMIN STYLE:
- Phrases: ${knowledge.adminStyle?.responses?.slice(0, 15).join(' | ') || 'friendly'}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Amharic phrases: ${knowledge.writingStyle?.amharic?.join(', ') || ''}

RULES:
${knowledge.rules?.map((r, i) => `${i + 1}. ${r}`).join('\n') || 'No rules yet'}

LOTTERY:
- Slots: 1-100
- Registered: ${lotteryList.length} people

INTENTS:
${knowledge.intents?.slice(0, 20).map(i => `- "${i.pattern}" → "${i.betterResponse || i.response}"`).join('\n') || ''}

CRITICAL:
1. Always respond in Amharic
2. Be natural, not robotic
3. Keep responses short like a real admin`;
}

// ─────────────────────────────────────────
// GROQ — generateResponse
// ─────────────────────────────────────────
export async function generateResponse(userMessage, userId, username) {
  const systemPrompt = await buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${username}: ${userMessage}` },
  ];

  const response = await callGroq(messages);
  const evaluation = await evaluateGroqResponse(userMessage, response);

  if (evaluation.suggestion && evaluation.score < 0.8) {
    await updateKnowledge({
      intents: [{
        pattern: userMessage,
        meaning: 'user question',
        betterResponse: evaluation.suggestion
      }]
    }).catch(err => console.error('[LEARN] Update error:', err.message));
  }

  return {
    response,
    confidence: evaluation.score,
    needsAdminApproval: evaluation.score < CONFIDENCE_THRESHOLD,
    evaluation,
  };
}

// ─────────────────────────────────────────
// GROQ — handleRegistration
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
  else if (numberTaken) situation = `Number ${requestedNumber} already taken`;
  else situation = `Number ${requestedNumber} is available`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Situation: ${situation}. @${username} wants number ${requestedNumber}. Respond as admin in Amharic.` },
  ];

  const response = await callGroq(messages);
  return { response, available: !numberTaken && validRange && !alreadyRegistered };
}

// ─────────────────────────────────────────
// GROQ — generateAnnouncement
// ─────────────────────────────────────────
export async function generateAnnouncement(topic, details) {
  const systemPrompt = await buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Write an announcement about: ${topic}. ${details}. Write in admin's Amharic style.` },
  ];
  return await callGroq(messages);
}
