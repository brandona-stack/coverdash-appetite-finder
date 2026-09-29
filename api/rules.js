// GET /api/rules            -> anyone: { rules: [...] | null }  (null = never saved, site uses built-in defaults)
// PUT /api/rules (passcode) -> replace the full rules list: { rules: [...], by: 'name' }
const { redis, passcodeOk, readBody, send, wrap, clip } = require('./_store');
const KEY = 'rules:v1';
const HIST = 'rules:history:v1';
const TYPES = ['exclude', 'sublimit', 'commission', 'note', 'prefer'];

function clean(r) {
  const arr = (v, n, m) => (Array.isArray(v) ? v : []).map(x => clip(x, m).trim()).filter(Boolean).slice(0, n);
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  if (!TYPES.includes(r.type)) return null;
  const carriers = arr(r.carriers, 60, 80);
  if (!carriers.length) return null;
  return {
    id: clip(r.id, 40) || Math.random().toString(36).slice(2, 10),
    type: r.type, carriers, active: r.active !== false,
    pts: arr(r.pts, 40, 60), states: arr(r.states, 60, 4), naics: arr(r.naics, 40, 6).filter(x => /^\d{2,6}$/.test(x)),
    subOver: num(r.subOver), revOver: num(r.revOver), revUnder: num(r.revUnder),
    value: num(r.value), note: clip(r.note, 300).trim(),
    by: clip(r.by, 80), at: clip(r.at, 40),
  };
}

module.exports = wrap(async (req, res) => {
  if (req.method === 'GET') {
    const raw = await redis('GET', KEY).catch(e => { if (e.status === 503) return null; throw e; });
    return send(res, 200, { rules: raw ? JSON.parse(raw) : null });
  }
  if (req.method !== 'PUT') return send(res, 405, { error: 'GET or PUT only' });
  if (!passcodeOk(req)) return send(res, 401, { error: 'Passcode required' });
  const b = await readBody(req);
  if (!Array.isArray(b.rules)) return send(res, 400, { error: 'rules must be a list' });
  const rules = b.rules.slice(0, 500).map(clean).filter(Boolean);
  const prev = await redis('GET', KEY);
  await redis('SET', KEY, JSON.stringify(rules));
  if (prev) { await redis('LPUSH', HIST, JSON.stringify({ at: new Date().toISOString(), by: clip(b.by, 80), rules: JSON.parse(prev) })); await redis('LTRIM', HIST, 0, 49); }
  send(res, 200, { ok: true, rules });
});
