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
  await query(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

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

  await query(`
    CREATE TABLE IF NOT EXISTS lottery (
      id SERIAL PRIMARY KEY,
      number INTEGER UNIQUE NOT NULL,
      user_id BIGINT NOT NULL,
      username TEXT,
      registered_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS bot_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      is_on BOOLEAN DEFAULT FALSE,
      toggled_at TIMESTAMP DEFAULT NOW(),
      toggled_by BIGINT,
      last_board_message_id BIGINT DEFAULT NULL
    )
  `);

  await query(`
    ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS last_board_message_id BIGINT DEFAULT NULL
  `).catch(() => {});

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

  await query(`
    CREATE TABLE IF NOT EXISTS board_snapshots (
      id SERIAL PRIMARY KEY,
      slots JSONB NOT NULL DEFAULT '{}',
      raw_text TEXT,
      context TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(err => console.error('[DB] board_snapshots:', err.message));

  // ── አዲስ: Action Logs ──
  // አንተ ያደረጋቸው actions ሁሉ ይቀመጣሉ — ለምን፣ መቼ፣ እንዴት
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

  // ── አዲስ: Q&A Pairs ──
  // ሰው ጠየቀ + አንተ/bot መለሰ → pair ይቀመጣል
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
    boardRules: {},
    boardPatterns: [],
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

// ===== HISTORY — 7 ቀን ብቻ =====
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

  // 7 ቀን ያለፈ raw history ያጠፋ — learned knowledge ይቆያል
  await query(`
    DELETE FROM history WHERE created_at < NOW() - INTERVAL '7 days'
  `);
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

// ===== ACTION LOGS =====

// አዲስ action ያስቀምጣል ወይም ያለውን ያዘምናል
export async function saveActionLog(actionType, trigger, reason, details = {}, isAdmin = true) {
  // ተመሳሳይ action ካለ ያዘምናል
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

// Action confidence ያዘምናል — ልክ ነበር ወይ አልነበረም
export async function updateActionConfidence(actionType, trigger, wasCorrect) {
  const res = await query(`
    SELECT id, times_seen, times_correct FROM action_logs
    WHERE action_type = $1 AND trigger = $2
  `, [actionType, trigger]);

  if (res.rows.length > 0) {
    const row = res.rows[0];
    const newCorrect = row.times_correct + (wasCorrect ? 1 : 0);
    const newSeen = row.times_seen + 1;
    const newConfidence = newCorrect / newSeen;

    await query(`
      UPDATE action_logs
      SET times_seen = $1, times_correct = $2, confidence = $3, updated_at = NOW()
      WHERE id = $4
    `, [newSeen, newCorrect, newConfidence, row.id]);
  }
}

// Actions ያወጣል — Groq ለማስተማር
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

// ሰው ጠየቀ + admin/bot መለሰ → pair ያስቀምጣል
export async function saveQAPair(userMessage, adminReply, context = '', intent = '', isAdminVerified = false) {
  // ተመሳሳይ question ካለ ያዘምናል
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

// Q&A confidence ያዘምናል
export async function updateQAConfidence(userMessage, wasCorrect) {
  const res = await query(`
    SELECT id, times_used, times_correct FROM qa_pairs
    WHERE user_message = $1
  `, [userMessage]);

  if (res.rows.length > 0) {
    const row = res.rows[0];
    const newCorrect = row.times_correct + (wasCorrect ? 1 : 0);
    const newUsed = row.times_used + 1;
    const newConfidence = newCorrect / newUsed;

    await query(`
      UPDATE qa_pairs
      SET times_used = $1, times_correct = $2, confidence = $3, updated_at = NOW()
      WHERE id = $4
    `, [newUsed, newCorrect, newConfidence, row.id]);
  }
}

// ተመሳሳይ question ፈልግ
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

// Best Q&A pairs ያወጣል — Groq ለማስተማር
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

export async function saveLastBoardMessageId(messageId) {
  await query(`
    UPDATE bot_state SET last_board_message_id = $1 WHERE id = 1
  `, [messageId]);
}

export async function getLastBoardMessageId() {
  const res = await query(`SELECT last_board_message_id FROM bot_state WHERE id = 1`);
  return res.rows[0]?.last_board_message_id || null;
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

// ===== BOARD SNAPSHOTS =====
export async function getBoardState() {
  const res = await query(`
    SELECT * FROM board_snapshots ORDER BY updated_at DESC LIMIT 1
  `);
  if (!res.rows[0]) return null;
  return {
    slots: res.rows[0].slots || {},
    rawText: res.rows[0].raw_text,
    context: res.rows[0].context,
    updatedAt: res.rows[0].updated_at,
  };
}

export async function updateBoardState(parsed) {
  const existing = await query(`SELECT id FROM board_snapshots LIMIT 1`);

  if (existing.rows.length > 0) {
    await query(`
      UPDATE board_snapshots
      SET slots = $1, raw_text = $2, context = $3, updated_at = NOW()
      WHERE id = $4
    `, [
      JSON.stringify(parsed.slots || {}),
      parsed.raw || null,
      parsed.context || null,
      existing.rows[0].id,
    ]);
  } else {
    await query(`
      INSERT INTO board_snapshots (slots, raw_text, context)
      VALUES ($1, $2, $3)
    `, [
      JSON.stringify(parsed.slots || {}),
      parsed.raw || null,
      parsed.context || null,
    ]);
  }
}

export { query };
