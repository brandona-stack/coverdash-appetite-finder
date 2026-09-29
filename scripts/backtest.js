// Hold out real quotes, predict each one's premium from the rest, and report accuracy.
// Usage: node scripts/backtest.js [n]
const E = require('../public/engine.js');
const D = E.prepare(require('../public/appetite-data.json'));
const N = +process.argv[2] || 600;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const idx = [];
for (let i = 0; i < D.Q.length; i++) { const r = D.Q[i]; if (r[7] > 0 && (r[5] > 0 || r[6] > 0)) idx.push(i); }
const sample = []; while (sample.length < N) sample.push(idx[Math.floor(rnd() * idx.length)]);
function run(label) {
  const errs = []; let inIQR = 0, within50 = 0, got = 0; const byPt = {};
  for (const i of sample) {
    const r = D.Q[i];
    const est = E.indicate(D, { pt: D.pts[r[0]], st: D.states[r[1]], code: D.code[r[2]], rev: r[5], pay: r[6], skip: i }).get(r[3]);
    if (!est) continue; got++;
    const e = est.mid / r[7]; errs.push(Math.abs(Math.log(e)));
    if (r[7] >= est.lo && r[7] <= est.hi) inIQR++;
    if (e >= 2/3 && e <= 1.5) within50++;
    const k = D.pts[r[0]]; (byPt[k] = byPt[k] || []).push(e >= 2/3 && e <= 1.5 ? 1 : 0);
  }
  errs.sort((a, b) => a - b);
  console.log(label, `covered ${got}/${N}`, `median error ${Math.round((Math.exp(errs[errs.length >> 1]) - 1) * 100)}%`,
    `within ±50%: ${Math.round(within50 / got * 100)}%`, `actual inside shown range: ${Math.round(inIQR / got * 100)}%`);
  return byPt;
}
if (process.argv[3] === 'tune') {
  for (const el of [0, 0.3, 0.5, 0.7, 0.9]) { E.T.ELASTICITY = el; run('elasticity ' + el); }
  E.T.ELASTICITY = 0.5;
  for (const w of [[0.5, 2], [0.4, 2.5], [0.25, 4]]) { E.T.WINDOW = w; run('window ' + w); }
} else {
  const by = run('current');
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length).slice(0, 8))
    console.log('  ', k, v.length, Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) + '% within ±50%');
}
