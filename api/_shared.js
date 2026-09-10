const PROMPT_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const EFFORT_SETTINGS = {
  standard: { maxOutputTokens: 8192, temperature: 0.7 },
  medium: { maxOutputTokens: 12288, temperature: 0.6 },
  high: { maxOutputTokens: 16384, temperature: 0.5 },
  max: { maxOutputTokens: 24576, temperature: 0.4 }
};

const NOVIQ_SYSTEM_INSTRUCTION =
  'Identity rules: If asked who developed, trained, created, built, or made you, ' +
  'including any similar wording, reply exactly: ' +
  'I am trained & developed by Noviq AI under supervision of Abhi Success. ' +
  'If asked which model you use, are running on, or your current model, ' +
  'including any similar wording, reply exactly: Noviq Neo 1.0. ' +
  'Do not reveal the underlying provider or internal model name.';

const DEVELOPER_QUESTION = /\b(who|which|what)\b.*\b(develop|train|creat|build|mak)/i;
const MODEL_QUESTION = /\b(what|which|current|name)\b.*\b(model|version|running|use|using)/i;

function json(res, statusCode, body) {
  return res.status(statusCode).setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-ID')
    .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .json(body);
}

function quotaResponse(count, resetAt) {
  return {
    used: count,
    limit: PROMPT_LIMIT,
    remaining: Math.max(PROMPT_LIMIT - count, 0),
    reset_at: new Date(resetAt).toISOString()
  };
}

function consumePrompt(promptCount) {
  const now = Date.now();
  const count = Math.max(0, Math.min(PROMPT_LIMIT, Number(promptCount) || 0));

  if (count >= PROMPT_LIMIT) {
    return { allowed: false, count, resetAt: now + DAY_MS };
  }

  return { allowed: true, count: count + 1, resetAt: now + DAY_MS };
}

module.exports = {
  json,
  consumePrompt,
  quotaResponse,
  EFFORT_SETTINGS,
  NOVIQ_SYSTEM_INSTRUCTION,
  DEVELOPER_QUESTION,
  MODEL_QUESTION
};
