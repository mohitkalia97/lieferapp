const DB_NAME='lieferroute-v5';
const DB_VERSION=1;
const TOUR_STORE='tours';
const META_STORE='meta';
const $=id=>document.getElementById(id);
const screens=['home','importScreen','manualScreen','savedScreen','backupScreen','route','tourListScreen','editStopScreen','optimizeScreen'];
let db=null;
let currentTour=null;
let manualStops=[];
let importedStops=[];
let editContext={mode:'edit',index:-1,returnTo:'route'};

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function uid(){return (crypto.randomUUID?.() || ('id-'+Date.now()+'-'+Math.random().toString(16).slice(2)));}
function now(){return new Date().toISOString();}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function fullAddress(s){return [s.address,s.postal].filter(Boolean).join(', ');}
function googleQuery(s){return [s.name,s.address,s.postal].filter(Boolean).join(', ');}
function stopTemplate(s={}){return {id:s.id||uid(),name:s.name||'',address:s.address||'',postal:s.postal||'',note:s.note||'',status:s.status||'pending',completedAt:s.completedAt||null,needsReview:!!s.needsReview};}
function normalizeTour(t){
  return {
    id:t.id||uid(), name:t.name||'Unbenannte Tour', source:t.source||'manual', createdAt:t.createdAt||now(), updatedAt:t.updatedAt||now(),
    currentIndex:Number.isInteger(t.currentIndex)?t.currentIndex:0,
    stops:(t.stops||[]).map(stopTemplate), routeUndo:t.routeUndo||null
  };
}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(TOUR_STORE)) d.createObjectStore(TOUR_STORE,{keyPath:'id'});
      if(!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE,{keyPath:'key'});
    };
    req.onsuccess=e=>resolve(e.target.result);
    req.onerror=()=>reject(req.error);
  });
}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store);}
function dbGet(store,key){return new Promise((resolve,reject)=>{const r=tx(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbGetAll(store){return new Promise((resolve,reject)=>{const r=tx(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
function dbPut(store,val){return new Promise((resolve,reject)=>{const r=tx(store,'readwrite').put(val);r.onsuccess=()=>resolve(val);r.onerror=()=>reject(r.error);});}
function dbDelete(store,key){return new Promise((resolve,reject)=>{const r=tx(store,'readwrite').delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
async function setMeta(key,value){await dbPut(META_STORE,{key,value});}
async function getMeta(key){return (await dbGet(META_STORE,key))?.value ?? null;}

function show(id){if(id!=='optimizeScreen'&&typeof cancelOptimization==='function')cancelOptimization();screens.forEach(s=>$(s).classList.toggle('hidden',s!==id)); window.scrollTo(0,0);}
function routeStats(t){
  const total=t?.stops?.length||0, done=t?.stops?.filter(s=>s.status==='done').length||0, notDelivered=t?.stops?.filter(s=>s.status==='not_delivered').length||0;
  const open=Math.max(0,total-done-notDelivered);
  return {total,done,notDelivered,open,completed:total>0&&open===0};
}
function nextPendingIndex(t,start=0){
  if(!t?.stops?.length) return -1;
  for(let i=Math.max(0,start);i<t.stops.length;i++) if(t.stops[i].status==='pending'||t.stops[i].status==='later') return i;
  for(let i=0;i<Math.max(0,start);i++) if(t.stops[i].status==='pending'||t.stops[i].status==='later') return i;
  return -1;
}
async function saveCurrent(){
  if(!currentTour) return;
  if(!RoutePlanner.undoAvailable(currentTour))currentTour.routeUndo=null;
  currentTour.updatedAt=now();
  await dbPut(TOUR_STORE,currentTour);
  await setMeta('currentTourId',currentTour.id);
  updateHeader();
}
function updateHeader(){
  if(currentTour){const st=routeStats(currentTour);$('status').textContent=`${st.done}/${st.total} zugestellt`;}
  else $('status').textContent='Bereit';
}

async function loadCurrent(){
  const id=await getMeta('currentTourId');
  currentTour=id?await dbGet(TOUR_STORE,id):null;
  if(currentTour) currentTour=normalizeTour(currentTour);
}

async function migrateV4(){
  const existing=await dbGetAll(TOUR_STORE); if(existing.length) return;
  let old=null;
  for(const key of ['lieferroute-v4','lieferroute-v3','lieferroute-v2','lieferroute-v1']){
    try{old=JSON.parse(localStorage.getItem(key)||'null');}catch{}
    if(old?.stops?.length||old?.addresses?.length) break;
  }
  if(!old) return;
  const stops=old.stops?.length?old.stops:old.addresses.map(a=>({name:'',address:a,postal:''}));
  const t=normalizeTour({name:'Übernommene Tour',source:'migration',stops,currentIndex:old.index||0});
  await dbPut(TOUR_STORE,t); await setMeta('currentTourId',t.id); currentTour=t;
}

async function renderHome(){
  await loadCurrent();
  if(currentTour){
    const st=routeStats(currentTour);
    $('resumeCard').classList.remove('hidden'); $('resumeName').textContent=currentTour.name;
    $('resumeMeta').textContent=`${st.done} zugestellt · ${st.notDelivered} nicht zugestellt · ${st.open} offen`;
  }else $('resumeCard').classList.add('hidden');
  updateHeader(); show('home');
}

function renderManual(){
  const wrap=$('manualStops'); wrap.innerHTML='';
  manualStops.forEach((s,i)=>{
    const d=document.createElement('div'); d.className='draft-stop';
    d.innerHTML=`<div class="stopText"><strong>${esc(s.name||'Ohne Kundenname')}</strong><small>${esc(fullAddress(s))}</small></div><button class="mini danger" data-rm="${i}">×</button>`;
    wrap.appendChild(d);
  });
  wrap.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{manualStops.splice(+b.dataset.rm,1);renderManual();});
}

function renderImported(){
  $('detectedCount').textContent=`${importedStops.length} Stopps`;
  const wrap=$('importStops');wrap.innerHTML='';
  importedStops.forEach((s,i)=>{
    const d=document.createElement('div');d.className='import-stop';
    d.innerHTML=`<div class="stopNumber">${i+1}</div><div class="editFields ${s.needsReview?'needsReview':''}">${s.needsReview?'<div class="reviewFlag">⚠ Bitte prüfen</div>':''}<input data-field="name" data-i="${i}" value="${esc(s.name)}" placeholder="Kundenname / Firma"><input data-field="address" data-i="${i}" value="${esc(s.address)}" placeholder="Adresse"><input data-field="postal" data-i="${i}" value="${esc(s.postal)}" placeholder="PLZ / Ort"></div><button class="mini danger" data-import-remove="${i}">×</button>`;
    wrap.appendChild(d);
  });
  wrap.querySelectorAll('input[data-field]').forEach(inp=>inp.oninput=()=>{
    const i=+inp.dataset.i; importedStops[i][inp.dataset.field]=inp.value.trimStart();
    importedStops[i].needsReview=!importedStops[i].address.trim()||!importedStops[i].postal.trim();
  });
  wrap.querySelectorAll('[data-import-remove]').forEach(b=>b.onclick=()=>{importedStops.splice(+b.dataset.importRemove,1);renderImported();});
}

function renderRoute(){
  if(!currentTour?.stops?.length){renderHome();return;}
  const st=routeStats(currentTour);
  renderOptimizationActions();
  $('routeName').textContent=currentTour.name;
  $('counter').textContent=`${st.done+st.notDelivered} von ${st.total} bearbeitet`;
  $('progressStats').textContent=`${st.open} offen`;
  $('routeProgress').value=st.total?((st.done+st.notDelivered)/st.total*100):0;
  $('routeFinished').classList.toggle('hidden',!st.completed);
  $('activeStop').classList.toggle('hidden',st.completed);
  if(st.completed){$('finishedText').textContent=`${st.done} zugestellt · ${st.notDelivered} nicht zugestellt`;show('route');return;}

  let idx=currentTour.currentIndex;
  if(idx<0||idx>=currentTour.stops.length) idx=nextPendingIndex(currentTour,0);
  currentTour.currentIndex=Math.max(0,idx);
  const s=currentTour.stops[currentTour.currentIndex];
  $('customer').textContent=s.name||'Kunde'; $('address').textContent=fullAddress(s)||'Adresse fehlt';
  const stateText={pending:'OFFEN',later:'SPÄTER',done:'ZUGESTELLT',not_delivered:'NICHT ZUGESTELLT'}[s.status]||'OFFEN';
  $('stopState').className=`stopState ${s.status}`;
  $('stopState').textContent=stateText; $('stopNote').value=s.note||''; $('noteDetails').open=!!s.note;
  $('previousStop').disabled=currentTour.currentIndex===0;
  show('route'); updateHeader();
}

async function renderSaved(){
  const tours=(await dbGetAll(TOUR_STORE)).map(normalizeTour).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const wrap=$('savedTours');wrap.innerHTML='';
  if(!tours.length){wrap.innerHTML='<p class="hint">Noch keine Touren gespeichert.</p>';show('savedScreen');return;}
  tours.forEach(t=>{
    const st=routeStats(t), pct=st.total?((st.done+st.notDelivered)/st.total*100):0;
    const d=document.createElement('div');d.className='savedCard';
    d.innerHTML=`<div class="savedHeader"><strong>${esc(t.name)}</strong><span class="badge ${st.completed?'done':'pending'}">${st.completed?'fertig':'aktiv'}</span></div><div class="savedMeta">${st.total} Stopps · ${st.done} zugestellt · ${st.notDelivered} nicht zugestellt</div><progress class="savedProgress" max="100" value="${pct}"></progress><div class="savedButtons"><button class="primary" data-open="${t.id}">${st.completed?'Ansehen':'Öffnen'}</button><button class="secondary square" data-dup="${t.id}" title="Duplizieren">⧉</button><button class="danger square" data-del="${t.id}" title="Löschen">×</button></div>`;
    wrap.appendChild(d);
  });
  wrap.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{currentTour=normalizeTour(await dbGet(TOUR_STORE,b.dataset.open));await setMeta('currentTourId',currentTour.id);renderRoute();});
  wrap.querySelectorAll('[data-dup]').forEach(b=>b.onclick=async()=>{
    const original=normalizeTour(await dbGet(TOUR_STORE,b.dataset.dup));
    const copy=normalizeTour({...original,id:uid(),name:original.name+' – Kopie',createdAt:now(),updatedAt:now(),currentIndex:0,stops:original.stops.map(s=>({...s,id:uid(),status:'pending',completedAt:null}))});
    await dbPut(TOUR_STORE,copy);await renderSaved();
  });
  wrap.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    const t=await dbGet(TOUR_STORE,b.dataset.del); if(!confirm(`Tour „${t?.name||''}“ wirklich löschen?`)) return;
    await dbDelete(TOUR_STORE,b.dataset.del); if(currentTour?.id===b.dataset.del){currentTour=null;await setMeta('currentTourId',null);} await renderSaved();
  });
  show('savedScreen');
}

function renderTourList(){
  if(!currentTour)return;
  renderOptimizationActions();
  const st=routeStats(currentTour);$('listTourName').textContent=currentTour.name;$('listStats').textContent=`${st.done} zugestellt · ${st.notDelivered} nicht zugestellt · ${st.open} offen`;
  const wrap=$('tourStopList');wrap.innerHTML='';
  currentTour.stops.forEach((s,i)=>{
    const statusLabel={pending:'offen',later:'später',done:'zugestellt',not_delivered:'nicht zugestellt'}[s.status]||s.status;
    const d=document.createElement('div');d.className='tourRow'+(i===currentTour.currentIndex?' current':'');
    d.innerHTML=`<div class="num">${i+1}</div><div class="main" data-jump="${i}"><strong>${esc(s.name||'Kunde')}</strong><small>${esc(fullAddress(s)||'Adresse fehlt')}</small><span class="badge ${s.status}">${statusLabel}</span></div><div class="tourRowActions"><button class="secondary" data-up="${i}" ${i===0?'disabled':''}>↑</button><button class="secondary" data-down="${i}" ${i===currentTour.stops.length-1?'disabled':''}>↓</button><button class="secondary" data-edit="${i}">✎</button></div>`;
    wrap.appendChild(d);
  });
  wrap.querySelectorAll('[data-jump]').forEach(el=>el.onclick=async()=>{currentTour.currentIndex=+el.dataset.jump;await saveCurrent();renderRoute();});
  wrap.querySelectorAll('[data-up]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const i=+b.dataset.up;[currentTour.stops[i-1],currentTour.stops[i]]=[currentTour.stops[i],currentTour.stops[i-1]];if(currentTour.currentIndex===i)currentTour.currentIndex=i-1;else if(currentTour.currentIndex===i-1)currentTour.currentIndex=i;await saveCurrent();renderTourList();});
  wrap.querySelectorAll('[data-down]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const i=+b.dataset.down;[currentTour.stops[i+1],currentTour.stops[i]]=[currentTour.stops[i],currentTour.stops[i+1]];if(currentTour.currentIndex===i)currentTour.currentIndex=i+1;else if(currentTour.currentIndex===i+1)currentTour.currentIndex=i;await saveCurrent();renderTourList();});
  wrap.querySelectorAll('[data-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openEditStop(+b.dataset.edit,'tourListScreen');});
  show('tourListScreen');
}

function openEditStop(index,returnTo='route',mode='edit'){
  editContext={index,returnTo,mode};
  const s=mode==='add'?stopTemplate():currentTour.stops[index];
  $('editStopTitle').textContent=mode==='add'?'Stopp hinzufügen':'Stopp bearbeiten';$('editName').value=s.name||'';$('editAddress').value=s.address||'';$('editPostal').value=s.postal||'';$('editNote').value=s.note||'';$('removeEditedStop').classList.toggle('hidden',mode==='add');show('editStopScreen');
}

async function advanceAfterStatus(status){
  const i=currentTour.currentIndex,s=currentTour.stops[i];s.status=status;s.completedAt=now();
  const next=nextPendingIndex(currentTour,i+1);currentTour.currentIndex=next>=0?next:i;await saveCurrent();renderRoute();
}

function setImportProgress(percent,text){$('importProgressWrap').classList.remove('hidden');$('importProgress').value=Math.max(0,Math.min(100,percent));$('importProgressText').textContent=text;}

// ----- OCR / Parser -----
function ocrLayoutText(data){
  const words=(data?.words||[]).filter(w=>cleanLine(w.text||'')&&w.bbox);
  if(!words.length) return cleanLine(data?.text||'')?data.text:'';
  const enriched=words.map(w=>{
    const b=w.bbox, h=Math.max(8,(b.y1||0)-(b.y0||0));
    return {text:cleanLine(w.text),x:b.x0||0,y:((b.y0||0)+(b.y1||0))/2,h};
  }).filter(w=>w.text);
  enriched.sort((a,b)=>a.y-b.y||a.x-b.x);
  const lines=[];
  for(const w of enriched){
    const last=lines[lines.length-1];
    const threshold=Math.max(8,Math.min(18,w.h*.7));
    if(last&&Math.abs(last.y-w.y)<=threshold){last.words.push(w);last.y=(last.y*(last.words.length-1)+w.y)/last.words.length;}
    else lines.push({y:w.y,words:[w]});
  }
  return lines.map(line=>line.words.sort((a,b)=>a.x-b.x).map(w=>w.text).join(' ')).join('\n');
}
async function ocrPdf(file){
  const bytes=new Uint8Array(await file.arrayBuffer()); const pdf=await pdfjsLib.getDocument({data:bytes}).promise; let allText='';
  for(let p=1;p<=pdf.numPages;p++){
    setImportProgress(5+Math.round(((p-1)/pdf.numPages)*78),`Seite ${p} von ${pdf.numPages} wird gelesen…`);
    const page=await pdf.getPage(p),viewport=page.getViewport({scale:2.6});
    const source=document.createElement('canvas'),sctx=source.getContext('2d',{willReadFrequently:true});source.width=Math.floor(viewport.width);source.height=Math.floor(viewport.height);await page.render({canvasContext:sctx,viewport}).promise;
    const cropX=Math.floor(source.width*.012),cropY=Math.floor(source.height*.075),cropW=Math.floor(source.width*.36),cropH=Math.floor(source.height*.87);
    const canvas=document.createElement('canvas');canvas.width=cropW;canvas.height=cropH;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,cropX,cropY,cropW,cropH,0,0,cropW,cropH);
    const img=ctx.getImageData(0,0,canvas.width,canvas.height),d=img.data;for(let i=0;i<d.length;i+=4){const g=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);let v=g>210?255:g<145?0:Math.max(0,Math.min(255,Math.round((g-145)*4.2)));d[i]=d[i+1]=d[i+2]=v;}ctx.putImageData(img,0,0);
    const result=await Tesseract.recognize(canvas,'deu',{logger:m=>{if(m.status==='recognizing text'){const base=5+((p-1)/pdf.numPages)*78,share=78/pdf.numPages;setImportProgress(Math.round(base+(m.progress||0)*share),`Seite ${p}/${pdf.numPages}: ${Math.round((m.progress||0)*100)}%`);}}});
    allText+=`\n===PAGE_${p}===\n${ocrLayoutText(result.data)||result.data.text}\n`;
  }return allText;
}
function cleanLine(s){return String(s||'').replace(/[|]+/g,' ').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();}
function isPageMarker(s){return /^===PAGE_\d+===$/.test(cleanLine(s));}
function isNoise(line){const s=cleanLine(line).toLowerCase();if(!s||isPageMarker(line))return true;return /tourenliste|morawa lesezirkel|hackinger|liefertag|lieferwoche|fahrer|tour:|seite \d|klasse|preis|kasse|\blieferung\b/.test(s)||/^kunde\b/i.test(s)||/^tel[:.]?/i.test(s)||/\bdw\s*\d+/.test(s)||/^(lieferpaket|kollektion|wunsch-kollektion|behältemappe|punktemappe)/i.test(s)||/^[\d\s.,/*()_-]+$/.test(s);}
function normalizeLines(text){const a=[];for(const raw of String(text||'').split(/\r?\n/)){let line=cleanLine(raw);if(!line)continue;if(isPageMarker(line)){a.push(line);continue;}const c=line.match(/^(.*?\d+[a-zA-Z]?)\s+(A[-\s]?\d{4}\s+.+)$/i);if(c&&!/tel[:.]?/i.test(line)){a.push(cleanLine(c[1]),cleanLine(c[2]));}else a.push(line);}return a;}
function parsePostal(line){line=cleanLine(line);const m=line.match(/^(?:A[-\s]?)?(\d{4})\s+(.+)$/i);if(!m)return null;let city=cleanLine(m[2]).replace(/\s+(?:tel|telefon)[:.].*$/i,'').replace(/[;,.:]+$/,'').trim();if(!city||/morawa|lesezirkel|hackinger|tel[:.]?|telefon|dw\s*\d+|©|@|www\./i.test(city))return null;return{postal:m[1],city};}
function inferPostalFromText(text){const s=cleanLine(text).toLowerCase();const map=[[/bad großpertholz|bad grosspertholz/,['3972','Bad Großpertholz']],[/moorbad harbach|moorheilbad harbach/,['3970','Moorbad Harbach']],[/groß gerungs|gross gerungs|gr\.?\s*gerungs/,['3920','Groß Gerungs']],[/alt nagelberg/,['3871','Alt Nagelberg']],[/heidenreichstein/,['3860','Heidenreichstein']],[/waidhofen/,['3830','Waidhofen/Thaya']],[/groß siegharts|gross siegharts/,['3812','Groß Siegharts']],[/raabs/,['3820','Raabs an der Thaya']],[/langschlag/,['3921','Langschlag']],[/schweiggers/,['3931','Schweiggers']],[/litschau/,['3874','Litschau']],[/schrems/,['3943','Schrems']],[/gmünd|gmuend/,['3950','Gmünd']],[/weitra/,['3970','Weitra']],[/gars(?:\/| am )kamp/,['3571','Gars/Kamp']]];for(const [re,[postal,city]] of map)if(re.test(s))return{postal,city};return null;}
function inferAddressFromText(name,text){const s=`${name} ${text}`;if(/böhm,\s*romana/i.test(s))return 'Stadtplatz 3';if(/hotel.*moorheilbad|moorheilbad.*hotel/i.test(s))return 'Bildbaumweg 1';return'';}
function looksLikeStopHeader(line){const s=cleanLine(line);return /^\d{1,3}\s+(?:k\s*n\s*r|knr)[.:]?\s*\d{4,}/i.test(s)||/^\d{1,3}\s+.{0,12}\b\d{6,7}\b/.test(s)||/^\d{1,3}\s+k\s*n/i.test(s);}
function extractStopNumber(line){const m=cleanLine(line).match(/^(\d{1,3})\b/);return m?+m[1]:null;}
function addressFromLine(line){
  const s=cleanLine(line).replace(/[;:]+$/,'').trim(); if(!s||isNoise(s)||parsePostal(s))return null;
  const street='straße|strasse|gasse|weg|platz|markt|ring|allee|zeile|berg|dorf|steig|gürtel|kai|lände|promenade';
  if(/^nr\.?\s*\d{1,4}[a-zA-Z]?$/i.test(s))return{address:s,nameBefore:''};
  const dash=s.match(/^(.*?)\s+-\s+(.+)$/);
  if(dash){
    const tail=cleanLine(dash[2]);
    const nested=addressFromLine(tail);
    if(nested)return{address:nested.address,nameBefore:[cleanLine(dash[1]),nested.nameBefore].filter(Boolean).join(' - ')};
  }
  const re=new RegExp(`((?:[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'\\/-]+\\s+){0,1}[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'\\/-]*(?:${street})\\s+\\d{1,4}[a-zA-Z]?)`,'ig');
  const matches=[...s.matchAll(re)];
  if(matches.length){
    const m=matches[matches.length-1],address=cleanLine(m[1]);
    return{address,nameBefore:cleanLine(s.slice(0,m.index))};
  }
  if(new RegExp(`\\b(${street})\\b`,'i').test(s)&&/\d/.test(s)&&s.split(/\s+/).length<=5)return{address:s,nameBefore:''};
  if(s.split(/\s+/).length<=4&&/^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'\-\/]{1,48}\s+\d{1,4}[a-zA-Z]?$/.test(s))return{address:s,nameBefore:''};
  return null;
}
function looksLikeAddress(line){return !!addressFromLine(line);}
function cleanNameLine(line){let s=cleanLine(line).replace(/^\d{1,3}\s+(?:k\s*n\s*r|knr)[.:]?\s*\d+\s*(?:\d+\/\d+)?\s*/i,'').replace(/^(?:k\s*n\s*r|knr)[.:]?\s*\d+\s*(?:\d+\/\d+)?\s*/i,'').trim();const embedded=addressFromLine(s);if(embedded?.nameBefore)s=embedded.nameBefore;if(!s||isNoise(s)||parsePostal(s)||looksLikeAddress(s)||/\b(?:k\s*n\s*r|knr)\b/i.test(s)||/^(?:nn|n|bel|bc|be)$/i.test(s)||/^(?:(?:mo|di|mi|do|fr|sa|so)(?:\b|[.:])|nü|b[h]?m|o\.b|immer|wenn|3\. edition)/i.test(s)||/\b(tel|telefon)\b/i.test(s)||/^\d+\s*\/\s*\d+/.test(s))return'';return s;}
function cleanDisplayName(name){return cleanLine(name).replace(/\s*[;:]\s*-\s*/g,' - ').replace(/\s*;\s*/g,' - ').replace(/\s*:\s*$/g,'').replace(/\s+-\s+-\s*/g,' - ').replace(/\s+-\s*$/,'').trim();}
function splitIntoBlocks(lines){const blocks=[];let cur=[],start=-1;const push=()=>{if(cur.length){cur._lineIndex=start;blocks.push(cur);cur=[];start=-1;}};for(let i=0;i<lines.length;i++){const line=lines[i];if(isPageMarker(line)){push();continue;}if(looksLikeStopHeader(line)){push();cur=[line];start=i;}else if(cur.length)cur.push(line);else if(!isNoise(line)){cur=[line];start=i;}}push();return blocks;}
function blockToStop(block){if(!block?.length)return null;while(block.length&&isNoise(block[0]))block.shift();if(!block.length)return null;const joined=block.join(' ');if(/nicht beliefert/i.test(joined))return null;const hasHeader=looksLikeStopHeader(block[0]),start=hasHeader?1:0,stopNo=extractStopNumber(block[0]);let postalIdx=-1,p=null;for(let i=start;i<block.length;i++){const x=parsePostal(block[i]);if(x){postalIdx=i;p=x;break;}}if(!p)p=inferPostalFromText(joined);let addr=-1,addrData=null,end=postalIdx>=0?postalIdx:block.length;for(let i=end-1;i>=start;i--){const found=addressFromLine(block[i]);if(found){addr=i;addrData=found;break;}}const names=[],nameEnd=addr>=0?addr+1:(postalIdx>=0?postalIdx:Math.min(block.length,start+5));for(let i=start;i<nameEnd;i++){const n=i===addr&&addrData?.nameBefore?cleanNameLine(addrData.nameBefore):cleanNameLine(block[i]);if(n)names.push(n);}let name=cleanDisplayName(names.slice(-3).join(' - ').trim()||`Stopp ${stopNo??'?'}`);const address=addrData?.address||inferAddressFromText(name,joined)||'',postal=p?`${p.postal} ${p.city}`:'';if(!postal||/tourenliste|morawa lesezirkel|hackinger/i.test(`${name} ${address} ${postal}`))return null;return{name,address,postal,needsReview:!address||name.startsWith('Stopp ')};}
function fallbackPostalStops(lines){const r=[];let prev=-1;for(let i=0;i<lines.length;i++){if(isPageMarker(lines[i])){prev=i;continue;}const p=parsePostal(lines[i]);if(!p)continue;const windowLines=lines.slice(Math.max(prev+1,i-8),i+1).join(' ');if(/nicht beliefert/i.test(windowLines)){prev=i;continue;}let a=-1,addrData=null;for(let j=i-1;j>=Math.max(prev+1,i-6);j--){const found=addressFromLine(lines[j]);if(found){a=j;addrData=found;break;}}if(a<0){prev=i;continue;}const names=[];const order=Math.max(prev+1,a-4);for(let j=order;j<=a;j++){const n=j===a&&addrData?.nameBefore?cleanNameLine(addrData.nameBefore):cleanNameLine(lines[j]);if(n)names.push(n);}const name=cleanDisplayName(names.slice(-3).join(' - ')||'Kunde');if(!/tourenliste|morawa lesezirkel|hackinger/i.test(name))r.push({name,address:addrData.address,postal:`${p.postal} ${p.city}`,needsReview:false,_order:order,_priority:1});prev=i;}return r;}
function sameStop(a,b){const n=s=>String(s||'').toLowerCase().replace(/[^a-z0-9äöüß]+/g,'');const samePlace=n(a.address)&&n(a.postal)&&n(a.address)===n(b.address)&&n(a.postal)===n(b.postal);if(!samePlace)return false;if(Number.isFinite(a._order)&&Number.isFinite(b._order))return Math.abs(a._order-b._order)<=5;return n(a.name)&&n(a.name)===n(b.name);}
function parseStops(text){const lines=normalizeLines(text);const structured=[];for(const line of lines){const sep=line.includes(';')?';':line.includes('\t')?'\t':null;if(!sep)continue;const parts=line.split(sep).map(cleanLine);if(parts.length<3)continue;const p=parsePostal(parts.slice(2).join(' '));if(p&&parts[0]&&!/kunde|firma|name/i.test(parts[0]))structured.push({name:parts[0],address:parts[1],postal:`${p.postal} ${p.city}`,needsReview:false});}if(structured.length>=2)return structured;const blocks=splitIntoBlocks(lines),primary=blocks.map(b=>{const s=blockToStop([...b]);if(s){s._order=b._lineIndex??0;s._priority=0;}return s;}).filter(Boolean),fallback=fallbackPostalStops(lines),merged=[];for(const s of [...primary,...fallback].sort((a,b)=>(a._order??0)-(b._order??0))){const dup=merged.findIndex(x=>sameStop(x,s));if(dup<0)merged.push(s);else if((s._priority??1)<(merged[dup]._priority??1))merged[dup]=s;}return merged.map(({_order,_priority,...s})=>s);}

// ----- Events -----
$('resumeTour').onclick=()=>renderRoute();
$('openImport').onclick=()=>show('importScreen');
$('openManual').onclick=()=>{show('manualScreen');renderManual();};
$('openSaved').onclick=()=>renderSaved();
$('openBackup').onclick=()=>show('backupScreen');
document.querySelectorAll('[data-home]').forEach(b=>b.onclick=()=>renderHome());
$('routeHome').onclick=()=>renderHome();
$('openTourList').onclick=()=>renderTourList();
$('viewFinishedList').onclick=()=>renderTourList();
$('finishToHome').onclick=()=>renderHome();
$('backToRoute').onclick=()=>renderRoute();

$('addManualStop').onclick=()=>{const s=stopTemplate({name:$('customerName').value.trim(),address:$('streetAddress').value.trim(),postal:$('postalCity').value.trim()});if(!s.address)return alert('Bitte eine Adresse eingeben.');manualStops.push(s);$('customerName').value='';$('streetAddress').value='';$('postalCity').value='';renderManual();};
$('saveManual').onclick=async()=>{if(!manualStops.length)return alert('Bitte mindestens einen Stopp hinzufügen.');const name=$('manualTourName').value.trim()||`Tour ${new Date().toLocaleDateString('de-AT')}`;currentTour=normalizeTour({name,source:'manual',stops:manualStops});manualStops=[];await saveCurrent();renderRoute();};

$('importFile').onchange=()=>{const f=$('importFile').files[0];$('importFileName').textContent=f?`${f.name} · ${Math.max(1,Math.round(f.size/1024))} KB`:'Noch keine Datei ausgewählt';if(f&&!$('importTourName').value)$('importTourName').value=f.name.replace(/\.[^.]+$/,'');};
$('runImport').onclick=async()=>{const file=$('importFile').files[0];if(!file)return alert('Bitte zuerst eine Datei auswählen.');importedStops=[];$('importResult').classList.add('hidden');setImportProgress(2,'Datei wird vorbereitet…');try{let text='',ext=(file.name.split('.').pop()||'').toLowerCase();if(ext==='txt'||ext==='csv'){text=await file.text();setImportProgress(80,'Text wird ausgewertet…');}else if(file.type==='application/pdf'||ext==='pdf'){if(!window.pdfjsLib||!window.Tesseract)throw new Error('OCR konnte nicht geladen werden. Bitte Internet prüfen.');text=await ocrPdf(file);}else if(file.type.startsWith('image/')){if(!window.Tesseract)throw new Error('OCR konnte nicht geladen werden.');const res=await Tesseract.recognize(file,'deu',{logger:m=>{if(m.status==='recognizing text')setImportProgress(10+Math.round((m.progress||0)*70),'Text wird erkannt…');}});text=res.data.text;}else throw new Error('Dateiformat nicht unterstützt.');setImportProgress(88,'Kunden und Adressen werden erkannt…');importedStops=parseStops(text).map(stopTemplate);if(!importedStops.length)throw new Error('Keine Stopps erkannt.');setImportProgress(100,`${importedStops.length} Stopps erkannt.`);renderImported();$('importResult').classList.remove('hidden');}catch(e){console.error(e);alert('Import fehlgeschlagen: '+e.message);$('importProgressWrap').classList.add('hidden');}};
$('saveImported').onclick=async()=>{const stops=importedStops.map(stopTemplate).filter(s=>s.name||s.address||s.postal);if(!stops.length)return alert('Keine gültigen Stopps vorhanden.');const name=$('importTourName').value.trim()||`Import ${new Date().toLocaleDateString('de-AT')}`;currentTour=normalizeTour({name,source:'import',stops});importedStops=[];await saveCurrent();renderRoute();};
$('clearImport').onclick=()=>{importedStops=[];$('importResult').classList.add('hidden');$('importProgressWrap').classList.add('hidden');$('importFile').value='';$('importFileName').textContent='Noch keine Datei ausgewählt';};

$('waze').onclick=()=>{const s=currentTour.stops[currentTour.currentIndex];window.location.href=`https://waze.com/ul?q=${encodeURIComponent(fullAddress(s))}&navigate=yes`;};
$('google').onclick=()=>{const s=currentTour.stops[currentTour.currentIndex];window.location.href=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleQuery(s))}`;};
$('done').onclick=()=>advanceAfterStatus('done');
$('notDelivered').onclick=()=>advanceAfterStatus('not_delivered');
$('later').onclick=async()=>{const i=currentTour.currentIndex,s=currentTour.stops.splice(i,1)[0];s.status='later';currentTour.stops.push(s);currentTour.currentIndex=Math.min(i,currentTour.stops.length-1);await saveCurrent();renderRoute();};
$('previousStop').onclick=async()=>{if(currentTour.currentIndex>0){currentTour.currentIndex--;await saveCurrent();renderRoute();}};
$('stopNote').oninput=async()=>{const s=currentTour.stops[currentTour.currentIndex];s.note=$('stopNote').value;await saveCurrent();};
$('editCurrent').onclick=()=>openEditStop(currentTour.currentIndex,'route','edit');

$('addStopFromList').onclick=()=>openEditStop(currentTour.stops.length,'tourListScreen','add');
$('resetStatuses').onclick=async()=>{if(!confirm('Alle Zustell-Status dieser Tour zurücksetzen?'))return;currentTour.stops.forEach(s=>{s.status='pending';s.completedAt=null;});currentTour.currentIndex=0;await saveCurrent();renderTourList();};
$('deleteCurrentTour').onclick=async()=>{if(!currentTour||!confirm(`Tour „${currentTour.name}“ wirklich löschen?`))return;const id=currentTour.id;await dbDelete(TOUR_STORE,id);currentTour=null;await setMeta('currentTourId',null);renderHome();};

$('cancelEditStop').onclick=()=>editContext.returnTo==='tourListScreen'?renderTourList():renderRoute();
$('saveEditedStop').onclick=async()=>{const s=stopTemplate({name:$('editName').value.trim(),address:$('editAddress').value.trim(),postal:$('editPostal').value.trim(),note:$('editNote').value.trim()});if(!s.address&&!s.name)return alert('Bitte mindestens Name oder Adresse eingeben.');if(editContext.mode==='add'){currentTour.stops.push(s);}else{const old=currentTour.stops[editContext.index];currentTour.stops[editContext.index]={...old,...s,id:old.id,status:old.status,completedAt:old.completedAt};}await saveCurrent();editContext.returnTo==='tourListScreen'?renderTourList():renderRoute();};
$('removeEditedStop').onclick=async()=>{if(editContext.mode==='add')return;if(!confirm('Diesen Stopp wirklich löschen?'))return;currentTour.stops.splice(editContext.index,1);currentTour.currentIndex=Math.min(currentTour.currentIndex,Math.max(0,currentTour.stops.length-1));await saveCurrent();renderTourList();};

function downloadBlob(name,type,content){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('exportBackup').onclick=async()=>{const tours=await dbGetAll(TOUR_STORE),meta={currentTourId:await getMeta('currentTourId')};downloadBlob(`LieferRoute-Backup-${new Date().toISOString().slice(0,10)}.json`,'application/json',JSON.stringify({version:5,exportedAt:now(),tours,meta},null,2));};
$('restoreFile').onchange=async()=>{const f=$('restoreFile').files[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.tours))throw new Error('Ungültiges Backup');if(!confirm(`${data.tours.length} Touren aus Backup importieren? Vorhandene Touren bleiben erhalten.`))return;for(const t of data.tours){const n=normalizeTour(t);const exists=await dbGet(TOUR_STORE,n.id);if(exists)n.id=uid();await dbPut(TOUR_STORE,n);}alert('Backup importiert.');$('restoreFile').value='';await renderHome();}catch(e){alert('Backup konnte nicht gelesen werden: '+e.message);}};
$('exportCsv').onclick=()=>{if(!currentTour)return alert('Keine aktive Tour.');const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const rows=[['Nr','Kunde','Adresse','PLZ Ort','Status','Notiz'],...currentTour.stops.map((s,i)=>[i+1,s.name,s.address,s.postal,s.status,s.note])];downloadBlob(`${currentTour.name.replace(/[^a-z0-9äöüß_-]+/gi,'_')}.csv`,'text/csv;charset=utf-8','\ufeff'+rows.map(r=>r.map(q).join(';')).join('\n'));};

async function init(){
  try{db=await openDB();await migrateV4();await renderHome();}
  catch(e){console.error(e);alert('Lokaler Speicher konnte nicht geöffnet werden. Bitte Safari/Browser neu starten.');}
  if('serviceWorker'in navigator){
    const wasControlled=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(wasControlled)$('appUpdateNotice').classList.remove('hidden');
    });
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(error=>console.warn('Offline-App konnte nicht aktualisiert werden.',error));
  }
}
$('reloadApp').onclick=()=>window.location.reload();
// All screen handlers must be attached before a saved tour can be opened.
window.addEventListener('DOMContentLoaded',init,{once:true});
