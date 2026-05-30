import { GoogleGenerativeAI } from '@google/generative-ai';
import { getNextGeminiKey, rotateGeminiKey } from './keyRotation.js';
import { readDB, updateKnowledge } from '../db/database.js';

// Call Gemini with auto key rotation on rate limit
async function callGemini(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const key = getNextGeminiKey();
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      if (err.status === 429 || err.message?.includes('quota')) {
        console.log('[GEMINI] Rate limit hit, rotating key...');
        rotateGeminiKey();
        continue;
      }
      throw err;
    }
  }
  throw new Error('All Gemini keys exhausted');
}

// Learn from a message
export async function learnFromMessage(message, isAdmin = false) {
  const knowledge = await readDB('knowledge');

  const prompt = `
You are a learning AI that analyzes Telegram messages to understand admin behavior and user patterns.

Current knowledge base summary:
- Admin phrases known: ${knowledge.adminStyle.responses.length}
- Rules known: ${knowledge.rules.length}
- Intents known: ${knowledge.intents.length}

New message to analyze:
- From: ${isAdmin ? 'ADMIN' : 'USER'}
- Username: ${message.from?.username || 'unknown'}
- Text: "${message.text}"

Extract and return ONLY valid JSON (no markdown, no explanation):
{
  "adminStyle": {
    "responses": ${isAdmin ? '["add this phrase if admin said something useful"]' : '[]'},
    "greetings": [],
    "warnings": [],
    "announcements": []
  },
  "rules": ["any rule mentioned"],
  "intents": [{"pattern": "what user said", "meaning": "what they want", "response": "how admin replied"}],
  "writingStyle": {
    "amharic": ["amharic phrases used"],
    "commonPhrases": ["common phrases"]
  },
  "shouldUpdate": true
}
`;

  try {
    const response = await callGemini(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (parsed.shouldUpdate) {
      await updateKnowledge(parsed);
      console.log('[GEMINI] Knowledge updated from message');
    }
    return parsed;
  } catch (err) {
    console.error('[GEMINI] Learn error:', err.message);
    return null;
  }
}

// Evaluate Groq's response and give feedback
export async function evaluateGroqResponse(userMessage, groqResponse, context) {
  const knowledge = await readDB('knowledge');

  const prompt = `
You are a trainer AI evaluating a bot's response. The bot is trying to replace an admin in an Amharic Telegram lottery group.

Admin's known style: ${JSON.stringify(knowledge.adminStyle.responses.slice(0, 10))}
Known rules: ${JSON.stringify(knowledge.rules)}

User said: "${userMessage}"
Bot responded: "${groqResponse}"

Evaluate and return ONLY valid JSON:
{
  "score": 0.85,
  "isCorrect": true,
  "issues": ["list any problems"],
  "amharicIssues": ["amharic language problems"],
  "suggestion": "better response would be...",
  "intentUpdate": {"pattern": "...", "meaning": "...", "betterResponse": "..."},
  "shouldLearn": true
}

Score 0-1. Above 0.9 means excellent. Be strict about Amharic accuracy.
`;

  try {
    const response = await callGemini(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const evaluation = JSON.parse(clean);

    // If should learn, update intents
    if (evaluation.shouldLearn && evaluation.intentUpdate) {
      await updateKnowledge({
        intents: [evaluation.intentUpdate],
      });
    }

    return evaluation;
  } catch (err) {
    console.error('[GEMINI] Evaluate error:', err.message);
    return { score: 0.5, isCorrect: true, issues: [] };
  }
}

// Learn lottery rules from admin message
export async function learnLotteryRules(adminMessage) {
  const prompt = `
Extract lottery rules from this admin message in a Telegram group.
Admin said: "${adminMessage}"

Return ONLY valid JSON:
{
  "rules": ["rule 1", "rule 2"],
  "registrationInfo": "how to register",
  "numberRange": {"min": 1, "max": 100},
  "eligibility": "who can join",
  "isRule": true
}
`;

  try {
    const response = await callGemini(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[GEMINI] Rule learn error:', err.message);
    return null;
  }
}

// Generate daily learning summary
export async function generateLearningSummary() {
  const knowledge = await readDB('knowledge');
  const history = await readDB('history');

  const recentMessages = history.messages.slice(-50);

  const prompt = `
Summarize what you've learned from this Telegram lottery group in the last period.

Knowledge base: ${JSON.stringify(knowledge)}
Recent messages count: ${recentMessages.length}

Return ONLY valid JSON:
{
  "summary": "brief summary in Amharic and English",
  "newThingsLearned": ["thing 1", "thing 2"],
  "weakAreas": ["area needing improvement"],
  "confidence": 0.75,
  "readyToReplace": false
}
`;

  try {
    const response = await callGemini(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[GEMINI] Summary error:', err.message);
    return null;
  }
}
