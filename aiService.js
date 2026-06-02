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
// ADMIN CONFIG
// ─────────────────────────────────────────
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => parseInt(id.trim()))
  .filter(id => !isNaN(id));

const BOT_TRIGGER = (process.env.BOT_TRIGGER || 'Bot').toLowerCase();

export function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

export function mentionsBot(text = '') {
  return text.toLowerCase().includes(BOT_TRIGGER);
}

export function classifyMessage(text = '', userId) {
  const adminSender = isAdmin(userId);
  const botMentioned = mentionsBot(text);

  if (adminSender && botMentioned) {
    const teachingKeywords = [
      'ስህተት', 'አይደለም', 'ትክክል አይደለም', 'ቀይር', 'ተው',
      'አታድርግ', 'ይህ አይሆንም', 'wrong', 'incorrect', 'no',
      'ልክ አደለም', 'እንደዚ አይሆንም'
    ];
    const isTeaching = teachingKeywords.some(kw =>
      text.toLowerCase().includes(kw.toLowerCase())
    );
    return isTeaching ? 'admin_teaching' : 'admin_command';
  }

  if (adminSender && !botMentioned) return 'admin_message';
  if (!adminSender && botMentioned) return 'user_about_bot';
  return 'user_message';
}

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
        max_tokens: 2048,
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
You are a learning AI student for an Amharic lottery Telegram bot.

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
You are a learning AI student for an Amharic lottery Telegram bot.

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
// HANDLE ADMIN TEACHING
// ─────────────────────────────────────────
export async function handleAdminTeaching(adminMessage, context = '') {
  const prompt = `
You are a learning AI student for an Amharic lottery Telegram bot.

The ADMIN (your teacher) just corrected or taught you something.

Admin message: "${adminMessage}"
Context: "${context}"

The admin is telling you what you did wrong or what you should do differently.
Learn from this correction carefully — your teacher knows best.

Return ONLY valid JSON:
{
  "correctionType": "wrong_response | wrong_action | style_issue | rule_update | other",
  "whatWasWrong": "brief description in Amharic",
  "newRule": "the rule to learn from this correction",
  "avoidInFuture": "what to avoid next time",
  "confidence": 0.95,
  "shouldLearn": true
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (parsed.shouldLearn && parsed.newRule) {
      await updateKnowledge({ rules: [parsed.newRule] });
      await saveActionLog(
        'admin_correction',
        adminMessage.slice(0, 50),
        parsed.whatWasWrong || '',
        { correction: parsed.newRule, avoid: parsed.avoidInFuture },
        true
      );
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `👨‍🏫 Admin ማስተማሪያ ተማረ — "${parsed.whatWasWrong?.slice(0, 50)}"`
    });

    return parsed;
  } catch (err) {
    console.error('[TEACHING] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// HANDLE ADMIN COMMAND
// ─────────────────────────────────────────
export async function handleAdminCommand(adminMessage, currentBoardText = '') {
  const knowledge = await readKnowledge();
  const actionLogs = await getActionLogs(0.7);
  const template = knowledge.boardTemplate || '';

  const prompt = `
You are an AI student learning to manage an Amharic Telegram lottery group.
Your ADMIN (teacher) just gave you a direct command.
You MUST obey this command exactly.

Admin command: "${adminMessage}"

Current board:
"""
${currentBoardText || '(no board yet)'}
"""

Board template learned from admin:
"""
${template || '(not learned yet)'}
"""

Rules you learned from admin:
${knowledge.rules?.slice(0, 15).map((r, i) => `${i+1}. ${r}`).join('\n') || 'None yet'}

Parse the admin command and decide what to do.

Return ONLY valid JSON:
{
  "action": "send_board | update_slot | delete_board | announce | respond | other",
  "slotNumber": null,
  "newName": null,
  "newStatus": null,
  "boardText": "full board text if action is send_board, else null",
  "responseText": "Amharic response to confirm action",
  "reason": "what admin asked for",
  "confidence": 0.95
}`;

  try {
    const response = await callDeepSeek(prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    learningEvents.emit('activity', {
      type: 'eval',
      msg: `👑 Admin command: ${parsed.action} — "${parsed.reason?.slice(0, 40)}"`
    });

    return parsed;
  } catch (err) {
    console.error('[ADMIN CMD] Error:', err.message);
    return { action: 'respond', responseText: 'ትዕዛዙን ልረዳ አልቻልኩም። እባክህ/ሽ ደግም ሞክር።', confidence: 0 };
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
You are an AI student learning to manage an Amharic Telegram lottery group.
You learned everything from watching the admin.

Board structure learned from admin:
${knowledge.boardTemplate || edits.slice(0, 3).map(e => e.after_text || e.before_text).join('\n---\n') || 'None yet'}

Rules learned from admin:
${knowledge.rules?.slice(0, 15).map((r, i) => `${i+1}. ${r}`).join('\n') || 'None yet'}

High confidence actions learned:
${actionLogs.map(a =>
  `- ${a.action_type}: ${a.reason} (${Math.round(a.confidence * 100)}%)`
).join('\n') || 'None yet'}

Current board:
"""
${currentBoardText || '(no board yet)'}
"""

User message: "@${username}: ${userMessage}"

Decide what to do based on what you learned from admin.
If action is "send_board" — create FULL board text exactly like admin does.

Return ONLY valid JSON:
{
  "action": "send_board | register_slot | respond_only | no_action",
  "slotNumber": null,
  "newName": null,
  "boardText": "FULL board text if action is send_board, else null",
  "responseText": "Amharic response to send to user",
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
You are a learning AI student. An admin just performed an action in a Telegram lottery group.
Learn from this action carefully.

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
You are a student learning how the admin responds.

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
export async function learnFromMessage(message, isAdminMsg = false) {
  const knowledge = await readKnowledge();

  const prompt = `
You are a learning AI student analyzing Telegram messages from an Amharic lottery group.
${isAdminMsg ? 'This is from your TEACHER (admin) — learn carefully!' : 'This is from a user — learn what they want.'}

Current knowledge:
- Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
- Rules: ${knowledge.rules?.length || 0}
- Intents: ${knowledge.intents?.length || 0}

New message:
- From: ${isAdminMsg ? 'ADMIN (your teacher)' : 'USER'}
- Text: "${message.text}"

Return ONLY valid JSON:
{
  "adminStyle": {
    "responses": ${isAdminMsg ? '["phrase if useful"]' : '[]'},
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
      msg: `📩 Message ተማረ — ${isAdminMsg ? 'ADMIN' : 'USER'}: "${message.text?.slice(0, 40)}"`
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
You are a background learning AI student for an Amharic lottery Telegram bot.

Admin style learned so far:
- Phrases: ${JSON.stringify(knowledge.adminStyle?.responses?.slice(0, 15))}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Rules: ${JSON.stringify(knowledge.rules?.slice(0, 10))}

Best Q&A pairs learned from admin:
${bestPairs.slice(0, 10).map(p => `Q: "${p.user_message}" → A: "${p.admin_reply}"`).join('\n')}

Context: ${context}
User said: "${userMessage}"
Bot responded: "${botResponse}"

Was the bot response good? How to improve?

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
// SYSTEM PROMPT BUILDER — STUDENT MINDSET
// ─────────────────────────────────────────
async function buildSystemPrompt(currentBoardText = '') {
  const knowledge = await readKnowledge();
  const lotteryList = await getLotteryList();
  const bestPairs = await getBestQAPairs(20);
  const actionLogs = await getActionLogs(0.6);
  const edits = await getBoardEdits(10);

  const confidencePct = Math.round((knowledge.confidence || 0) * 100);
  const isReady = (knowledge.confidence || 0) >= 0.8;

  return `You are an AI student learning to become the admin of this Amharic Telegram lottery group.

YOUR MINDSET:
- You are NOT the admin yet — you are learning to become one
- The real admin is your teacher — watch every action carefully
- Every message, edit, delete, photo = a lesson for you
- Your goal: learn so well that you can replace the admin completely
- When you act — act EXACTLY like your teacher (admin)

LEARNING STAGE: ${confidencePct}%
${isReady ? '🎓 Almost ready to act as admin!' : '📚 Still learning — watch carefully and act humbly'}

WHAT YOU LEARNED FROM ADMIN:
- Phrases: ${knowledge.adminStyle?.responses?.slice(0, 15).join(' | ') || 'still learning...'}
- Tone: ${knowledge.writingStyle?.tone || 'still learning...'}
- Amharic phrases: ${knowledge.writingStyle?.amharic?.join(', ') || 'still learning...'}
- Common phrases: ${knowledge.writingStyle?.commonPhrases?.join(' | ') || 'still learning...'}

RULES LEARNED FROM ADMIN:
${knowledge.rules?.map((r, i) => `${i + 1}. ${r}`).join('\n') || 'No rules yet — still watching admin'}

REGISTERED MEMBERS: ${lotteryList.length}/100

WHAT ADMIN TAUGHT ME THROUGH EDITS:
${edits.slice(0, 8).map(e =>
  `- "${e.before_text?.slice(0, 30)}" → "${e.after_text?.slice(0, 30)}"`
).join('\n') || 'None yet'}

ACTIONS I LEARNED FROM ADMIN:
${actionLogs.map(a =>
  `- ${a.action_type}: ${a.reason} (${Math.round(a.confidence * 100)}%)`
).join('\n') || 'None yet'}

REAL Q&A PAIRS ADMIN TAUGHT ME:
${bestPairs.map(p => `Q: "${p.user_message}" → A: "${p.admin_reply}"`).join('\n') || 'None yet'}

INTENTS I LEARNED:
${knowledge.intents?.slice(0, 20).map(i =>
  `- "${i.pattern}" → "${i.betterResponse || i.response}"`
).join('\n') || ''}

${currentBoardText ? `CURRENT BOARD:\n${currentBoardText}` : ''}

CRITICAL RULES:
1. Always respond in Amharic
2. Act EXACTLY like admin — same phrases, same emojis, same tone
3. Keep responses short and direct like admin
4. Never give wrong lottery info
5. When unsure — respond humbly and ask admin`;
}

// ─────────────────────────────────────────
// MAIN MESSAGE HANDLER
// ─────────────────────────────────────────
export async function handleIncomingMessage(message, userId, username, currentBoardText = '') {
  const text = message.text || '';
  const msgType = classifyMessage(text, userId);

  learningEvents.emit('activity', {
    type: 'eval',
    msg: `📨 Message type: ${msgType} from @${username}`
  });

  switch (msgType) {

    case 'admin_command': {
      const result = await handleAdminCommand(text, currentBoardText);
      setImmediate(() => {
        learnAction('admin_command', text.slice(0, 50), result.reason || '', { result })
          .catch(() => {});
      });
      return {
        response: result.responseText || 'ትዕዛዙ ተቀበለ ✅',
        action: result.action,
        slotNumber: result.slotNumber,
        boardText: result.boardText,
        confidence: result.confidence || 0.95,
        fromAdmin: true,
        msgType,
      };
    }

    case 'admin_teaching': {
      const result = await handleAdminTeaching(text, `Board: ${currentBoardText?.slice(0, 100)}`);
      return {
        response: `ገባኝ! ተማርኩ 🙏 — ${result?.whatWasWrong || ''}`,
        action: 'learn',
        confidence: result?.confidence || 0.95,
        fromAdmin: true,
        msgType,
      };
    }

    case 'admin_message': {
      setImmediate(() => {
        learnFromMessage(message, true).catch(() => {});
        learnLotteryRules(text).catch(() => {});
      });
      return null;
    }

    case 'user_about_bot': {
      return await generateResponse(text, userId, username, currentBoardText);
    }

    case 'user_message':
    default: {
      return await generateResponse(text, userId, username, currentBoardText);
    }
  }
}

// ─────────────────────────────────────────
// GENERATE RESPONSE
// ─────────────────────────────────────────
export async function generateResponse(userMessage, userId, username, currentBoardText = '') {
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

  try {
    const decidedAction = await decideBotAction(userMessage, username, currentBoardText);
    if (decidedAction && decidedAction.confidence > (parsed.confidence || 0)) {
      parsed.action = decidedAction.action;
      parsed.slotNumber = decidedAction.slotNumber || parsed.slotNumber;
      if (decidedAction.responseText) {
        parsed.response = decidedAction.responseText;
        parsed.confidence = decidedAction.confidence;
      }
    }
  } catch (err) {
    console.error('[DECIDE] Error:', err.message);
  }

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
Summarize learning progress of this AI student learning to become a Telegram lottery group admin.

Current data:
- Admin phrases learned: ${phrasesCount}
- Rules learned: ${rulesCount}
- Intents learned: ${intentsCount}
- Q&A pairs: ${bestPairs.length}
- Board edits studied: ${edits.length}
- Messages (5 days): ${history.length}

Top rules learned:
${knowledge.rules?.slice(0, 10).map((r, i) => (i+1) + '. ' + r).join('\n') || 'None'}

Calculate REAL confidence (DO NOT default to 0.75):
- 0-20%: 0-5 rules, 0-10 intents
- 21-40%: 6-15 rules, 11-30 intents
- 41-60%: 16-30 rules, 31-60 intents
- 61-80%: 31-50 rules, 61-100 intents
- 81-95%: 50+ rules, 100+ intents
- 96-100%: fully ready to replace admin

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

export function addToBuffer(msg, isAdminMsg, botResponse = null) {
  messageBuffer.push({
    text: msg.text || '',
    botResponse,
    isAdmin: isAdminMsg,
    timestamp: Date.now(),
  });

  if (!isAdminMsg && botResponse) {
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
You are a learning AI student for an Amharic Telegram lottery group.
Analyze this batch of ${batch.length} messages from your teacher (admin) and users.

ADMIN messages (your teacher) (${adminMessages.length}):
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
You are a deep learning AI student for an Amharic lottery Telegram group.
End of day — review everything you learned today and consolidate.

Mini summaries today (${summariesToProcess.length} batches):
${summariesToProcess.map((s, i) => `Batch ${i+1}: ${s.summary} (${s.messageCount} msgs)`).join('\n')}

Board edits studied today (${edits.length}):
${edits.slice(0, 20).map(e =>
  `- "${e.before_text?.slice(0, 30)}" → "${e.after_text?.slice(0, 30)}"`
).join('\n') || 'None'}

Deletions studied today (${deletions.length}):
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
Amharic lottery bot response rating — student learning from feedback:

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

// ─────────────────────────────────────────
// 📷 ANALYZE PHOTO
// ─────────────────────────────────────────
export async function analyzePhoto(base64Image, caption = '', username = '', context = '') {
  const knowledge = await readKnowledge();

  try {
    const key = getNextDeepSeekKey();
    const client = new OpenAI({
      apiKey: key,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });

    const completion = await client.chat.completions.create({
      model: 'deepseek-ai/deepseek-v4-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: `
You are an AI student analyzing a photo sent in an Amharic Telegram lottery group.

Caption: "${caption || '(none)'}"
Sent by: @${username}
Context: ${context}

What you learned about this group:
- Rules: ${knowledge.rules?.slice(0, 10).join(', ') || 'learning...'}
- Admin phrases: ${knowledge.adminStyle?.responses?.slice(0, 5).join(', ') || 'learning...'}

Look at the photo carefully. DO NOT assume — analyze what you actually see.

Return ONLY valid JSON:
{
  "photoType": "what type of photo this is (describe naturally)",
  "extractedText": "any text visible in the photo",
  "meaning": "what this photo means in context of this group",
  "suggestedAction": "what the bot should do based on this photo",
  "keyDetails": {
    "amount": null,
    "name": null,
    "number": null,
    "bank": null,
    "other": null
  },
  "confidence": 0.8,
  "shouldLearn": true,
  "ruleToLearn": "any rule to remember from this photo, or null"
}`,
            },
          ],
        },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    });

    await trackTokens(
      'nvidia-deepseek',
      completion.usage?.prompt_tokens || 0,
      completion.usage?.completion_tokens || 0
    );

    const raw = completion.choices[0]?.message?.content || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (parsed.shouldLearn && parsed.ruleToLearn) {
      await updateKnowledge({ rules: [parsed.ruleToLearn] });
    }

    if (parsed.meaning) {
      setImmediate(() => {
        deepSeekBackgroundLearn(
          `[PHOTO] ${caption || parsed.photoType}`,
          parsed.meaning,
          `Photo from @${username}: ${parsed.extractedText?.slice(0, 100) || ''}`
        ).catch(() => {});
      });
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `📷 Photo analyzed — ${parsed.photoType?.slice(0, 50)} (${Math.round((parsed.confidence || 0) * 100)}%)`
    });

    return parsed;

  } catch (err) {
    console.error('[PHOTO] Vision error:', err.message);

    if (caption) {
      const fallback = await callDeepSeek(`
You are an AI student in an Amharic lottery Telegram group.
A photo was sent with caption: "${caption}" by @${username}
What does this mean? What should the bot do?
Return ONLY valid JSON:
{
  "photoType": "unknown - caption only",
  "extractedText": "${caption}",
  "meaning": "inferred from caption",
  "suggestedAction": "respond_only",
  "keyDetails": { "amount": null, "name": null, "number": null, "bank": null, "other": null },
  "confidence": 0.4,
  "shouldLearn": false,
  "ruleToLearn": null
}`);

      try {
        const clean = fallback.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
      } catch {
        return null;
      }
    }

    return null;
  }
}

// ─────────────────────────────────────────
// PRIVATE CHAT CONTEXT — Smart History
// Last 20 messages + summary of older ones
// ─────────────────────────────────────────
const privateChatHistories = new Map();
const MAX_RECENT = 20;

function getPrivateHistory(userId) {
  if (!privateChatHistories.has(userId)) {
    privateChatHistories.set(userId, { messages: [], summary: '' });
  }
  return privateChatHistories.get(userId);
}

async function addToPrivateHistory(userId, role, content) {
  const history = getPrivateHistory(userId);
  history.messages.push({ role, content, time: Date.now() });

  if (history.messages.length > MAX_RECENT) {
    const oldMessages = history.messages.splice(0, history.messages.length - MAX_RECENT);
    const oldText = oldMessages.map(m => `${m.role}: "${m.content}"`).join('\n');
    try {
      const summaryPrompt = `Summarize this conversation briefly in Amharic (max 3 sentences):\n${oldText}\nReturn ONLY the summary text, no JSON.`;
      const newSummary = await callDeepSeek(summaryPrompt);
      history.summary = (history.summary ? history.summary + ' | ' : '') + newSummary.trim();
    } catch {
      history.summary = `${oldMessages.length} messages discussed earlier`;
    }
  }
}

// ─────────────────────────────────────────
// PRIVATE CHAT TEACHING MODE
// ─────────────────────────────────────────
export async function handlePrivateTeaching(userId, userMessage) {
  const knowledge = await readKnowledge();
  const history = getPrivateHistory(userId);
  const confidencePct = Math.round((knowledge.confidence || 0) * 100);

  const historyMessages = history.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const systemPrompt = `You are an AI student learning to become the admin of an Amharic Telegram lottery group.

YOUR MINDSET:
- You are a humble student — your teacher (admin) is talking to you privately
- Listen carefully, ask smart questions, learn everything
- Remember everything from this conversation
- When teacher corrects you — say "ገባኝ ተማርኩ 🙏" and update your understanding
- Be conversational — talk naturally like a student to teacher

WHAT YOU KNOW SO FAR (${confidencePct}%):
- Rules: ${knowledge.rules?.slice(0, 10).map((r, i) => `${i+1}. ${r}`).join(' | ') || 'ገና እየተማርኩ ነው'}
- Admin style: ${knowledge.adminStyle?.responses?.slice(0, 5).join(' | ') || 'ገና እየተማርኩ ነው'}
- Board template: ${knowledge.boardTemplate ? 'አውቃለሁ ✅' : 'ገና አላወቅሁም ❌'}
- Intents: ${knowledge.intents?.length || 0} patterns learned

${history.summary ? `EARLIER IN THIS CONVERSATION:\n${history.summary}` : ''}

BEHAVIOR:
- ሁልጊዜ በአማርኛ ተናገር
- ጥያቄ ስጠይቅ አንድ ብቻ ጠይቅ
- ስህተት ሲነገርህ ወዲያው ተማር እና አረጋግጥ
- የተማርከውን ነገር ሲጠየቅ ግልጽ አድርግ
- አጭር እና ቀጥተኛ ሁን`;

  await addToPrivateHistory(userId, 'user', userMessage);

  try {
    const key = getNextDeepSeekKey();
    const client = new OpenAI({
      apiKey: key,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });

    const completion = await client.chat.completions.create({
      model: 'deepseek-ai/deepseek-v4-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    });

    await trackTokens(
      'nvidia-deepseek',
      completion.usage?.prompt_tokens || 0,
      completion.usage?.completion_tokens || 0
    );

    const botReply = completion.choices[0]?.message?.content || 'ልረዳ አልቻልኩም።';

    await addToPrivateHistory(userId, 'assistant', botReply);

    setImmediate(() => {
      learnFromMessage({ text: userMessage }, true).catch(() => {});
      learnLotteryRules(userMessage).catch(() => {});

      // Q&A pair ሆኖ ቀምጥ — user message + bot reply ሁለቱም
      saveQAPair(userMessage, botReply, 'private_teaching', '', true).catch(() => {});

      // Intent ሆኖ ቀምጥ — group ላይ ይጠቀምበታል
      updateKnowledge({
        intents: [{
          pattern: userMessage,
          meaning: 'admin taught this privately',
          response: botReply,
          betterResponse: botReply,
        }],
        adminStyle: {
          responses: [botReply],
        }
      }).catch(() => {});
    });

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `💬 Private teaching — "${userMessage.slice(0, 40)}"`
    });

    return botReply;

  } catch (err) {
    console.error('[PRIVATE CHAT] Error:', err.message);
    return 'ይቅርታ፣ ልረዳ አልቻልኩም። እባክህ ደግም ሞክር።';
  }
}

export function clearPrivateHistory(userId) {
  privateChatHistories.delete(userId);
  }
