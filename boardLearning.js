// boardLearning.js — Unified Learning System
// ai.js (aiService.js) ጋር አንድ brain — አንድ ላይ ይማራሉ

import { query, readKnowledge, updateKnowledge, getBoardMessage } from './database.js';
import {
  learningEvents,
  callDeepSeekAPI,
  callDeepSeekAPIFast,
  buildUnifiedContext,
  miniSummaries,
  dailyExchanges,
  unifiedDeepLearning,
  processBatch,
} from './aiService.js';
import { getLearningDeepSeekKey, rotateResponseDeepSeekKey } from './keys.js';

// ─────────────────────────────────────────
// BOARD MINI SUMMARIES — unifiedDeepLearning ጋር share ይደረጋል
// ─────────────────────────────────────────
const boardMiniSummaries = [];
const boardExchanges = [];

// ─────────────────────────────────────────
// LEARN FROM ADMIN ACTION — ዋናው learning
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// SAFE JSON PARSER
// ─────────────────────────────────────────
function safeParseJSON(raw) {
  if (!raw) return null;
  try {
    const clean = raw
      .replace(/```json|```/g, '')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/\uFEFF/g, '')
      .trim();
    return JSON.parse(clean);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

export async function learnBoardAction(actionType, details) {
  try {
    // aiService.js ጋር shared context — አንድ ላይ ይማራሉ
    const context = await buildUnifiedContext(details.currentBoardText || '');

    const systemPrompt = `
አንተ Telegram lottery bot AI ነህ። ሁሉንም ከ admin ትምራለህ — hard-code rules የሉህም።

Group type: ${context.groupContext?.groupType || 'still learning'}
Group rules: ${context.groupContext?.rules?.join(', ') || 'still learning'}
Admin personality: ${context.groupContext?.adminPersonality || 'still learning'}

Private rules admin አስተምሯቸዋል:
${JSON.stringify(context.knowledge.privateRules || [])}

Board patterns learned:
${JSON.stringify(context.knowledge.boardPatterns?.slice(-15) || [])}

User styles:
${context.userStyles?.slice(0, 10).map(u => `@${u.username}: usually "${u.intent}"`).join('\n') || 'None'}

ምላሽ JSON ብቻ።
`;

    const userPrompt = `
Admin action: ${actionType}
Details: ${JSON.stringify(details)}

ከዚህ action ምን ተማርክ?

Return ONLY valid JSON:
{
  "pattern": "ምን pattern አለ",
  "trigger": "ምን ሲሆን ይህ action ይሆናል",
  "lesson": "bot ቀጣይ ጊዜ ምን ማድረግ አለበት",
  "confidence": 0.0,
  "relatedPatterns": []
}
`;

    const learned = await callDeepSeekAPI(systemPrompt, userPrompt, null, { retries: 3 });
    if (!learned) return;

    const knowledge = await readKnowledge();
    if (!knowledge.boardPatterns) knowledge.boardPatterns = [];

    knowledge.boardPatterns.push({
      actionType,
      pattern: learned.pattern,
      trigger: learned.trigger,
      lesson: learned.lesson,
      confidence: learned.confidence,
      learnedAt: new Date().toISOString(),
    });

    // ከ 50 በላይ አይሄድም
    if (knowledge.boardPatterns.length > 50) {
      knowledge.boardPatterns = knowledge.boardPatterns.slice(-50);
    }

    await updateKnowledge({ boardPatterns: knowledge.boardPatterns });

    await query(`
      INSERT INTO action_logs (action_type, trigger, reason, details, is_admin)
      VALUES ($1, $2, $3, $4, TRUE)
    `, [
      `board_${actionType}`,
      JSON.stringify(details).slice(0, 100),
      learned.lesson || '',
      JSON.stringify(learned),
    ]).catch(() => {});

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `📋 Board learned: ${actionType} — "${learned.pattern?.slice(0, 50) || ''}"`,
    });

    boardMiniSummaries.push({
      time: new Date().toISOString(),
      summary: `${actionType}: ${learned.lesson?.slice(0, 60)}`,
      messageCount: 1,
    });

    rotateResponseDeepSeekKey();
    return learned;

  } catch (err) {
    console.error('[BoardLearning] Learn error:', err.message);
  }
}

// ─────────────────────────────────────────
// PRIVATE TEACHING — Admin private chat
// ─────────────────────────────────────────
export async function handlePrivateBoardTeaching(adminId, text) {
  try {
    const [knowledge, context] = await Promise.all([
      readKnowledge(),
      buildUnifiedContext(),
    ]);

    if (!knowledge.privateRules) knowledge.privateRules = [];

    const systemPrompt = `
አንተ Telegram bot AI ነህ። Admin private chat ውስጥ board rules እያስተምረህ ነው።

Group: ${context.groupContext?.groupType || 'learning...'}
Admin style: ${context.knowledge.adminStyle?.responses?.slice(0, 3).join(' | ') || ''}

Admin:
- አዲስ rule ሊጽፍ ይችላል → ይቀበለዋል
- ያለ rule ሊሰርዝ ይችላል → ይሰርዘዋል
- Rule ሊቀይር ይችላል → ያስተካክለዋል
- ምን rules እንዳለ ሊጠይቅ ይችላል → ዝርዝር ያሳያል

አሁን ያሉ rules:
${JSON.stringify(knowledge.privateRules)}

ምላሽ JSON ብቻ።
`;

    const userPrompt = `
Admin message: "${text}"

Return ONLY valid JSON:
{
  "intent": "add_rule | delete_rule | update_rule | list_rules | other",
  "ruleText": "rule text if add/update",
  "deleteTarget": "what to delete",
  "reply": "Amharic reply to admin",
  "confidence": 0.0
}
`;

    const result = await callDeepSeekAPI(systemPrompt, userPrompt, null, { retries: 2 });
    if (!result) return '❌ ልረዳ አልቻልኩም። እንደገና ሞክር።';

    // ADD
    if (result.intent === 'add_rule' && result.ruleText) {
      knowledge.privateRules.push({ rule: result.ruleText, addedAt: new Date().toISOString() });
      await updateKnowledge({ privateRules: knowledge.privateRules });
      learningEvents.emit('activity', { type: 'learn', msg: `📝 Private rule added: "${result.ruleText.slice(0, 50)}"` });
      return result.reply || `✅ Rule ተቀበለ:\n"${result.ruleText}"`;
    }

    // DELETE
    if (result.intent === 'delete_rule') {
      const numMatch = text.match(/\d+/);
      if (numMatch) {
        const idx = parseInt(numMatch[0]) - 1;
        if (idx >= 0 && idx < knowledge.privateRules.length) {
          const deleted = knowledge.privateRules.splice(idx, 1)[0];
          await updateKnowledge({ privateRules: knowledge.privateRules });
          learningEvents.emit('activity', { type: 'learn', msg: `🗑️ Rule deleted: "${deleted.rule?.slice(0, 40)}"` });
          return result.reply || `🗑️ Rule ተሰረዘ:\n"${deleted.rule}"`;
        }
      }
      if (result.deleteTarget) {
        const idx = knowledge.privateRules.findIndex(r =>
          r.rule?.toLowerCase().includes(result.deleteTarget.toLowerCase())
        );
        if (idx !== -1) {
          const deleted = knowledge.privateRules.splice(idx, 1)[0];
          await updateKnowledge({ privateRules: knowledge.privateRules });
          return result.reply || `🗑️ Rule ተሰረዘ:\n"${deleted.rule}"`;
        }
      }
      return '❓ ምን rule እንደምትሰርዝ አልገባኝም። ቁጥር ስጥ (ምሳሌ: "rule 2 ሰርዝ")';
    }

    // UPDATE
    if (result.intent === 'update_rule' && result.ruleText) {
      const numMatch = text.match(/\d+/);
      if (numMatch) {
        const idx = parseInt(numMatch[0]) - 1;
        if (idx >= 0 && idx < knowledge.privateRules.length) {
          knowledge.privateRules[idx].rule = result.ruleText;
          knowledge.privateRules[idx].updatedAt = new Date().toISOString();
          await updateKnowledge({ privateRules: knowledge.privateRules });
          return result.reply || `✏️ Rule ተቀየረ:\n"${result.ruleText}"`;
        }
      }
    }

    // LIST
    if (result.intent === 'list_rules') {
      if (knowledge.privateRules.length === 0) return '📋 እስካሁን ምንም rule አልተጻፈም።';
      const list = knowledge.privateRules.map((r, i) => `${i + 1}. ${r.rule}`).join('\n');
      return `📋 *Board Rules* (${knowledge.privateRules.length})\n━━━━━━\n${list}`;
    }

    // OTHER — general teaching
    await learnBoardAction('private_teaching', { adminMessage: text, lesson: result.reply });
    return result.reply || '✅ ገባኝ። ተማርኩ!';

  } catch (err) {
    console.error('[BoardLearning] Private teaching error:', err.message);
    return '❌ Error ሆነ። እንደገና ሞክር።';
  }
}

// ─────────────────────────────────────────
// BOARD CREATED
// ─────────────────────────────────────────
export async function onBoardCreated(messageId, chatId, boardText, adminId) {
  await learnBoardAction('board_created', {
    messageId,
    chatId,
    boardText: boardText?.slice(0, 500),
    hour: new Date().getHours(),
    dayOfWeek: new Date().getDay(),
  });
}

// ─────────────────────────────────────────
// BOARD EDITED
// ─────────────────────────────────────────
export async function onBoardEdited(messageId, beforeText, afterText, adminId) {
  try {
    const context = await buildUnifiedContext();

    const systemPrompt = `
አንተ Telegram lottery bot AI ነህ። Admin board edit አደረገ።
ሁሉንም ከ admin ትምራለህ — hard-code rules የሉህም።

Group: ${context.groupContext?.groupType || 'learning...'}
Private rules: ${JSON.stringify(context.knowledge.privateRules || [])}
User styles: ${context.userStyles?.slice(0, 5).map(u => `@${u.username}: "${u.intent}"`).join(', ') || 'None'}

Recent chat context:
${context.recentHistory?.slice(0, 10).map(h => `@${h.username}: "${h.text?.slice(0, 50)}"`).join('\n') || 'None'}

ምላሽ JSON ብቻ።
`;

    const userPrompt = `
Before: ${beforeText?.slice(0, 400) || 'N/A'}
After: ${afterText?.slice(0, 400) || 'N/A'}

ምን ዓይነት edit ነው? ለምን? ቀጣይ ጊዜ bot ምን ማድረግ አለበት?

Return ONLY valid JSON:
{
  "editType": "registration | payment_confirm | removal | replacement | status_change | other",
  "changedSlots": [],
  "pattern": "ምን pattern ተማርን",
  "trigger": "ምን user message ነው ይህን edit ያስከተለው",
  "lesson": "ቀጣይ ጊዜ bot ምን ያድርግ",
  "confidence": 0.0
}
`;

    const learned = await callDeepSeekAPI(systemPrompt, userPrompt, null, { retries: 2 });

    await learnBoardAction(`board_edited_${learned?.editType || 'unknown'}`, {
      messageId,
      beforeText: beforeText?.slice(0, 300),
      afterText: afterText?.slice(0, 300),
      editType: learned?.editType,
      changedSlots: learned?.changedSlots,
      pattern: learned?.pattern,
      trigger: learned?.trigger,
      lesson: learned?.lesson,
    });

    // board exchange ያስቀምጣል — unifiedDeepLearning ጋር share
    boardExchanges.push({
      user: learned?.trigger || 'board edit',
      username: 'admin',
      bot: learned?.lesson || '',
      time: new Date().toISOString(),
    });

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `✏️ Board edit learned: ${learned?.editType || 'unknown'}`,
    });

  } catch (err) {
    console.error('[BoardLearning] Edit error:', err.message);
  }
}

// ─────────────────────────────────────────
// BOARD REPLACED
// ─────────────────────────────────────────
export async function onBoardReplaced(oldMessageId, oldText, newText, adminId) {
  await learnBoardAction('board_replaced', {
    oldText: oldText?.slice(0, 300),
    newText: newText?.slice(0, 300),
    hour: new Date().getHours(),
    dayOfWeek: new Date().getDay(),
  });
}

// ─────────────────────────────────────────
// ADMIN REPLY LEARNED
// ─────────────────────────────────────────
export async function onAdminReply(userMessage, adminReply, username, action) {
  await learnBoardAction('admin_reply_pattern', {
    userMessage,
    adminReply,
    username,
    action,
  });

  // aiService.js Q&A pair ጋር share
  boardExchanges.push({
    user: userMessage,
    username,
    bot: adminReply,
    time: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────
// BOT DECISION — ምን ማድረግ አለበት?
// ─────────────────────────────────────────
export async function decideBoardAction(userMessage, username, currentBoardText) {
  try {
    // aiService.js ጋር አንድ context
    const context = await buildUnifiedContext(currentBoardText);

    const systemPrompt = `
አንተ Telegram lottery bot ነህ። ሁሉንም ከ admin ተምረሃል። Hard-code rules የሉህም።

Group type: ${context.groupContext?.groupType || 'still learning'}
Typical flow: ${context.groupContext?.typicalFlow || 'still learning'}
Admin personality: ${context.groupContext?.adminPersonality || 'still learning'}

Private rules (ቅድሚያ ስጣቸው):
${JSON.stringify(context.knowledge.privateRules || [])}

Board patterns learned:
${JSON.stringify(context.knowledge.boardPatterns?.slice(-15) || [])}

User @${username} style: ${context.userStyles?.find(u => u.username === username)?.intent || 'unknown'}

All user styles:
${context.userStyles?.slice(0, 10).map(u => `@${u.username}: "${u.intent}"`).join('\n') || 'None'}

Current board:
${currentBoardText?.slice(0, 500) || 'No board yet'}

Recent chat:
${context.recentHistory?.slice(0, 10).map(h => `@${h.username}: "${h.text?.slice(0, 50)}"`).join('\n') || 'None'}

ምላሽ JSON ብቻ — hard-code አይደለም፣ ከ admin የተማርከውን ተጠቀም።
`;

    const userPrompt = `
User: @${username}
Message: "${userMessage}"

Admin ቢሆን ምን ያደርጋል? ምን ይላል?

Return ONLY valid JSON:
{
  "shouldRespond": true,
  "response": "Amharic response like admin",
  "shouldEditBoard": false,
  "boardEdit": {
    "slotNumber": null,
    "newEntry": null,
    "editType": null
  },
  "confidence": 0.0,
  "reasoning": "ለምን ይህን ወሰንክ"
}
`;

    const decision = await callDeepSeekAPIFast(systemPrompt, userPrompt, { retries: 2 });

    if (decision) {
      learningEvents.emit('activity', {
        type: 'eval',
        msg: `🤖 Board decision: ${decision.shouldEditBoard ? 'EDIT BOARD' : 'RESPOND'} — ${Math.round((decision.confidence || 0) * 100)}%`,
      });
    }

    rotateResponseDeepSeekKey();
    return decision;

  } catch (err) {
    console.error('[BoardLearning] Decision error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
// 🌙 NIGHTLY BOARD REVIEW — unifiedDeepLearning ጋር አንድ ላይ
// ─────────────────────────────────────────
export async function nightlyBoardReview() {
  learningEvents.emit('activity', {
    type: 'learn',
    msg: '🌙 Nightly Board Review + Unified Deep Learning እየጀመረ...',
  });

  // aiService.js unifiedDeepLearning ጋር አንድ ላይ ይሰራሉ
  // board summaries እና exchanges ያካፍላሉ
  const result = await unifiedDeepLearning(boardMiniSummaries, boardExchanges);

  // board summaries ያፀዳ
  boardMiniSummaries.length = 0;
  boardExchanges.length = 0;

  if (result) {
    // board patterns ደካሞቹን ያፀዳ
    const knowledge = await readKnowledge();
    if (knowledge.boardPatterns) {
      // confidence ዝቅ ያሉትን ያስወግዳል
      const cleaned = knowledge.boardPatterns.filter(p => (p.confidence || 0) >= 0.4);
      if (cleaned.length !== knowledge.boardPatterns.length) {
        await updateKnowledge({ boardPatterns: cleaned });
        learningEvents.emit('activity', {
          type: 'learn',
          msg: `🧹 Board patterns cleaned: ${knowledge.boardPatterns.length - cleaned.length} removed`,
        });
      }
    }

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🌙 Nightly review done — Group: ${result.groupContext?.groupType || '?'} — ${Math.round((result.newConfidence || 0) * 100)}%`,
    });
  }

  return result;
}
