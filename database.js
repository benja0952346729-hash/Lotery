import pg from 'pg';

const { Pool } = pg;

function loadPools() {
  const pools = [];
  let i = 1;
  while (process.env[`NEON_DB_${i}`] && i <= 10) {
    pools.push(new Pool({
      connectionString: process.env[`NEON_DB_${i}`],
      ssl: true,
    }));
    i++;
  }
  if (pools.length === 0) throw new Error('No NEON_DB_1 found in env!');
  console.log(`[DB] ${pools.length} Neon database(s) connected`);
  return pools;
}

const pools = loadPools();
let currentPoolIndex = 0;

function getPool() {
  return pools[currentPoolIndex % pools.length];
}

function rotatePool() {
  currentPoolIndex = (currentPoolIndex + 1) % pools.length;
  console.log(`[DB] Rotated to DB #${currentPoolIndex + 1}`);
}

async function query(sql, params = [], retries = Math.max(pools.length, 3)) {
  for (let i = 0; i < retries; i++) {
    try {
      const pool = getPool();
      const result = await pool.query(sql, params);
      return result;
    } catch (err) {
      console.error(`[DB] Query failed (attempt ${i+1}/${retries}):`, err.message, err.code || '');
      if (i < retries - 1) {
        rotatePool();
        await new Promise(res => setTimeout(res, 1000));
      }
    }
  }
  throw new Error('All Neon DBs failed');
}

export async function initDB() {
  // ── Knowledge ──
  await query(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── History ──
  await query(`
    CREATE TABLE IF NOT EXISTS history (
      id SERIAL PRIMARY KEY,
      message_id BIGINT,
      user_id BIGINT,
      username TEXT,
      first_name TEXT,
      text TEXT,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Lottery ──
  await query(`
    CREATE TABLE IF NOT EXISTS lottery (
      id SERIAL PRIMARY KEY,
      number INTEGER UNIQUE NOT NULL,
      user_id BIGINT NOT NULL,
      username TEXT,
      registered_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Bot State ──
  await query(`
    CREATE TABLE IF NOT EXISTS bot_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      is_on BOOLEAN DEFAULT FALSE,
      toggled_at TIMESTAMP DEFAULT NOW(),
      toggled_by BIGINT
    )
  `);
// ── Payment SMS ──
await query(`
  CREATE TABLE IF NOT EXISTS payment_sms (
    id SERIAL PRIMARY KEY,
    ref_no TEXT UNIQUE NOT NULL,
    amount NUMERIC NOT NULL,
    type TEXT NOT NULL,
    raw_sms TEXT,
    matched BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
  )
`);

// ── Payment Screenshots ──
await query(`
  CREATE TABLE IF NOT EXISTS payment_screenshots (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL,
    ref_no TEXT,
    type TEXT,
    description TEXT,
    matched BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
  )
`);
  // ── Token Usage ──
  await query(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id SERIAL PRIMARY KEY,
      service TEXT NOT NULL,
      input_tokens BIGINT DEFAULT 0,
      output_tokens BIGINT DEFAULT 0,
      calls BIGINT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Action Logs ──
  await query(`
    CREATE TABLE IF NOT EXISTS action_logs (
      id SERIAL PRIMARY KEY,
      action_type TEXT NOT NULL,
      trigger TEXT,
      reason TEXT,
      details JSONB DEFAULT '{}',
      is_admin BOOLEAN DEFAULT FALSE,
      confidence FLOAT DEFAULT 1.0,
      times_seen INTEGER DEFAULT 1,
      times_correct INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Q&A Pairs ──
  await query(`
    CREATE TABLE IF NOT EXISTS qa_pairs (
      id SERIAL PRIMARY KEY,
      user_message TEXT NOT NULL,
      admin_reply TEXT NOT NULL,
      context TEXT,
      intent TEXT,
      confidence FLOAT DEFAULT 1.0,
      times_used INTEGER DEFAULT 0,
      times_correct INTEGER DEFAULT 0,
      is_admin_verified BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Board Messages — admin board ሲልክ message_id ይቀመጣል ──
  await query(`
    CREATE TABLE IF NOT EXISTS board_messages (
      id SERIAL PRIMARY KEY,
      message_id BIGINT UNIQUE NOT NULL,
      chat_id BIGINT NOT NULL,
      text TEXT,
      sent_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Board Edits — admin manually edit ሲያደርግ before/after ──
  await query(`
    CREATE TABLE IF NOT EXISTS board_edits (
      id SERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL,
      chat_id BIGINT NOT NULL,
      before_text TEXT,
      after_text TEXT,
      learned BOOLEAN DEFAULT FALSE,
      edited_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Deleted Messages — admin message ሲሰርዝ ──
  await query(`
    CREATE TABLE IF NOT EXISTS deleted_messages (
      id SERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL,
      chat_id BIGINT NOT NULL,
      text TEXT,
      deleted_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await ensureTokenService('nvidia-deepseek');
  await ensureTokenService('groq');

  await query(`
    INSERT INTO bot_state (id, is_on) VALUES (1, FALSE)
    ON CONFLICT (id) DO NOTHING
  `);

  const defaults = {
    adminStyle: { greetings: [], warnings: [], announcements: [], responses: [] },
    userPatterns: {},
    rules: [],
    intents: [],
    writingStyle: { amharic: [], tone: '', commonPhrases: [] },
    lastUpdated: null,
  };
  await query(`
    INSERT INTO knowledge (key, value) VALUES ('main', $1)
    ON CONFLICT (key) DO NOTHING
  `, [JSON.stringify(defaults)]);

  console.log('[DB] Tables initialized ✅');
}

async function ensureTokenService(service) {
  const res = await query(`SELECT id FROM token_usage WHERE service = $1`, [service]);
  if (res.rows.length === 0) {
    await query(`
      INSERT INTO token_usage (service, input_tokens, output_tokens, calls)
      VALUES ($1, 0, 0, 0)
    `, [service]);
  }
}

// ===== KNOWLEDGE =====
export async function readKnowledge() {
  const res = await query(`SELECT value FROM knowledge WHERE key = 'main'`);
  return res.rows[0]?.value || {};
}

export async function updateKnowledge(updates) {
  const current = await readKnowledge();
  const merged = deepMergeArrays(current, updates);
  merged.lastUpdated = new Date().toISOString();
  await query(`
    UPDATE knowledge SET value = $1, updated_at = NOW() WHERE key = 'main'
  `, [JSON.stringify(merged)]);
  return merged;
}

function deepMergeArrays(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (Array.isArray(source[key]) && Array.isArray(target[key])) {
      result[key] = [...new Set([...target[key], ...source[key]])];
    } else if (typeof source[key] === 'object' && source[key] !== null) {
      result[key] = deepMergeArrays(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ===== HISTORY =====
export async function saveHistory(message) {
  await query(`
    INSERT INTO history (message_id, user_id, username, first_name, text, is_admin)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    message.message_id,
    message.from?.id,
    message.from?.username,
    message.from?.first_name,
    message.text || '',
    message._isAdmin || false,
  ]);


}

export async function getHistory(days = 7) {
  const res = await query(`
    SELECT * FROM history
    WHERE created_at > NOW() - INTERVAL '${days} days'
    ORDER BY created_at DESC
    LIMIT 500
  `);
  return res.rows;
}

// ===== BOARD MESSAGES =====

// Admin board message ሲልክ → message_id ያስቀምጣል
export async function saveBoardMessage(messageId, chatId, text) {
  await query(`
    INSERT INTO board_messages (message_id, chat_id, text)
    VALUES ($1, $2, $3)
    ON CONFLICT (message_id) DO UPDATE SET text = $3, sent_at = NOW()
  `, [messageId, chatId, text]);
}

// Current board message ያወጣል
export async function getBoardMessage() {
  const res = await query(`
    SELECT * FROM board_messages ORDER BY sent_at DESC LIMIT 1
  `);
  return res.rows[0] || null;
}

// Board message text ያዘምናል (bot edit ሲያደርግ)
export async function updateBoardMessageText(messageId, newText) {
  await query(`
    UPDATE board_messages SET text = $1 WHERE message_id = $2
  `, [newText, messageId]);
}

// ===== BOARD EDITS =====

// Admin manually edit ሲያደርግ → before/after ያስቀምጣል
export async function saveBoardEdit(messageId, chatId, beforeText, afterText) {
  await query(`
    INSERT INTO board_edits (message_id, chat_id, before_text, after_text)
    VALUES ($1, $2, $3, $4)
  `, [messageId, chatId, beforeText, afterText]);
}

// DeepSeek ያላወቀ edits ያወጣል
export async function getUnlearnedEdits(limit = 20) {
  const res = await query(`
    SELECT * FROM board_edits
    WHERE learned = FALSE
    ORDER BY edited_at ASC
    LIMIT $1
  `, [limit]);
  return res.rows;
}

// Edit ተምሯል ብሎ ያስቀምጣል
export async function markEditLearned(id) {
  await query(`UPDATE board_edits SET learned = TRUE WHERE id = $1`, [id]);
}

// All edits ያወጣል — DeepSeek ለማስተማር
export async function getBoardEdits(limit = 50) {
  const res = await query(`
    SELECT * FROM board_edits ORDER BY edited_at DESC LIMIT $1
  `, [limit]);
  return res.rows;
}

// ===== DELETED MESSAGES =====

// Admin message ሲሰርዝ → ያስቀምጣል
export async function saveDeletedMessage(messageId, chatId, text) {
  await query(`
    INSERT INTO deleted_messages (message_id, chat_id, text)
    VALUES ($1, $2, $3)
  `, [messageId, chatId, text || '']);
}

// Deleted messages ያወጣል
export async function getDeletedMessages(limit = 20) {
  const res = await query(`
    SELECT * FROM deleted_messages ORDER BY deleted_at DESC LIMIT $1
  `, [limit]);
  return res.rows;
}

// ===== ACTION LOGS =====
export async function saveActionLog(actionType, trigger, reason, details = {}, isAdmin = true) {
  const existing = await query(`
    SELECT id, times_seen, times_correct FROM action_logs
    WHERE action_type = $1 AND trigger = $2
    LIMIT 1
  `, [actionType, trigger]);

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    await query(`
      UPDATE action_logs
      SET times_seen = times_seen + 1,
          times_correct = times_correct + 1,
          confidence = LEAST(1.0, $1::float),
          details = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [
      (row.times_correct + 1) / (row.times_seen + 1),
      JSON.stringify(details),
      row.id,
    ]);
  } else {
    await query(`
      INSERT INTO action_logs (action_type, trigger, reason, details, is_admin, confidence)
      VALUES ($1, $2, $3, $4, $5, 1.0)
    `, [actionType, trigger, reason, JSON.stringify(details), isAdmin]);
  }
}

export async function updateActionConfidence(actionType, trigger, wasCorrect) {
  const res = await query(`
    SELECT id, times_seen, times_correct FROM action_logs
    WHERE action_type = $1 AND trigger = $2
  `, [actionType, trigger]);

  if (res.rows.length > 0) {
    const row = res.rows[0];
    const newCorrect = row.times_correct + (wasCorrect ? 1 : 0);
    const newSeen = row.times_seen + 1;
    await query(`
      UPDATE action_logs
      SET times_seen = $1, times_correct = $2, confidence = $3, updated_at = NOW()
      WHERE id = $4
    `, [newSeen, newCorrect, newCorrect / newSeen, row.id]);
  }
}

export async function getActionLogs(minConfidence = 0.0) {
  const res = await query(`
    SELECT * FROM action_logs
    WHERE confidence >= $1
    ORDER BY confidence DESC, times_seen DESC
    LIMIT 50
  `, [minConfidence]);
  return res.rows;
}

// ===== Q&A PAIRS =====
export async function saveQAPair(userMessage, adminReply, context = '', intent = '', isAdminVerified = false) {
  const existing = await query(`
    SELECT id, times_used, times_correct FROM qa_pairs
    WHERE user_message = $1
    LIMIT 1
  `, [userMessage]);

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    await query(`
      UPDATE qa_pairs
      SET admin_reply = $1,
          times_used = times_used + 1,
          times_correct = times_correct + 1,
          confidence = LEAST(1.0, $2::float),
          is_admin_verified = $3,
          updated_at = NOW()
      WHERE id = $4
    `, [
      adminReply,
      (row.times_correct + 1) / (row.times_used + 1),
      isAdminVerified,
      row.id,
    ]);
  } else {
    await query(`
      INSERT INTO qa_pairs (user_message, admin_reply, context, intent, confidence, is_admin_verified)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [userMessage, adminReply, context, intent, isAdminVerified ? 1.0 : 0.7, isAdminVerified]);
  }
}

export async function updateQAConfidence(userMessage, wasCorrect) {
  const res = await query(`
    SELECT id, times_used, times_correct FROM qa_pairs
    WHERE user_message = $1
  `, [userMessage]);

  if (res.rows.length > 0) {
    const row = res.rows[0];
    const newCorrect = row.times_correct + (wasCorrect ? 1 : 0);
    const newUsed = row.times_used + 1;
    await query(`
      UPDATE qa_pairs
      SET times_used = $1, times_correct = $2, confidence = $3, updated_at = NOW()
      WHERE id = $4
    `, [newUsed, newCorrect, newCorrect / newUsed, row.id]);
  }
}

export async function findSimilarQA(userMessage, limit = 5) {
  const res = await query(`
    SELECT * FROM qa_pairs
    WHERE confidence > 0.5
    ORDER BY
      CASE WHEN user_message = $1 THEN 1
           WHEN user_message ILIKE $2 THEN 2
           ELSE 3
      END,
      confidence DESC,
      times_correct DESC
    LIMIT $3
  `, [userMessage, `%${userMessage.slice(0, 20)}%`, limit]);
  return res.rows;
}

export async function getBestQAPairs(limit = 30) {
  const res = await query(`
    SELECT * FROM qa_pairs
    WHERE confidence >= 0.7
    ORDER BY is_admin_verified DESC, confidence DESC, times_correct DESC
    LIMIT $1
  `, [limit]);
  return res.rows;
}

// ===== LOTTERY =====
export async function registerMember(userId, username, number) {
  const taken = await query(`SELECT id FROM lottery WHERE number = $1`, [number]);
  if (taken.rows.length > 0) return { success: false, reason: 'number_taken' };

  const already = await query(`SELECT number FROM lottery WHERE user_id = $1`, [userId]);
  if (already.rows.length > 0) return { success: false, reason: 'already_registered', number: already.rows[0].number };

  await query(`
    INSERT INTO lottery (number, user_id, username) VALUES ($1, $2, $3)
  `, [number, userId, username]);

  return { success: true, number };
}

export async function getLotteryList() {
  const res = await query(`SELECT * FROM lottery ORDER BY number ASC`);
  return res.rows;
}

export async function removeMember(number) {
  await query(`DELETE FROM lottery WHERE number = $1`, [number]);
}

export async function clearLottery() {
  await query(`DELETE FROM lottery`);
}

// ===== BOT STATE =====
export async function getBotState() {
  const res = await query(`SELECT is_on FROM bot_state WHERE id = 1`);
  return res.rows[0]?.is_on || false;
}

export async function setBotState(isOn, adminId) {
  await query(`
    UPDATE bot_state SET is_on = $1, toggled_at = NOW(), toggled_by = $2 WHERE id = 1
  `, [isOn, adminId]);
}

// ===== TOKEN USAGE =====
export async function addTokenUsage(service, inputTokens, outputTokens) {
  const res = await query(`
    UPDATE token_usage
    SET input_tokens = input_tokens + $1,
        output_tokens = output_tokens + $2,
        calls = calls + 1,
        updated_at = NOW()
    WHERE service = $3
  `, [inputTokens, outputTokens, service]);

  if (res.rowCount === 0) {
    await query(`
      INSERT INTO token_usage (service, input_tokens, output_tokens, calls)
      VALUES ($1, $2, $3, 1)
    `, [service, inputTokens, outputTokens]);
  }
}

export async function getTokenUsage() {
  const res = await query(`SELECT * FROM token_usage ORDER BY service`);
  const result = {};
  for (const row of res.rows) {
    result[row.service] = {
      input: parseInt(row.input_tokens),
      output: parseInt(row.output_tokens),
      calls: parseInt(row.calls),
      total: parseInt(row.input_tokens) + parseInt(row.output_tokens),
      updatedAt: row.updated_at,
    };
  }
  return result;
}

export async function resetTokenUsage() {
  await query(`UPDATE token_usage SET input_tokens=0, output_tokens=0, calls=0, updated_at=NOW()`);
}

// ===== CLEANUP — 5 ቀን ያለፈ raw data ያጠፋ =====
// Knowledge አይጠፋም — raw collected data ብቻ ነው የሚጠፋው
export async function cleanupOldData() {
  const results = {};

  // History — 5 ቀን
  const h = await query(`DELETE FROM history WHERE created_at < NOW() - INTERVAL '5 days'`);
  results.history = h.rowCount;

  // Board edits — 5 ቀን
  const be = await query(`DELETE FROM board_edits WHERE edited_at < NOW() - INTERVAL '5 days'`);
  results.boardEdits = be.rowCount;

  // Deleted messages — 5 ቀን
  const dm = await query(`DELETE FROM deleted_messages WHERE deleted_at < NOW() - INTERVAL '5 days'`);
  results.deletedMessages = dm.rowCount;

  // Board messages — 5 ቀን
  const bm = await query(`DELETE FROM board_messages WHERE sent_at < NOW() - INTERVAL '5 days'`);
  results.boardMessages = bm.rowCount;

  // Action logs — 5 ቀን
  const al = await query(`DELETE FROM action_logs WHERE updated_at < NOW() - INTERVAL '5 days'`);
  results.actionLogs = al.rowCount;

  // QA pairs — 5 ቀን
  const qa = await query(`DELETE FROM qa_pairs WHERE updated_at < NOW() - INTERVAL '5 days'`);
  results.qaPairs = qa.rowCount;

  console.log('[DB] Cleanup done:', results);
  return results;
}
// ===== PAYMENT =====
export async function saveSmsPayment(refNo, amount, type, rawSms) {
  await query(`
    INSERT INTO payment_sms (ref_no, amount, type, raw_sms)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (ref_no) DO NOTHING
  `, [refNo, amount, type, rawSms]);

  return await tryMatch({ refNo, amount, type });
}

export async function saveScreenshotPayment(telegramId, refNo, type, description) {
  await query(`
    INSERT INTO payment_screenshots (telegram_id, ref_no, type, description)
    VALUES ($1, $2, $3, $4)
  `, [telegramId, refNo, type, description]);

  return await tryMatch({ refNo, telegramId });
}

export async function tryMatch({ refNo, amount, type, telegramId }) {
  if (!refNo) return { matched: null };

  // SMS ና Screenshot ያዛምዳል
  const sms = await query(`
    SELECT * FROM payment_sms WHERE ref_no = $1 AND matched = FALSE
  `, [refNo]);

  const screenshot = await query(`
    SELECT * FROM payment_screenshots WHERE ref_no = $1 AND matched = FALSE
  `, [refNo]);

  if (sms.rows.length > 0 && screenshot.rows.length > 0) {
    const s = sms.rows[0];
    const sc = screenshot.rows[0];

    // Match ሆነ — ሁለቱንም ያዘምናል
    await query(`UPDATE payment_sms SET matched = TRUE WHERE ref_no = $1`, [refNo]);
    await query(`UPDATE payment_screenshots SET matched = TRUE WHERE ref_no = $1`, [refNo]);

    return {
      matched: {
        telegramId: sc.telegram_id,
        amount: s.amount,
        type: s.type,
        refNo,
      }
    };
  }

  return { matched: null };
}

export async function cleanupPayments() {
  const sms = await query(`
    DELETE FROM payment_sms WHERE created_at < NOW() - INTERVAL '2 days'
  `);
  const screenshots = await query(`
    DELETE FROM payment_screenshots WHERE created_at < NOW() - INTERVAL '2 days'
  `);
  return { sms: sms.rowCount, screenshots: screenshots.rowCount };
}
export { query };
