
// ─────────────────────────────────────────
// 📦 BATCH LEARNING SYSTEM
// 50 messages ወይም 10 minutes → አንድ DeepSeek call
// ─────────────────────────────────────────

const messageBuffer = [];
const BATCH_SIZE = 50;
const BATCH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let batchTimer = null;
const miniSummaries = []; // ቀን ውስጥ ያሉ mini summaries

export function addToBuffer(msg, isAdmin) {
  messageBuffer.push({
    text: msg.text || '',
    isAdmin,
    timestamp: Date.now(),
  });

  learningEvents.emit('activity', {
    type: 'learn',
    msg: `📥 Buffer: ${messageBuffer.length}/${BATCH_SIZE} messages`
  });

  // 50 ሲሞሉ → ወዲያው ያስተምራል
  if (messageBuffer.length >= BATCH_SIZE) {
    processBatch();
    return;
  }

  // Timer reset — 10 min ካልሞሉ
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(() => {
    if (messageBuffer.length > 0) processBatch();
  }, BATCH_INTERVAL_MS);
}

async function processBatch() {
  if (messageBuffer.length === 0) return;

  // Buffer ን copy አርጎ clear
  const batch = [...messageBuffer];
  messageBuffer.length = 0;
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  learningEvents.emit('activity', {
    type: 'learn',
    msg: `📦 Batch processing ${batch.length} messages...`
  });

  const adminMessages = batch.filter(m => m.isAdmin).map(m => m.text);
  const userMessages = batch.filter(m => !m.isAdmin).map(m => m.text);

  const prompt = `
You are a learning AI for an Amharic Telegram lottery group bot.

Analyze this batch of ${batch.length} messages and extract ALL learning patterns.

ADMIN messages (${adminMessages.length}):
${adminMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n') || 'None'}

USER messages (${userMessages.length}):
${userMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n') || 'None'}

Extract:
1. Admin style patterns (phrases, tone, emojis)
2. Common user questions and their patterns
3. Lottery rules mentioned
4. Registration patterns
5. Board/payment patterns

Return ONLY valid JSON:
{
  "adminStyle": {
    "responses": [],
    "greetings": [],
    "warnings": [],
    "tone": ""
  },
  "rules": [],
  "intents": [
    {"pattern": "", "meaning": "", "response": ""}
  ],
  "writingStyle": {
    "amharic": [],
    "commonPhrases": [],
    "emojiUsage": ""
  },
  "miniSummary": "brief summary of what was learned in Amharic",
  "topPatterns": [],
  "shouldUpdate": true
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (parsed.shouldUpdate) {
      await updateKnowledge({
        adminStyle: parsed.adminStyle,
        rules: parsed.rules || [],
        intents: parsed.intents || [],
        writingStyle: parsed.writingStyle,
      });
    }

    // Mini summary ያስቀምጣል — 24hr learning ይጠቀምበታል
    if (parsed.miniSummary) {
      miniSummaries.push({
        time: new Date().toISOString(),
        summary: parsed.miniSummary,
        patterns: parsed.topPatterns || [],
        messageCount: batch.length,
      });

      learningEvents.emit('activity', {
        type: 'learn',
        msg: `✅ Batch learned! — "${parsed.miniSummary.slice(0, 60)}"`
      });
    }

    return parsed;
  } catch (err) {
    console.error('[BATCH] Error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// 🌙 24HR DEEP LEARNING — ሌሊት አንዴ
// Mini summaries ሰብስቦ deep learning ያደርጋል
// ─────────────────────────────────────────
export async function deepNightLearning() {
  learningEvents.emit('activity', {
    type: 'learn',
    msg: '🌙 24hr Deep Learning እየጀመረ...'
  });

  const knowledge = await readKnowledge();
  const history = await getHistory(1); // የዛሬ messages
  const bestPairs = await getBestQAPairs(20);

  // ያሉ mini summaries ሰብስብ
  const summariesToProcess = [...miniSummaries];
  miniSummaries.length = 0; // clear

  const prompt = `
You are a deep learning AI for an Amharic lottery Telegram bot.

It's the end of the day. Do a DEEP analysis of everything learned today.

Mini summaries from today's batches (${summariesToProcess.length} batches):
${summariesToProcess.map((s, i) => `
Batch ${i + 1} (${s.time}):
- Summary: ${s.summary}
- Patterns: ${s.patterns.join(', ')}
- Messages: ${s.messageCount}
`).join('\n')}

Current knowledge state:
- Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
- Rules: ${knowledge.rules?.length || 0}
- Intents: ${knowledge.intents?.length || 0}
- Confidence: ${Math.round((knowledge.confidence || 0) * 100)}%

Best Q&A pairs learned:
${bestPairs.slice(0, 10).map(p => `Q: "${p.user_message}" → A: "${p.admin_reply}"`).join('\n')}

Today's message count: ${history.length}

Tasks:
1. Consolidate all patterns — remove duplicates
2. Strengthen high-frequency patterns
3. Identify gaps — what questions can't bot answer yet?
4. Calculate new confidence score
5. Write detailed Amharic summary

Return ONLY valid JSON:
{
  "consolidatedRules": [],
  "strengthenedIntents": [
    {"pattern": "", "meaning": "", "betterResponse": "", "confidence": 0.9}
  ],
  "gaps": [],
  "newConfidence": 0.85,
  "readyToReplace": false,
  "dailySummary": "ዛሬ ምን ተማርኩ — Amharic detailed summary",
  "improvements": [],
  "totalPatternsLearned": 0
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Knowledge ያዘምናል
    await updateKnowledge({
      rules: parsed.consolidatedRules || [],
      intents: parsed.strengthenedIntents || [],
      confidence: parsed.newConfidence || knowledge.confidence,
      readyToReplace: parsed.readyToReplace || false,
      dailySummary: parsed.dailySummary,
      gaps: parsed.gaps || [],
      lastDeepLearning: new Date().toISOString(),
    });

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🌙 Deep Learning ተጠናቀቀ! Confidence: ${Math.round((parsed.newConfidence || 0) * 100)}% — ${parsed.totalPatternsLearned} patterns`
    });

    return parsed;
  } catch (err) {
    console.error('[NIGHT] Deep learning error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// ⭐ LEARN FROM RATING — admin rating → DeepSeek
// ─────────────────────────────────────────
export async function learnFromRating(userText, botResponse, score) {
  const RATING_LABELS = {
    1: '👎 ዝቅተኛ',
    2: '😐 መካከለኛ',
    3: '👍 አሪፍ',
    4: '🔥 በጣም አሪፍ',
  };

  const label = RATING_LABELS[score] || '?';
  const isGood = score >= 3;
  const isExcellent = score === 4;
  const isBad = score === 1;

  const prompt = `
You are a learning AI for an Amharic lottery Telegram bot.

The admin just rated this bot response:

User asked: "${userText}"
Bot responded: "${botResponse}"
Admin rating: ${score}/4 — ${label}

${isExcellent ? `
This is EXCELLENT (4/4). 
- Save this as a perfect response pattern
- Bot should respond EXACTLY like this next time
- Increase confidence for this pattern` : ''}

${score === 3 ? `
This is GOOD (3/4).
- This response works well
- Minor improvements possible
- Keep this pattern` : ''}

${score === 2 ? `
This is AVERAGE (2/4).
- Response is acceptable but not great
- Try to improve style next time
- Note what could be better` : ''}

${isBad ? `
This is BAD (1/4).
- This response was WRONG or poor quality
- Bot should NOT respond like this
- Learn what went wrong` : ''}

Return ONLY valid JSON:
{
  "ruleToAdd": "rule to remember based on this rating",
  "pattern": "${userText}",
  "goodResponse": ${isGood ? `"${botResponse}"` : 'null'},
  "badResponse": ${isBad ? `"${botResponse}"` : 'null'},
  "improvement": "how to improve if rating < 3, else null",
  "confidenceChange": ${score === 4 ? 0.3 : score === 3 ? 0.1 : score === 2 ? 0 : -0.2},
  "saveAsExample": ${isExcellent}
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    const updates = {};

    if (parsed.ruleToAdd) {
      updates.rules = [parsed.ruleToAdd];
    }

    if (isExcellent && parsed.goodResponse) {
      updates.intents = [{
        pattern: userText,
        meaning: 'admin rated excellent 🔥',
        response: parsed.goodResponse,
        betterResponse: parsed.goodResponse,
        rating: 4,
        locked: true,
      }];
      updates.adminStyle = { responses: [parsed.goodResponse] };
    }

    if (score === 3 && parsed.goodResponse) {
      updates.intents = [{
        pattern: userText,
        meaning: 'admin rated good 👍',
        response: parsed.goodResponse,
        betterResponse: parsed.goodResponse,
        rating: 3,
      }];
    }

    if (isBad) {
      updates.rules = [
        parsed.ruleToAdd || `Never respond like "${botResponse.slice(0, 50)}" to "${userText.slice(0, 50)}"`,
      ];
    }

    if (Object.keys(updates).length > 0) {
      await updateKnowledge(updates);
    }

    await updateQAConfidence(userText, isGood, parsed.confidenceChange || 0).catch(() => {});

    learningEvents.emit('activity', {
      type: isGood ? 'learn' : 'eval',
      msg: `⭐ Rating ${score}/4 (${label}) — "${userText.slice(0, 30)}" — DeepSeek ተማረ`
    });

    return parsed;
  } catch (err) {
    console.error('[RATING] Learn error:', err.message);
    return null;
  }
}
