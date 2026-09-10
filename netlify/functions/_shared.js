const crypto = require('node:crypto');
const { getStore } = require('@netlify/blobs');

const store = getStore('noviq-ai');
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

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getDeviceId(event) {
  const headers = event.headers || {};
  const deviceId = headers['x-device-id'] || headers['X-Device-ID'];
  const forwardedIp = headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'];
  return String(deviceId || forwardedIp || 'unknown').split(',')[0].trim();
}

async function readJson(key, fallback) {
  return (await store.get(key, { type: 'json' })) ?? fallback;
}

async function consumePrompt(deviceId) {
  const now = Date.now();
  const key = `usage-${hash(deviceId)}`;
  const previous = await readJson(key, []);
  const timestamps = previous.filter((timestamp) => now - timestamp < DAY_MS);

  if (timestamps.length >= PROMPT_LIMIT) {
    return {
      allowed: false,
      count: timestamps.length,
      resetAt: Math.min(...timestamps) + DAY_MS
    };
  }

  timestamps.push(now);
  await store.setJSON(key, timestamps);
  return { allowed: true, count: timestamps.length, resetAt: now + DAY_MS };
}

function quotaResponse(count, resetAt) {
  return {
    used: count,
    limit: PROMPT_LIMIT,
    remaining: Math.max(PROMPT_LIMIT - count, 0),
    reset_at: new Date(resetAt).toISOString()
  };
}

module.exports = {
  store,
  hash,
  getDeviceId,
  readJson,
  consumePrompt,
  quotaResponse,
  json,
  EFFORT_SETTINGS,
  NOVIQ_SYSTEM_INSTRUCTION,
  DEVELOPER_QUESTION,
  MODEL_QUESTION
};
