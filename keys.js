// ===== KEY ROTATION =====
function loadKeys(prefix) {
  const keys = [];
  let i = 1;
  while (process.env[`${prefix}_${i}`] && i <= 50) {
    keys.push(process.env[`${prefix}_${i}`]);
    i++;
  }
  return keys;
}

const DEEPSEEK_KEYS = loadKeys('DEEPSEEK_KEY');
const GROQ_KEYS = loadKeys('GROQ_KEY');
let deepseekIndex = 0;
let groqIndex = 0;

export function getNextDeepSeekKey() {
  if (DEEPSEEK_KEYS.length === 0) throw new Error('No DeepSeek API keys found in .env');
  const key = DEEPSEEK_KEYS[deepseekIndex];
  deepseekIndex = (deepseekIndex + 1) % DEEPSEEK_KEYS.length;
  return key;
}

export function getNextGroqKey() {
  if (GROQ_KEYS.length === 0) throw new Error('No Groq API keys found in .env');
  const key = GROQ_KEYS[groqIndex];
  groqIndex = (groqIndex + 1) % GROQ_KEYS.length;
  return key;
}

export function rotateDeepSeekKey() {
  deepseekIndex = (deepseekIndex + 1) % DEEPSEEK_KEYS.length;
  return DEEPSEEK_KEYS[deepseekIndex];
}

export function rotateGroqKey() {
  groqIndex = (groqIndex + 1) % GROQ_KEYS.length;
  return GROQ_KEYS[groqIndex];
}

export function getKeyStats() {
  return {
    deepseek: { total: DEEPSEEK_KEYS.length, currentIndex: deepseekIndex },
    groq:     { total: GROQ_KEYS.length, currentIndex: groqIndex },
  };
}

