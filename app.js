const KEY='lieferroute-v4';
const $=id=>document.getElementById(id);
let state=JSON.parse(localStorage.getItem(KEY)||'null');
let manualStops=[];
let importedStops=[];

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function hideAll(){
  ['home','importScreen','manualScreen','route'].forEach(id=>$(id).classList.add('hidden'));
}
function show(id){
  hideAll();
  $(id).classList.remove('hidden');
}
function save(){
  localStorage.setItem(KEY,JSON.stringify(state));
  renderRoute();
}
function fullAddress(s){
  return [s.address,s.postal].filter(Boolean).join(', ');
}
function googleQuery(s){
  return [s.name,s.address,s.postal].filter(Boolean).join(', ');
}
function esc(s){
  return String(s||'').replace(/[&<>"']/g,m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

function renderRoute(){
  if(!state?.stops?.length){
    $('status').textContent='Keine Tour';
    show('home');
    return;
  }
  show('route');
  const i=Math.min(state.index,state.stops.length-1);
  const s=state.stops[i];
  $('counter').textContent=`Stopp ${i+1} von ${state.stops.length}`;
  $('status').textContent=`${i+1}/${state.stops.length}`;
  $('customer').textContent=s.name || 'Kunde';
  $('address').textContent=fullAddress(s);
  $('routeProgress').value=((i+1)/state.stops.length)*100;
  $('back').disabled=i===0;
}

function renderManual(){
  const wrap=$('manualStops');
  wrap.innerHTML='';
  manualStops.forEach((s,i)=>{
    const d=document.createElement('div');
    d.className='draft-stop';
    d.innerHTML=`
      <div class="stopText">
        <strong>${esc(s.name||'Ohne Kundenname')}</strong>
        <small>${esc(fullAddress(s))}</small>
      </div>
      <button class="mini danger" data-manual-remove="${i}">Entfernen</button>`;
    wrap.appendChild(d);
  });
  wrap.querySelectorAll('[data-manual-remove]').forEach(b=>{
    b.onclick=()=>{
      manualStops.splice(Number(b.dataset.manualRemove),1);
      renderManual();
    };
  });
}

function renderImported(){
  $('detectedCount').textContent=`${importedStops.length} Stopps`;
  const wrap=$('importStops');
  wrap.innerHTML='';

  importedStops.forEach((s,i)=>{
    const d=document.createElement('div');
    d.className='import-stop';
    d.innerHTML=`
      <div class="stopNumber">${i+1}</div>
      <div class="editFields">
        <input data-field="name" data-i="${i}" value="${esc(s.name)}" placeholder="Kundenname / Firma">
        <input data-field="address" data-i="${i}" value="${esc(s.address)}" placeholder="Adresse">
        <input data-field="postal" data-i="${i}" value="${esc(s.postal)}" placeholder="PLZ / Ort">
      </div>
      <button class="mini danger" data-import-remove="${i}">×</button>`;
    wrap.appendChild(d);
  });

  wrap.querySelectorAll('input[data-field]').forEach(inp=>{
    inp.oninput=()=>{
      importedStops[Number(inp.dataset.i)][inp.dataset.field]=inp.value.trimStart();
    };
  });

  wrap.querySelectorAll('[data-import-remove]').forEach(b=>{
    b.onclick=()=>{
      importedStops.splice(Number(b.dataset.importRemove),1);
      renderImported();
    };
  });
}

$('openImport').onclick=()=>show('importScreen');
$('openManual').onclick=()=>{show('manualScreen');renderManual();};
document.querySelectorAll('[data-home]').forEach(b=>b.onclick=()=>show('home'));

$('addStop').onclick=()=>{
  const name=$('customerName').value.trim();
  const address=$('streetAddress').value.trim();
  const postal=$('postalCity').value.trim();
  if(!address) return alert('Bitte eine Adresse eingeben.');
  manualStops.push({name,address,postal});
  $('customerName').value='';
  $('streetAddress').value='';
  $('postalCity').value='';
  $('customerName').focus();
  renderManual();
};

$('startManual').onclick=()=>{
  if(!manualStops.length) return alert('Bitte mindestens einen Stopp hinzufügen.');
  state={stops:[...manualStops],index:0,startedAt:new Date().toISOString()};
  manualStops=[];
  save();
};

$('importFile').onchange=()=>{
  const f=$('importFile').files[0];
  $('importFileName').textContent=f ? `${f.name} · ${Math.max(1,Math.round(f.size/1024))} KB` : 'Noch keine Datei ausgewählt';
};

function setImportProgress(percent,text){
  $('importProgressWrap').classList.remove('hidden');
  $('importProgress').value=Math.max(0,Math.min(100,percent));
  $('importProgressText').textContent=text;
}

$('runImport').onclick=async()=>{
  const file=$('importFile').files[0];
  if(!file) return alert('Bitte zuerst eine Datei auswählen.');

  importedStops=[];
  $('importResult').classList.add('hidden');
  setImportProgress(2,'Datei wird vorbereitet…');

  try{
    let text='';
    const ext=(file.name.split('.').pop()||'').toLowerCase();

    if(ext==='txt' || ext==='csv'){
      text=await file.text();
      setImportProgress(80,'Text wird ausgewertet…');
    } else if(file.type==='application/pdf' || ext==='pdf'){
      if(!window.pdfjsLib || !window.Tesseract) throw new Error('OCR-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.');
      text=await ocrPdf(file);
    } else if(file.type.startsWith('image/')){
      if(!window.Tesseract) throw new Error('OCR-Bibliothek konnte nicht geladen werden.');
      setImportProgress(10,'Foto wird gelesen…');
      const res=await Tesseract.recognize(file,'deu',{
        logger:m=>{
          if(m.status==='recognizing text'){
            setImportProgress(10+Math.round((m.progress||0)*70),'Text wird erkannt…');
          }
        }
      });
      text=res.data.text;
    } else {
      throw new Error('Dateiformat nicht unterstützt.');
    }

    setImportProgress(88,'Kunden und Adressen werden erkannt…');
    importedStops = parseStops(text);

    if(!importedStops.length){
      throw new Error('Keine eindeutigen Adressen erkannt. Versuch bitte ein schärferes PDF/Foto oder eine TXT/CSV-Datei.');
    }

    setImportProgress(100,`${importedStops.length} Stopps erkannt.`);
    renderImported();
    $('importResult').classList.remove('hidden');
  }catch(err){
    console.error(err);
    alert('Import fehlgeschlagen: '+err.message);
    $('importProgressWrap').classList.add('hidden');
  }
};

async function ocrPdf(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
  let allText='';

  for(let p=1;p<=pdf.numPages;p++){
    setImportProgress(
      5+Math.round(((p-1)/pdf.numPages)*78),
      `Seite ${p} von ${pdf.numPages} wird gelesen…`
    );

    const page=await pdf.getPage(p);
    const viewport=page.getViewport({scale:1.9});
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    canvas.width=Math.floor(viewport.width);
    canvas.height=Math.floor(viewport.height);

    await page.render({canvasContext:ctx,viewport}).promise;

    const result=await Tesseract.recognize(canvas,'deu',{
      logger:m=>{
        if(m.status==='recognizing text'){
          const pageBase=5+((p-1)/pdf.numPages)*78;
          const pageShare=78/pdf.numPages;
          setImportProgress(
            Math.round(pageBase+(m.progress||0)*pageShare),
            `Seite ${p}/${pdf.numPages}: ${Math.round((m.progress||0)*100)}%`
          );
        }
      }
    });
    allText += '\n'+result.data.text+'\n';
  }
  return allText;
}

function cleanLine(s){
  return s
    .replace(/[|]+/g,' ')
    .replace(/\s+/g,' ')
    .replace(/[–—]/g,'-')
    .trim();
}

function isHeaderOrNoise(line){
  const s=(line||'').toLowerCase();
  return !s ||
    /tourenliste|morawa lesezirkel|hackinger|liefertag|lieferwoche|fahrer|tour:|seite \d|klasse|preis|kasse|rechnung|bankeinzug|lieferpaket|kollektion|behältemappe|wunsch-kollektion/.test(s) ||
    /\btel[:.]?\b|\btelefon\b|\bdw\s*\d+/.test(s) ||
    /\b\d{1,2}\.\d{1,2}\.\d{4}\b/.test(s) ||
    /^[\d\s.,/*()_-]+$/.test(s);
}

function normalizeOcrLines(text){
  const out=[];
  for(let rawLine of text.split(/\r?\n/)){
    let line=cleanLine(rawLine);
    if(!line) continue;

    // OCR hängt Straße und "A-1234 Ort" manchmal in dieselbe Zeile.
    const combined=line.match(/^(.*?\d+[a-zA-Z]?)\s+(A[- ]?\d{4}\s+.+)$/i);
    if(combined && !/tel[:.]?/i.test(line)){
      out.push(cleanLine(combined[1]));
      out.push(cleanLine(combined[2]));
      continue;
    }
    out.push(line);
  }
  return out;
}

function parsePostalLine(line){
  if(!line) return null;

  // Die PLZ muss am ANFANG stehen. Dadurch wird z.B. eine Telefonnummer nicht zur Adresse.
  const m=line.match(/^(?:A[- ]?)?(\d{4})\s+(.+)$/i);
  if(!m) return null;

  let city=cleanLine(m[2])
    .replace(/\s+(?:tel|telefon)[:.].*$/i,'')
    .replace(/\s{2,}/g,' ')
    .trim();

  // Header/Telefonzeilen wie "1140 Wien, Tel: ..." explizit verwerfen.
  if(!city || /tel[:.]?|telefon|morawa|lesezirkel|hackinger|dw\s*\d+|@|www\.|©/.test(city.toLowerCase())) return null;
  if(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/.test(city)) return null;
  if(city.length>45) return null;

  return {postal:m[1], city};
}

function looksLikeStreet(line){
  if(!line || isHeaderOrNoise(line)) return false;
  const s=line.trim();

  // Klassische österreichische Straßennamen.
  const streetWord=/(straße|strasse|gasse|weg|platz|markt|ring|allee|zeile|berg|dorf|steig|gürtel|kai|lände|promenade|hauptplatz|stadtplatz|kreuzberg|bildbaumweg)/i;
  if(streetWord.test(s) && /\b\d{1,4}[a-zA-Z]?\b/.test(s)) return true;

  // Sonderfälle der Tourenlisten wie "Bad Großpertholz 72" oder "Nr. 72".
  if(/^nr\.?\s*\d{1,4}[a-zA-Z]?$/i.test(s)) return true;
  if(/^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'\-\/]{2,35}\s+\d{1,4}[a-zA-Z]?$/.test(s)){
    if(!/\b(knr|tel|tour|fahrer|seite|liefer|klasse|preis)\b/i.test(s)) return true;
  }
  return false;
}

function cleanCustomerLine(line){
  let s=cleanLine(line)
    .replace(/^\d+\s+KNr[:.]?\s*\d+\s*(?:\d+\/\d+)?\s*/i,'')
    .replace(/^KNr[:.]?\s*\d+\s*(?:\d+\/\d+)?\s*/i,'')
    .replace(/^\d+\s+(?=Dr\.|Praxis|Friseur|Bäck|Cafe|Café|Land|Hotel|Studio|Rehab|Tennis|Haar|Moor|Gesund)/i,'')
    .trim();

  if(isHeaderOrNoise(s)) return '';
  if(/^(mo|di|mi|do|fr|sa|so|nü|b[h]?m|o\.b|immer|wenn|rechnung|3\. edition)/i.test(s)) return '';
  if(/^\d+\s*\/\s*\d+/.test(s)) return '';
  return s;
}

function parseStops(text){
  const raw=normalizeOcrLines(text);

  // CSV/TXT: Name ; Adresse ; PLZ Ort
  const structured=[];
  for(const line of raw){
    const sep=line.includes(';')?';':(line.includes('\t')?'\t':null);
    if(!sep) continue;
    const parts=line.split(sep).map(cleanLine);
    if(parts.length<3) continue;
    const postal=parsePostalLine(parts.slice(2).join(' '));
    if(postal){
      structured.push({
        name:parts[0],
        address:parts[1],
        postal:`${postal.postal} ${postal.city}`
      });
    }
  }
  if(structured.length>=2) return structured;

  const stops=[];
  let previousPostalIndex=-1;

  for(let i=0;i<raw.length;i++){
    const p=parsePostalLine(raw[i]);
    if(!p) continue;

    // Nur übernehmen, wenn davor wirklich eine plausible Straßenzeile steht.
    let streetIdx=-1;
    for(let j=i-1;j>=Math.max(previousPostalIndex+1,i-6);j--){
      if(looksLikeStreet(raw[j])){
        streetIdx=j;
        break;
      }
    }

    // Kein "irgendeine Zeile mit Zahl"-Fallback mehr:
    // genau der hat bisher den Morawa-Header als Kunden erkannt.
    if(streetIdx<0){
      previousPostalIndex=i;
      continue;
    }

    const address=cleanLine(raw[streetIdx]);
    const postal=`${p.postal} ${p.city}`;

    // Kunden-/Firmennamen direkt über der Straße suchen.
    const candidateNames=[];
    for(let j=Math.max(previousPostalIndex+1,streetIdx-4);j<streetIdx;j++){
      const n=cleanCustomerLine(raw[j]);
      if(n && n.length>=3 && !looksLikeStreet(n)){
        candidateNames.push(n);
      }
    }

    // Für Google Maps sind die letzten 2-3 aussagekräftigen Namenszeilen am nützlichsten.
    let name=candidateNames.slice(-3).join(' - ').trim();
    if(!name) name='Kunde';

    // Nochmals Schutz gegen Kopfzeilen.
    const whole=(name+' '+address+' '+postal).toLowerCase();
    if(/morawa lesezirkel|tourenliste|hackinger|liefertag|lieferwoche/.test(whole)){
      previousPostalIndex=i;
      continue;
    }

    stops.push({name,address,postal});
    previousPostalIndex=i;
  }

  // Identische OCR-Duplikate entfernen, echte doppelte Zustellstopps an derselben
  // Adresse mit unterschiedlichem Kundennamen aber beibehalten.
  const seen=new Set();
  const dedup=[];
  for(const s of stops){
    const key=(s.name+'|'+s.address+'|'+s.postal).toLowerCase().replace(/\s+/g,' ');
    if(!seen.has(key)){
      seen.add(key);
      dedup.push(s);
    }
  }
  return dedup;
}

$('startImported').onclick=()=>{
  importedStops=importedStops
    .map(s=>({name:s.name.trim(),address:s.address.trim(),postal:s.postal.trim()}))
    .filter(s=>s.address);

  if(!importedStops.length) return alert('Keine gültigen Stopps vorhanden.');
  state={stops:[...importedStops],index:0,startedAt:new Date().toISOString()};
  importedStops=[];
  save();
};

$('clearImport').onclick=()=>{
  importedStops=[];
  $('importResult').classList.add('hidden');
  $('importProgressWrap').classList.add('hidden');
  $('importFile').value='';
  $('importFileName').textContent='Noch keine Datei ausgewählt';
};

$('waze').onclick=()=>{
  const s=state.stops[state.index];
  const q=encodeURIComponent(fullAddress(s));
  window.location.href=`https://waze.com/ul?q=${q}&navigate=yes`;
};

$('google').onclick=()=>{
  const s=state.stops[state.index];
  const q=encodeURIComponent(googleQuery(s));
  window.location.href=`https://www.google.com/maps/search/?api=1&query=${q}`;
};

$('done').onclick=()=>{
  if(state.index<state.stops.length-1){state.index++;save();}
  else alert('Tour fertig! 🎉');
};

$('skip').onclick=()=>{
  if(state.index<state.stops.length-1){state.index++;save();}
  else alert('Das ist bereits der letzte Stopp.');
};

$('back').onclick=()=>{
  if(state.index>0){state.index--;save();}
};

$('reset').onclick=()=>{
  if(confirm('Aktuelle Tour wirklich beenden und löschen?')){
    localStorage.removeItem(KEY);
    state=null;
    $('status').textContent='Keine Tour';
    show('home');
  }
};

if(state?.stops?.length) renderRoute();
else show('home');

if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
