(function(){
const PT_LABELS={GENERAL_LIABILITY:"General Liability",BUSINESS_OWNERS_POLICY:"Business Owners (BOP)",PROFESSIONAL_LIABILITY:"Professional Liability",
WORKERS_COMP:"Workers' Comp",CYBER:"Cyber",UMBRELLA:"Umbrella",COMMERCIAL_AUTO:"Commercial Auto",COMMERCIAL_PROPERTY:"Commercial Property",
INLAND_MARINE:"Inland Marine",EXCESS_LIABILITY:"Excess Liability",TECH_EO:"Tech E&O",GARAGE:"Garage",DIRECTORS_AND_OFFICERS:"Directors & Officers (D&O)",
POLLUTION:"Pollution",BUILDERS_RISK:"Builders Risk",CRIME:"Crime",EMPLOYMENT_PRACTICES_LIABILITY:"Employment Practices (EPL)",LIQUOR_LIABILITY:"Liquor Liability",
SURETY_BOND:"Surety Bond",SPECIAL_EVENT_COVERAGE:"Special Event",MEDIA_LIABILITY:"Media Liability",ABUSE_MOLESTATION:"Abuse & Molestation",
GLOBAL_PACKAGE:"Global Package",OCEAN_MARINE:"Ocean Marine",PRODUCTS_LIABILITY:"Products Liability",
DIRECTORS_AND_OFFICERS_EMPLOYMENT_PRACTICES_LIABILITY:"D&O + EPL",AUTOMOBILE_PHYSICAL_DAMAGE:"Auto Physical Damage",MOTOR_TRUCK_CARGO:"Motor Truck Cargo",
WIND_HAIL:"Wind/Hail",NON_TRUCKING_LIABILITY:"Non-Trucking Liability"};
const STATES={AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",
FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",
SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",PR:"Puerto Rico"};
const $=id=>document.getElementById(id);
const ptLabel=k=>PT_LABELS[k]||k.toLowerCase().replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
const stLabel=k=>STATES[k]?`${STATES[k]} (${k})`:k;
const money=n=>n==null?"—":"$"+Math.round(n).toLocaleString();
const pct=x=>Math.round(x*100)+"%";
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let D=null, showAll=false;

fetch("appetite-data.json").then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(d=>{D=d;init()})
  .catch(()=>{$("summary").innerHTML='<div class="notice">Could not load appetite data. Refresh the page to try again.</div>'});

function opt(sel,items,allLabel){
  sel.innerHTML=`<option value="*">${allLabel}</option>`+items.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join("");
}
function fmtDate(s){const d=new Date(s+"T12:00:00");return d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}

function init(){
  const m=D.meta;
  $("dataRange").textContent=`${m.nQuotes.toLocaleString()} quotes and ${m.nPolicies.toLocaleString()} policies · ${fmtDate(m.range[0])} – ${fmtDate(m.range[1])}`;
  const pts=m.policyTypes.filter(p=>D.combos[`${p}|*|*`]).sort((a,b)=>(m.ptCounts[b]||0)-(m.ptCounts[a]||0));
  const ptSel=$("pt"); ptSel.innerHTML=pts.map(p=>`<option value="${p}">${esc(ptLabel(p))}</option>`).join("");
  opt($("st"),m.states.filter(s=>s.length===2).sort((a,b)=>stLabel(a).localeCompare(stLabel(b))).map(s=>[s,stLabel(s)]),"All states");
  opt($("ind"),m.industries.map(i=>[i,i]),"All industries");
  const h=decodeURIComponent(location.hash.slice(1)).split("|");
  if(h.length===3){ if(pts.includes(h[0]))ptSel.value=h[0]; setIf($("st"),h[1]); setIf($("ind"),h[2]); }
  ["pt","st","ind"].forEach(id=>$(id).addEventListener("change",()=>{showAll=false;render()}));
  $("onlyBound").addEventListener("change",render);
  window.addEventListener("hashchange",()=>{const h=decodeURIComponent(location.hash.slice(1)).split("|");if(h.length===3){ptSel.value=h[0];setIf($("st"),h[1]);setIf($("ind"),h[2]);render()}});
  render();
}
function setIf(sel,v){if([...sel.options].some(o=>o.value===v))sel.value=v}

function appetite(r){
  const [,subs,priced,refer,decl,,bound]=r;
  if(bound>=3)return["Proven","b-proven"];
  if(bound>=1)return["Has bound","b-bound"];
  if(subs>0 && priced/subs>=0.5)return["Quotes","b-quotes"];
  if(refer>=decl && refer>0)return["Refers","b-refers"];
  if(decl>0)return["Declines","b-declines"];
  return["Quotes","b-quotes"];
}
function strength(n){ if(n>=30)return["Strong",3]; if(n>=10)return["Moderate",2]; return["Thin",1]; }

function render(){
  if(!D)return;
  const pt=$("pt").value, st=$("st").value, ind=$("ind").value;
  const key=`${pt}|${st}|${ind}`;
  history.replaceState(null,"","#"+encodeURIComponent(key));
  const rows=(D.combos[key]||[]).slice();
  const tot=D.totals[key]||[0,0,0];
  const [subs,pricedBiz,boundBiz]=tot;
  const where=[st==="*"?"all states":(STATES[st]||st), ind==="*"?"all industries":ind].join(" · ");
  $("resultsTitle").textContent=`Carriers for ${ptLabel(pt)} · ${where}`;

  // Summary
  const wMed=tot[3]??null;
  const [sl,sn]=strength(subs);
  const topCar=rows.filter(r=>r[6]>0).sort((a,b)=>b[6]-a[6])[0];
  $("summary").innerHTML=subs||boundBiz?`
    <div class="stat"><div class="k">Businesses quoted</div><div class="v">${subs.toLocaleString()}</div>
      <div class="s strength"><span class="dots">${[1,2,3].map(i=>`<i class="${i<=sn?"on":""}"></i>`).join("")}</span>${sl} data</div></div>
    <div class="stat"><div class="k">Businesses bound</div><div class="v">${boundBiz.toLocaleString()}</div>
      <div class="s">${subs?pct(Math.min(boundBiz/subs,1))+" of those quoted":""}</div></div>
    <div class="stat"><div class="k">Typical bound premium</div><div class="v">${money(wMed)}</div><div class="s">median of all bound policies</div></div>
    <div class="stat"><div class="k">Most binds</div><div class="v" style="font-size:18px;line-height:1.35;padding-top:5px">${topCar?esc(topCar[0]):"—"}</div>
      <div class="s">${topCar?`${topCar[6]} of ${boundBiz} bound`:"nothing bound yet"}</div></div>`:"";

  // Notices / fallbacks
  const fb=[];
  if(st!=="*")fb.push(["See all states",`${pt}|*|${ind}`]);
  if(ind!=="*")fb.push(["See all industries",`${pt}|${st}|*`]);
  const btns=fb.map(([l,k])=>`<button data-k="${esc(k)}">${l}</button>`).join("");
  let n="";
  if(!rows.length) n=`<div class="notice">No quotes or policies for this combination in the last 6 months. That doesn't mean carriers won't write it, only that we haven't tried. ${btns}</div>`;
  else if(subs<10) n=`<div class="notice">Only ${subs} ${subs===1?"business":"businesses"} quoted here, so treat this as a rough signal. ${btns}</div>`;
  $("notice").innerHTML=n;
  $("notice").querySelectorAll("button").forEach(b=>b.onclick=()=>{const [a,s,i]=b.dataset.k.split("|");$("pt").value=a;$("st").value=s;$("ind").value=i;showAll=false;render()});

  // Results
  $("resultsHead").hidden=!rows.length;
  if(!rows.length){$("results").innerHTML="";$("results").style.display="none";return}
  $("results").style.display="";
  const order={"b-proven":0,"b-bound":1,"b-quotes":2,"b-refers":3,"b-declines":4};
  rows.sort((a,b)=>b[6]-a[6] || (order[appetite(a)[1]]-order[appetite(b)[1]]) || rate(b)-rate(a) || b[2]-a[2]);
  let list=$("onlyBound").checked?rows.filter(r=>r[6]>0):rows;
  const LIMIT=15, total=list.length;
  if(!showAll)list=list.slice(0,LIMIT);
  const maxB=Math.max(1,...rows.map(r=>r[6]));
  const head=`<div class="row head"><div>Carrier</div><div>Bound (last 6 mo)</div><div>Bind rate</div><div>Quoted</div><div>Typical premium</div><div>Last quoted</div></div>`;
  const body=list.map(r=>{
    const [car,s,priced,refer,decl,boundQ,bound,canc,last,bp,qp,uw]=r;
    const [al,ac]=appetite(r);
    const br=priced>0?Math.min(Math.max(boundQ,bound),priced)/priced:null;
    const prem=bp&&bp[1]!=null?{m:bp[1],lo:bp[0],hi:bp[2],lab:"bound"}:(qp&&qp[1]!=null?{m:qp[1],lo:qp[0],hi:qp[2],lab:"quoted"}:null);
    const outc=[]; if(refer)outc.push(`${refer} referred`); if(decl)outc.push(`${decl} declined`);
    return `<div class="row">
      <div class="car">${esc(car)}${uw?`<div class="uw">via ${uw.map(esc).join(", ")}</div>`:""}<div><span class="badge ${ac}">${al}</span></div></div>
      <div><span class="cell-label">Bound</span><div class="bar"><span class="n">${bound}</span><span class="track"><span class="fill" style="width:${bound/maxB*100}%"></span></span></div>
        ${canc?`<div class="small">${canc} cancelled since</div>`:""}</div>
      <div><span class="cell-label">Bind rate</span><span class="num">${br==null?"—":pct(br)}</span>${br!=null&&priced<5?`<div class="small">small sample</div>`:""}</div>
      <div><span class="cell-label">Quoted</span><span class="num">${s.toLocaleString()}</span>${outc.length?`<div class="small">${outc.join(" · ")}</div>`:""}</div>
      <div><span class="cell-label">Typical premium</span>${prem?`<span class="prem">${money(prem.m)}</span><div class="small">${prem.lo!==prem.hi?`${money(prem.lo)}–${money(prem.hi)} · `:""}${prem.lab}</div>`:"—"}</div>
      <div><span class="cell-label">Last quoted</span><span class="small">${last?fmtDate(last):"—"}</span></div>
    </div>`}).join("");
  const more=total>LIMIT?`<button class="more" id="moreBtn">${showAll?"Show fewer":`Show all ${total} carriers`}</button>`:"";
  $("results").innerHTML=head+body+more;
  if(more)$("moreBtn").onclick=()=>{showAll=!showAll;render()};
}
function rate(r){return r[2]>0?Math.min(Math.max(r[5],r[6]),r[2])/r[2]:0}
})();
