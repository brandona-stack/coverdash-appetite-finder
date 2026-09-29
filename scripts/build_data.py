"""Rebuild public/appetite-data.json from the Close/Admin exports.

Put the exports at data/quotes.xlsx and data/policies.xlsx (data/ is gitignored), then run:
    python scripts/build_data.py
"""
import json, os
import pandas as pd, numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
q = pd.read_excel(os.path.join(ROOT, 'data/quotes.xlsx'))
p = pd.read_excel(os.path.join(ROOT, 'data/policies.xlsx'))
titles = json.load(open(os.path.join(ROOT, 'scripts/naics_titles.json')))

BAD = {'NOT_SELECTED'}
def clean(d):
    d = d[d['Policy Type'].notna() & ~d['Policy Type'].isin(BAD) & d.State.notna() & d.Carrier.notna() & d['NAICS Code'].notna()].copy()
    d['naics'] = d['NAICS Code'].astype(int).astype(str)
    d['biz'] = d['Business Name'].astype(str).str.strip().str.upper()
    d['rev'] = d['Business Revenue'].fillna(0).clip(lower=0)
    d['pay'] = d['Business Payroll'].fillna(0).clip(lower=0)
    return d
q = clean(q); p = clean(p)
RANK = {'BOUND': 5, 'SELECTED': 4, 'READY': 3, 'MANUAL': 3, 'REFERRED': 2, 'REJECTED': 1, 'NOT ELIGIBLE': 1}
q['rank'] = q['Quote Status'].map(RANK).fillna(0).astype(int)
q['ts'] = pd.to_datetime(q['Quoted At'].astype(str).str[:19])
start = q.ts.min().normalize()

# One record per business + carrier + policy type + state: best outcome, latest priced premium
q = q.sort_values('ts')
K = ['biz', 'Carrier', 'Policy Type', 'State']
best = q.groupby(K).agg(rank=('rank', 'max'), last=('ts', 'max'), naics=('naics', 'last'), rev=('rev', 'last'), pay=('pay', 'last')).reset_index()
priced = q[(q['rank'] >= 3) & (q['Gross Premium'] > 0)]
lastp = priced.groupby(K).agg(prem=('Gross Premium', 'last'), prev=('rev', 'last'), ppay=('pay', 'last')).reset_index()
best = best.merge(lastp, how='left', on=K)
# use exposure from the priced quote when there is one
best['rev'] = np.where(best.prem.notna(), best.prev, best.rev)
best['pay'] = np.where(best.prem.notna(), best.ppay, best.pay)
pb = p.groupby(K).agg(bprem=('Gross Premium', 'sum')).reset_index()
best = best.merge(pb[K].assign(b=1), how='left', on=K)
best['b'] = best.b.fillna(0).astype(int)

# dictionaries
pts = sorted(set(best['Policy Type']) | set(p['Policy Type']))
sts = sorted(set(best.State) | set(p.State))
cars = sorted(set(best.Carrier) | set(p.Carrier))
codes = sorted(set(best.naics) | set(p.naics))
ix = lambda lst: {v: i for i, v in enumerate(lst)}
PT, ST, CA, NC = ix(pts), ix(sts), ix(cars), ix(codes)

Q = np.column_stack([
    best['Policy Type'].map(PT), best.State.map(ST), best.naics.map(NC), best.Carrier.map(CA),
    best['rank'], best.rev.round(), best.pay.round(), best.prem.fillna(-1).round(), best.b,
    (best['last'].dt.normalize() - start).dt.days]).astype(np.int64).tolist()

# Bound policies (one per business + carrier + type + state)
pp = p.groupby(K).agg(naics=('naics', 'last'), prem=('Gross Premium', 'sum'), rev=('rev', 'last'), pay=('pay', 'last')).reset_index()
P = np.column_stack([pp['Policy Type'].map(PT), pp.State.map(ST), pp.naics.map(NC), pp.Carrier.map(CA),
    pp.prem.round(), pp.rev.round(), pp.pay.round()]).astype(np.int64).tolist()

# UW paper per carrier (for wholesalers / MGAs)
import re
norm = lambda x: re.sub(r'[^a-z]', '', str(x).lower())[:6]
uw = {}
src = pd.concat([p[['Carrier', 'UW Carrier']].assign(w=3), q[q['rank'] >= 3][['Carrier', 'UW Carrier']].assign(w=1)])
src = src[src['UW Carrier'].notna()]
for c, g in src.groupby('Carrier'):
    sc = g.groupby('UW Carrier').w.sum().sort_values(ascending=False)
    keep, seen = [], set()
    for n in sc.index:
        k = norm(n)
        if k == norm(c) or k in seen: continue
        seen.add(k); keep.append(str(n))
    if keep: uw[c] = keep[:3]

counts = best.groupby('naics').biz.nunique().to_dict()
def title(c):
    for L in (6, 5, 4, 3, 2):
        if c[:L] in titles: return titles[c[:L]]
    return c
naics = [[c, title(c), int(counts.get(c, 0))] for c in codes]
# every other 6-digit class (2017 + 2022) so AEs can pick a class we haven't quoted yet
naics += [[c, t, 0] for c, t in sorted(titles.items()) if len(c) == 6 and c not in NC]
groups = {}
for c in codes:
    for L in (2, 3, 4):
        k = c[:L]
        if k in titles: groups[k] = titles[k]
if '31' in groups or any(c.startswith(('31', '32', '33')) for c in codes): groups.setdefault('31', 'Manufacturing')
out = dict(
    meta=dict(start=start.strftime('%Y-%m-%d'), end=q.ts.max().strftime('%Y-%m-%d'),
              nQuotes=int(len(q)), nPolicies=int(len(p)),
              ptCounts=best.groupby('Policy Type').biz.nunique().to_dict()),
    pts=pts, states=sts, carriers=cars, naics=naics, groups=groups, uw=uw,
    Q=Q, P=P)
json.dump(out, open(os.path.join(ROOT, 'public/appetite-data.json'), 'w'), separators=(',', ':'))
print('quote records', len(Q), 'policy records', len(P), 'codes', len(codes))
