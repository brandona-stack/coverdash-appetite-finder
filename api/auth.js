// POST /api/auth  (header x-passcode) -> { ok: true } if the passcode matches RULES_PASSCODE
const { passcodeOk, send, wrap } = require('./_store');
module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!process.env.RULES_PASSCODE) return send(res, 503, { error: 'RULES_PASSCODE is not set in Vercel.' });
  if (!passcodeOk(req)) { await new Promise(r => setTimeout(r, 600)); return send(res, 401, { error: 'Wrong passcode' }); }
  send(res, 200, { ok: true });
});
