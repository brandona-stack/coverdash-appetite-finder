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
const short=n=>n>=1e6?"$"+(n/1e6).toFixed(n>=1e7?0:1).replace(/\.0$/,"")+"M":n>=1e3?"$"+Math.round(n/1e3)+"K":"$"+Math.round(n);
const pct=x=>Math.round(x*100)+"%";
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let D=null, S={pt:null,st:"*",code:"",prefix:"",rev:0,pay:0,sub:0}, showAll=false, sort="comm", day0=null;

fetch("appetite-data.json").then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(d=>{D=Engine.prepare(d);init()})
  .catch(()=>{$("summary").innerHTML='<div class="notice">Could not load the data. Refresh the page to try again.</div>'});

const fmtDate=d=>d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
const dayToDate=n=>{const d=new Date(day0);d.setDate(d.getDate()+n);return d};
function parseAmt(s){ s=String(s||"").trim().toLowerCase().replace(/[$,\s]/g,""); if(!s)return 0;
  const m=s.match(/^([\d.]+)(k|m|mm)?$/); if(!m)return NaN; let v=parseFloat(m[1]); if(isNaN(v))return NaN;
  if(m[2]==="k")v*=1e3; else if(m[2])v*=1e6; return Math.round(v); }
function title(prefix){ if(!prefix)return "All classes"; const n=D.naics.find(x=>x[0]===prefix); return n?n[1]:(D.groups[prefix]||prefix); }

function init(){
  day0=new Date(D.meta.start+"T12:00:00");
  $("dataRange").textContent=`${D.meta.nQuotes.toLocaleString()} quotes (${fmtDate(new Date(D.meta.start+"T12:00:00"))} – ${fmtDate(new Date(D.meta.end+"T12:00:00"))}) and ${D.meta.nPolicies.toLocaleString()} bound policies`;
  const pts=D.pts.filter(p=>D.meta.ptCounts[p]).sort((a,b)=>(D.meta.ptCounts[b]||0)-(D.meta.ptCounts[a]||0));
  $("pt").innerHTML=pts.map(p=>`<option value="${p}">${esc(ptLabel(p))}</option>`).join("");
  $("st").innerHTML=`<option value="*">All states</option>`+D.states.filter(s=>STATES[s]).sort((a,b)=>STATES[a].localeCompare(STATES[b])).map(s=>`<option value="${s}">${esc(stLabel(s))}</option>`).join("");
  S.pt=pts[0];
  readHash();
  $("pt").onchange=()=>{S.pt=$("pt").value;showAll=false;render()};
  $("st").onchange=()=>{S.st=$("st").value;showAll=false;render()};
  let t; const num=(id,key,max)=>$(id).addEventListener("input",()=>{clearTimeout(t);t=setTimeout(()=>{const v=parseAmt($(id).value);
    $(id).closest(".field").classList.toggle("bad",isNaN(v)||(max&&v>max)); if(!isNaN(v)&&!(max&&v>max)){S[key]=v;render()}},250)});
  num("rev","rev"); num("pay","pay"); num("sub","sub",100);
  ["rev","pay"].forEach(id=>$(id).addEventListener("blur",()=>{const v=parseAmt($(id).value);if(v>0)$(id).value=v.toLocaleString()}));
  document.querySelectorAll(".seg button").forEach(b=>b.onclick=()=>{sort=b.dataset.sort;render()});
  setupCombo();
  window.addEventListener("hashchange",()=>{readHash();render()});
  render();
}

function readHash(){
  const h=decodeURIComponent(location.hash.slice(1)).split("|");
  if(h[0]&&D.ptIx[h[0]]!==undefined)S.pt=h[0];
  if(h[1]&&(h[1]==="*"||D.stIx[h[1]]!==undefined))S.st=h[1];
  if(h[2]!==undefined){S.code=h[2]||"";S.prefix=h[3]!==undefined?h[3]:S.code}
  if(h[4])S.rev=+h[4]||0; if(h[5])S.pay=+h[5]||0; if(h[6])S.sub=+h[6]||0;
  $("pt").value=S.pt; $("st").value=S.st;
  $("cls").value=S.code?`${S.code} · ${title(S.code)}`:""; $("clsClear").hidden=!S.code;
  $("rev").value=S.rev?S.rev.toLocaleString():""; $("pay").value=S.pay?S.pay.toLocaleString():""; $("sub").value=S.sub||"";
}

// ---- Class search --------------------------------------------------------
function setupCombo(){
  const inp=$("cls"), list=$("clsList"); let items=[], act=-1;
  NaicsSearch.build(D.naics);
  const loadModel=()=>NaicsSearch.load("naics-model.json").then(()=>{ if(!list.hidden&&inp.value.trim())show(); });
  let deb;
  function show(){
    const q=inp.value.trim();
    items=NaicsSearch.search(q,q&&!/^\d+$/.test(q)?10:40).map(e=>[e.code,e.title,e.count]);
    act=-1;
    const hint=!q?`<li class="hint">Describe what the business does, like "fixes leaky pipes" or "sells candles online". You can also type a NAICS code.</li>`:"";
    list.innerHTML=hint+(items.length?items.map((n,i)=>`<li role="option" data-i="${i}" class="${n[2]?"":"dim"}"><span class="code">${n[0]}</span><span class="t">${esc(n[1])}</span><span class="c">${n[2]?n[2].toLocaleString()+" quoted":"no quotes yet"}</span></li>`).join("")
      :`<li class="none">No classes match "${esc(q)}". Try describing it another way.</li>`);
    list.hidden=false; inp.setAttribute("aria-expanded","true");
  }
  function pick(n){ S.code=n?n[0]:""; S.prefix=S.code; inp.value=n?`${n[0]} · ${n[1]}`:""; $("clsClear").hidden=!n; hide(); showAll=false; render(); }
  function hide(){ list.hidden=true; inp.setAttribute("aria-expanded","false"); }
  inp.addEventListener("focus",()=>{inp.select();loadModel();show()});
  inp.addEventListener("input",()=>{clearTimeout(deb);deb=setTimeout(show,120)});
  inp.addEventListener("keydown",e=>{
    const lis=[...list.querySelectorAll("li[data-i]")];
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(list.hidden)show();act=Math.max(0,Math.min(lis.length-1,act+(e.key==="ArrowDown"?1:-1)));lis.forEach((l,i)=>l.classList.toggle("act",i===act));lis[act]&&lis[act].scrollIntoView({block:"nearest"})}
    else if(e.key==="Enter"){e.preventDefault();if(act<0){clearTimeout(deb);show()}if(items[act>=0?act:0])pick(items[act>=0?act:0])}
    else if(e.key==="Escape"){hide();inp.blur()}
  });
  list.addEventListener("mousedown",e=>{const li=e.target.closest("li[data-i]");if(li){e.preventDefault();pick(items[+li.dataset.i])}});
  inp.addEventListener("blur",()=>{setTimeout(hide,120); if(!inp.value.trim()&&S.code)pick(null); else if(S.code)inp.value=`${S.code} · ${title(S.code)}`});
  $("clsClear").onclick=()=>{pick(null);inp.focus()};
}

// ---- Rendering -----------------------------------------------------------
function appetiteTag(a){
  if(a.bound>=3)return["Proven","b-proven"];
  if(a.bound>=1)return["Has bound","b-bound"];
  if(a.subs>0&&a.priced/a.subs>=0.5)return["Quotes","b-quotes"];
  if(a.refer>=a.decl&&a.refer>0)return["Refers","b-refers"];
  if(a.decl>0)return["Declines","b-declines"];
  return["Quotes","b-quotes"];
}
const strength=n=>n>=30?["Strong",3]:n>=10?["Moderate",2]:["Thin",1];
function levelText(l){ const cls=l.L===0?"all classes":l.L===6?"this class":`NAICS ${l.prefix} (${title(l.prefix)})`; return `${cls}${l.st==="*"?", all states":""}`; }
function sameLevel(l){ return l.prefix===S.prefix && (l.st===S.st); }

function render(){
  if(!D)return;
  history.replaceState(null,"","#"+encodeURIComponent([S.pt,S.st,S.code,S.prefix,S.rev||"",S.pay||"",S.sub||""].join("|")));
  const A=Engine.appetite(D,{pt:S.pt,st:S.st,prefix:S.prefix});
  const haveExp=S.rev>0||S.pay>0;
  const est=Engine.indicate(D,{pt:S.pt,st:S.st,code:S.prefix,rev:S.rev,pay:S.pay});
  const isWC=S.pt==="WORKERS_COMP";
  const expLabel=(isWC&&S.pay>0)||(!(S.rev>0)&&S.pay>0)?"payroll":"revenue";
  const where=[S.st==="*"?"all states":STATES[S.st]||S.st, S.prefix?(S.prefix.length===6?title(S.prefix):`NAICS ${S.prefix} · ${title(S.prefix)}`):"all classes"].join(" · ");
  $("resultsTitle").textContent=`${ptLabel(S.pt)} · ${where}`;

  // Sub % rules
  const excluded=[], rows=[];
  for(const a of A.rows){ const name=D.carriers[a.c]; const lim=Engine.maxSubFor(name); (S.sub>lim?excluded:rows).push(Object.assign(a,{name,lim})); }

  // Split carriers into "can write this" and "tough fit"
  const rate=a=>a.priced?Math.min(Math.max(a.boundQ,a.bound),a.priced)/a.priced:0;
  for(const r of rows){
    r.e=est.get(r.c); r.tag=appetiteTag(r);
    const X=r.e&&(r.e.basis==="payroll"?S.pay:S.rev);
    r.tooBig=haveExp&&r.e&&r.e.maxExp&&X>r.e.maxExp*2;
    r.tooSmall=haveExp&&r.e&&r.e.minExp&&X<r.e.minExp/2;
    const cm=D.comm[r.name]; const cv=cm&&(cm[S.pt]||cm["*"]);
    r.comm=cv?cv[0]:null; r.commAll=!!(cm&&!cm[S.pt]&&cm["*"]);
    r.commAmt=r.comm!=null&&r.e?r.e.mid*r.comm/100:null;
    r.fit=(r.tag[1]==="b-refers"||r.tag[1]==="b-declines"||r.tooBig)?"tough":"can";
  }
  const can=rows.filter(r=>r.fit==="can"), tough=rows.filter(r=>r.fit==="tough");
  const withEst=can.filter(r=>r.e);
  const bestComm=can.filter(r=>r.comm!=null).sort((a,b)=>b.comm-a.comm||(b.commAmt??0)-(a.commAmt??0))[0];
  const mids=withEst.map(r=>r.e.mid).sort((x,y)=>x-y);
  const [sl,sn]=strength(A.subs);
  const expTxt=haveExp?`${short(expLabel==="payroll"?S.pay:S.rev)} ${expLabel}`:"";
  $("summary").innerHTML=(A.subs||A.bound)?`
    <div class="answer">
      <div class="a-main">
        <div class="k">${can.length?`${can.length} carrier${can.length===1?"":"s"} can likely write this`:"No carriers with a clear appetite yet"}</div>
        ${mids.length?`<div class="v">${mids.length>1?`${money(mids[0])} – ${money(mids[mids.length-1])}`:money(mids[0])}</div>
          <div class="s">${haveExp?`Estimated premium at ${expTxt}`:"Typical quoted premium (enter revenue for this account)"}${mids.length>1?`, cheapest to priciest carrier · middle ${money(Engine.quant(mids,.5))}`:""}</div>`
          :`<div class="s">${haveExp?"Not enough comparable quotes to estimate premium.":"Enter revenue to see premium ranges."}</div>`}
      </div>
      <div class="a-side">
        <div><span class="n">${A.subs.toLocaleString()}</span> businesses quoted</div>
        <div><span class="n">${A.bound.toLocaleString()}</span> bound${A.boundMed?` · median ${money(A.boundMed)}`:""}</div>
        ${bestComm?`<div>Best commission: <span class="n">${esc(bestComm.name)} ${+bestComm.comm.toFixed(1)}%</span></div>`:""}
        <div class="strength"><span class="dots">${[1,2,3].map(i=>`<i class="${i<=sn?"on":""}"></i>`).join("")}</span>${sl} data</div>
      </div>
    </div>`:"";

  // Notices
  const n=[];
  const btn=(l,act)=>`<button data-act="${esc(act)}">${esc(l)}</button>`;
  const broaden=[];
  if(S.prefix.length>2){ const nx=S.prefix.length===6?4:S.prefix.length===4?3:2; const p=S.prefix.slice(0,nx); broaden.push(btn(`Broaden to ${p} · ${title(p)}`,"prefix:"+p)); }
  if(S.st!=="*")broaden.push(btn("All states","st:*"));
  if(S.prefix!==S.code)broaden.push(btn(`Back to ${S.code}`,"prefix:"+S.code));
  if(!A.rows.length) n.push(`<div class="notice">No quotes for this combination yet. That doesn't mean carriers won't write it, only that we haven't tried. ${broaden.join("")}</div>`);
  else if(A.subs<10) n.push(`<div class="notice">Only ${A.subs} ${A.subs===1?"business":"businesses"} quoted here, so treat this as a rough read. ${broaden.join("")}</div>`);
  else if(S.prefix!==S.code) n.push(`<div class="notice info">Showing the wider group ${S.prefix}. ${broaden.join("")}</div>`);
  if(S.sub>25) n.push(`<div class="notice warn">${S.sub}% subcontracted: standard carriers are removed${S.sub>50?", including Coterie (its limit is 50%)":". Coterie stays in up to 50%"}.</div>`);
  $("notice").innerHTML=n.join("");
  $("notice").querySelectorAll("button[data-act]").forEach(b=>b.onclick=()=>{const [k,v]=b.dataset.act.split(":");if(k==="st"){S.st=v;$("st").value=v}else S.prefix=v;showAll=false;render()});

  // Carrier list
  $("resultsHead").hidden=!rows.length;
  document.querySelectorAll(".seg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.sort===sort));
  const order={"b-proven":0,"b-bound":1,"b-quotes":2,"b-refers":3,"b-declines":4};
  const cmp=sort==="price"
    ?(a,b)=>(a.e?a.e.mid:Infinity)-(b.e?b.e.mid:Infinity)||b.bound-a.bound
    :sort==="comm"
    ?(a,b)=>(b.comm??-1)-(a.comm??-1)||(b.commAmt??-1)-(a.commAmt??-1)||b.bound-a.bound
    :(a,b)=>b.bound-a.bound||order[a.tag[1]]-order[b.tag[1]]||rate(b)-rate(a)||b.priced-a.priced;
  can.sort(cmp); tough.sort(cmp);
  const card=a=>{
    const [al,ac]=a.tag, e=a.e, uw=D.uw[a.name];
    let prem=`<div class="p-none">${haveExp?"Not enough quotes to estimate":"Enter revenue to estimate"}</div>`;
    if(e){
      const where=sameLevel(e.level)?"":` · from ${levelText(e.level)}`;
      prem=`<div class="p-range${e.thin?" thin":""}">${e.lo!==e.hi?`${money(e.lo)} – ${money(e.hi)}`:money(e.mid)}</div>
        <div class="small">typical ${money(e.mid)} · ${e.n} comparable quote${e.n===1?"":"s"}${where}${e.thin?" · rough":""}</div>`;
    }
    const flags=[];
    if(a.tooBig)flags.push(`Bigger than anything they've quoted here (max ${short(e.maxExp)} ${e.basis})`);
    else if(haveExp&&e&&e.maxExp&&(e.basis==="payroll"?S.pay:S.rev)>e.maxExp*1.25)flags.push(`Near the top of what they've quoted (max ${short(e.maxExp)})`);
    if(a.tooSmall)flags.push(`Smaller than they usually quote (min ${short(e.minExp)})`);
    return `<div class="crow">
      <div class="car">${esc(a.name)}${uw?`<div class="uw">via ${uw.map(esc).join(", ")}</div>`:""}
        <div class="tags"><span class="badge ${ac}">${al}</span>${a.lim<Infinity&&S.sub>0?`<span class="badge b-lim">up to ${a.lim}% sub</span>`:""}</div></div>
      <div class="prem-col"><span class="cell-label">${haveExp?"Estimated premium":"Typical quoted premium"}</span>${prem}${a.comm!=null?`<div class="comm"><strong>${+a.comm.toFixed(1)}%</strong> commission${a.commAmt?` · about ${money(a.commAmt)}`:""}${a.commAll?` <span class="small">(all lines)</span>`:""}</div>`:""}${flags.map(f=>`<div class="flag">${esc(f)}</div>`).join("")}</div>
    </div>`;
  };
  const LIMIT=12;
  const canList=showAll?can:can.slice(0,LIMIT);
  let html="";
  if(can.length) html+=`<div class="group"><div class="g-head"><span class="dot ok"></span>Can write this <span class="count">${can.length}</span></div>${canList.map(card).join("")}
    ${can.length>LIMIT?`<button class="more" id="moreBtn">${showAll?"Show fewer":`Show all ${can.length} carriers`}</button>`:""}</div>`;
  if(tough.length) html+=`<div class="group tough"><div class="g-head"><span class="dot no"></span>Tough fit <span class="count">${tough.length}</span><span class="g-note">mostly refer or decline these, or the account is bigger than they've written</span></div>${tough.map(card).join("")}</div>`;
  $("results").innerHTML=html;
  $("results").style.display=html?"":"none";
  const mb=$("moreBtn"); if(mb)mb.onclick=()=>{showAll=!showAll;render()};
  $("excluded").innerHTML=excluded.length?`<div class="excl"><strong>Removed for ${S.sub}% sub:</strong> ${excluded.sort((a,b)=>b.bound-a.bound).map(a=>`${esc(a.name)} <span class="small">(max ${a.lim}%)</span>`).join(", ")}</div>`:"";
}
})();
