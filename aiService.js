import OpenAI from 'openai';
import { EventEmitter } from 'events';
import {
  getResponseDeepSeekKey,
  rotateResponseDeepSeekKey,
  getLearningDeepSeekKey,
  rotateLearningDeepSeekKey,
} from './keys.js';
import {
  readKnowledge, updateKnowledge, getHistory,
  getLotteryList, getTokenUsage, addTokenUsage,
  saveActionLog, updateActionConfidence, getActionLogs,
  saveQAPair, updateQAConfidence, findSimilarQA, getBestQAPairs,
  saveBoardEdit, getUnlearnedEdits, markEditLearned,
  getBoardEdits, getDeletedMessages, query,
} from './database.js';

// ─────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────
export const learningEvents = new EventEmitter();

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
// RESPONSE CALLER — ፈጣን (user facing)
// ─────────────────────────────────────────
async function callDeepSeekResponse(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const key = getResponseDeepSeekKey();
      const client = new OpenAI({
        apiKey: key,
        baseURL: 'https://integrate.api.nvidia.com/v1',
      });
      const completion = await client.chat.completions.create({
        model: 'deepseek-ai/deepseek-v4-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
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
        rotateResponseDeepSeekKey();
        await new Promise(res => setTimeout(res, 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('All response keys exhausted');
}

// ─────────────────────────────────────────
// LEARNING CALLER — background
// ─────────────────────────────────────────
async function callDeepSeekLearn(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const key = getLearningDeepSeekKey();
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
        rotateLearningDeepSeekKey();
        await new Promise(res => setTimeout(res, 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('All learning keys exhausted');
}

// ─────────────────────────────────────────
// EXPORT — boardLearning.js ይጠቀምበታል
// ─────────────────────────────────────────
export async function callDeepSeekAPI(systemPrompt, userPrompt, apiKey, options = {}) {
  const prompt = systemPrompt + '\n\n' + userPrompt;
  const raw = await callDeepSeekLearn(prompt, options.retries || 3);
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
}

export async function callMultipleAPIsInParallel() {
  return null;
}

// ─────────────────────────────────────────
// STARTUP TEST
// ─────────────────────────────────────────
export async function testNvidiaConnection() {
  try {
    const key = getResponseDeepSeekKey();
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
    learningEvents.emit('activity', { type: 'learn', msg: '✅ NVIDIA NIM Online!' });
    return true;
  } catch (err) {
    console.error('❌ NVIDIA NIM connection failed:', err.message);
    learningEvents.emit('activity', { type: 'error', msg: `❌ NVIDIA failed: ${err.message}` });
    return false;
  }
}

// ─────────────────────────────────────────
// INTENT CACHE — DB ውስጥ (restart ቢሆን አይጠፋም)
// ─────────────────────────────────────────
async function getIntentCache(intent, number = null) {
  try {
    const key = number ? `${intent}_${number}` : intent;
    const res = await query(`
      SELECT response, confidence FROM qa_pairs
      WHERE intent = $1 AND confidence >= 0.7
      ORDER BY is_admin_verified DESC, confidence DESC, times_correct DESC
      LIMIT 1
    `, [key]);
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

async function saveIntentCache(intent, number = null, response, confidence = 0.8) {
  try {
    const key = number ? `${intent}_${number}` : intent;
    await saveQAPair(`__intent__${key}`, response, 'intent_cache', key, false);
  } catch {}
}

async function clearBadIntentCache(intent) {
  try {
    await query(`
      UPDATE qa_pairs SET confidence = 0.3
      WHERE intent = $1 AND is_admin_verified = FALSE
    `, [intent]);
  } catch {}
}

// ─────────────────────────────────────────
// USER STYLE TRACKER — users ምን style እንዳላቸው
// ─────────────────────────────────────────
async function saveUserStyle(userId, username, messageText, intent) {
  try {
    await query(`
      INSERT INTO user_styles (user_id, username, sample_message, intent, seen_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET username = $2,
            sample_message = $3,
            intent = $4,
            message_count = user_styles.message_count + 1,
            seen_at = NOW()
    `, [userId, username, messageText?.slice(0, 200), intent]);
  } catch {}
}

async function getUserStyles(limit = 30) {
  try {
    const res = await query(`
      SELECT user_id, username, sample_message, intent, message_count
      FROM user_styles
      ORDER BY message_count DESC
      LIMIT $1
    `, [limit]);
    return res.rows;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────
// GROUP CONTEXT — group ምን እንደሆነ ይማራል
// ─────────────────────────────────────────
async function getGroupContext() {
  try {
    const res = await query(`
      SELECT value FROM knowledge WHERE key = 'group_context'
    `);
    return res.rows[0]?.value || null;
  } catch {
    return null;
  }
}

async function saveGroupContext(context) {
  try {
    await query(`
      INSERT INTO knowledge (key, value)
      VALUES ('group_context', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [JSON.stringify(context)]);
  } catch {}
}

// ─────────────────────────────────────────
// UNIFIED CONTEXT BUILDER — ሁለቱም ፋይሎች ይጠቀሙበታል
// ─────────────────────────────────────────
export async function buildUnifiedContext(currentBoardText = '') {
  const [
    knowledge,
    bestPairs,
    actionLogs,
    edits,
    userStyles,
    groupContext,
    recentHistory,
  ] = await Promise.all([
    readKnowledge(),
    getBestQAPairs(20),
    getActionLogs(0.6),
    getBoardEdits(10),
    getUserStyles(20),
    getGroupContext(),
    getHistory(2),
  ]);

  return {
    knowledge,
    bestPairs,
    actionLogs,
    edits,
    userStyles,
    groupContext,
    recentHistory,
    currentBoardText,
    timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────
// LEARN FROM EDIT
// ─────────────────────────────────────────
export async function learnFromEdit(messageId, beforeText, afterText) {
  const context = await buildUnifiedContext();

  const prompt = `
አንተ Telegram lottery bot AI ነህ። ሁሉንም ከ admin ትምራለህ።

Group context: ${JSON.stringify(context.groupContext || {})}
User styles seen: ${context.userStyles?.length || 0} users

Admin ይህን message አስተካከለ።

Before:
"""
${beforeText || '(empty)'}
"""

After:
"""
${afterText || '(empty)'}
"""

ምን ተቀየረ? ለምን? ቀጣይ ጊዜ bot ምን ማድረግ አለበት?

Return ONLY valid JSON:
{
  "changeType": "added_name | removed_name | status_changed | payment_confirmed | reposted | other",
  "whatChanged": "brief description in Amharic",
  "rule": "rule bot should follow next time",
  "botAction": "what bot should do automatically next time",
  "confidence": 0.9,
  "shouldLearn": true
}`;

  try {
    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

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
አንተ Telegram lottery bot AI ነህ። ሁሉንም ከ admin ትምራለህ።

Admin ይህን message ሰረዘ።

Deleted:
"""
${deletedText || '(unknown)'}
"""

Context: ${context}

ለምን ሰረዘ? ቀጣይ ጊዜ bot ምን ማድረግ አለበት?

Return ONLY valid JSON:
{
  "reason": "why admin deleted this",
  "rule": "rule bot should follow",
  "botAction": "what bot should do next time",
  "confidence": 0.8,
  "shouldLearn": true
}`;

  try {
    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

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
አንተ Telegram lottery bot AI ነህ። Admin አስተምሮሃል።

Admin message: "${adminMessage}"
Context: "${context}"

Return ONLY valid JSON:
{
  "correctionType": "wrong_response | wrong_action | style_issue | rule_update | other",
  "whatWasWrong": "brief description in Amharic",
  "newRule": "the rule to learn",
  "avoidInFuture": "what to avoid",
  "confidence": 0.95,
  "shouldLearn": true
}`;

  try {
    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

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
      msg: `👨‍🏫 Admin ማስተማሪያ — "${parsed.whatWasWrong?.slice(0, 50)}"`
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
  const context = await buildUnifiedContext(currentBoardText);

  const prompt = `
አንተ Telegram lottery bot AI ነህ። ሁሉንም ከ admin ተምረሃል።

Group context: ${JSON.stringify(context.groupContext || 'still learning')}

Admin rules learned:
${context.knowledge.rules?.slice(0, 15).map((r, i) => `${i+1}. ${r}`).join('\n') || 'None yet'}

Private rules:
${JSON.stringify(context.knowledge.privateRules || [])}

Current board:
"""
${currentBoardText || '(no board yet)'}
"""

Admin command: "${adminMessage}"

Return ONLY valid JSON:
{
  "action": "send_board | update_slot | delete_board | announce | respond | other",
  "slotNumber": null,
  "newName": null,
  "newStatus": null,
  "boardText": "full board text if action is send_board, else null",
  "responseText": "Amharic response",
  "reason": "what admin asked for",
  "confidence": 0.95
}`;

  try {
    const response = await callDeepSeekResponse(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

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
// LEARN FROM MESSAGE
// ─────────────────────────────────────────
export async function learnFromMessage(message, isAdminMsg = false) {
  const knowledge = await readKnowledge();

  const prompt = `
አንተ Telegram lottery bot AI ነህ። ሁሉንም ከ admin ትምራለህ።
${isAdminMsg ? 'ይህ ከ ADMIN (teacher) ነው — በጥንቃቄ ተማር!' : 'ይህ ከ user ነው — ምን እንደሚፈልግ ተማር።'}

Current knowledge:
- Rules: ${knowledge.rules?.length || 0}
- Intents: ${knowledge.intents?.length || 0}

Message from ${isAdminMsg ? 'ADMIN' : 'USER'}: "${message.text}"

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
    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());
    if (parsed.shouldUpdate) {
      await updateKnowledge(parsed);
    }
    learningEvents.emit('activity', {
      type: 'learn',
      msg: `📩 Message ተማረ — ${isAdminMsg ? 'ADMIN' : 'USER'}: "${message.text?.slice(0, 40)}"`
    });
    return parsed;
  } catch (err) {
    console.error('[MSG] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// LEARN LOTTERY RULES
// ─────────────────────────────────────────
export async function learnLotteryRules(adminMessage) {
  const prompt = `
Extract lottery/group rules from this admin message: "${adminMessage}"

Return ONLY valid JSON:
{
  "rules": [],
  "registrationInfo": "",
  "numberRange": {"min": 1, "max": 100},
  "eligibility": "",
  "isRule": false
}`;

  try {
    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());
    if (parsed.isRule && parsed.rules.length > 0) {
      await updateKnowledge({ rules: parsed.rules });
      learningEvents.emit('activity', {
        type: 'rule',
        msg: `ህግ ተወሰደ: "${parsed.rules[0]?.slice(0, 50)}"`
      });
    }
    return parsed;
  } catch (err) {
    console.error('[RULE] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// BACKGROUND LEARNER
// ─────────────────────────────────────────
async function backgroundLearn(userMessage, botResponse, context = '') {
  const knowledge = await readKnowledge();
  const bestPairs = await getBestQAPairs(15);

  const prompt = `
አንተ Telegram lottery bot AI ነህ። background ውስጥ ትማራለህ።

Admin style:
- Phrases: ${JSON.stringify(knowledge.adminStyle?.responses?.slice(0, 10))}
- Tone: ${knowledge.writingStyle?.tone || 'friendly but firm'}
- Rules: ${JSON.stringify(knowledge.rules?.slice(0, 10))}

Best Q&A pairs:
${bestPairs.slice(0, 10).map(p => `Q: "${p.user_message}" → A: "${p.admin_reply}"`).join('\n')}

Context: ${context}
User: "${userMessage}"
Bot responded: "${botResponse}"

ይህ response ጥሩ ነበር? ማሻሻያ አለ?

Return ONLY valid JSON:
{
  "wasGood": true,
  "ruleToAdd": "rule or null",
  "intentToUpdate": {
    "pattern": "${userMessage}",
    "meaning": "what user wanted",
    "betterResponse": "improved response or null"
  },
  "styleNote": "note or null"
}`;

  try {
    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

    const updates = {};
    if (parsed.ruleToAdd) updates.rules = [parsed.ruleToAdd];
    if (parsed.intentToUpdate?.betterResponse) updates.intents = [parsed.intentToUpdate];
    if (Object.keys(updates).length > 0) await updateKnowledge(updates);

    // ስህተት ከሆነ — intent cache ያፀዳ
    if (!parsed.wasGood) {
      const intentMatch = context.match(/Intent: (\w+)/);
      if (intentMatch) {
        await clearBadIntentCache(intentMatch[1]);
        learningEvents.emit('activity', {
          type: 'learn',
          msg: `🧹 Bad cache cleared — intent: ${intentMatch[1]}`
        });
      }
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🧠 Background learn — "${userMessage.slice(0, 30)}" wasGood: ${parsed.wasGood}`
    });

    return parsed;
  } catch (err) {
    console.error('[BACKGROUND] Learn error:', err.message);
    return null;
  }
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
        learnAction('admin_command', text.slice(0, 50), result.reason || '', { result }).catch(() => {});
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

    case 'user_about_bot':
    case 'user_message':
    default: {
      return await generateResponse(text, userId, username, currentBoardText);
    }
  }
}

// ─────────────────────────────────────────
// GENERATE RESPONSE — intent cache ጋር
// ─────────────────────────────────────────
export async function generateResponse(userMessage, userId, username, currentBoardText = '') {

  // ── Step 1: Exact cache check ──
  const similarPairs = await findSimilarQA(userMessage, 3);
  const exactMatch = similarPairs.find(p =>
    p.user_message === userMessage && p.confidence >= 0.7
  );

  if (exactMatch) {
    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🎯 Exact cache hit — ${Math.round(exactMatch.confidence * 100)}%`
    });
    // user style ያስቀምጣል
    setImmediate(() => saveUserStyle(userId, username, userMessage, exactMatch.intent).catch(() => {}));
    return {
      response: exactMatch.admin_reply,
      confidence: exactMatch.confidence,
      fromCache: true,
    };
  }

  // ── Step 2: Intent detection — ትንሽ prompt ──
  const knowledge = await readKnowledge();
  const groupContext = await getGroupContext();

  const intentPrompt = `
Group type: ${groupContext?.groupType || 'unknown — still learning'}
Admin rules: ${knowledge.rules?.slice(0, 5).map((r, i) => `${i+1}. ${r}`).join('\n') || 'None'}
Current board: ${currentBoardText?.slice(0, 200) || 'No board'}

User @${username}: "${userMessage}"

ይህ user ምን ፈልጓል? Intent ወስን።

Return ONLY valid JSON:
{
  "intent": "register | payment | cancel | greeting | question | check_slot | other",
  "number": null,
  "confidence": 0.9
}`;

  let intent = 'other';
  let number = null;

  try {
    const intentRaw = await callDeepSeekResponse(intentPrompt);
    const intentParsed = JSON.parse(intentRaw.replace(/```json|```/g, '').trim());
    intent = intentParsed.intent || 'other';
    number = intentParsed.number || null;
  } catch {}

  // ── Step 3: Intent cache check ──
  const intentCached = await getIntentCache(intent, number);
  if (intentCached && intentCached.confidence >= 0.75) {
    learningEvents.emit('activity', {
      type: 'learn',
      msg: `⚡ Intent cache hit — ${intent} (${Math.round(intentCached.confidence * 100)}%)`
    });
    setImmediate(() => saveUserStyle(userId, username, userMessage, intent).catch(() => {}));
    return {
      response: intentCached.response,
      intent,
      confidence: intentCached.confidence,
      fromCache: true,
    };
  }

  // ── Step 4: Full response — ሳይማር "እየተማርኩ ነው" ──
  const confidencePct = Math.round((knowledge.confidence || 0) * 100);
  const isLearning = confidencePct < 20;

  if (isLearning) {
    const learningMsg = `ቦቱ እየተማረ ነው ⏳ (${confidencePct}%) — Admin እስኪያስተምር ትንሽ 辛抱ください。`;
    learningEvents.emit('activity', { type: 'eval', msg: `📚 Still learning — ${confidencePct}%` });
    return {
      response: learningMsg,
      intent,
      confidence: 0.1,
      fromCache: false,
      stillLearning: true,
    };
  }

  const context = await buildUnifiedContext(currentBoardText);

  const fullPrompt = `
አንተ Telegram bot ነህ። ሁሉንም ከ admin ተምረሃል።

Group type: ${context.groupContext?.groupType || 'learning...'}
Group rules: ${context.groupContext?.rules?.join(', ') || 'learning...'}

Admin style: ${context.knowledge.adminStyle?.responses?.slice(0, 5).join(' | ') || 'learning...'}
Top rules: ${context.knowledge.rules?.slice(0, 10).map((r, i) => `${i+1}. ${r}`).join('\n') || 'None'}
Private rules: ${JSON.stringify(context.knowledge.privateRules || [])}

Board patterns from admin:
${context.edits?.slice(0, 5).map(e => `"${e.before_text?.slice(0, 30)}" → "${e.after_text?.slice(0, 30)}"`).join('\n') || 'None'}

Current board:
${currentBoardText || 'No board yet'}

User styles seen:
${context.userStyles?.slice(0, 10).map(u => `@${u.username}: usually "${u.intent}"`).join('\n') || 'None'}

User @${username}: "${userMessage}"
Detected intent: ${intent} ${number ? `(number: ${number})` : ''}

Admin ቢሆን ምን ይላል? ምን ያደርጋል?

Return ONLY valid JSON:
{
  "action": "respond_only | register_slot | edit_board | send_board",
  "response": "Amharic response exactly like admin",
  "boardEdit": null,
  "confidence": 0.9
}`;

  const raw = await callDeepSeekResponse(fullPrompt);

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    parsed = { action: 'respond_only', response: raw, confidence: 0.7 };
  }

  // intent cache ያስቀምጣል
  if (parsed.confidence >= 0.75) {
    setImmediate(() => saveIntentCache(intent, number, parsed.response, parsed.confidence).catch(() => {}));
  }

  // user style ያስቀምጣል
  setImmediate(() => saveUserStyle(userId, username, userMessage, intent).catch(() => {}));

  // background learning
  setImmediate(async () => {
    try {
      await backgroundLearn(userMessage, parsed.response, `User: ${username}, Intent: ${intent}`);
      await saveQAPair(userMessage, parsed.response, 'auto_cached', intent, false);
    } catch (err) {
      console.error('[BACKGROUND] Error:', err.message);
    }
  });

  return {
    response: parsed.response,
    intent,
    action: parsed.action,
    boardEdit: parsed.boardEdit,
    confidence: parsed.confidence || 0.9,
    fromCache: false,
  };
}

// ─────────────────────────────────────────
// ACTION LEARNING
// ─────────────────────────────────────────
export async function learnAction(actionType, trigger, reason, details = {}) {
  try {
    await saveActionLog(actionType, trigger, reason, details, true);

    const prompt = `
Admin action in Telegram lottery group:
Action: "${actionType}"
Trigger: "${trigger}"
Reason: "${reason}"

Return ONLY valid JSON:
{
  "pattern": "when this happens",
  "action": "do this",
  "rule": "rule to remember",
  "confidence": 0.9
}`;

    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

    if (parsed.rule) await updateKnowledge({ rules: [parsed.rule] });
    await updateActionConfidence(actionType, trigger, true).catch(() => {});

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `⚡ Action ተማረ: ${actionType}`
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
Q&A pair from Telegram lottery group:
User: "${userMessage}"
Admin: "${adminReply}"

Return ONLY valid JSON:
{
  "intent": "what user wanted",
  "rule": "rule to remember or null"
}`;

    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

    if (parsed.intent) {
      await updateKnowledge({
        intents: [{ pattern: userMessage, meaning: parsed.intent, response: adminReply, betterResponse: adminReply }]
      });
    }
    if (parsed.rule) await updateKnowledge({ rules: [parsed.rule] });

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `💬 Q&A ተማረ — "${userMessage.slice(0, 30)}"`
    });

    return parsed;
  } catch (err) {
    console.error('[QA] Learn error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// HANDLE REGISTRATION
// ─────────────────────────────────────────
export async function handleRegistration(userId, username, requestedNumber) {
  const [lotteryList, context] = await Promise.all([
    getLotteryList(),
    buildUnifiedContext(),
  ]);

  const numberTaken = lotteryList.find(m => m.number === requestedNumber);
  const alreadyRegistered = lotteryList.find(m => m.user_id === userId);
  const validRange = requestedNumber >= 1 && requestedNumber <= 100;

  let situation = '';
  if (!validRange) situation = `Invalid number ${requestedNumber}`;
  else if (alreadyRegistered) situation = `Already registered with number ${alreadyRegistered.number}`;
  else if (numberTaken) situation = `Number ${requestedNumber} taken by ${numberTaken.username}`;
  else situation = `Number ${requestedNumber} available for ${username}`;

  const prompt = `
አንተ Telegram lottery bot ነህ። ሁሉንም ከ admin ተምረሃል።

Group type: ${context.groupContext?.groupType || 'lottery group'}
Admin style: ${context.knowledge.adminStyle?.responses?.slice(0, 3).join(' | ') || ''}
Rules: ${context.knowledge.rules?.slice(0, 5).join(', ') || ''}

Situation: ${situation}
@${username} ቁጥር ${requestedNumber} ፈልጓል።

Admin ቢሆን ምን ይላል? በአማርኛ ምላሽ ስጥ።`;

  const response = await callDeepSeekResponse(prompt);

  setImmediate(() => backgroundLearn(
    `ምዝገባ ቁጥር ${requestedNumber}`, response, situation
  ).catch(() => {}));

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
  const context = await buildUnifiedContext();
  const prompt = `
አንተ Telegram bot ነህ። Admin style ተምረሃል።
Group: ${context.groupContext?.groupType || 'lottery group'}
Admin phrases: ${context.knowledge.adminStyle?.responses?.slice(0, 5).join(' | ') || ''}

Announcement about: ${topic}. ${details}
Admin style ጋር ተመሳሳይ ሆኖ በአማርኛ ጻፍ — emojis ጨምር።`;

  const response = await callDeepSeekResponse(prompt);
  setImmediate(() => backgroundLearn(`announcement: ${topic}`, response, 'announcement').catch(() => {}));
  return response;
}

// ─────────────────────────────────────────
// GENERATE LEARNING SUMMARY
// ─────────────────────────────────────────
export async function generateLearningSummary() {
  const [knowledge, bestPairs, edits] = await Promise.all([
    readKnowledge(),
    getBestQAPairs(10),
    getBoardEdits(20),
  ]);

  const rulesCount = knowledge.rules?.length || 0;
  const intentsCount = knowledge.intents?.length || 0;

  const prompt = `
Learning progress summary for Telegram lottery bot AI student.

Data:
- Rules: ${rulesCount}
- Intents: ${intentsCount}
- Q&A pairs: ${bestPairs.length}
- Board edits: ${edits.length}

Confidence scale:
- 0-20%: 0-5 rules
- 21-40%: 6-15 rules
- 41-60%: 16-30 rules
- 61-80%: 31-50 rules
- 81-95%: 50+ rules
- 96-100%: fully ready

Return ONLY valid JSON:
{
  "summary": "brief in Amharic and English",
  "weakAreas": [],
  "confidence": 0.0,
  "readyToReplace": false
}`;

  try {
    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

    let rawConf = parsed.confidence || 0;
    if (rawConf > 1) rawConf = rawConf / 100;
    const finalConf = rawConf > 0 ? rawConf : (
      rulesCount > 50 ? 0.85 :
      rulesCount > 30 ? 0.70 :
      rulesCount > 15 ? 0.55 :
      rulesCount > 5  ? 0.35 : 0.15
    );

    await updateKnowledge({ confidence: finalConf, readyToReplace: parsed.readyToReplace || false });
    parsed.confidence = finalConf;

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `📊 Summary — ${Math.round(finalConf * 100)}%`
    });
    return parsed;
  } catch (err) {
    console.error('[SUMMARY] Error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// BATCH LEARNING SYSTEM — 50 messages
// ─────────────────────────────────────────
const messageBuffer = [];
const BATCH_SIZE = 50;
const BATCH_INTERVAL_MS = 10 * 60 * 1000;
let batchTimer = null;
export const miniSummaries = [];
export const dailyExchanges = [];

export function addToBuffer(msg, isAdminMsg, botResponse = null) {
  messageBuffer.push({
    text: msg.text || '',
    username: msg.from?.username || '',
    userId: msg.from?.id || null,
    botResponse,
    isAdmin: isAdminMsg,
    timestamp: Date.now(),
  });

  if (!isAdminMsg && botResponse) {
    dailyExchanges.push({
      user: msg.text || '',
      username: msg.from?.username || '',
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

export async function processBatch() {
  if (messageBuffer.length === 0) return;

  const batch = [...messageBuffer];
  messageBuffer.length = 0;
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }

  learningEvents.emit('activity', {
    type: 'learn',
    msg: `📦 Batch processing ${batch.length} messages...`
  });

  // boardLearning.js ጋር shared context
  const context = await buildUnifiedContext();

  const adminMessages = batch.filter(m => m.isAdmin).map(m => m.text);
  const userExchanges = batch
    .filter(m => !m.isAdmin && m.botResponse)
    .map((m, i) => `${i+1}. @${m.username}: "${m.text}" → Bot: "${m.botResponse}"`);

  const userStyles = batch
    .filter(m => !m.isAdmin)
    .reduce((acc, m) => {
      if (m.username) {
        if (!acc[m.username]) acc[m.username] = [];
        acc[m.username].push(m.text);
      }
      return acc;
    }, {});

  const prompt = `
አንተ Telegram lottery bot AI ነህ። ሁሉንም ከ admin ትምራለህ።

Current group understanding:
${JSON.stringify(context.groupContext || 'not yet determined')}

ADMIN messages (${adminMessages.length}):
${adminMessages.map((m, i) => `${i+1}. "${m}"`).join('\n') || 'None'}

USER + BOT exchanges (${userExchanges.length}):
${userExchanges.join('\n') || 'None'}

User styles observed:
${Object.entries(userStyles).map(([u, msgs]) => `@${u}: ${msgs.slice(0,3).map(m => `"${m}"`).join(', ')}`).join('\n') || 'None'}

Board edits from admin:
${context.edits?.slice(0, 5).map(e => `"${e.before_text?.slice(0, 40)}" → "${e.after_text?.slice(0, 40)}"`).join('\n') || 'None'}

ትንተና:
1. Bot ምን ስህተት ሰራ? (wasGood: false ያሉትን ፈልግ)
2. Group ምን ዓይነት ነው? ምን pattern አለ?
3. Users ምን ፈለጉ? Admin ምን አደረገ?
4. ምን ተማርን?

Return ONLY valid JSON:
{
  "adminStyle": { "responses": [], "greetings": [], "warnings": [], "tone": "" },
  "rules": [],
  "intents": [{"pattern": "", "meaning": "", "response": ""}],
  "writingStyle": { "amharic": [], "commonPhrases": [], "emojiUsage": "" },
  "groupContext": {
    "groupType": "lottery | betting | savings | other",
    "adminPersonality": "",
    "commonUserRequests": [],
    "rules": []
  },
  "badResponses": ["response texts that were wrong — to clear from cache"],
  "goodResponses": [{"intent": "", "response": ""}],
  "miniSummary": "brief summary in Amharic",
  "shouldUpdate": true
}`;

  try {
    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

    if (parsed.shouldUpdate) {
      await updateKnowledge({
        adminStyle: parsed.adminStyle,
        rules: parsed.rules || [],
        intents: parsed.intents || [],
        writingStyle: parsed.writingStyle,
      });

      // group context ያስቀምጣል
      if (parsed.groupContext?.groupType && parsed.groupContext.groupType !== 'other') {
        await saveGroupContext(parsed.groupContext);
        learningEvents.emit('activity', {
          type: 'learn',
          msg: `🌍 Group understood: ${parsed.groupContext.groupType}`
        });
      }

      // ስህተት responses — cache ያፀዳ
      if (parsed.badResponses?.length > 0) {
        for (const bad of parsed.badResponses) {
          await query(`
            UPDATE qa_pairs SET confidence = 0.2
            WHERE admin_reply = $1 AND is_admin_verified = FALSE
          `, [bad]).catch(() => {});
        }
        learningEvents.emit('activity', {
          type: 'learn',
          msg: `🧹 Cleared ${parsed.badResponses.length} bad cache entries`
        });
      }

      // ጥሩ responses — intent cache ያጠናክር
      if (parsed.goodResponses?.length > 0) {
        for (const good of parsed.goodResponses) {
          await saveIntentCache(good.intent, null, good.response, 0.85);
        }
      }
    }

    if (parsed.miniSummary) {
      miniSummaries.push({
        time: new Date().toISOString(),
        summary: parsed.miniSummary,
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
// 🌙 UNIFIED DEEP LEARNING — ai + board አንድ ላይ
// ─────────────────────────────────────────
export async function unifiedDeepLearning(boardMiniSummaries = [], boardExchanges = []) {
  learningEvents.emit('activity', {
    type: 'learn',
    msg: '🌙 Unified Deep Learning እየጀመረ...'
  });

  // ሁሉንም DB ከ አንድ ቦታ ያነባል
  const [knowledge, bestPairs, edits, deletions, userStyles, groupContext] = await Promise.all([
    readKnowledge(),
    getBestQAPairs(20),
    getBoardEdits(50),
    getDeletedMessages(20),
    getUserStyles(30),
    getGroupContext(),
  ]);

  const allMiniSummaries = [...miniSummaries, ...boardMiniSummaries];
  const allExchanges = [...dailyExchanges, ...boardExchanges];

  // buffer ያፀዳ
  miniSummaries.length = 0;
  dailyExchanges.length = 0;

  const prompt = `
አንተ Telegram bot AI ነህ። ዛሬ ሙሉ ቀን ምን ሆነ? ሁሉንም ገምግም።

Group type so far: ${groupContext?.groupType || 'still learning'}
Group rules: ${groupContext?.rules?.join(', ') || 'learning...'}

Mini summaries today (${allMiniSummaries.length} batches):
${allMiniSummaries.map((s, i) => `Batch ${i+1}: ${s.summary} (${s.messageCount} msgs)`).join('\n') || 'None'}

Board edits today (${edits.length}):
${edits.slice(0, 20).map(e => `"${e.before_text?.slice(0, 40)}" → "${e.after_text?.slice(0, 40)}"`).join('\n') || 'None'}

Deleted messages (${deletions.length}):
${deletions.slice(0, 10).map(d => `"${d.text?.slice(0, 50)}"`).join('\n') || 'None'}

Current knowledge:
- Rules: ${knowledge.rules?.length || 0}
- Admin phrases: ${knowledge.adminStyle?.responses?.length || 0}
- Confidence: ${Math.round((knowledge.confidence || 0) * 100)}%

Today's exchanges (${allExchanges.length}):
${allExchanges.slice(0, 30).map((e, i) => `${i+1}. @${e.username || '?'}: "${e.user}" → Bot: "${e.bot}"`).join('\n') || 'None'}

User styles:
${userStyles.slice(0, 15).map(u => `@${u.username}: "${u.intent}" (${u.message_count} msgs)`).join('\n') || 'None'}

Best Q&A pairs (${bestPairs.length}):
${bestPairs.slice(0, 10).map(p => `"${p.user_message}" → "${p.admin_reply}" (${Math.round(p.confidence * 100)}%)`).join('\n') || 'None'}

ሁሉንም ገምግም:
1. Group ምን ዓይነት ነው? ምን ተረዳህ?
2. Admin ምን style አለው?
3. Users ምን ፈለጉ?
4. Bot ምን ስህተት ሰራ?
5. ምን ማሻሻል አለብን?

Return ONLY valid JSON:
{
  "consolidatedRules": [],
  "strengthenedIntents": [{"pattern": "", "meaning": "", "betterResponse": "", "confidence": 0.9}],
  "groupContext": {
    "groupType": "lottery | betting | savings | other",
    "adminPersonality": "description",
    "typicalFlow": "how the group works",
    "commonUserRequests": [],
    "peakHours": [],
    "rules": []
  },
  "userPatterns": [{"username": "", "typicalIntent": "", "style": ""}],
  "badCacheToRemove": ["bad responses to clear"],
  "gaps": [],
  "newConfidence": 0.0,
  "readyToReplace": false,
  "dailySummary": "ዛሬ ምን ተማርኩ — Amharic"
}`;

  try {
    const response = await callDeepSeekLearn(prompt);
    const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());

    // knowledge ያዘምናል
    await updateKnowledge({
      rules: parsed.consolidatedRules || [],
      intents: parsed.strengthenedIntents || [],
      confidence: parsed.newConfidence || knowledge.confidence,
      readyToReplace: parsed.readyToReplace || false,
      dailySummary: parsed.dailySummary,
      gaps: parsed.gaps || [],
      lastDeepLearning: new Date().toISOString(),
    });

    // group context ያዘምናል
    if (parsed.groupContext?.groupType) {
      await saveGroupContext(parsed.groupContext);
    }

    // ስህተት cache ያፀዳ
    if (parsed.badCacheToRemove?.length > 0) {
      for (const bad of parsed.badCacheToRemove) {
        await query(`
          UPDATE qa_pairs SET confidence = 0.1
          WHERE admin_reply = $1 AND is_admin_verified = FALSE
        `, [bad]).catch(() => {});
      }
      learningEvents.emit('activity', {
        type: 'learn',
        msg: `🧹 Deep clean: ${parsed.badCacheToRemove.length} bad entries removed`
      });
    }

    // user patterns ያስቀምጣል
    if (parsed.userPatterns?.length > 0) {
      for (const up of parsed.userPatterns) {
        if (up.username) {
          await query(`
            UPDATE user_styles SET intent = $1 WHERE username = $2
          `, [up.typicalIntent, up.username]).catch(() => {});
        }
      }
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🌙 Deep Learning ተጠናቀቀ! ${Math.round((parsed.newConfidence || 0) * 100)}% — Group: ${parsed.groupContext?.groupType || '?'}`
    });

    return parsed;
  } catch (err) {
    console.error('[DEEP] Learning error:', err.message);
    return null;
  }
}

// backward compat — ያሮጉ code ሲጠራ
export async function deepNightLearning() {
  return await unifiedDeepLearning();
}

// ─────────────────────────────────────────
// LEARN FROM RATING
// ─────────────────────────────────────────
export async function learnFromRating(userText, botResponse, score) {
  const RATING_LABELS = { 1: '👎 ዝቅተኛ', 2: '😐 መካከለኛ', 3: '👍 አሪፍ', 4: '🔥 በጣም አሪፍ' };
  const isGood = score >= 3;
  const isExcellent = score === 4;
  const isBad = score === 1;

  const updates = {};

  if (isExcellent) {
    updates.intents = [{
      pattern: userText, meaning: 'admin rated excellent 🔥',
      response: botResponse, betterResponse: botResponse, rating: 4, locked: true,
    }];
    updates.adminStyle = { responses: [botResponse] };
    // intent cache ያጠናክር
    await saveIntentCache('excellent_rated', null, botResponse, 0.95);
  }

  if (isBad) {
    // ስህተት cache ወዲያው ያፀዳ
    await query(`
      UPDATE qa_pairs SET confidence = 0.1
      WHERE admin_reply = $1 AND is_admin_verified = FALSE
    `, [botResponse]).catch(() => {});
    updates.rules = [`Avoid: "${botResponse.slice(0, 50)}" when user says "${userText.slice(0, 50)}"`];
    learningEvents.emit('activity', { type: 'learn', msg: `🧹 Bad response cleared immediately` });
  }

  if (Object.keys(updates).length > 0) await updateKnowledge(updates);
  await updateQAConfidence(userText, isGood).catch(() => {});

  learningEvents.emit('activity', {
    type: isGood ? 'learn' : 'eval',
    msg: `⭐ Rating ${score}/4 (${RATING_LABELS[score]}) — "${userText.slice(0, 30)}"`
  });
}

// ─────────────────────────────────────────
// ANALYZE PHOTO
// ─────────────────────────────────────────
export async function analyzePhoto(base64Image, caption = '', username = '', context = '') {
  const knowledge = await readKnowledge();
  const groupContext = await getGroupContext();

  try {
    const key = getResponseDeepSeekKey();
    const client = new OpenAI({
      apiKey: key,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });

    const completion = await client.chat.completions.create({
      model: 'deepseek-ai/deepseek-v4-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: 'text', text: `
አንተ Telegram lottery bot AI ነህ። ሁሉንም ከ admin ተምረሃል።

Group type: ${groupContext?.groupType || 'learning...'}
Caption: "${caption || '(none)'}"
Sent by: @${username}
Context: ${context}
Rules: ${knowledge.rules?.slice(0, 5).join(', ') || 'learning...'}

Photo ምን ያሳያል? Context ውስጥ ምን ማለት ነው?

Return ONLY valid JSON:
{
  "photoType": "what type of photo",
  "extractedText": "any text visible",
  "meaning": "what this means in context",
  "suggestedAction": "what bot should do",
  "keyDetails": { "amount": null, "name": null, "number": null, "bank": null, "other": null },
  "confidence": 0.8,
  "shouldLearn": true,
  "ruleToLearn": "rule or null"
}` }
        ]
      }],
      max_tokens: 2048,
      temperature: 0.3,
    });

    await trackTokens('nvidia-deepseek',
      completion.usage?.prompt_tokens || 0,
      completion.usage?.completion_tokens || 0
    );

    const raw = completion.choices[0]?.message?.content || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    if (parsed.shouldLearn && parsed.ruleToLearn) {
      await updateKnowledge({ rules: [parsed.ruleToLearn] });
    }

    if (parsed.meaning) {
      setImmediate(() => backgroundLearn(
        `[PHOTO] ${caption || parsed.photoType}`,
        parsed.meaning,
        `Photo from @${username}`
      ).catch(() => {}));
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `📷 Photo analyzed — ${parsed.photoType?.slice(0, 40)} (${Math.round((parsed.confidence || 0) * 100)}%)`
    });

    return parsed;
  } catch (err) {
    console.error('[PHOTO] Vision error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// PRIVATE CHAT
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
      const newSummary = await callDeepSeekLearn(
        `Summarize briefly in Amharic (3 sentences max):\n${oldText}\nReturn ONLY summary text.`
      );
      history.summary = (history.summary ? history.summary + ' | ' : '') + newSummary.trim();
    } catch {
      history.summary = `${oldMessages.length} messages discussed earlier`;
    }
  }
}

export async function handlePrivateTeaching(userId, userMessage) {
  const [knowledge, groupContext] = await Promise.all([
    readKnowledge(),
    getGroupContext(),
  ]);
  const history = getPrivateHistory(userId);
  const confidencePct = Math.round((knowledge.confidence || 0) * 100);

  const systemPrompt = `አንተ Telegram bot AI ነህ። Admin private ውስጥ ያስተምርሃል።

Group: ${groupContext?.groupType || 'learning...'}
Confidence: ${confidencePct}%
Rules: ${knowledge.rules?.slice(0, 10).map((r, i) => `${i+1}. ${r}`).join(' | ') || 'ገና እየተማርኩ ነው'}
Board template: ${knowledge.boardTemplate ? '✅ አውቃለሁ' : '❌ ገና አላወቅሁም'}
${history.summary ? `Earlier: ${history.summary}` : ''}

ሁልጊዜ በአማርኛ ተናገር። አጭር ሁን። ስህተት ሲነገርህ ተማር።`;

  await addToPrivateHistory(userId, 'user', userMessage);

  try {
    const key = getResponseDeepSeekKey();
    const client = new OpenAI({ apiKey: key, baseURL: 'https://integrate.api.nvidia.com/v1' });

    const completion = await client.chat.completions.create({
      model: 'deepseek-ai/deepseek-v4-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    });

    await trackTokens('nvidia-deepseek',
      completion.usage?.prompt_tokens || 0,
      completion.usage?.completion_tokens || 0
    );

    const botReply = completion.choices[0]?.message?.content || 'ልረዳ አልቻልኩም።';
    await addToPrivateHistory(userId, 'assistant', botReply);

    setImmediate(() => {
      learnFromMessage({ text: userMessage }, true).catch(() => {});
      learnLotteryRules(userMessage).catch(() => {});
      saveQAPair(userMessage, botReply, 'private_teaching', '', true).catch(() => {});
      updateKnowledge({
        intents: [{ pattern: userMessage, meaning: 'admin taught privately', response: botReply, betterResponse: botReply }],
        adminStyle: { responses: [botReply] }
      }).catch(() => {});
    });

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `💬 Private teaching — "${userMessage.slice(0, 40)}"`
    });

    return botReply;
  } catch (err) {
    console.error('[PRIVATE] Error:', err.message);
    return 'ይቅርታ፣ ልረዳ አልቻልኩም። እባክህ ደግም ሞክር።';
  }
}

export function clearPrivateHistory(userId) {
  privateChatHistories.delete(userId);
}
