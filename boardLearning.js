// ============================================================
// 📋 BOARD LEARNING — ሁሉም ከ Admin ይማራል
// boardLearning.js
// ============================================================
//
// ይህ module:
// • Admin board ሲፈጥር፣ ሲEdit፣ ሲሰርዝ፣ ሲተካ ይማራል
// • Private chat ውስጥ admin rules ይጽፋል፣ ይሰርዛል፣ ይቀይራል
// • DeepSeek AI ሙሉ context ሰጥቶ ይማራል
// • Hard-code rules የሉም — AI ብቻ ይወስናል
// • aiService.js + database.js ጋር ይሰራል
// ============================================================

import { query, readKnowledge, updateKnowledge, getBoardMessage } from './database.js';
import { learningEvents } from './aiService.js';

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-ai/deepseek-r1';

// ── DeepSeek ጋር ይነጋገራል ──
async function askDeepSeek(systemPrompt, userPrompt, apiKey) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(NVIDIA_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 1500,
        }),
      });

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch (err) {
      if (attempt === 3) {
        console.error('[BoardLearning] DeepSeek error:', err.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// ── API Key ያምጣ ──
function getApiKey() {
  const keys = (process.env.NVIDIA_API_KEYS || process.env.NVIDIA_API_KEY || '').split(',').filter(Boolean);
  return keys[Math.floor(Math.random() * keys.length)] || null;
}

// ============================================================
// 📚 CONTEXT BUILDER — ሙሉ context ለ DeepSeek
// ============================================================
async function buildBoardContext() {
  try {
    const knowledge = await readKnowledge();

    const recentEdits = await query(`
      SELECT before_text, after_text, edited_at
      FROM board_edits
      ORDER BY edited_at DESC
      LIMIT 20
    `);

    const recentHistory = await query(`
      SELECT text, is_admin, created_at
      FROM messages
      ORDER BY created_at DESC
      LIMIT 30
    `);

    const boardPatterns = await query(`
      SELECT action_type, context, result, created_at
      FROM action_logs
      WHERE action_type LIKE '%board%'
         OR action_type LIKE '%register%'
         OR action_type LIKE '%payment%'
      ORDER BY created_at DESC
      LIMIT 20
    `).catch(() => ({ rows: [] }));

    return {
      knowledge: {
        boardTemplate: knowledge.boardTemplate || '',
        rules: knowledge.rules || [],
        adminStyle: knowledge.adminStyle || {},
        boardPatterns: knowledge.boardPatterns || [],
        privateRules: knowledge.privateRules || [],
      },
      recentEdits: recentEdits.rows || [],
      recentHistory: recentHistory.rows || [],
      boardPatterns: boardPatterns.rows || [],
      currentTime: new Date().toISOString(),
      dayOfWeek: new Date().getDay(),
      hour: new Date().getHours(),
    };
  } catch (err) {
    console.error('[BoardLearning] Context error:', err.message);
    return {};
  }
}

// ============================================================
// 🎓 LEARN FROM ADMIN ACTION — ዋናው learning function
// ============================================================
export async function learnBoardAction(actionType, details) {
  const apiKey = getApiKey();
  if (!apiKey) return;

  try {
    const context = await buildBoardContext();

    const systemPrompt = `
አንተ የ Telegram lottery bot AI ነህ።
አንተ ሁሉንም ነገር ከ admin ትምራለህ — hard-code rules የሉህም።
Admin private chat ውስጥ ያስተማረህን rules ጨምሮ ሁሉንም context ተጠቀም።

Private rules admin አስተምሯቸዋል:
${JSON.stringify(context.knowledge.privateRules || [], null, 2)}

ሙሉ context:
${JSON.stringify(context, null, 2)}

ምላሽ በ JSON ብቻ ስጥ። ምንም ሌላ text አትጻፍ።
`;

    const userPrompt = `
Admin action: ${actionType}
Details: ${JSON.stringify(details, null, 2)}

ከዚህ action ምን ተማርክ? JSON ስጥ:
{
  "pattern": "ምን pattern አለ",
  "trigger": "ምን ሲሆን ይህ action ይሆናል",
  "lesson": "bot ቀጣይ ጊዜ ምን ማድረግ አለበት",
  "confidence": 0.0-1.0,
  "boardUpdate": "board ምን ይሆናል (optional)",
  "relatedPatterns": ["ሌሎች related patterns"]
}
`;

    const learned = await askDeepSeek(systemPrompt, userPrompt, apiKey);
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

    if (knowledge.boardPatterns.length > 50) {
      knowledge.boardPatterns = knowledge.boardPatterns.slice(-50);
    }

    await updateKnowledge({ boardPatterns: knowledge.boardPatterns });

    await query(`
      INSERT INTO action_logs (action_type, context, result, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [
      `board_learning_${actionType}`,
      JSON.stringify(details),
      JSON.stringify(learned),
    ]).catch(() => {});

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `📋 Board learned: ${actionType} — "${learned.pattern?.slice(0, 50) || ''}"`,
    });

    console.log(`[BoardLearning] ✅ Learned: ${actionType}`);
    return learned;

  } catch (err) {
    console.error('[BoardLearning] Learn error:', err.message);
  }
}

// ============================================================
// 💬 PRIVATE TEACHING — Admin private chat ውስጥ ያስተምራል
// ============================================================
export async function handlePrivateBoardTeaching(adminId, text) {
  const apiKey = getApiKey();
  if (!apiKey) return '❌ API key የለም';

  try {
    const knowledge = await readKnowledge();
    if (!knowledge.privateRules) knowledge.privateRules = [];

    const context = await buildBoardContext();

    const systemPrompt = `
አንተ lottery bot AI ነህ። Admin private chat ውስጥ board rules እያስተማረህ ነው።
Admin:
- አዲስ rule ሊጽፍ ይችላል → ይቀበለዋል
- ያለ rule ሊሰርዝ ይችላል → ይሰርዘዋል  
- Rule ሊቀይር ይችላል → ያስተካክለዋል
- ምን rules እንዳለ ሊጠይቅ ይችላል → ዝርዝር ያሳያል

አሁን ያሉ rules:
${JSON.stringify(knowledge.privateRules, null, 2)}

ሙሉ board context:
${JSON.stringify(context.knowledge, null, 2)}

ምላሽ JSON ብቻ።
`;

    const userPrompt = `
Admin message: "${text}"

Admin ምን ማድረግ ፈልጓል? JSON ስጥ:
{
  "intent": "add_rule|delete_rule|update_rule|list_rules|other",
  "ruleText": "rule ምንድነው (add/update ከሆነ)",
  "ruleIndex": null,
  "deleteTarget": "ምን rule ሰርዝ (delete ከሆነ)",
  "reply": "admin ላይ ምን ትመልሳለህ (Amharic — short)",
  "confidence": 0.0-1.0
}
`;

    const result = await askDeepSeek(systemPrompt, userPrompt, apiKey);
    if (!result) return '❌ ልረዳ አልቻልኩም። እንደገና ሞክር።';

    // ── ADD RULE ──
    if (result.intent === 'add_rule' && result.ruleText) {
      knowledge.privateRules.push({
        rule: result.ruleText,
        addedAt: new Date().toISOString(),
      });
      await updateKnowledge({ privateRules: knowledge.privateRules });

      learningEvents.emit('activity', {
        type: 'learn',
        msg: `📝 Private rule added: "${result.ruleText.slice(0, 50)}"`,
      });

      return result.reply || `✅ Rule ተቀበለ:\n"${result.ruleText}"`;
    }

    // ── DELETE RULE ──
    if (result.intent === 'delete_rule') {
      const before = knowledge.privateRules.length;

      // ቁጥር ከሆነ index ይጠቀም
      const numMatch = text.match(/\d+/);
      if (numMatch) {
        const idx = parseInt(numMatch[0]) - 1;
        if (idx >= 0 && idx < knowledge.privateRules.length) {
          const deleted = knowledge.privateRules.splice(idx, 1)[0];
          await updateKnowledge({ privateRules: knowledge.privateRules });

          learningEvents.emit('activity', {
            type: 'learn',
            msg: `🗑️ Private rule deleted: "${deleted.rule?.slice(0, 40)}"`,
          });

          return result.reply || `🗑️ Rule ተሰረዘ:\n"${deleted.rule}"`;
        }
      }

      // Text ከሆነ match ይፈልግ
      if (result.deleteTarget) {
        const idx = knowledge.privateRules.findIndex(r =>
          r.rule?.toLowerCase().includes(result.deleteTarget.toLowerCase())
        );
        if (idx !== -1) {
          const deleted = knowledge.privateRules.splice(idx, 1)[0];
          await updateKnowledge({ privateRules: knowledge.privateRules });

          learningEvents.emit('activity', {
            type: 'learn',
            msg: `🗑️ Private rule deleted: "${deleted.rule?.slice(0, 40)}"`,
          });

          return result.reply || `🗑️ Rule ተሰረዘ:\n"${deleted.rule}"`;
        }
      }

      return '❓ ምን rule እንደምትሰርዝ አልገባኝም። ቁጥር ስጥ (ምሳሌ: "rule 2 ሰርዝ")';
    }

    // ── UPDATE RULE ──
    if (result.intent === 'update_rule' && result.ruleText) {
      const numMatch = text.match(/\d+/);
      if (numMatch) {
        const idx = parseInt(numMatch[0]) - 1;
        if (idx >= 0 && idx < knowledge.privateRules.length) {
          knowledge.privateRules[idx].rule = result.ruleText;
          knowledge.privateRules[idx].updatedAt = new Date().toISOString();
          await updateKnowledge({ privateRules: knowledge.privateRules });

          learningEvents.emit('activity', {
            type: 'learn',
            msg: `✏️ Private rule updated: "${result.ruleText.slice(0, 40)}"`,
          });

          return result.reply || `✏️ Rule ተቀየረ:\n"${result.ruleText}"`;
        }
      }
    }

    // ── LIST RULES ──
    if (result.intent === 'list_rules') {
      if (knowledge.privateRules.length === 0) {
        return '📋 እስካሁን ምንም rule አልተጻፈም።';
      }
      const list = knowledge.privateRules
        .map((r, i) => `${i + 1}. ${r.rule}`)
        .join('\n');
      return `📋 *Board Rules* (${knowledge.privateRules.length})\n━━━━━━━━\n${list}`;
    }

    // ── OTHER — general board teaching ──
    await learnBoardAction('private_teaching', {
      adminMessage: text,
      intent: result.intent,
      lesson: result.reply,
    });

    return result.reply || '✅ ገባኝ። ተማርኩ!';

  } catch (err) {
    console.error('[BoardLearning] Private teaching error:', err.message);
    return '❌ Error ሆነ። እንደገና ሞክር።';
  }
}

// ============================================================
// 📋 BOARD CREATED — Admin አዲስ board ፈጠረ
// ============================================================
export async function onBoardCreated(messageId, chatId, boardText, adminId) {
  await learnBoardAction('board_created', {
    messageId,
    chatId,
    boardText: boardText.slice(0, 500),
    slotCount: (boardText.match(/#/g) || []).length,
    hour: new Date().getHours(),
    dayOfWeek: new Date().getDay(),
    lesson: 'Admin ፈጠረ — structure, timing, slot count ይማር',
  });
}

// ============================================================
// ✏️ BOARD EDITED — Admin board edit አደረገ
// ============================================================
export async function onBoardEdited(messageId, beforeText, afterText, adminId) {
  const apiKey = getApiKey();
  if (!apiKey) return;

  try {
    const context = await buildBoardContext();

    const systemPrompt = `
አንተ lottery board AI ነህ። Admin board edit አደረገ።
ምን ዓይነት edit እንደሆነ ተረዳ — registration, payment confirm, removal, replacement, ወዘተ።

Admin private rules:
${JSON.stringify(context.knowledge.privateRules || [], null, 2)}

ምላሽ JSON ብቻ።
`;

    const userPrompt = `
Before: ${beforeText?.slice(0, 300) || 'N/A'}
After: ${afterText?.slice(0, 300) || 'N/A'}

Recent chat history for context:
${JSON.stringify(context.recentHistory?.slice(0, 10), null, 2)}

{
  "editType": "registration|payment_confirm|removal|replacement|other",
  "changedSlots": ["slot numbers that changed"],
  "pattern": "ምን pattern ተማርን",
  "trigger": "ምን user message ነው ይህን edit ያስከተለው",
  "lesson": "ቀጣይ ጊዜ bot ምን ያድርግ",
  "confidence": 0.0-1.0
}
`;

    const learned = await askDeepSeek(systemPrompt, userPrompt, apiKey);

    await learnBoardAction(`board_edited_${learned?.editType || 'unknown'}`, {
      messageId,
      beforeText: beforeText?.slice(0, 300),
      afterText: afterText?.slice(0, 300),
      editType: learned?.editType,
      changedSlots: learned?.changedSlots,
      pattern: learned?.pattern,
      trigger: learned?.trigger,
      lesson: learned?.lesson,
      hour: new Date().getHours(),
    });

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `✏️ Edit learned: ${learned?.editType || 'unknown'} — slots: ${learned?.changedSlots?.join(', ') || '?'}`,
    });

  } catch (err) {
    console.error('[BoardLearning] Edit learn error:', err.message);
  }
}

// ============================================================
// 🗑️ BOARD REPLACED — Admin ሰርዞ አዲስ ሰራ
// ============================================================
export async function onBoardReplaced(oldMessageId, oldText, newText, adminId) {
  await learnBoardAction('board_replaced', {
    oldText: oldText?.slice(0, 300),
    newText: newText?.slice(0, 300),
    hour: new Date().getHours(),
    dayOfWeek: new Date().getDay(),
    lesson: 'Admin ሰርዞ አዲስ board ሰራ — timing እና reason ይማር',
  });
}

// ============================================================
// 💬 ADMIN REPLY LEARNED — Admin reply → board action
// ============================================================
export async function onAdminReply(userMessage, adminReply, username, action) {
  await learnBoardAction('admin_reply_pattern', {
    userMessage,
    adminReply,
    username,
    action,
    lesson: 'Admin reply ከዚህ user message ጋር → ይህ action ይከተላል',
  });
}

// ============================================================
// 🤖 BOT DECISION — Bot ምን ማድረግ አለበት?
// ============================================================
export async function decideBoardAction(userMessage, username, currentBoardText) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const context = await buildBoardContext();

    const systemPrompt = `
አንተ lottery bot ነህ። ከ admin ተምረሃል።
አሁን user message መጣ — ምን ማድረግ አለብህ?

Admin private ውስጥ ያስተማረህ rules (ቅድሚያ ስጣቸው):
${JSON.stringify(context.knowledge.privateRules || [], null, 2)}

የተማርካቸው board patterns:
${JSON.stringify(context.knowledge.boardPatterns?.slice(-20), null, 2)}

አሁን ያለው board:
${currentBoardText?.slice(0, 500) || 'No board yet'}

Recent chat history:
${JSON.stringify(context.recentHistory?.slice(0, 15), null, 2)}

ምላሽ JSON ብቻ — hard rules አይደሉም፣ የተማርከውን ተጠቀም።
`;

    const userPrompt = `
User: @${username}
Message: "${userMessage}"

{
  "shouldRespond": true/false,
  "response": "ምን ትላለህ (Amharic)",
  "shouldEditBoard": true/false,
  "boardEdit": {
    "slotNumber": "number",
    "newEntry": "the full updated line as admin would write it",
    "editType": "registration|payment|removal"
  },
  "confidence": 0.0-1.0,
  "reasoning": "ለምን ይህን ወሰንክ"
}
`;

    const decision = await askDeepSeek(systemPrompt, userPrompt, apiKey);

    if (decision) {
      learningEvents.emit('activity', {
        type: 'eval',
        msg: `🤖 Board decision: ${decision.shouldEditBoard ? 'EDIT' : 'NO EDIT'} — confidence: ${Math.round((decision.confidence || 0) * 100)}%`,
      });
    }

    return decision;

  } catch (err) {
    console.error('[BoardLearning] Decision error:', err.message);
    return null;
  }
}

// ============================================================
// 🌙 NIGHTLY BOARD REVIEW — ሌሊት ሁሉንም ይገምግም
// ============================================================
export async function nightlyBoardReview() {
  const apiKey = getApiKey();
  if (!apiKey) return;

  try {
    const context = await buildBoardContext();

    const systemPrompt = `
አንተ lottery bot ነህ። ዛሬ ሙሉ ቀን admin ምን ሰራ?
ሁሉንም board patterns ገምግም — ምን ተማርክ? ምን ደካማ ነው?
Private rules ጨምሮ ሁሉንም አስብ።
ምላሽ JSON ብቻ።
`;

    const userPrompt = `
Today's board actions:
${JSON.stringify(context.recentEdits, null, 2)}

Today's chat:
${JSON.stringify(context.recentHistory?.slice(0, 20), null, 2)}

Private rules:
${JSON.stringify(context.knowledge.privateRules, null, 2)}

Learned patterns so far:
${JSON.stringify(context.knowledge.boardPatterns?.slice(-30), null, 2)}

{
  "summary": "ዛሬ ምን ተማርን",
  "strongPatterns": ["ጠንካራ patterns"],
  "weakPatterns": ["ደካማ patterns"],
  "improvements": ["ምን ማሻሻል አለብን"],
  "newConfidence": 0.0-1.0
}
`;

    const review = await askDeepSeek(systemPrompt, userPrompt, apiKey);
    if (!review) return;

    await updateKnowledge({
      boardNightlyReview: review,
      boardConfidence: review.newConfidence,
    });

    learningEvents.emit('activity', {
      type: 'learn',
      msg: `🌙 Nightly board review done — confidence: ${Math.round((review.newConfidence || 0) * 100)}%`,
    });

    console.log('[BoardLearning] 🌙 Nightly review complete');
    return review;

  } catch (err) {
    console.error('[BoardLearning] Nightly review error:', err.message);
  }
}
