// Appetite + indication engine. Runs in the browser and in Node (for backtesting).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(this, function () {
  // ---- Built-in rules ---------------------------------------------------------
  // Used until someone saves rules from the Rules tab; after that the saved list replaces these.
  const STANDARD = ['The Hartford', 'Chubb', 'Acuity', 'Travelers', 'Hiscox', 'CNA', 'biBerk by Berkshire Hathaway',
    'Nationwide', 'Employers', 'Guard', 'Hanover Insurance', 'Amtrust', 'Three by Berkshire Hathaway', 'Markel',
    'Great American Insurance Group'];
  const DEFAULT_RULES = [
    { id: 'std-sub', type: 'sublimit', carriers: STANDARD, value: 25, note: 'Standard carriers: up to 25% sub', active: true, pts: [], states: [], naics: [] },
    { id: 'coterie-sub', type: 'sublimit', carriers: ['Coterie'], value: 50, note: 'Coterie considers up to 50% sub', active: true, pts: [], states: [], naics: [] },
  ];

  // Does a rule apply to this carrier and search?  ctx: {pt, st, code, rev, sub}
  function ruleMatches(r, carrier, ctx) {
    if (r.active === false) return false;
    if (!(r.carriers || []).some(c => c === '*' || c === carrier)) return false;
    if (r.pts && r.pts.length && !r.pts.includes(ctx.pt)) return false;
    if (r.states && r.states.length && !r.states.includes(ctx.st)) return false;
    if (r.naics && r.naics.length && !(ctx.code && r.naics.some(n => ctx.code.startsWith(n)))) return false;
    if (r.subOver != null && !(ctx.sub > r.subOver)) return false;
    if (r.revOver != null && !(ctx.rev > r.revOver)) return false;
    if (r.revUnder != null && !(ctx.rev > 0 && ctx.rev < r.revUnder)) return false;
    return true;
  }
  // More specific rules win: fewer carriers, then more conditions.
  const specificity = r => -((r.carriers || []).includes('*') ? 1e6 : (r.carriers || []).length) * 10 +
    ['pts', 'states', 'naics'].filter(k => r[k] && r[k].length).length + (r.subOver != null) + (r.revOver != null) + (r.revUnder != null);

  // Everything the rules say about one carrier for this search.
  function applyRules(rules, carrier, ctx) {
    const hit = (rules || DEFAULT_RULES).filter(r => ruleMatches(r, carrier, ctx));
    const best = type => hit.filter(r => r.type === type).sort((a, b) => specificity(b) - specificity(a))[0];
    const out = { lim: Infinity, comm: null, notes: [], prefer: false, exclude: null };
    const sl = best('sublimit'); if (sl && sl.value != null) out.lim = sl.value;
    const cm = best('commission'); if (cm && cm.value != null) out.comm = cm.value;
    const ex = hit.find(r => r.type === 'exclude'); if (ex) out.exclude = ex.note || 'Excluded by a rule';
    if (!out.exclude && ctx.sub > out.lim) out.exclude = `Allows up to ${out.lim}% sub`;
    for (const r of hit) {
      if (r.type === 'note' && r.note) out.notes.push(r.note);
      if (r.type === 'prefer') { out.prefer = true; if (r.note) out.notes.push(r.note); }
    }
    return out;
  }

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

  return { DEFAULT_RULES, STANDARD, applyRules, ruleMatches, prepare, appetite, indicate, levels, quant, T };
});
