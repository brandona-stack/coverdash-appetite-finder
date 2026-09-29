import pandas as pd, numpy as np, json, itertools
q=pd.read_csv('data/quotes.csv', low_memory=False)
p=pd.read_excel('data/policies.xlsx')
BAD={'NOT_SELECTED'}
q=q[q['Policy Type'].notna() & ~q['Policy Type'].isin(BAD) & q.State.notna() & q.Industry.notna() & q.Carrier.notna()].copy()
p=p[p['Policy Type'].notna() & p.State.notna() & p.Industry.notna() & p.Carrier.notna()].copy()
p=p[~p.Status.isin(['MANUAL_BIND_REQUIRED','MANUAL_ACTION_REQUIRED'])]
q['biz']=q['Business Name'].astype(str).str.strip().str.upper()
p['biz']=p['Business Name'].astype(str).str.strip().str.upper()
q['ts']=pd.to_datetime(q['Quoted At'].str[:19])
RANK={'BOUND':5,'SELECTED':4,'READY':3,'MANUAL':3,'REFERRED':2,'REJECTED':1,'NOT ELIGIBLE':1}
q['rank']=q['Quote Status'].map(RANK)
K=['Policy Type','State','Industry','Carrier']
# one row per business per key: best outcome, latest date, median priced premium
g=q.groupby(K+['biz'])
bq=g.agg(rank=('rank','max'),last=('ts','max')).reset_index()
priced=q[(q['rank']>=3)&(q['Gross Premium']>0)]
pp=priced.groupby(K+['biz'])['Gross Premium'].min().rename('qprem').reset_index()
bq=bq.merge(pp,how='left',on=K+['biz'])
bound=p.groupby(K+['biz']).agg(bprem=('Premium','sum'),canc=('Status',lambda s: s.isin(['CANCELLED','PENDING_CANCEL']).any())).reset_index()
bq=bq.merge(bound[K+['biz']].assign(isb=1),how='left',on=K+['biz'])
bq['isb']=bq.isb.fillna(0)
uw_q=q[q['rank']>=3].groupby(K)['UW Carrier'].agg(lambda s: s.value_counts().index[:3].tolist())
uw_p=p.groupby(K)['UW Carrier'].agg(lambda s: s.value_counts().index[:3].tolist())

def pct(a,x):
    a=np.asarray(a); a=a[~np.isnan(a)]; a=a[a>0]
    return round(float(np.percentile(a,x))) if len(a) else None
out={}
def build(level_cols):
    rows=[]
    bqx=bq.copy(); bx=bound.copy()
    for c in ['State','Industry']:
        if c not in level_cols: bqx[c]='*'; bx[c]='*'
    GK=['Policy Type','State','Industry','Carrier']
    # combo totals (distinct businesses across carriers)
    tot_q=bqx.groupby(GK[:3]).agg(subs=('biz','nunique'))
    pb=bqx[bqx['rank']>=3].groupby(GK[:3])['biz'].nunique().rename('pricedBiz')
    bb=bx.groupby(GK[:3])['biz'].nunique().rename('boundBiz')
    tot=tot_q.join(pb).join(bb).fillna(0).astype(int)
    tot['med']=bx[bx.bprem>0].groupby(GK[:3])['bprem'].median()
    a=bqx.groupby(GK).agg(subs=('biz','nunique'),
        priced=('rank',lambda r:(r>=3).sum()),refer=('rank',lambda r:(r==2).sum()),
        decl=('rank',lambda r:(r==1).sum()),boundQ=('isb','sum'),last=('last','max'))
    bc=bx.groupby(GK).agg(bound=('biz','nunique'),canc=('canc','sum'))
    a=a.join(bc,how='outer').fillna({'subs':0,'priced':0,'refer':0,'decl':0,'boundQ':0,'bound':0,'canc':0})
    # premiums
    bpr=bx.groupby(GK)['bprem'].apply(list); qpr=bqx.groupby(GK)['qprem'].apply(list)
    for key,r in a.iterrows():
        bl=bpr.get(key,[]); ql=qpr.get(key,[])
        rows.append(dict(k=key, subs=int(r.subs),priced=int(r.priced),refer=int(r.refer),decl=int(r.decl),
            boundQ=int(r.boundQ),bound=int(r.bound),canc=int(r.canc),
            last=r['last'].strftime('%Y-%m-%d') if pd.notna(r['last']) else None,
            bp=[pct(bl,25),pct(bl,50),pct(bl,75)] if len(bl) else None,
            qp=[pct(ql,25),pct(ql,50),pct(ql,75)] if len(ql) else None))
    return rows,tot
allrows=[];tots={}
uw={}
for lv in [['State','Industry'],['State'],['Industry'],[]]:
    rows,tot=build(lv); allrows+=rows
    for kk,t in tot.iterrows(): tots['|'.join(kk)]=[int(t.subs),int(t.pricedBiz),int(t.boundBiz),None if pd.isna(t.med) else round(float(t.med))]
# UW carriers only at full level + aggregated by carrier/type (small)
uwc={}
for c,s in pd.concat([p[['Carrier','UW Carrier']],q[q['rank']>=3][['Carrier','UW Carrier']]]).groupby('Carrier')['UW Carrier']:
    vc=s.value_counts(); 
    if len(vc)>1 or (len(vc)==1 and vc.index[0]!=c): uwc[c]=vc.index[:4].tolist()
# per-row UW carriers (bound first, then priced), only where it adds info
import re
def norm(x): return re.sub(r'[^a-z]','',str(x).lower())[:6]
uwsrc=pd.concat([p[K+['UW Carrier']].assign(w=3),q[q['rank']>=3][K+['UW Carrier']].assign(w=1)])
uwsrc=uwsrc[uwsrc['UW Carrier'].notna()]
uwmap={}
for lv in [['State','Industry'],['State'],['Industry'],[]]:
    t=uwsrc.copy()
    for c in ['State','Industry']:
        if c not in lv: t[c]='*'
    for key,grp in t.groupby(K):
        sc=grp.groupby('UW Carrier').w.sum().sort_values(ascending=False)
        names=[n for n in sc.index if norm(n)!=norm(key[3])]
        seen=set();keep=[]
        for n in names:
            if norm(n) in seen: continue
            seen.add(norm(n)); keep.append(n)
        if keep: uwmap[key]=keep[:3]
# pack
combos={}
for r in allrows:
    pt,st,ind,car=r['k']; key=f'{pt}|{st}|{ind}'
    combos.setdefault(key,[]).append([car,r['subs'],r['priced'],r['refer'],r['decl'],r['boundQ'],r['bound'],r['canc'],r['last'],r['bp'],r['qp'],uwmap.get(r['k'])])
meta=dict(policyTypes=sorted(set(q['Policy Type'])|set(p['Policy Type'])),states=sorted(set(q.State)|set(p.State)),
    industries=sorted(set(q.Industry)|set(p.Industry)),
    range=[q.ts.min().strftime('%Y-%m-%d'),q.ts.max().strftime('%Y-%m-%d')],
    nQuotes=int(len(q)),nPolicies=int(len(p)))
# popularity counts for sorting dropdowns
meta['ptCounts']=q.groupby('Policy Type').biz.nunique().to_dict()
json.dump(dict(meta=meta,totals=tots,combos=combos),open('public/appetite-data.json','w'),separators=(',',':'),default=str)
print(len(combos), sum(len(v) for v in combos.values()))
