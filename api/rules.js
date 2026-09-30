// GET  /api/rules                      -> anyone: { rules: [...] | null }  (null = never saved; built-in defaults apply)
// GET  /api/rules?admin=1  (passcode)   -> { rules, pending: [...], role }
// POST /api/rules {action:'propose', op, by} (editor or owner)
//        editor -> saved as a pending proposal; owner -> applied right away
//        op = {kind:'add', rule} | {kind:'edit', rule} | {kind:'delete', id} | {kind:'toggle', id, active}
// POST /api/rules {action:'approve'|'reject', id, by} (owner only)
const crypto = require('crypto');
const { redis, getRole, readBody, send, wrap, clip } = require('./_store');
const { DEFAULT_RULES } = require('../public/engine.js');
const KEY = 'rules:v1', HIST = 'rules:history:v1', PEND = 'rules:pending:v1';
const TYPES = ['exclude', 'sublimit', 'commission', 'note', 'prefer'];

function clean(r) {
  if (!r || typeof r !== 'object') return null;
  const arr = (v, n, m) => (Array.isArray(v) ? v : []).map(x => clip(x, m).trim()).filter(Boolean).slice(0, n);
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  if (!TYPES.includes(r.type)) return null;
  const carriers = arr(r.carriers, 60, 80);
  if (!carriers.length) return null;
  return {
    id: clip(r.id, 40) || crypto.randomBytes(5).toString('hex'),
    type: r.type, carriers, active: r.active !== false,
    pts: arr(r.pts, 40, 60), states: arr(r.states, 60, 4), naics: arr(r.naics, 40, 6).filter(x => /^\d{2,6}$/.test(x)),
    subOver: num(r.subOver), revOver: num(r.revOver), revUnder: num(r.revUnder),
    value: num(r.value), note: clip(r.note, 300).trim(),
    by: clip(r.by, 80), at: clip(r.at, 40),
  };
}
async function live() { const raw = await redis('GET', KEY); return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_RULES)); }
async function saveLive(rules, by, note) {
  const prev = await redis('GET', KEY);
  await redis('SET', KEY, JSON.stringify(rules));
  if (prev) { await redis('LPUSH', HIST, JSON.stringify({ at: new Date().toISOString(), by, note, rules: JSON.parse(prev) })); await redis('LTRIM', HIST, 0, 49); }
}
function cleanOp(op) {
  if (!op || typeof op !== 'object') return null;
  if (op.kind === 'add' || op.kind === 'edit') { const rule = clean(op.rule); return rule ? { kind: op.kind, rule } : null; }
  if (op.kind === 'delete') return op.id ? { kind: 'delete', id: clip(op.id, 40) } : null;
  if (op.kind === 'toggle') return op.id ? { kind: 'toggle', id: clip(op.id, 40), active: !!op.active } : null;
  return null;
}
function applyOp(rules, op) {
  const i = op.rule ? rules.findIndex(r => r.id === op.rule.id) : rules.findIndex(r => r.id === op.id);
  if (op.kind === 'add') { if (i >= 0) op.rule.id = crypto.randomBytes(5).toString('hex'); rules.push(op.rule); }
  else if (op.kind === 'edit') { if (i >= 0) rules[i] = op.rule; else rules.push(op.rule); }
  else if (op.kind === 'delete') { if (i >= 0) rules.splice(i, 1); }
  else if (op.kind === 'toggle') { if (i >= 0) rules[i].active = op.active; }
  return rules;
}
async function pendingList() {
  const raw = await redis('HVALS', PEND) || [];
  return raw.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean).sort((a, b) => a.at.localeCompare(b.at));
}

module.exports = wrap(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && !url.searchParams.get('admin')) {
    const raw = await redis('GET', KEY).catch(e => { if (e.status === 503) return null; throw e; });
    return send(res, 200, { rules: raw ? JSON.parse(raw) : null });
  }
  const role = await getRole(req);
  if (!role) return send(res, 401, { error: 'Passcode required' });
  if (req.method === 'GET') return send(res, 200, { rules: await live(), pending: await pendingList(), role });
  if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST only' });
  const b = await readBody(req);
  const by = clip(b.by, 80) || (role === 'owner' ? 'Owner' : 'Editor');

  if (b.action === 'propose') {
    const op = cleanOp(b.op);
    if (!op) return send(res, 400, { error: 'That rule is missing a type or carrier.' });
    const rules = await live();
    const before = op.kind === 'add' ? null : (rules.find(r => r.id === (op.rule ? op.rule.id : op.id)) || null);
    if (op.rule) { op.rule.by = by; op.rule.at = new Date().toISOString(); }
    if (role === 'owner') {
      await saveLive(applyOp(rules, op), by, `direct ${op.kind}`);
      return send(res, 200, { ok: true, applied: true, rules: await live(), pending: await pendingList() });
    }
    const count = await redis('HLEN', PEND);
    if (count >= 200) return send(res, 507, { error: 'Too many changes waiting for approval.' });
    const p = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), by, op, before };
    await redis('HSET', PEND, p.id, JSON.stringify(p));
    return send(res, 200, { ok: true, applied: false, pending: await pendingList() });
  }

  if (b.action === 'approve' || b.action === 'reject') {
    if (role !== 'owner') return send(res, 403, { error: 'Only the owner can approve or reject changes.' });
    const raw = await redis('HGET', PEND, clip(b.id, 40));
    if (!raw) return send(res, 404, { error: 'That change was already handled.' });
    const p = JSON.parse(raw);
    if (b.action === 'approve') await saveLive(applyOp(await live(), p.op), by, `approved ${p.op.kind} from ${p.by}`);
    await redis('HDEL', PEND, p.id);
    return send(res, 200, { ok: true, rules: await live(), pending: await pendingList() });
  }
  send(res, 400, { error: 'Unknown action' });
});
