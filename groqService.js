import Groq from 'groq-sdk';
import { getNextGroqKey, rotateGroqKey } from './keyRotation.js';
import { readDB } from '../db/database.js';
import { evaluateGroqResponse } from './geminiService.js';

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.90');
const BOT_NAME = process.env.BOT_NAME || 'Admin';

// Call Groq with auto key rotation
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
        console.log('[GROQ] Rate limit hit, rotating key...');
        rotateGroqKey();
        continue;
      }
      throw err;
    }
  }
  throw new Error('All Groq keys exhausted');
}

// Build system prompt from knowledge base
async function buildSystemPrompt() {
  const knowledge = await readDB('knowledge');
  const lottery = await readDB('lottery');

  return `You are ${BOT_NAME}, the admin of an Amharic Telegram lottery group. You must respond EXACTLY like the real admin.

ADMIN STYLE:
- Common responses: ${knowledge.adminStyle.responses.slice(0, 15).join(' | ')}
- Greetings: ${knowledge.adminStyle.greetings.join(' | ')}
- Warnings: ${knowledge.adminStyle.warnings.join(' | ')}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Common Amharic phrases: ${knowledge.writingStyle?.amharic?.join(', ') || ''}

LOTTERY RULES:
${knowledge.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

LOTTERY STATUS:
- Total slots: ${lottery.totalSlots} (1-100)
- Registered: ${Object.keys(lottery.list).length} people

KNOWN INTENTS:
${knowledge.intents.slice(0, 20).map(i => `- If user says "${i.pattern}" → respond like: "${i.betterResponse || i.response}"`).join('\n')}

CRITICAL RULES:
1. ALWAYS respond in Amharic (አማርኛ) unless user writes in English
2. Respond EXACTLY like ${BOT_NAME} - same style, same tone
3. Follow lottery rules strictly
4. Be natural, not robotic
5. Keep responses short and direct like a real admin`;
}

// Generate response with confidence evaluation
export async function generateResponse(userMessage, userId, username) {
  const systemPrompt = await buildSystemPrompt();

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${username || 'User'}: ${userMessage}` },
  ];

  const response = await callGroq(messages);

  // Gemini evaluates Groq's response
  const evaluation = await evaluateGroqResponse(userMessage, response, { userId, username });

  console.log(`[GROQ] Response confidence: ${evaluation.score}`);

  return {
    response,
    confidence: evaluation.score,
    needsAdminApproval: evaluation.score < CONFIDENCE_THRESHOLD,
    evaluation,
  };
}

// Handle lottery registration request
export async function handleRegistration(userId, username, requestedNumber) {
  const knowledge = await readDB('knowledge');
  const lottery = await readDB('lottery');

  const systemPrompt = await buildSystemPrompt();

  // Check if number is available
  const numberTaken = lottery.list[requestedNumber];
  const alreadyRegistered = Object.values(lottery.list).find(m => m.userId === userId);
  const validRange = requestedNumber >= 1 && requestedNumber <= lottery.totalSlots;

  let situation = '';
  if (!validRange) situation = `User requested invalid number ${requestedNumber} (must be 1-100)`;
  else if (alreadyRegistered) situation = `User is already registered with number ${Object.keys(lottery.list).find(k => lottery.list[k].userId === userId)}`;
  else if (numberTaken) situation = `Number ${requestedNumber} is already taken by someone else`;
  else situation = `Number ${requestedNumber} is available, user wants to register`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Situation: ${situation}. User @${username} (ID: ${userId}) wants number ${requestedNumber}. How do you respond as admin?`,
    },
  ];

  const response = await callGroq(messages);
  return { response, available: !numberTaken && validRange && !alreadyRegistered };
}

// Generate announcement
export async function generateAnnouncement(topic, details) {
  const systemPrompt = await buildSystemPrompt();

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Write an announcement about: ${topic}. Details: ${details}. Write it in the admin's style.`,
    },
  ];

  return await callGroq(messages);
}
