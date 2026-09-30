// POST /api/auth  (header x-passcode) -> { ok: true } if the passcode is right
const { checkPasscode, send, wrap } = require('./_store');
module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!(await checkPasscode(req))) { await new Promise(r => setTimeout(r, 600)); return send(res, 401, { error: 'Wrong passcode' }); }
  send(res, 200, { ok: true });
});
