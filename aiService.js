import OpenAI from 'openai';
import { EventEmitter } from 'events';
import { getNextDeepSeekKey, rotateDeepSeekKey } from './keys.js';
import {
  readKnowledge, updateKnowledge, getHistory,
  getLotteryList, getTokenUsage, addTokenUsage,
  saveActionLog, updateActionConfidence, getActionLogs,
  saveQAPair, updateQAConfidence, findSimilarQA, getBestQAPairs,
  saveBoardEdit, getUnlearnedEdits, markEditLearned,
  getBoardEdits, getDeletedMessages,
} from './database.js';

// ─────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────
export const learningEvents = new EventEmitter();

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
// NVIDIA / DeepSeek CALLER (ONLY CALLER)
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
// LEARN FROM EDIT
// ─────────────────────────────────────────
export async function learnFromEdit(messageId, beforeText, afterText) {
  const prompt = `
You are a learning AI for an Amharic lottery Telegram bot.

The admin just manually EDITED a message. Analyze what changed and why.

Before edit:
"""
${beforeText || '(empty)'}
"""

After edit:
"""
${afterText || '(empty)'}
"""

Message ID: ${messageId}

Analyze the difference:
- What was added? (new name, status symbol like ✅ or ⏳, number, etc.)
- What was removed? (name deleted = person left or didn't pay?)
- What was changed? (⏳ → ✅ = payment confirmed?)

Extract the rule the bot should learn.

Return ONLY valid JSON:
{
  "changeType": "added_name | removed_name | status_changed | reposted | other",
  "whatChanged": "brief description in Amharic",
  "rule": "rule bot should follow next time",
  "botAction": "what bot should do automatically next time",
  "confidence": 0.9,
  "shouldLearn": true
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (parsed.shouldLearn && parsed.rule) {
      await updateKnowledge({ rules: [parsed.rule] });
      await saveActionLog(
        parsed.changeType || 'edit',
        beforeText?.slice(0, 50) || '',
        parsed.whatChanged || '',
        { beforeText, afterText, botAction: parsed.botAction },
        true
      );
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `✏️ Edit ተማረ — ${parsed.changeType}: "${parsed.whatChanged?.slice(0, 50)}"`
    });

    return parsed;
  } catch (err) {
    console.error('[EDIT] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// LEARN FROM DELETE
// ─────────────────────────────────────────
export async function learnFromDelete(deletedText, context = '') {
  const prompt = `
You are a learning AI for an Amharic lottery Telegram bot.

The admin just DELETED a message. Analyze why.

Deleted message:
"""
${deletedText || '(unknown)'}
"""

Context: ${context}

Why did admin delete this? Common reasons:
- Board text became too long → delete + repost at bottom
- Wrong info was sent → corrected
- Outdated message → cleaned up

Return ONLY valid JSON:
{
  "reason": "why admin deleted this",
  "rule": "rule bot should follow",
  "botAction": "what bot should do next time",
  "confidence": 0.8,
  "shouldLearn": true
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (parsed.shouldLearn && parsed.rule) {
      await updateKnowledge({ rules: [parsed.rule] });
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🗑️ Delete ተማረ — "${parsed.reason?.slice(0, 50)}"`
    });

    return parsed;
  } catch (err) {
    console.error('[DELETE] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// TRY BOT ACTION
// ─────────────────────────────────────────
export async function decideBotAction(userMessage, username, currentBoardText) {
  const knowledge = await readKnowledge();
  const actionLogs = await getActionLogs(0.7);
  const edits = await getBoardEdits(20);
  const deletions = await getDeletedMessages(10);

  const prompt = `
You are an AI that decides what action a Telegram lottery bot should take.

You have learned from watching the admin manually manage the board.

Actions learned from admin edits:
${edits.slice(0, 10).map(e =>
  `- Changed: "${e.before_text?.slice(0, 30)}" → "${e.after_text?.slice(0, 30)}"`
).join('\n') || 'None yet'}

Actions learned from admin deletions:
${deletions.slice(0, 5).map(d =>
  `- Deleted: "${d.text?.slice(0, 30)}"`
).join('\n') || 'None yet'}

Rules learned:
${knowledge.rules?.slice(0, 15).map((r, i) => `${i+1}. ${r}`).join('\n') || 'None yet'}

High confidence actions:
${actionLogs.map(a =>
  `- ${a.action_type}: ${a.reason} (${Math.round(a.confidence * 100)}%)`
).join('\n') || 'None yet'}

Current board:
"""
${currentBoardText || '(no board yet)'}
"""

User message: "@${username}: ${userMessage}"

Decide what action to take. Return ONLY valid JSON:
{
  "action": "edit_board | delete_and_repost | respond_only | register_slot | confirm_payment | no_action",
  "slotNumber": null,
  "newName": null,
  "newStatus": null,
  "responseText": "Amharic response to send",
  "reason": "why this action",
  "confidence": 0.85,
  "shouldAct": true
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    learningEvents.emit('activity', {
      type: 'eval',
      msg: `🤖 Bot action decided: ${parsed.action} (${Math.round((parsed.confidence || 0) * 100)}%)`
    });

    return parsed;
  } catch (err) {
    console.error('[ACTION] Decide error:', err.message);
    return { action: 'respond_only', shouldAct: false, confidence: 0 };
  }
}

// ─────────────────────────────────────────
// ACTION LEARNING
// ─────────────────────────────────────────
export async function learnAction(actionType, trigger, reason, details = {}) {
  try {
    await saveActionLog(actionType, trigger, reason, details, true);

    const prompt = `
You are a learning AI. An admin just performed an action in a Telegram lottery group.

Action: "${actionType}"
Trigger: "${trigger}"
Reason: "${reason}"
Details: ${JSON.stringify(details)}

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

    await updateActionConfidence(actionType, trigger, parsed.confidence ?? 0.8).catch(() => {});

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
// Q&A PAIR LEARNING
// ─────────────────────────────────────────
export async function learnQAPair(userMessage, adminReply, context = '') {
  try {
    await saveQAPair(userMessage, adminReply, context, '', true);

    const prompt = `
Analyze this Q&A pair from an Amharic lottery Telegram group.

User said: "${userMessage}"
Admin replied: "${adminReply}"
Context: "${context}"

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
// LEARN FROM MESSAGE
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
// BACKGROUND LEARNER
// ─────────────────────────────────────────
async function deepSeekBackgroundLearn(userMessage, botResponse, context = '') {
  const knowledge = await readKnowledge();
  const bestPairs = await getBestQAPairs(15);
  const actionLogs = await getActionLogs(0.7);

  const prompt = `
You are a background learning AI for an Amharic lottery Telegram bot.

Admin style:
- Phrases: ${JSON.stringify(knowledge.adminStyle?.responses?.slice(0, 15))}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Rules: ${JSON.stringify(knowledge.rules?.slice(0, 10))}

Best Q&A pairs:
${bestPairs.slice(0, 10).map(p => `Q: "${p.user_message}" → A: "${p.admin_reply}"`).join('\n')}

Context: ${context}
User said: "${userMessage}"
Bot responded: "${botResponse}"

Return ONLY valid JSON:
{
  "ruleToAdd": "rule to improve future responses, or null",
  "intentToUpdate": {
    "pattern": "${userMessage}",
    "meaning": "what user wanted",
    "betterResponse": "improved response or null"
  },
  "styleNote": "style improvement note or null"
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    const updates = {};
    if (parsed.ruleToAdd) updates.rules = [parsed.ruleToAdd];
    if (parsed.intentToUpdate?.betterResponse) updates.intents = [parsed.intentToUpdate];
    if (Object.keys(updates).length > 0) await updateKnowledge(updates);

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🧠 Background learning — "${userMessage.slice(0, 30)}"`
    });

    return parsed;
  } catch (err) {
    console.error('[BACKGROUND] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// SYSTEM PROMPT BUILDER
// ─────────────────────────────────────────
async function buildSystemPrompt(currentBoardText = '') {
  const knowledge = await readKnowledge();
  const lotteryList = await getLotteryList();
  const bestPairs = await getBestQAPairs(20);
  const actionLogs = await getActionLogs(0.6);
  const edits = await getBoardEdits(10);

  return `You are ${BOT_NAME}, admin of an Amharic Telegram lottery group.
Respond EXACTLY like the real admin learned from their actions.
You must also decide what ACTION to take based on what you learned.

ADMIN STYLE:
- Phrases: ${knowledge.adminStyle?.responses?.slice(0, 15).join(' | ') || 'friendly'}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Amharic phrases: ${knowledge.writingStyle?.amharic?.join(', ') || ''}
- Common phrases: ${knowledge.writingStyle?.commonPhrases?.join(' | ') || ''}

LOTTERY RULES:
${knowledge.rules?.map((r, i) => `${i + 1}. ${r}`).join('\n') || 'No rules yet'}

REGISTERED MEMBERS: ${lotteryList.length}/100

WHAT I LEARNED FROM ADMIN EDITS:
${edits.slice(0, 8).map(e =>
  `- "${e.before_text?.slice(0, 30)}" → "${e.after_text?.slice(0, 30)}"`
).join('\n') || 'None yet'}

ACTIONS LEARNED:
${actionLogs.map(a =>
  `- ${a.action_type}: ${a.reason} (${Math.round(a.confidence * 100)}%)`
).join('\n') || 'None yet'}

REAL Q&A PAIRS:
${bestPairs.map(p => `Q: "${p.user_message}" → A: "${p.admin_reply}"`).join('\n') || 'None yet'}

INTENTS:
${knowledge.intents?.slice(0, 20).map(i =>
  `- "${i.pattern}" → "${i.betterResponse || i.response}"`
).join('\n') || ''}

${currentBoardText ? `CURRENT BOARD:\n${currentBoardText}` : ''}

CRITICAL:
1. Always respond in Amharic
2. Be natural — exactly like the real admin
3. Keep responses short and direct
4. Use emojis like the admin does
5. Never give wrong lottery info`;
}

// ─────────────────────────────────────────
// GENERATE RESPONSE
// ─────────────────────────────────────────
export async function generateResponse(userMessage, userId, username, currentBoardText = '') {
  // Exact match check
  const similarPairs = await findSimilarQA(userMessage, 3);
  const exactMatch = similarPairs.find(p =>
    p.user_message === userMessage && p.confidence >= 0.9
  );

  if (exactMatch) {
    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🎯 Exact Q&A match — ${Math.round(exactMatch.confidence * 100)}%`
    });
    return {
      response: exactMatch.admin_reply,
      confidence: exactMatch.confidence,
      fromCache: true,
    };
  }

  const systemPrompt = await buildSystemPrompt(currentBoardText);
  const intentPrompt = systemPrompt + `

User message: "${username}: ${userMessage}"
Current board: """${currentBoardText || 'none'}"""

Decide the ACTION and RESPONSE. Return ONLY valid JSON:
{
  "intent": "register | check_availability | greeting | payment | question | other",
  "slotNumber": null,
  "action": "register_slot | edit_board | respond_only | check_slot",
  "response": "Amharic response exactly like admin",
  "confidence": 0.9
}`;

  const raw = await callDeepSeek(intentPrompt);

  let parsed;
  try {
    const clean = raw.replace(/\`\`\`json|\`\`\`/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    parsed = {
      intent: 'other',
      action: 'respond_only',
      response: raw,
      confidence: 0.7,
    };
  }

  setImmediate(() => {
    deepSeekBackgroundLearn(userMessage, parsed.response, `User: ${username}, Intent: ${parsed.intent}`)
      .catch(err => console.error('[BACKGROUND] Error:', err.message));
  });

  return {
    response: parsed.response,
    intent: parsed.intent,
    action: parsed.action,
    slotNumber: parsed.slotNumber,
    confidence: parsed.confidence || 1.0,
    fromCache: false,
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

  const fullPrompt = systemPrompt + `\n\nSituation: ${situation}. @${username} wants number ${requestedNumber}. Respond as admin in Amharic.`;
  const response = await callDeepSeek(fullPrompt);

  setImmediate(() => {
    deepSeekBackgroundLearn(
      `ምዝገባ ቁጥር ${requestedNumber}`,
      response,
      situation
    ).catch(err => console.error('[BACKGROUND] Error:', err.message));
  });

  return {
    response,
    available: !numberTaken && validRange && !alreadyRegistered,
    confidence: 1.0,
  };
}

// ─────────────────────────────────────────
// GENERATE ANNOUNCEMENT
// ─────────────────────────────────────────
export async function generateAnnouncement(topic, details) {
  const systemPrompt = await buildSystemPrompt();
  const fullPrompt = systemPrompt + `\n\nWrite announcement about: ${topic}. ${details}. Admin Amharic style with emojis.`;
  const response = await callDeepSeek(fullPrompt);

  setImmediate(() => {
    deepSeekBackgroundLearn(`announcement: ${topic}`, response, 'announcement')
      .catch(err => console.error('[BACKGROUND] Error:', err.message));
  });

  return response;
}

// ─────────────────────────────────────────
// GENERATE LEARNING SUMMARY
// ─────────────────────────────────────────
export async function generateLearningSummary() {
  const knowledge = await readKnowledge();
  const history = await getHistory(5);
  const bestPairs = await getBestQAPairs(10);
  const edits = await getBoardEdits(20);
  const deletions = await getDeletedMessages(10);

  const rulesCount = knowledge.rules?.length || 0;
  const intentsCount = knowledge.intents?.length || 0;
  const phrasesCount = knowledge.adminStyle?.responses?.length || 0;

  const prompt = `
Summarize learning from this Telegram lottery group.

Current data:
- Admin phrases: ${phrasesCount}
- Rules learned: ${rulesCount}
- Intents: ${intentsCount}
- Q&A pairs: ${bestPairs.length}
- Board edits: ${edits.length}
- Messages (5 days): ${history.length}

Top rules:
${knowledge.rules?.slice(0, 10).map((r, i) => (i+1) + '. ' + r).join('\n') || 'None'}

Calculate REAL confidence (DO NOT default to 0.75):
- 0-20%: 0-5 rules, 0-10 intents
- 21-40%: 6-15 rules, 11-30 intents
- 41-60%: 16-30 rules, 31-60 intents
- 61-80%: 31-50 rules, 61-100 intents
- 81-95%: 50+ rules, 100+ intents
- 96-100%: fully ready

Return ONLY valid JSON:
{
  "summary": "brief summary in Amharic and English",
  "newThingsLearned": [],
  "weakAreas": [],
  "confidence": <CALCULATE_FROM_DATA_ABOVE>,
  "readyToReplace": false
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    let rawConf = parsed.confidence || 0;
    if (rawConf > 1) rawConf = rawConf / 100;
    const finalConfidence = rawConf > 0 ? rawConf : (
      rulesCount > 50 ? 0.85 :
      rulesCount > 30 ? 0.70 :
      rulesCount > 15 ? 0.55 :
      rulesCount > 5  ? 0.35 : 0.15
    );
    await updateKnowledge({
      confidence: finalConfidence,
      readyToReplace: parsed.readyToReplace || false,
    });
    parsed.confidence = finalConfidence;

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `📊 Summary — ${Math.round((parsed.confidence || 0) * 100)}%`
    });
    return parsed;
  } catch (err) {
    console.error('[NVIDIA] Summary error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// BATCH LEARNING SYSTEM
// ─────────────────────────────────────────
const messageBuffer = [];
const BATCH_SIZE = 50;
const BATCH_INTERVAL_MS = 10 * 60 * 1000;
let batchTimer = null;
const miniSummaries = [];
const dailyExchanges = [];

export function addToBuffer(msg, isAdmin, botResponse = null) {
  messageBuffer.push({
    text: msg.text || '',
    botResponse,
    isAdmin,
    timestamp: Date.now(),
  });

  if (!isAdmin && botResponse) {
    dailyExchanges.push({
      user: msg.text || '',
      bot: botResponse,
      time: new Date().toISOString(),
    });
  }

  learningEvents.emit('activity', {
    type: 'learn',
    msg: `📥 Buffer: ${messageBuffer.length}/${BATCH_SIZE}`
  });

  if (messageBuffer.length >= BATCH_SIZE) {
    processBatch();
    return;
  }

  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(() => {
    if (messageBuffer.length > 0) processBatch();
  }, BATCH_INTERVAL_MS);
}

async function processBatch() {
  if (messageBuffer.length === 0) return;

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
  const userMessages = batch.filter(m => !m.isAdmin);
  const qaExchanges = userMessages
    .filter(m => m.botResponse)
    .map((m, i) => `${i + 1}. User: "${m.text}" → Bot: "${m.botResponse}"`);

  const prompt = `
You are a learning AI for an Amharic Telegram lottery group bot.

Analyze this batch of ${batch.length} messages.

ADMIN messages (${adminMessages.length}):
${adminMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n') || 'None'}

USER + BOT exchanges (${qaExchanges.length}):
${qaExchanges.join('\n') || 'None'}

Return ONLY valid JSON:
{
  "adminStyle": {
    "responses": [],
    "greetings": [],
    "warnings": [],
    "tone": ""
  },
  "rules": [],
  "intents": [{"pattern": "", "meaning": "", "response": ""}],
  "writingStyle": {
    "amharic": [],
    "commonPhrases": [],
    "emojiUsage": ""
  },
  "miniSummary": "brief summary in Amharic",
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
// 🌙 24HR DEEP LEARNING
// ─────────────────────────────────────────
export async function deepNightLearning() {
  learningEvents.emit('activity', {
    type: 'learn',
    msg: '🌙 24hr Deep Learning እየጀመረ...'
  });

  const knowledge = await readKnowledge();
  const history = await getHistory(1);
  const bestPairs = await getBestQAPairs(20);
  const edits = await getBoardEdits(50);
  const deletions = await getDeletedMessages(20);

  const summariesToProcess = [...miniSummaries];
  miniSummaries.length = 0;
  const exchangesToReview = [...dailyExchanges];
  dailyExchanges.length = 0;

  const prompt = `
You are a deep learning AI for an Amharic lottery Telegram bot.

End of day deep analysis.

Mini summaries (${summariesToProcess.length} batches):
${summariesToProcess.map((s, i) => `Batch ${i+1}: ${s.summary} (${s.messageCount} msgs)`).join('\n')}

Board edits learned today (${edits.length}):
${edits.slice(0, 20).map(e =>
  `- "${e.before_text?.slice(0, 30)}" → "${e.after_text?.slice(0, 30)}"`
).join('\n') || 'None'}

Deletions learned today (${deletions.length}):
${deletions.slice(0, 10).map(d => `- "${d.text?.slice(0, 40)}"`).join('\n') || 'None'}

Current knowledge:
- Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
- Rules: ${knowledge.rules?.length || 0}
- Confidence: ${Math.round((knowledge.confidence || 0) * 100)}%

Today's Q&A exchanges:
${exchangesToReview.slice(0, 50).map((e, i) =>
  `${i+1}. User: "${e.user}" → Bot: "${e.bot}"`
).join('\n') || 'None'}

Return ONLY valid JSON:
{
  "consolidatedRules": [],
  "strengthenedIntents": [
    {"pattern": "", "meaning": "", "betterResponse": "", "confidence": 0.9}
  ],
  "gaps": [],
  "newConfidence": 0.85,
  "readyToReplace": false,
  "dailySummary": "ዛሬ ምን ተማርኩ — Amharic summary",
  "improvements": [],
  "totalPatternsLearned": 0
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

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
      msg: `🌙 Deep Learning ተጠናቀቀ! ${Math.round((parsed.newConfidence || 0) * 100)}% — ${parsed.totalPatternsLearned} patterns`
    });

    return parsed;
  } catch (err) {
    console.error('[NIGHT] Deep learning error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// ⭐ LEARN FROM RATING
// ─────────────────────────────────────────
export async function learnFromRating(userText, botResponse, score) {
  const RATING_LABELS = { 1: '👎 ዝቅተኛ', 2: '😐 መካከለኛ', 3: '👍 አሪፍ', 4: '🔥 በጣም አሪፍ' };
  const label = RATING_LABELS[score] || '?';
  const isGood = score >= 3;
  const isExcellent = score === 4;
  const isBad = score === 1;

  const prompt = `
Amharic lottery bot response rating:

User: "${userText}"
Bot: "${botResponse}"
Rating: ${score}/4 — ${label}

Return ONLY valid JSON:
{
  "ruleToAdd": "rule or null",
  "pattern": ${JSON.stringify(userText)},
  "goodResponse": ${isGood ? JSON.stringify(botResponse) : 'null'},
  "badResponse": ${isBad ? JSON.stringify(botResponse) : 'null'},
  "improvement": ${!isGood ? '"how to improve"' : 'null'},
  "confidenceChange": ${score === 4 ? 0.3 : score === 3 ? 0.1 : score === 2 ? 0 : -0.2},
  "saveAsExample": ${isExcellent}
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    const updates = {};
    if (parsed.ruleToAdd) updates.rules = [parsed.ruleToAdd];
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
        `Avoid: "${botResponse.slice(0, 50)}" when user says "${userText.slice(0, 50)}"`
      ];
    }

    if (Object.keys(updates).length > 0) await updateKnowledge(updates);
    await updateQAConfidence(userText, isGood, parsed.confidenceChange || 0).catch(() => {});

    learningEvents.emit('activity', {
      type: isGood ? 'learn' : 'eval',
      msg: `⭐ Rating ${score}/4 (${label}) — "${userText.slice(0, 30)}"`
    });

    return parsed;
  } catch (err) {
    console.error('[RATING] Learn error:', err.message);
    return null;
  }
}
