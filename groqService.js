import Groq from 'groq-sdk';
import { getNextGroqKey, rotateGroqKey } from './core.js';
import { readKnowledge, getLotteryList, updateKnowledge } from './database.js';
import { evaluateGroqResponse } from './geminiService.js';

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.90');
const BOT_NAME = process.env.BOT_NAME || 'Admin';

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

export async function generateResponse(userMessage, userId, username) {
  const systemPrompt = await buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${username}: ${userMessage}` },
  ];

  const response = await callGroq(messages);
  const evaluation = await evaluateGroqResponse(userMessage, response);

  // ✅ Better response ካለ knowledge ውስጥ አስቀምጥ — ቀጣዩ ጊዜ ይሻላል
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

export async function generateAnnouncement(topic, details) {
  const systemPrompt = await buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Write an announcement about: ${topic}. ${details}. Write in admin's Amharic style.` },
  ];
  return await callGroq(messages);
}
