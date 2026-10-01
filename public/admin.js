// Tabs, the Feedback form, and the passcode-protected Rules tab (rules editor + feedback inbox).
(function(){
const $=id=>document.getElementById(id);
const AF=window.AF;
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const store={get(k){try{return sessionStorage.getItem(k)}catch(e){return null}},set(k,v){try{v==null?sessionStorage.removeItem(k):sessionStorage.setItem(k,v)}catch(e){}}};
let passcode=store.get("af_passcode")||"", role="", admin={rules:null,pending:[]};

// ---- Tabs ------------------------------------------------------------------
function showTab(t){
  document.querySelectorAll(".tabs [data-tab]").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));
  ["find","feedback","rules"].forEach(v=>$("view-"+v).hidden=v!==t);
  if(t==="feedback"){ refreshSearchSummary(); paintFeedbackLock(); }
  if(t==="rules"&&passcode)unlock(passcode,true);
  window.scrollTo(0,0);
}
document.querySelectorAll(".tabs [data-tab]").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$("fbFromResults").onclick=()=>{ $("fbAttach").checked=true; verdict="didnt"; paintVerdict(); showTab("feedback"); $("fbMsg").focus(); };

// ---- Feedback form -----------------------------------------------------------
function paintFeedbackLock(){ $("fbLock").hidden=!!passcode; $("fbPanel").hidden=!passcode; }
$("fbLockForm").onsubmit=async e=>{
  e.preventDefault(); const st=$("fbLockStatus"); st.textContent="Checking…"; st.className="status";
  try{ await verify($("fbPasscode").value); st.textContent=""; $("fbPasscode").value=""; paintFeedbackLock(); $("fbMsg").focus(); }
  catch(err){ st.textContent=err.message; st.className="status bad"; }
};
let verdict="";
function paintVerdict(){document.querySelectorAll("[data-verdict]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.verdict===verdict))}
document.querySelectorAll("[data-verdict]").forEach(b=>b.onclick=()=>{verdict=b.dataset.verdict;paintVerdict()});
function refreshSearchSummary(){const s=AF.searchSummary();$("fbSearchSummary").textContent=s?`(${s.text})`:"";}
try{ $("fbName").value=localStorage.getItem("af_name")||""; }catch(e){}
$("fbForm").onsubmit=async e=>{
  e.preventDefault();
  const msg=$("fbMsg").value.trim(), st=$("fbStatus");
  if(!msg){st.textContent="Add a short description first.";st.className="status bad";$("fbMsg").focus();return;}
  const name=$("fbName").value.trim(); try{localStorage.setItem("af_name",name)}catch(e){}
  const body={verdict,topic:$("fbTopic").value,name,message:msg,search:$("fbAttach").checked?AF.searchSummary():null};
  $("fbSend").disabled=true; st.textContent="Sending…"; st.className="status";
  try{
    const r=await fetch("api/feedback",{method:"POST",headers:{"Content-Type":"application/json","x-passcode":passcode},body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));
    if(r.status===401){ lock(); throw new Error("Your passcode is no longer valid. Unlock again to send."); }
    if(!r.ok)throw new Error(j.error||"Couldn't send. Try again.");
    st.textContent="Thanks, your feedback was sent."; st.className="status ok";
    $("fbMsg").value=""; verdict=""; paintVerdict();
  }catch(err){ st.textContent=err.message; st.className="status bad"; }
  finally{ $("fbSend").disabled=false; }
};

// ---- Lock / unlock ----------------------------------------------------------
async function api(path,opts={}){
  const r=await fetch(path,{...opts,headers:{"Content-Type":"application/json","x-passcode":passcode,...(opts.headers||{})}});
  const j=await r.json().catch(()=>({}));
  if(r.status===401){lock();throw new Error("Passcode no longer valid.");}
  if(!r.ok)throw new Error(j.error||"Request failed");
  return j;
}
async function unlock(code,silent){
  const st=$("lockStatus");
  if(!silent){st.textContent="Checking…";st.className="status";}
  try{
    const r=await fetch("api/auth",{method:"POST",headers:{"x-passcode":code}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||"Wrong passcode");
    passcode=code; role=j.role||"editor"; store.set("af_passcode",code);
    $("rulesLock").hidden=true; $("rulesAdmin").hidden=false; st.textContent="";
    $("roleTag").textContent=role==="owner"?"Signed in as owner":"Signed in as editor · changes need owner approval";
    editing=null; await loadAdmin(); loadInbox();
  }catch(err){ passcode=""; store.set("af_passcode",null); $("rulesLock").hidden=false; $("rulesAdmin").hidden=true; st.textContent=err.message; st.className="status bad"; }
}
function lock(){ passcode=""; role=""; if($("fbLock"))paintFeedbackLock(); store.set("af_passcode",null); $("rulesLock").hidden=false; $("rulesAdmin").hidden=true; $("passcode").value=""; }
$("lockForm").onsubmit=e=>{e.preventDefault();unlock($("passcode").value)};
$("lockBtn").onclick=lock;
document.querySelectorAll("[data-admin]").forEach(b=>b.onclick=()=>{
  document.querySelectorAll("[data-admin]").forEach(x=>x.setAttribute("aria-pressed",x===b));
  $("adminRules").hidden=b.dataset.admin!=="rules"; $("adminInbox").hidden=b.dataset.admin!=="inbox";
  if(b.dataset.admin==="inbox")loadInbox();
});

// ---- Rules editor -----------------------------------------------------------
const TYPES={
  exclude:{label:"Exclude carrier",help:"Remove the carrier from results when the conditions match.",value:null,note:"Reason shown to AEs"},
  sublimit:{label:"Sub % limit",help:"Highest subcontracted % the carrier accepts. Above it, the carrier is removed.",value:"Max sub %",note:"Note (optional)"},
  commission:{label:"Commission %",help:"Override the commission % shown for the carrier.",value:"Commission %",note:"Note (optional)"},
  note:{label:"Note for AEs",help:"Show a note on the carrier's row, e.g. underwriting requirements.",value:null,note:"Note shown to AEs"},
  prefer:{label:"Preferred carrier",help:"Pin the carrier to the top of its group and tag it Preferred.",value:null,note:"Note (optional)"},
};
let editing=null; // rule being edited (object) or null
const workingRules=()=>JSON.parse(JSON.stringify(admin.rules||AF.rules||window.Engine.DEFAULT_RULES));
async function loadAdmin(){
  try{ const j=await api("api/rules?admin=1"); admin={rules:j.rules,pending:j.pending||[]}; role=j.role||role; }catch(err){ admin={rules:null,pending:[]}; }
  paintPendingBadge(); renderRules();
}
function paintPendingBadge(){ const n=admin.pending.length; const t=document.querySelector('.tabs [data-tab="rules"]'); let b=t.querySelector(".tabcount"); if(!b){b=document.createElement("span");b.className="tabcount";t.appendChild(b);} b.textContent=n&&role==="owner"?n:""; b.hidden=!(n&&role==="owner"); }
function opText(p){
  const o=p.op, r=o.rule||p.before||{}, name=`${TYPES[r.type]?TYPES[r.type].label:"Rule"} for ${carriersText(r)}`;
  if(o.kind==="add")return {head:`Add: ${name}`,rule:o.rule};
  if(o.kind==="edit")return {head:`Change: ${name}`,rule:o.rule,before:p.before};
  if(o.kind==="delete")return {head:`Delete: ${name}`,rule:p.before};
  return {head:`${o.active?"Turn on":"Turn off"}: ${name}`,rule:p.before};
}
const ruleLine=r=>r?`${valueText(r)?esc(valueText(r))+" · ":""}${esc(condText(r))}${r.note?` · “${esc(r.note)}”`:""}`:"";
function pendingHtml(){
  if(!admin.pending.length)return "";
  return `<div class="pending"><h3>Waiting for approval <span class="count">${admin.pending.length}</span></h3>
    ${admin.pending.map(p=>{const t=opText(p);return `<div class="prow">
      <div class="r-main"><strong>${esc(t.head)}</strong>
        ${t.before?`<div class="small"><span class="was">Was:</span> ${ruleLine(t.before)}</div><div class="small"><span class="now">Now:</span> ${ruleLine(t.rule)}</div>`:`<div class="small">${ruleLine(t.rule)}</div>`}
        <div class="small">Proposed by ${esc(p.by)} · ${new Date(p.at).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</div></div>
      <div class="r-act">${role==="owner"?`<button type="button" class="btn primary sm" data-approve="${p.id}">Approve</button><button type="button" class="btn sm" data-reject="${p.id}">Reject</button>`:`<span class="badge b-refers">Waiting for owner</span>`}</div>
    </div>`}).join("")}</div>`;
}
const money=n=>"$"+Math.round(n).toLocaleString();
function condText(r){
  const c=[];
  if(r.pts&&r.pts.length)c.push(r.pts.map(AF.ptLabel).join(", "));
  if(r.states&&r.states.length)c.push(r.states.join(", "));
  if(r.naics&&r.naics.length)c.push("NAICS "+r.naics.join(", "));
  if(r.subOver!=null)c.push(`sub over ${r.subOver}%`);
  if(r.revOver!=null)c.push(`revenue over ${money(r.revOver)}`);
  if(r.revUnder!=null)c.push(`revenue under ${money(r.revUnder)}`);
  return c.length?"When "+c.join(" · "):"Always";
}
function carriersText(r){ const c=r.carriers||[]; if(c.includes("*"))return "All carriers"; return c.length>4?`${c.slice(0,4).join(", ")} +${c.length-4} more`:c.join(", "); }
function valueText(r){ if(r.type==="sublimit")return `Up to ${r.value}% sub`; if(r.type==="commission")return `${r.value}% commission`; return ""; }

function renderRules(){
  const rules=workingRules();
  const fromDefaults=!AF.rules;
  const lead=role==="owner"?"You're the owner, so your changes go live right away, and you approve or reject what editors propose.":"Your changes are sent to the owner for approval. They go live once approved.";
  let h=`<div class="card panel">
    <div class="rules-top"><div><h2>Carrier rules</h2><p class="muted">${lead} More specific rules win. For example, a Coterie-only sub % rule beats a rule that covers every standard carrier.</p></div>
    <button type="button" class="btn primary" id="addRule">Add rule</button></div>
    ${pendingHtml()}
    ${fromDefaults&&role==="owner"?`<p class="notice info">These are the built-in rules. Your first change stores them, and from then on this list is the one everyone uses.</p>`:""}
    <div id="ruleForm"></div>
    <div class="rules-list">${rules.length?rules.map((r,i)=>`<div class="rule${r.active===false?" off":""}">
      <div class="r-main"><span class="badge b-type t-${r.type}">${esc(TYPES[r.type]?TYPES[r.type].label:r.type)}</span>
        <strong>${esc(carriersText(r))}</strong>${valueText(r)?` · ${esc(valueText(r))}`:""}
        <div class="small">${esc(condText(r))}${r.note?` · “${esc(r.note)}”`:""}</div>
        ${r.by?`<div class="small">Last edited by ${esc(r.by)}${r.at?` on ${esc(new Date(r.at).toLocaleDateString())}`:""}</div>`:""}</div>
      <div class="r-act">
        <label class="switch" title="On/off"><input type="checkbox" data-toggle="${i}" ${r.active!==false?"checked":""}><span></span></label>
        <button type="button" class="linkbtn" data-edit="${i}">Edit</button>
        <button type="button" class="linkbtn danger" data-del="${i}">Delete</button>
      </div></div>`).join(""):`<p class="muted">No rules yet.</p>`}</div>
    <p class="status" id="rulesStatus" role="status"></p></div>`;
  $("adminRules").innerHTML=h;
  $("addRule").onclick=()=>{editing={type:"exclude",carriers:[],pts:[],states:[],naics:[],active:true};renderForm(-1);};
  $("adminRules").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{editing=workingRules()[+b.dataset.edit];renderForm(+b.dataset.edit);});
  $("adminRules").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{ if(!confirmDelete(b))return; propose({kind:"delete",id:workingRules()[+b.dataset.del].id}); });
  $("adminRules").querySelectorAll("[data-toggle]").forEach(c=>c.onchange=()=>{ propose({kind:"toggle",id:workingRules()[+c.dataset.toggle].id,active:c.checked}); });
  $("adminRules").querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>decide("approve",b.dataset.approve));
  $("adminRules").querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>decide("reject",b.dataset.reject));
}
// Two-click delete instead of a browser confirm() dialog
function confirmDelete(b){ if(b.dataset.armed){return true;} b.dataset.armed="1"; b.textContent="Click again to delete"; setTimeout(()=>{if(b.isConnected){delete b.dataset.armed;b.textContent="Delete";}},3000); return false; }

function renderForm(idx){
  const r=editing, D=AF.D, T=TYPES[r.type];
  const carriers=[...D.carriers].sort((a,b)=>a.localeCompare(b));
  const pts=[...D.pts].filter(p=>D.meta.ptCounts[p]).sort((a,b)=>(D.meta.ptCounts[b]||0)-(D.meta.ptCounts[a]||0));
  const sel=new Set(r.carriers||[]);
  $("ruleForm").innerHTML=`<form class="rform" id="rform">
    <h3>${idx<0?"New rule":"Edit rule"}</h3>
    <div class="grid2">
      <div class="field"><label for="rType">Rule type</label>
        <select id="rType">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}" ${k===r.type?"selected":""}>${v.label}</option>`).join("")}</select>
        <div class="small">${esc(T.help)}</div></div>
      <div class="field"><label>Carriers</label>
        <input type="text" id="rCarSearch" placeholder="Filter carriers…">
        <div class="checks" id="rCars">
          <label class="check"><input type="checkbox" value="*" ${sel.has("*")?"checked":""}> <strong>All carriers</strong></label>
          <label class="check"><input type="checkbox" value="__std"> <em>All standard carriers</em></label>
          ${carriers.map(c=>`<label class="check" data-name="${esc(c.toLowerCase())}"><input type="checkbox" value="${esc(c)}" ${sel.has(c)?"checked":""}> ${esc(c)}</label>`).join("")}
        </div></div>
    </div>
    <fieldset><legend>Only when… <span class="small">(leave blank to always apply)</span></legend>
      <div class="field"><label>Policy types</label>
        <div class="chips" id="rPts">${pts.map(p=>`<label class="chip"><input type="checkbox" value="${p}" ${(r.pts||[]).includes(p)?"checked":""}><span>${esc(AF.ptLabel(p))}</span></label>`).join("")}</div></div>
      <div class="grid3">
        <div class="field"><label for="rStates">States</label><input id="rStates" type="text" placeholder="e.g. TX, CA, FL" value="${esc((r.states||[]).join(", "))}"></div>
        <div class="field"><label for="rNaics">NAICS starts with</label><input id="rNaics" type="text" placeholder="e.g. 2381, 561720" value="${esc((r.naics||[]).join(", "))}"></div>
        <div class="field"><label for="rSub">Sub % over</label><input id="rSub" type="text" inputmode="decimal" placeholder="e.g. 25" value="${r.subOver??""}"></div>
        <div class="field"><label for="rRevO">Revenue over</label><input id="rRevO" type="text" inputmode="decimal" placeholder="e.g. 5m" value="${r.revOver??""}"></div>
        <div class="field"><label for="rRevU">Revenue under</label><input id="rRevU" type="text" inputmode="decimal" placeholder="e.g. 100k" value="${r.revUnder??""}"></div>
      </div>
    </fieldset>
    <div class="grid3">
      ${T.value?`<div class="field"><label for="rVal">${T.value}</label><input id="rVal" type="text" inputmode="decimal" value="${r.value??""}"></div>`:""}
      <div class="field span2"><label for="rNote">${T.note}</label><input id="rNote" type="text" maxlength="300" value="${esc(r.note||"")}"></div>
    </div>
    <div class="grid3"><div class="field"><label for="rBy">Your name</label><input id="rBy" type="text" maxlength="80" value="${esc(storeName())}"></div></div>
    <div class="actions"><button type="submit" class="btn primary">Save rule</button><button type="button" class="btn" id="rCancel">Cancel</button><span class="status" id="rStatus" role="status"></span></div>
  </form>`;
  $("rType").onchange=()=>{ collect(); editing.type=$("rType").value; renderForm(idx); };
  $("rCarSearch").oninput=e=>{const q=e.target.value.toLowerCase();$("rCars").querySelectorAll("[data-name]").forEach(l=>l.hidden=!l.dataset.name.includes(q));};
  $("rCars").querySelector('input[value="__std"]').onchange=e=>{ if(e.target.checked){ window.Engine.STANDARD.forEach(n=>{const i=[...$("rCars").querySelectorAll("input")].find(x=>x.value===n); if(i)i.checked=true;}); } e.target.checked=false; };
  $("rCancel").onclick=()=>{editing=null;$("ruleForm").innerHTML="";};
  $("rform").onsubmit=e=>{
    e.preventDefault(); collect();
    const st=$("rStatus"), T2=TYPES[editing.type];
    if(!editing.carriers.length){st.textContent="Pick at least one carrier.";st.className="status bad";return;}
    if(T2.value&&(editing.value==null||isNaN(editing.value))){st.textContent=`Enter the ${T2.value.toLowerCase()}.`;st.className="status bad";return;}
    if((editing.type==="note")&&!editing.note){st.textContent="Write the note AEs should see.";st.className="status bad";return;}
    propose(idx<0?{kind:"add",rule:editing}:{kind:"edit",rule:editing});
  };
  $("ruleForm").scrollIntoView({behavior:"smooth",block:"start"});
}
function num(v){ v=String(v||"").trim().toLowerCase().replace(/[$,%\s]/g,""); if(!v)return null; const m=v.match(/^([\d.]+)(k|m)?$/); if(!m)return NaN; let x=parseFloat(m[1]); if(m[2]==="k")x*=1e3; if(m[2]==="m")x*=1e6; return x; }
const list=v=>String(v||"").split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
function storeName(){try{return localStorage.getItem("af_name")||""}catch(e){return ""}}
function collect(){
  const f=$("rform"); if(!f)return;
  editing.carriers=[...$("rCars").querySelectorAll("input:checked")].map(i=>i.value).filter(v=>v!=="__std");
  if(editing.carriers.includes("*"))editing.carriers=["*"];
  editing.pts=[...$("rPts").querySelectorAll("input:checked")].map(i=>i.value);
  editing.states=list($("rStates").value).map(s=>s.toUpperCase().slice(0,2));
  editing.naics=list($("rNaics").value).filter(x=>/^\d{2,6}$/.test(x));
  editing.subOver=num($("rSub").value); editing.revOver=num($("rRevO").value); editing.revUnder=num($("rRevU").value);
  if($("rVal"))editing.value=num($("rVal").value); else editing.value=null;
  editing.note=$("rNote").value.trim();
  editing.by=$("rBy").value.trim(); try{localStorage.setItem("af_name",editing.by)}catch(e){}
}
async function propose(op){
  try{
    const j=await api("api/rules",{method:"POST",body:JSON.stringify({action:"propose",op,by:storeName()})});
    if(j.applied){ AF.setRules(j.rules); admin.rules=j.rules; }
    admin.pending=j.pending||admin.pending; editing=null; paintPendingBadge(); renderRules();
    flash(j.applied?"Saved. It's live now.":"Sent to the owner for approval. It'll go live once approved.","ok");
  }catch(err){ flash(err.message,"bad",true); renderRules(); }
}
async function decide(action,id){
  try{
    const j=await api("api/rules",{method:"POST",body:JSON.stringify({action,id,by:storeName()})});
    admin.rules=j.rules; admin.pending=j.pending||[]; if(action==="approve")AF.setRules(j.rules);
    paintPendingBadge(); renderRules(); flash(action==="approve"?"Approved. It's live now.":"Rejected.","ok");
  }catch(err){ flash(err.message,"bad"); }
}
function flash(msg,kind,inForm){ const s2=(inForm&&$("rStatus"))||$("rulesStatus"); if(s2){s2.textContent=msg;s2.className="status "+kind;} }

// ---- Inline "Add note" on a carrier row -------------------------------------
async function verify(code){
  const r=await fetch("api/auth",{method:"POST",headers:{"x-passcode":code}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||"Wrong passcode");
  passcode=code; role=j.role; store.set("af_passcode",code); return role;
}
function openNoteForm(slot,carrier){
  document.querySelectorAll(".nform-slot").forEach(x=>{ if(x!==slot)x.innerHTML=""; });
  if(slot.innerHTML){ slot.innerHTML=""; return; }
  const S=AF.S, cls=S.code?AF.title(S.code):"";
  slot.innerHTML=`<form class="nform">
    <textarea rows="3" maxlength="300" placeholder="e.g. Won't write roofing over 3 stories. Needs 3 years in business. Prefers loss runs upfront." aria-label="Note about ${esc(carrier)}"></textarea>
    <div class="small">Show this note:</div>
    <label class="check"><input type="checkbox" data-scope="pt" checked> Only for ${esc(AF.ptLabel(S.pt))}</label>
    ${S.st!=="*"?`<label class="check"><input type="checkbox" data-scope="st"> Only in ${esc(S.st)}</label>`:""}
    ${S.code?`<label class="check"><input type="checkbox" data-scope="code"> Only for ${esc(S.code)} · ${esc(cls)}</label>`:""}
    ${passcode?"":`<input type="password" class="npass" placeholder="Passcode" aria-label="Passcode" autocomplete="current-password">`}
    <input type="text" class="nby" placeholder="Your name" maxlength="80" value="${esc(storeName())}" aria-label="Your name">
    <div class="actions"><button type="submit" class="btn primary sm">Save note</button><button type="button" class="btn sm ncancel">Cancel</button><span class="status nstatus" role="status"></span></div>
  </form>`;
  const f=slot.querySelector("form"), st=f.querySelector(".nstatus");
  f.querySelector("textarea").focus();
  f.querySelector(".ncancel").onclick=()=>{slot.innerHTML="";};
  f.onsubmit=async e=>{
    e.preventDefault();
    const text=f.querySelector("textarea").value.trim();
    if(!text){st.textContent="Write the note first.";st.className="status nstatus bad";return;}
    const by=f.querySelector(".nby").value.trim(); try{localStorage.setItem("af_name",by)}catch(e){}
    try{
      if(!passcode){ const pc=f.querySelector(".npass").value; if(!pc)throw new Error("Enter the passcode to add notes."); await verify(pc); }
      const sc=k=>{const i=f.querySelector(`[data-scope="${k}"]`);return i&&i.checked;};
      const rule={type:"note",carriers:[carrier],active:true,note:text,
        pts:sc("pt")?[S.pt]:[], states:sc("st")?[S.st]:[], naics:sc("code")?[S.code]:[]};
      st.textContent="Saving…"; st.className="status nstatus";
      const j=await api("api/rules",{method:"POST",body:JSON.stringify({action:"propose",op:{kind:"add",rule},by})});
      if(j.applied){ admin.rules=j.rules; AF.setRules(j.rules); }
      else { admin.pending=j.pending||admin.pending; slot.innerHTML=`<div class="status ok">Note sent to the owner for approval. It will show here once it's approved.</div>`; }
      paintPendingBadge();
    }catch(err){ st.textContent=err.message; st.className="status nstatus bad"; }
  };
}
window.AFAdmin={openNoteForm};

// ---- Feedback inbox ---------------------------------------------------------
const TOPICS={appetite:"Carriers listed",premium:"Premium estimate",class:"Class search",commission:"Commission",rules:"Rules",idea:"Idea",other:"Other"};
let inbox=[], inboxFilter="new";
async function loadInbox(){
  try{ const j=await api("api/feedback"); inbox=j.items||[]; }catch(err){ $("adminInbox").innerHTML=`<div class="card panel"><p class="status bad">${esc(err.message)}</p></div>`; return; }
  const n=inbox.filter(i=>i.status!=="done").length; $("inboxCount").textContent=n?`(${n})`:"";
  renderInbox();
}
function renderInbox(){
  const items=inbox.filter(i=>inboxFilter==="all"||(inboxFilter==="new"?i.status!=="done":i.status==="done"));
  $("adminInbox").innerHTML=`<div class="card panel">
    <div class="rules-top"><h2>Feedback inbox</h2>
      <div class="seg" role="group">${["new","done","all"].map(f=>`<button type="button" data-f="${f}" aria-pressed="${f===inboxFilter}">${f==="new"?"Open":f==="done"?"Done":"All"}</button>`).join("")}</div></div>
    ${items.length?items.map(i=>`<div class="fb${i.status==="done"?" off":""}">
      <div class="fb-top">${i.verdict?`<span class="badge ${i.verdict==="worked"?"b-proven":"b-declines"}">${i.verdict==="worked"?"Worked":"Didn't work"}</span>`:""}
        <span class="badge b-lim">${esc(TOPICS[i.topic]||i.topic||"Other")}</span>
        <span class="small">${esc(i.name||"Anonymous")} · ${new Date(i.at).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</span></div>
      <p>${esc(i.message)}</p>
      ${i.search?`<div class="small">Search: ${esc([AF.ptLabel(i.search.pt||""),i.search.st||"all states",i.search.cls||"all classes",i.search.rev?AF.short(i.search.rev)+" rev":"",i.search.pay?AF.short(i.search.pay)+" payroll":"",i.search.sub?i.search.sub+"% sub":""].filter(Boolean).join(" · "))}
        ${i.search.link?` · <a href="${esc(i.search.link)}" data-open="${esc(i.search.link)}">Open this search</a>`:""}</div>`:""}
      <div class="r-act"><button type="button" class="linkbtn" data-done="${i.id}" data-to="${i.status==="done"?"new":"done"}">${i.status==="done"?"Reopen":"Mark done"}</button>
        <button type="button" class="linkbtn danger" data-fdel="${i.id}">Delete</button></div></div>`).join(""):`<p class="muted">Nothing here.</p>`}
  </div>`;
  $("adminInbox").querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{inboxFilter=b.dataset.f;renderInbox();});
  $("adminInbox").querySelectorAll("[data-done]").forEach(b=>b.onclick=async()=>{ await api("api/feedback",{method:"POST",body:JSON.stringify({action:"status",id:b.dataset.done,status:b.dataset.to})}); loadInbox(); });
  $("adminInbox").querySelectorAll("[data-fdel]").forEach(b=>b.onclick=async()=>{ if(!confirmDelete(b))return; await api("api/feedback",{method:"POST",body:JSON.stringify({action:"delete",id:b.dataset.fdel})}); loadInbox(); });
  $("adminInbox").querySelectorAll("[data-open]").forEach(a=>a.onclick=e=>{ e.preventDefault(); const u=new URL(a.dataset.open); location.hash=u.hash; showTab("find"); });
}
})();
