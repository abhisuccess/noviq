const { Redis } = require('@upstash/redis');
const crypto = require('node:crypto');

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
});

const PROMPT_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const EFFORT_SETTINGS = {
  standard: { maxOutputTokens: 2048, temperature: 0.7 },
  medium: { maxOutputTokens: 4096, temperature: 0.6 },
  high: { maxOutputTokens: 8192, temperature: 0.5 },
  max: { maxOutputTokens: 16384, temperature: 0.4 }
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

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getDeviceId(req) {
  const deviceId = req.headers['x-device-id'];
  const forwardedIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
  return String(deviceId || forwardedIp || 'unknown').split(',')[0].trim();
}

function quotaResponse(count, resetAt) {
  return {
    used: count,
    limit: PROMPT_LIMIT,
    remaining: Math.max(PROMPT_LIMIT - count, 0),
    reset_at: new Date(resetAt).toISOString()
  };
}

async function consumePrompt(deviceId) {
  const now = Date.now();
  const key = `noviq:usage:${hash(deviceId)}`;
  const previous = (await kv.get(key)) || [];
  const timestamps = previous.filter((timestamp) => now - timestamp < DAY_MS);

  if (timestamps.length >= PROMPT_LIMIT) {
    return {
      allowed: false,
      count: timestamps.length,
      resetAt: Math.min(...timestamps) + DAY_MS
    };
  }

  timestamps.push(now);
  await kv.set(key, timestamps, { ex: 60 * 60 * 25 });
  return { allowed: true, count: timestamps.length, resetAt: now + DAY_MS };
}

async function readHistory(deviceId, sessionId) {
  return (await kv.get(`noviq:history:${hash(`${deviceId}:${sessionId}`)}`)) || [];
}

async function writeHistory(deviceId, sessionId, history) {
  await kv.set(`noviq:history:${hash(`${deviceId}:${sessionId}`)}`, history, { ex: 60 * 60 * 24 * 30 });
}

async function deleteHistory(deviceId, sessionId) {
  await kv.del(`noviq:history:${hash(`${deviceId}:${sessionId}`)}`);
}

module.exports = {
  kv,
  json,
  getDeviceId,
  consumePrompt,
  quotaResponse,
  readHistory,
  writeHistory,
  deleteHistory,
  EFFORT_SETTINGS,
  NOVIQ_SYSTEM_INSTRUCTION,
  DEVELOPER_QUESTION,
  MODEL_QUESTION
};
