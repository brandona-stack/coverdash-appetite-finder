// POST /api/feedback              -> anyone: add feedback
// GET  /api/feedback  (passcode)  -> list feedback, newest first
// POST /api/feedback {action:'status', id, status} (passcode) -> mark new / done
// POST /api/feedback {action:'delete', id}          (passcode) -> delete
const crypto = require('crypto');
const { redis, getRole, readBody, send, wrap, clip } = require('./_store');
const KEY = 'feedback:v1';
const MAX = 2000;

module.exports = wrap(async (req, res) => {
  if (req.method === 'GET') {
    if (!(await getRole(req))) return send(res, 401, { error: 'Passcode required' });
    const raw = await redis('HVALS', KEY) || [];
    const items = raw.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at));
    return send(res, 200, { items });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST only' });
  const b = await readBody(req);

  if (b.action === 'status' || b.action === 'delete') {
    if (!(await getRole(req))) return send(res, 401, { error: 'Passcode required' });
    const id = clip(b.id, 40);
    if (b.action === 'delete') { await redis('HDEL', KEY, id); return send(res, 200, { ok: true }); }
    const cur = await redis('HGET', KEY, id);
    if (!cur) return send(res, 404, { error: 'Not found' });
    const item = JSON.parse(cur); item.status = b.status === 'done' ? 'done' : 'new';
    await redis('HSET', KEY, id, JSON.stringify(item));
    return send(res, 200, { ok: true });
  }

  const message = clip(b.message, 2000).trim();
  if (!message) return send(res, 400, { error: 'Please add a message.' });
  const count = await redis('HLEN', KEY);
  if (count >= MAX) return send(res, 507, { error: 'Feedback inbox is full. Ask an admin to clear old items.' });
  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    at: new Date().toISOString(),
    name: clip(b.name, 80).trim(),
    verdict: ['worked', 'didnt'].includes(b.verdict) ? b.verdict : '',
    topic: clip(b.topic, 40),
    message,
    search: b.search && typeof b.search === 'object' ? {
      pt: clip(b.search.pt, 60), st: clip(b.search.st, 4), code: clip(b.search.code, 6), cls: clip(b.search.cls, 120),
      rev: +b.search.rev || 0, pay: +b.search.pay || 0, sub: +b.search.sub || 0, link: clip(b.search.link, 300),
    } : null,
    status: 'new',
  };
  await redis('HSET', KEY, item.id, JSON.stringify(item));
  send(res, 200, { ok: true });
});
