// Appetite + indication engine. Runs in the browser and in Node (for backtesting).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(this, function () {
  // ---- Carrier rules for subcontracted work -------------------------------
  // Above STANDARD_MAX_SUB %, standard carriers are excluded.
  // Coterie is the one standard carrier that will consider up to COTERIE_MAX_SUB %.
  const RULES = {
    STANDARD_CARRIERS: ['The Hartford', 'Chubb', 'Acuity', 'Travelers', 'Hiscox', 'CNA', 'biBerk by Berkshire Hathaway',
      'Nationwide', 'Employers', 'Guard', 'Hanover Insurance', 'Amtrust', 'Three by Berkshire Hathaway', 'Markel',
      'Great American Insurance Group', 'Coterie'],
    STANDARD_MAX_SUB: 25,
    EXCEPTIONS: { 'Coterie': 50 },
  };

  // ---- Tuning ---------------------------------------------------------------
  const T = {
    WINDOW: [0.5, 2],     // comparable quotes must be within this multiple of the entered exposure
    ELASTICITY: 0.4,      // premium moves ~ exposure^ELASTICITY inside the window (fit by backtest)
    MIN_COMPS: 5,         // comparables needed before we stop broadening
    MAX_COMPS: 25,        // nearest comparables used
    STATE_FIRST: true,    // Workers' Comp: stay in-state and broaden the class before going national
    ELASTICITY_WC: 0.6,   // Workers' Comp elasticity override
  };

  // Record layouts (from build_data.py)
  // Q: [pt, st, naicsIdx, carrier, rank, rev, pay, prem, bound, day]
  // P: [pt, st, naicsIdx, carrier, prem, rev, pay]

  function prepare(D) {
    D.ptIx = Object.fromEntries(D.pts.map((v, i) => [v, i]));
    D.stIx = Object.fromEntries(D.states.map((v, i) => [v, i]));
    D.code = D.naics.map(n => n[0]);
    D.WC = D.ptIx['WORKERS_COMP'];
    return D;
  }

  const prefixOk = (D, idx, prefix) => !prefix || D.code[idx].startsWith(prefix);

  function maxSubFor(carrier) {
    if (carrier in RULES.EXCEPTIONS) return RULES.EXCEPTIONS[carrier];
    if (RULES.STANDARD_CARRIERS.includes(carrier)) return RULES.STANDARD_MAX_SUB;
    return Infinity;
  }

  // Appetite stats for one search. prefix = NAICS prefix ('' = all classes). st = state or '*'.
  function appetite(D, { pt, st, prefix }) {
    const p = D.ptIx[pt], s = st === '*' ? -1 : D.stIx[st];
    const by = new Map();
    const get = c => { if (!by.has(c)) by.set(c, { c, subs: 0, priced: 0, refer: 0, decl: 0, boundQ: 0, bound: 0, last: -1, bprem: [], qprem: [] }); return by.get(c); };
    const biz = { subs: 0 };
    for (const r of D.Q) {
      if (r[0] !== p || (s >= 0 && r[1] !== s) || !prefixOk(D, r[2], prefix)) continue;
      const a = get(r[3]);
      a.subs++; biz.subs++;
      if (r[4] >= 3) a.priced++; else if (r[4] === 2) a.refer++; else if (r[4] === 1) a.decl++;
      if (r[8]) a.boundQ++;
      if (r[9] > a.last) a.last = r[9];
      if (r[7] > 0) a.qprem.push(r[7]);
    }
    let boundAll = 0; const bp = [];
    for (const r of D.P) {
      if (r[0] !== p || (s >= 0 && r[1] !== s) || !prefixOk(D, r[2], prefix)) continue;
      const a = get(r[3]); a.bound++; boundAll++;
      if (r[4] > 0) { a.bprem.push(r[4]); bp.push(r[4]); }
    }
    return { rows: [...by.values()], subs: biz.subs, bound: boundAll, boundMed: quant(bp, .5) };
  }

  // Search levels from most specific to broadest.
  function levels(code, st, stateFirst) {
    const out = [];
    if (stateFirst && st !== '*' && code) {
      for (const L of [6, 4, 3, 2]) if (code.length >= L) out.push({ prefix: code.slice(0, L), st, L });
      for (const L of [6, 4, 3, 2]) if (code.length >= L) out.push({ prefix: code.slice(0, L), st: '*', L });
      return out;
    }
    for (const L of [6, 4, 3, 2]) {
      if (!code || code.length < L) continue;
      if (st !== '*') out.push({ prefix: code.slice(0, L), st, L });
      out.push({ prefix: code.slice(0, L), st: '*', L });
    }
    if (!code) { if (st !== '*') out.push({ prefix: '', st, L: 0 }); out.push({ prefix: '', st: '*', L: 0 }); }
    return out;
  }

  // Indication for every carrier (and the market overall).
  // opts: {pt, st, code, rev, pay, exclude:Set(recordIndex)} ; returns Map carrierIdx -> estimate, plus 'all'
  function indicate(D, { pt, st, code, rev, pay, skip }) {
    const p = D.ptIx[pt];
    const useRev = !(p === D.WC && pay > 0) && rev > 0;
    const X = useRev ? rev : pay;
    const col = useRev ? 5 : 6;
    const isWC = p === D.WC;
    const lv = levels(code, st, isWC && T.STATE_FIRST);
    const EL = isWC && T.ELASTICITY_WC != null ? T.ELASTICITY_WC : T.ELASTICITY;
    // Collect priced records for this policy type once, bucketed per carrier
    const pool = new Map(); pool.set('all', []);
    for (let i = 0; i < D.Q.length; i++) {
      const r = D.Q[i];
      if (r[0] !== p || r[7] <= 0 || (skip !== undefined && i === skip)) continue;
      if (!pool.has(r[3])) pool.set(r[3], []);
      pool.get(r[3]).push(r); pool.get('all').push(r);
    }
    const res = new Map();
    for (const [car, recs] of pool) {
      let found = null, fallback = null;
      for (const l of lv) {
        const s = l.st === '*' ? -1 : D.stIx[l.st];
        const inLevel = recs.filter(r => (s < 0 || r[1] === s) && prefixOk(D, r[2], l.prefix));
        if (!inLevel.length) continue;
        let comps;
        if (X > 0) {
          comps = inLevel.filter(r => r[col] > 0).map(r => ({ r, ratio: X / r[col] }))
            .filter(o => o.ratio >= T.WINDOW[0] && o.ratio <= T.WINDOW[1])
            .sort((a, b) => Math.abs(Math.log(a.ratio)) - Math.abs(Math.log(b.ratio)))
            .slice(0, T.MAX_COMPS)
            .map(o => o.r[7] * Math.pow(o.ratio, EL));
        } else {
          comps = inLevel.map(r => r[7]);
        }
        const exp = inLevel.filter(r => r[col] > 0).map(r => r[col]);
        const cand = { comps, level: l, n: comps.length, maxExp: exp.length ? Math.max(...exp) : 0, minExp: exp.length ? Math.min(...exp) : 0 };
        if (comps.length >= T.MIN_COMPS) { found = cand; break; }
        if (comps.length && (!fallback || comps.length > fallback.n)) fallback = cand;
      }
      const pick = found || (fallback && fallback.n >= 2 ? fallback : null);
      if (!pick) continue;
      res.set(car, { lo: quant(pick.comps, .25), mid: quant(pick.comps, .5), hi: quant(pick.comps, .75), n: pick.n,
        level: pick.level, thin: !found, basis: useRev ? 'revenue' : 'payroll', maxExp: pick.maxExp, minExp: pick.minExp });
    }
    return res;
  }

  function quant(a, q) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return Math.round(s[lo] + (s[hi] - s[lo]) * (pos - lo));
  }

  return { RULES, prepare, appetite, indicate, maxSubFor, levels, quant, T };
});
