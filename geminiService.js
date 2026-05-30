import { GoogleGenerativeAI } from '@google/generative-ai';
import { EventEmitter } from 'events';
import { getNextGeminiKey, rotateGeminiKey } from './core.js';
import { readKnowledge, updateKnowledge, getHistory } from './database.js';

export const learningEvents = new EventEmitter();

async function callGemini(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const key = getNextGeminiKey();
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      if (err.status === 429 || err.message?.includes('quota')) {
        console.log('[GEMINI] Rate limit, rotating key...');
        rotateGeminiKey();
        await new Promise(res => setTimeout(res, 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('All Gemini keys exhausted');
}

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
    const response = await callGemini(prompt);
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
    console.error('[GEMINI] Learn error:', err.message);
    learningEvents.emit('activity', {
      type: 'error',
      msg: `Learn error: ${err.message}`
    });
    return null;
  }
}

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
    const response = await callGemini(prompt);
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
    console.error('[GEMINI] Evaluate error:', err.message);
    learningEvents.emit('activity', {
      type: 'error',
      msg: `Evaluate error: ${err.message}`
    });
    return { score: 0.5, isCorrect: true, issues: [] };
  }
}

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
    const response = await callGemini(prompt);
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
    console.error('[GEMINI] Rule error:', err.message);
    learningEvents.emit('activity', {
      type: 'error',
      msg: `Rule error: ${err.message}`
    });
    return null;
  }
}

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
    const response = await callGemini(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    learningEvents.emit('activity', {
      type: 'learn',
      msg: `Daily summary ተሰራ — confidence: ${Math.round((parsed.confidence || 0) * 100)}%`
    });
    return parsed;
  } catch (err) {
    console.error('[GEMINI] Summary error:', err.message);
    learningEvents.emit('activity', {
      type: 'error',
      msg: `Summary error: ${err.message}`
    });
    return null;
  }
}
