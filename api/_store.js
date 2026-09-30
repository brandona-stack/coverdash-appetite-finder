// Shared helpers for the API routes.
// Storage: Upstash Redis over its REST API (added from Vercel > Storage > Upstash for Redis).
// Vercel sets either KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...cmd) {
  if (!URL_ || !TOKEN) { const e = new Error('storage_not_configured'); e.status = 503; throw e; }
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new Error(j.error || `redis_${r.status}`); e.status = 502; throw e; }
  return j.result;
}

// Passcode for the Rules tab. RULES_PASSCODE in Vercel overrides this default.
const PASSCODE = process.env.RULES_PASSCODE || 'mak0930';

function passcodeOk(req) {
  const got = String(req.headers['x-passcode'] || '');
  const a = crypto.createHash('sha256').update(PASSCODE).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

// Lockout: 10 wrong passcodes from one IP -> blocked for 15 minutes.
const MAX_TRIES = 10, WINDOW_S = 900;
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
async function checkPasscode(req) {
  const key = `lock:${ipOf(req)}`;
  const tries = +(await redis('GET', key).catch(() => 0)) || 0;
  if (tries >= MAX_TRIES) { const e = new Error('Too many wrong passcodes. Try again in 15 minutes.'); e.status = 429; e.expose = true; throw e; }
  if (passcodeOk(req)) return true;
  await redis('INCR', key).catch(() => {}); await redis('EXPIRE', key, WINDOW_S).catch(() => {});
  return false;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 100000) break; chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { send(res, e.status || 500, { error: e.message === 'storage_not_configured' ? 'Storage is not set up yet. Add Upstash for Redis in Vercel > Storage.' : e.expose ? e.message : 'Something went wrong. Try again.' }); }
  };
}

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

module.exports = { redis, passcodeOk, checkPasscode, readBody, send, wrap, clip };
