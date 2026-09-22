const routeClient=RoutePlanner.createClient();
let optimizationRun=null;
let optimizationPreview=null;
let optimizationReturnTo='tourListScreen';
let optimizationMessage=null;

function checkOptimizationAbort(signal){
  if(signal.aborted)throw new DOMException('Abgebrochen','AbortError');
}

function tourFingerprint(tour){
  return JSON.stringify({id:tour.id,stops:tour.stops.map(s=>[s.id,s.name,s.address,s.postal,s.status,s.note,s.completedAt])});
}

function renderOptimizationActions(){
  const open=currentTour?.stops.filter(s=>s.status==='pending'||s.status==='later').length||0;
  $('optimizeFromRoute').classList.toggle('hidden',open<2);
  $('optimizeFromList').disabled=open<2;
  $('undoOptimization').classList.toggle('hidden',!RoutePlanner.undoAvailable(currentTour));
  const message=optimizationMessage?.tourId===currentTour?.id?optimizationMessage.text:'';
  $('optimizationNotice').textContent=message;
  $('optimizationNotice').classList.toggle('hidden',!message);
}

function optimizationError(message=''){
  $('optimizationError').textContent=message;
  $('optimizationError').classList.toggle('hidden',!message);
}

function optimizationProgress(percent,message){
  $('optimizationProgress').value=percent;
  $('optimizationProgressText').textContent=message;
}

function setOptimizationBusy(busy){
  $('optimizationSettings').disabled=busy;
  $('calculateOptimization').disabled=busy;
  $('optimizationProgressWrap').classList.toggle('hidden',!busy);
  $('optimizationForm').setAttribute('aria-busy',String(busy));
}

function invalidateOptimization(){
  optimizationPreview=null;
  $('optimizationPreview').classList.add('hidden');
  const count=RoutePlanner.eligible(currentTour?.stops||[],$('optimizationIncludeLater').checked).length;
  $('optimizationCount').textContent=`${count} Stopps zur Planung`;
  $('startAddressGroup').classList.toggle('hidden',!document.querySelector('input[name="routeStart"][value="address"]').checked);
  $('optimizationStartAddress').required=document.querySelector('input[name="routeStart"][value="address"]').checked;
}

function cancelOptimization(){
  if(!optimizationRun)return;
  const controller=optimizationRun;
  optimizationRun=null;
  controller.abort();
  setOptimizationBusy(false);
  $('locationChoice').classList.add('hidden');
}

function openOptimization(returnTo){
  if(!currentTour)return;
  cancelOptimization();
  optimizationReturnTo=returnTo;
  optimizationError();
  invalidateOptimization();
  show('optimizeScreen');
}

function getStartPosition(signal){
  return new Promise((resolve,reject)=>{
    if(!window.isSecureContext||!navigator.geolocation)return reject(new Error('Standort nicht verfügbar. Bitte eine Startadresse oder den ersten offenen Stopp wählen.'));
    let finished=false;
    const finish=(error,point)=>{
      if(finished)return;
      finished=true;
      signal.removeEventListener('abort',cancel);
      error?reject(error):resolve(point);
    };
    const cancel=()=>finish(new DOMException('Abgebrochen','AbortError'));
    if(signal.aborted)return cancel();
    signal.addEventListener('abort',cancel,{once:true});
    navigator.geolocation.getCurrentPosition(p=>{
      if(p.coords.accuracy>1000)return finish(new Error('Dein Standort ist zu ungenau. Bitte eine Startadresse oder den ersten offenen Stopp wählen.'));
      const point={lat:p.coords.latitude,lon:p.coords.longitude,label:'Mein Standort'};
      if(!RoutePlanner.validPoint(point))return finish(new Error('Kein gültiger Standort verfügbar. Bitte eine Startadresse wählen.'));
      finish(null,point);
    },()=>finish(new Error('Standort nicht verfügbar oder nicht freigegeben. Bitte eine Startadresse oder den ersten offenen Stopp wählen.')),
    {enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  });
}

function chooseLocation(stop,initial,country,signal){
  return new Promise((resolve,reject)=>{
    let options=initial,settled=false;
    const panel=$('locationChoice');
    panel.classList.remove('hidden');
    $('locationChoiceName').textContent=stop.name||'Startpunkt';
    $('locationChoiceAddress').textContent=fullAddress(stop);
    $('locationSearchQuery').value=fullAddress(stop);
    $('locationSearchButton').disabled=false;
    const finish=(error,point)=>{
      if(settled)return;
      settled=true;
      signal.removeEventListener('abort',cancel);
      panel.classList.add('hidden');
      $('locationSearchForm').onsubmit=null;
      $('confirmLocationChoice').onclick=null;
      error?reject(error):resolve(point);
    };
    const cancel=()=>finish(new DOMException('Abgebrochen','AbortError'));
    if(signal.aborted)return cancel();
    signal.addEventListener('abort',cancel,{once:true});
    function renderChoices(){
      const container=$('locationCandidates');
      container.querySelectorAll('label').forEach(el=>el.remove());
      $('confirmLocationChoice').disabled=true;
      $('locationChoiceMessage').textContent=options.length?'Kein eindeutiger Adresstreffer. Bitte den passenden Standort auswählen.':'Keine passende Adresse gefunden. Bitte Straße, Hausnummer und Ort prüfen.';
      options.forEach((point,i)=>{
        const label=document.createElement('label');label.className='locationCandidate';
        const radio=document.createElement('input');radio.type='radio';radio.name='locationCandidate';radio.value=String(i);
        radio.onchange=()=>{$('confirmLocationChoice').disabled=false;};
        const text=document.createElement('span');text.textContent=point.label;
        label.append(radio,text);container.appendChild(label);
      });
    }
    renderChoices();
    $('locationSearchForm').onsubmit=async event=>{
      event.preventDefault();
      const query=$('locationSearchQuery').value.trim();if(!query)return;
      $('locationSearchButton').disabled=true;$('confirmLocationChoice').disabled=true;
      $('locationCandidates').disabled=true;
      $('locationChoiceMessage').textContent='Adresse wird gesucht…';
      try{
        const found=await routeClient.geocode({address:query,postal:''},country,signal);
        if(settled)return;
        options=found;renderChoices();
      }catch(error){if(!settled)$('locationChoiceMessage').textContent=error.message;}
      finally{if(!settled){$('locationSearchButton').disabled=false;$('locationCandidates').disabled=false;}}
    };
    $('locationCandidates').disabled=false;
    $('confirmLocationChoice').onclick=()=>{
      const selected=document.querySelector('input[name="locationCandidate"]:checked');
      if(selected&&options[Number(selected.value)])finish(null,options[Number(selected.value)]);
    };
    panel.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
}

async function locateStop(stop,country,signal){
  const key='route-location-v1:'+RoutePlanner.addressKey(stop,country);
  const cached=await getMeta(key);
  checkOptimizationAbort(signal);
  if(RoutePlanner.validPoint(cached?.point))return cached.point;
  const options=await routeClient.geocode(stop,country,signal);
  checkOptimizationAbort(signal);
  const point=RoutePlanner.exactMatch(stop,options,country)||await chooseLocation(stop,options,country,signal);
  checkOptimizationAbort(signal);
  await setMeta(key,{point,locatedAt:now()});
  return point;
}

function formatDrivingTime(seconds){
  const minutes=Math.round(seconds/60);
  if(minutes<1)return '< 1 Min.';
  return minutes>=60?`${Math.floor(minutes/60)} Std. ${minutes%60} Min.`:`${minutes} Min.`;
}

function showOptimizationPreview(preview){
  const {plan,orderedStops,startLabel}=preview;
  $('optimizationBefore').textContent=formatDrivingTime(plan.before.duration);
  $('optimizationAfter').textContent=formatDrivingTime(plan.after.duration);
  $('optimizationSaving').textContent=plan.savedSeconds>0?formatDrivingTime(plan.savedSeconds):'0 Min.';
  $('optimizationDistance').textContent=`${(plan.before.distance/1000).toLocaleString('de-AT',{maximumFractionDigits:1})} km bisher · ${(plan.after.distance/1000).toLocaleString('de-AT',{maximumFractionDigits:1})} km vorgeschlagen · Ohne Rückfahrt`;
  $('optimizationStartLabel').textContent=`Start: ${startLabel}`;
  const changed=orderedStops.some((s,i)=>s.id!==preview.originalIds[i]);
  $('optimizationResultTitle').textContent=changed?'Neue Reihenfolge':'Aktuelle Reihenfolge beibehalten';
  const wrap=$('optimizationStopPreview');wrap.replaceChildren();
  orderedStops.forEach(stop=>{
    const li=document.createElement('li'),name=document.createElement('strong'),address=document.createElement('small');
    name.textContent=stop.name||'Kunde';address.textContent=fullAddress(stop);li.append(name,address);wrap.appendChild(li);
  });
  $('applyOptimization').disabled=!changed;
  $('optimizationPreview').classList.remove('hidden');
}

async function calculateOptimization(event){
  event.preventDefault();
  if(optimizationRun||!currentTour)return;
  optimizationError();invalidateOptimization();
  const stops=RoutePlanner.eligible(currentTour.stops,$('optimizationIncludeLater').checked);
  if(stops.length<2){optimizationError('Mindestens zwei offene Stopps nötig. Bei Bedarf „Später“-Stopps einbeziehen.');return;}
  if(stops.length>RoutePlanner.MAX_STOPS){optimizationError(`Es können bis zu ${RoutePlanner.MAX_STOPS} Stopps auf einmal geplant werden. Bitte die Tour aufteilen.`);return;}
  if(new Set(currentTour.stops.map(s=>s.id)).size!==currentTour.stops.length){optimizationError('Diese Tour enthält doppelte Stopp-IDs. Bitte die betroffenen Stopps neu anlegen.');return;}
  const missing=stops.find(s=>!s.address.trim()||!s.postal.trim());
  if(missing){optimizationError(`Adresse oder PLZ / Ort fehlt bei „${missing.name||'Kunde'}“. Bitte den Stopp zuerst bearbeiten.`);return;}
  const controller=new AbortController(),signal=controller.signal;
  optimizationRun=controller;
  const fingerprint=tourFingerprint(currentTour),country=$('optimizationCountry').value;
  const mode=document.querySelector('input[name="routeStart"]:checked').value;
  setOptimizationBusy(true);
  try{
    const points=[];
    let startLabel='';
    optimizationProgress(2,'Startpunkt wird bestimmt…');
    if(mode==='gps'){
      const start=await getStartPosition(signal);points.push(start);startLabel=start.label;
    }else if(mode==='address'){
      const address=$('optimizationStartAddress').value.trim();
      if(!address)throw new Error('Bitte eine Startadresse eingeben.');
      const start=await locateStop({name:'Startadresse',address,postal:''},country,signal);
      points.push(start);startLabel=start.label;
    }
    for(let i=0;i<stops.length;i++){
      optimizationProgress(5+Math.round(i/stops.length*65),`Adresse ${i+1} von ${stops.length}: ${stops[i].name||stops[i].address}`);
      points.push(await locateStop(stops[i],country,signal));
    }
    checkOptimizationAbort(signal);
    if(mode==='first')startLabel=fullAddress(stops[0]);
    optimizationProgress(78,'Fahrzeiten und Reihenfolge werden berechnet…');
    const plan=await routeClient.optimize(points,signal);
    checkOptimizationAbort(signal);
    if(!currentTour||tourFingerprint(currentTour)!==fingerprint)throw new Error('Die Tour wurde inzwischen geändert. Bitte neu berechnen.');
    const orderedStops=plan.order.filter(i=>mode==='first'||i!==0).map(i=>stops[mode==='first'?i:i-1]);
    optimizationPreview={plan,orderedStops,originalIds:stops.map(s=>s.id),startLabel,fingerprint,tourId:currentTour.id};
    showOptimizationPreview(optimizationPreview);
    $('optimizationPreview').scrollIntoView({block:'start',behavior:'smooth'});
  }catch(error){
    if(optimizationRun===controller&&error.name!=='AbortError')optimizationError(error.message);
  }finally{
    if(optimizationRun===controller){optimizationRun=null;setOptimizationBusy(false);$('locationChoice').classList.add('hidden');}
  }
}

function commitTourOrder(next,fingerprint){
  // The old order remains active until both the tour and active-tour marker commit.
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction([TOUR_STORE,META_STORE],'readwrite');
    const store=transaction.objectStore(TOUR_STORE);
    let conflict=false;
    const read=store.get(next.id);
    read.onsuccess=()=>{
      if(!read.result||tourFingerprint(normalizeTour(read.result))!==fingerprint){conflict=true;transaction.abort();return;}
      store.put(next);transaction.objectStore(META_STORE).put({key:'currentTourId',value:next.id});
    };
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(new Error(conflict?'Die Tour wurde inzwischen geändert. Bitte neu öffnen und berechnen.':'Die Reihenfolge konnte nicht gespeichert werden. Bitte erneut versuchen.'));
    transaction.onerror=()=>{};
  });
}

$('optimizationForm').onsubmit=calculateOptimization;
$('optimizationSettings').onchange=()=>{optimizationError();invalidateOptimization();};
$('optimizationStartAddress').oninput=()=>invalidateOptimization();
$('optimizeFromRoute').onclick=()=>openOptimization('route');
$('optimizeFromList').onclick=()=>openOptimization('tourListScreen');
$('closeOptimization').onclick=()=>{cancelOptimization();optimizationReturnTo==='route'?renderRoute():renderTourList();};
$('cancelOptimizationRun').onclick=()=>{cancelOptimization();optimizationError('Berechnung abgebrochen. Die Reihenfolge bleibt unverändert.');};
$('applyOptimization').onclick=async()=>{
  const preview=optimizationPreview;
  if(!preview||!currentTour)return;
  $('applyOptimization').disabled=true;
  try{
    if(currentTour.id!==preview.tourId||tourFingerprint(currentTour)!==preview.fingerprint)throw new Error('Die Tour wurde geändert. Bitte neu berechnen.');
    const stops=RoutePlanner.reorderStops(currentTour.stops,preview.orderedStops.map(s=>s.id));
    const next={...currentTour,stops,updatedAt:now(),currentIndex:stops.findIndex(s=>s.id===preview.orderedStops[0].id),
      routeUndo:{before:currentTour.stops.map(s=>s.id),after:stops.map(s=>s.id),currentId:currentTour.stops[currentTour.currentIndex]?.id}};
    await commitTourOrder(next,preview.fingerprint);
    currentTour=next;updateHeader();
    optimizationMessage={tourId:next.id,text:'Neue Reihenfolge gespeichert.'};
    optimizationPreview=null;renderTourList();
  }catch(error){optimizationError(error.message);$('applyOptimization').disabled=false;}
};
$('undoOptimization').onclick=async()=>{
  if(!RoutePlanner.undoAvailable(currentTour))return;
  $('undoOptimization').disabled=true;
  try{
    const fingerprint=tourFingerprint(currentTour),undo=currentTour.routeUndo;
    const byId=new Map(currentTour.stops.map(s=>[s.id,s])),stops=undo.before.map(id=>byId.get(id));
    const previousIndex=stops.findIndex(s=>s.id===undo.currentId&&(s.status==='pending'||s.status==='later'));
    const next={...currentTour,stops,updatedAt:now(),routeUndo:null,currentIndex:previousIndex>=0?previousIndex:Math.max(0,nextPendingIndex({stops}))};
    await commitTourOrder(next,fingerprint);currentTour=next;updateHeader();
    optimizationMessage={tourId:next.id,text:'Vorherige Reihenfolge wiederhergestellt.'};renderTourList();
  }catch(error){alert(error.message);}
  finally{$('undoOptimization').disabled=false;}
};
