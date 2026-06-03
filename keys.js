// ===== KEY ROTATION =====
// keys.js — Optimized key management with separate pools

function loadKeys(prefix) {
  const keys = [];
  let i = 1;
  while (i <= 50 && process.env[`${prefix}_${i}`]) {
    keys.push(process.env[`${prefix}_${i}`]);
    i++;
  }
  return keys;
}

const DEEPSEEK_KEYS = loadKeys('DEEPSEEK_KEY');
const GROQ_KEYS = loadKeys('GROQ_KEY');

let deepseekResponseIndex = 0; // for keys 1-25 (response — الأولويات)
let deepseekLearningIndex = 0; // for keys 26-50 (learning — background processing)
let groqIndex = 0;

function slicePool(arr, start, end) {
  return (arr || []).slice(start, end).filter(Boolean);
}

const DEEPSEEK_RESPONSE_KEYS = slicePool(DEEPSEEK_KEYS, 0, 25);
const DEEPSEEK_LEARNING_KEYS = slicePool(DEEPSEEK_KEYS, 25, 50);

// ============================================================
// 🎯 RESPONSE KEYS (1-25) — User-facing responses (priority)
// ============================================================
export function getResponseDeepSeekKey() {
  if (DEEPSEEK_RESPONSE_KEYS.length > 0) {
    const key = DEEPSEEK_RESPONSE_KEYS[deepseekResponseIndex % DEEPSEEK_RESPONSE_KEYS.length];
    deepseekResponseIndex = (deepseekResponseIndex + 1) % DEEPSEEK_RESPONSE_KEYS.length;
    return key;
  }
  if (DEEPSEEK_KEYS.length > 0) {
    const key = DEEPSEEK_KEYS[deepseekResponseIndex % DEEPSEEK_KEYS.length];
    deepseekResponseIndex = (deepseekResponseIndex + 1) % DEEPSEEK_KEYS.length;
    return key;
  }
  throw new Error('No DeepSeek API keys found for response');
}

export function rotateResponseDeepSeekKey() {
  if (DEEPSEEK_RESPONSE_KEYS.length === 0 && DEEPSEEK_KEYS.length === 0) {
    throw new Error('No DeepSeek API keys found');
  }
  deepseekResponseIndex = (deepseekResponseIndex + 1) % (DEEPSEEK_RESPONSE_KEYS.length || DEEPSEEK_KEYS.length);
  return (DEEPSEEK_RESPONSE_KEYS[deepseekResponseIndex] || DEEPSEEK_KEYS[deepseekResponseIndex]);
}

// ============================================================
// 🧠 LEARNING KEYS (26-50) — Background learning (non-blocking)
// ============================================================
export function getLearningDeepSeekKey() {
  if (DEEPSEEK_LEARNING_KEYS.length > 0) {
    const key = DEEPSEEK_LEARNING_KEYS[deepseekLearningIndex % DEEPSEEK_LEARNING_KEYS.length];
    deepseekLearningIndex = (deepseekLearningIndex + 1) % DEEPSEEK_LEARNING_KEYS.length;
    return key;
  }
  if (DEEPSEEK_KEYS.length > 0) {
    const key = DEEPSEEK_KEYS[deepseekLearningIndex % DEEPSEEK_KEYS.length];
    deepseekLearningIndex = (deepseekLearningIndex + 1) % DEEPSEEK_KEYS.length;
    return key;
  }
  throw new Error('No DeepSeek API keys found for learning');
}

export function rotateLearningDeepSeekKey() {
  if (DEEPSEEK_LEARNING_KEYS.length === 0 && DEEPSEEK_KEYS.length === 0) {
    throw new Error('No DeepSeek API keys found');
  }
  deepseekLearningIndex = (deepseekLearningIndex + 1) % (DEEPSEEK_LEARNING_KEYS.length || DEEPSEEK_KEYS.length);
  return (DEEPSEEK_LEARNING_KEYS[deepseekLearningIndex] || DEEPSEEK_KEYS[deepseekLearningIndex]);
}

// ============================================================
// ⚡ GROQ KEYS — All requests (usually has quota)
// ============================================================
export function getNextGroqKey() {
  if (GROQ_KEYS.length === 0) {
    throw new Error('No Groq API keys found in .env');
  }
  const key = GROQ_KEYS[groqIndex];
  groqIndex = (groqIndex + 1) % GROQ_KEYS.length;
  return key;
}

// ============================================================
// 📊 STATS & MONITORING
// ============================================================
export function getKeyStats() {
  return {
    deepseek: {
      total: DEEPSEEK_KEYS.length,
      responsePool: DEEPSEEK_RESPONSE_KEYS.length,
      learningPool: DEEPSEEK_LEARNING_KEYS.length,
      responseIndex: deepseekResponseIndex,
      learningIndex: deepseekLearningIndex,
      responseKeysRemaining: DEEPSEEK_RESPONSE_KEYS.length - (deepseekResponseIndex % (DEEPSEEK_RESPONSE_KEYS.length || 1)),
      learningKeysRemaining: DEEPSEEK_LEARNING_KEYS.length - (deepseekLearningIndex % (DEEPSEEK_LEARNING_KEYS.length || 1)),
    },
    groq: {
      total: GROQ_KEYS.length,
      currentIndex: groqIndex,
      keysRemaining: GROQ_KEYS.length - (groqIndex % (GROQ_KEYS.length || 1)),
    },
  };
}

// ============================================================
// 🔄 RESET FOR TESTING (optional)
// ============================================================
export function resetKeyIndices() {
  deepseekResponseIndex = 0;
  deepseekLearningIndex = 0;
  groqIndex = 0;
  console.log('[Keys] Indices reset');
}
