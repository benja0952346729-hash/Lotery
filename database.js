import pg from 'pg';

const { Pool } = pg;

// ===== LOAD UP TO 10 NEON DB CONNECTIONS =====
function loadPools() {
  const pools = [];
  let i = 1;
  while (process.env[`NEON_DB_${i}`] && i <= 10) {
    pools.push(new Pool({
      connectionString: process.env[`NEON_DB_${i}`],
      ssl: { rejectUnauthorized: false },
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

async function query(sql, params = [], retries = pools.length) {
  for (let i = 0; i < retries; i++) {
    try {
      const pool = getPool();
      const result = await pool.query(sql, params);
      return result;
    } catch (err) {
      console.error(`[DB] Query failed on DB #${currentPoolIndex + 1}:`, err.message);
      rotatePool();
    }
  }
  throw new Error('All Neon DBs failed');
}

// ===== INIT TABLES =====
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
      toggled_by BIGINT
    )
  `);

  // ===== TOKEN USAGE TABLE =====
  await query(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id SERIAL PRIMARY KEY,
      service TEXT NOT NULL UNIQUE,
      input_tokens BIGINT DEFAULT 0,
      output_tokens BIGINT DEFAULT 0,
      calls BIGINT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // UNIQUE constraint ካልተጨመረ ያክላል (bot restart ቢሆን error አይሰጥም)
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'token_usage_service_unique'
      ) THEN
        ALTER TABLE token_usage ADD CONSTRAINT token_usage_service_unique UNIQUE (service);
      END IF;
    END $$;
  `).catch(() => {});

  // nvidia-deepseek እና groq services ይጨምራል
  await query(`
    INSERT INTO token_usage (service, input_tokens, output_tokens, calls)
    VALUES ('nvidia-deepseek', 0, 0, 0), ('groq', 0, 0, 0)
    ON CONFLICT (service) DO NOTHING
  `);

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

  await query(`
    DELETE FROM history WHERE created_at < NOW() - INTERVAL '10 days'
  `);
}

export async function getHistory(days = 10) {
  const res = await query(`
    SELECT * FROM history
    WHERE created_at > NOW() - INTERVAL '${days} days'
    ORDER BY created_at DESC
    LIMIT 500
  `);
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
  await query(`
    INSERT INTO token_usage (service, input_tokens, output_tokens, calls)
    VALUES ($3, $1, $2, 1)
    ON CONFLICT (service) DO UPDATE
    SET input_tokens = token_usage.input_tokens + $1,
        output_tokens = token_usage.output_tokens + $2,
        calls = token_usage.calls + 1,
        updated_at = NOW()
  `, [inputTokens, outputTokens, service]);
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

export { query };
