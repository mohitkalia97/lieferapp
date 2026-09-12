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
  return s.replace(/\s+/g,' ').replace(/[|]+/g,' ').trim();
}
function looksLikeStreet(line){
  if(!line || line.length<3) return false;
  if(/^(tel|telefon|knr|kunde|lieferung|klasse|preis|kasse|seite|tour|fahrer|liefertag|lieferwoche)/i.test(line)) return false;
  if(/\b\d{1,4}[a-zA-Z]?\b/.test(line) && /(straße|strasse|gasse|weg|platz|markt|ring|allee|zeile|berg|dorf|nr\.?|hauptplatz|stadtplatz|kreuzberg|bildbaumweg)/i.test(line)) return true;
  return false;
}
function looksLikeNoise(line){
  return !line ||
    /^(tel|telefon|knr|kunde|lieferung|klasse|preis|kasse|seite|tour|fahrer|liefertag|lieferwoche|rech\.?|bankeinzug|kollektion|lieferpaket|behältemappe|wunsch-kollektion)/i.test(line) ||
    /^[\d\s.,/*-]+$/.test(line);
}

function parseStops(text){
  const raw=text.split(/\r?\n/).map(cleanLine).filter(Boolean);

  // CSV/TXT mit Semikolon/Tab: Name ; Adresse ; PLZ Ort
  const structured=[];
  for(const line of raw){
    const sep=line.includes(';')?';':(line.includes('\t')?'\t':null);
    if(sep){
      const parts=line.split(sep).map(cleanLine);
      if(parts.length>=3 && /\b\d{4}\b/.test(parts[2])){
        structured.push({name:parts[0],address:parts[1],postal:parts.slice(2).join(' ')});
      }
    }
  }
  if(structured.length>=2) return structured;

  // Morawa-/OCR-Parser: findet A-1234 Ort bzw. 1234 Ort und die Straße davor.
  const stops=[];
  let lastPostalIdx=-1;

  for(let i=0;i<raw.length;i++){
    let line=raw[i];
    const postalMatch=line.match(/\bA[-\s]?(\d{4})\s+(.{2,})$/i) ||
                      line.match(/(?:^|\s)(\d{4})\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .\/-]{2,})$/);

    if(!postalMatch) continue;

    let postal=`${postalMatch[1]} ${postalMatch[2]}`.replace(/\s+/g,' ').trim();
    postal=postal.replace(/[|]+$/,'').trim();

    let streetIdx=-1;
    for(let j=i-1;j>=Math.max(lastPostalIdx+1,i-7);j--){
      if(looksLikeStreet(raw[j])){
        streetIdx=j;
        break;
      }
    }
    if(streetIdx<0){
      for(let j=i-1;j>=Math.max(lastPostalIdx+1,i-5);j--){
        if(/\d/.test(raw[j]) && !looksLikeNoise(raw[j])){
          streetIdx=j;
          break;
        }
      }
    }
    if(streetIdx<0) { lastPostalIdx=i; continue; }

    const address=raw[streetIdx]
      .replace(/^A[-\s]?\d{4}\s+/i,'')
      .trim();

    const candidateNames=[];
    for(let j=Math.max(lastPostalIdx+1,streetIdx-4);j<streetIdx;j++){
      let n=raw[j]
        .replace(/^\d+\s+KNr[:.]?\s*\d+\s*/i,'')
        .replace(/^KNr[:.]?\s*\d+\s*/i,'')
        .trim();
      if(!looksLikeNoise(n) && n.length>2 && !/^\d+\s*\/\s*\d+/.test(n)){
        candidateNames.push(n);
      }
    }

    let name=candidateNames.slice(-2).join(' – ');
    if(!name) name='Kunde';

    // Duplicate OCR fragments reduzieren
    name=name.replace(/\s{2,}/g,' ').trim();

    stops.push({name,address,postal});
    lastPostalIdx=i;
  }

  // Doppelte OCR-Erkennungen direkt hintereinander entfernen
  const dedup=[];
  for(const s of stops){
    const key=(s.name+'|'+s.address+'|'+s.postal).toLowerCase();
    if(!dedup.some(x=>(x.name+'|'+x.address+'|'+x.postal).toLowerCase()===key)){
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
