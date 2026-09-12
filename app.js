const KEY='lieferroute-v2';
const OLD_KEY='lieferroute-v1';
const $=id=>document.getElementById(id);

let draftStops = [];
let state = JSON.parse(localStorage.getItem(KEY) || 'null');

// Alte V1-Tour automatisch übernehmen, falls vorhanden
if (!state) {
  const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
  if (old?.addresses?.length) {
    state = {
      stops: old.addresses.map(a => ({ name:'', address:a, postal:'' })),
      index: old.index || 0,
      startedAt: old.startedAt || new Date().toISOString()
    };
    localStorage.setItem(KEY, JSON.stringify(state));
  }
}

function save(){
  localStorage.setItem(KEY, JSON.stringify(state));
  render();
}

function fullAddress(stop){
  return [stop.address, stop.postal].filter(Boolean).join(', ');
}

function googleQuery(stop){
  return [stop.name, stop.address, stop.postal].filter(Boolean).join(', ');
}

function renderDraft(){
  const wrap = $('stopList');
  wrap.innerHTML = '';
  draftStops.forEach((s,i)=>{
    const div = document.createElement('div');
    div.className='draft-stop';
    div.innerHTML = `
      <div>
        <strong>${escapeHtml(s.name || 'Ohne Kundenname')}</strong>
        <div>${escapeHtml(fullAddress(s))}</div>
      </div>
      <button class="mini danger" data-i="${i}">Entfernen</button>`;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('button[data-i]').forEach(btn=>{
    btn.onclick=()=>{
      draftStops.splice(Number(btn.dataset.i),1);
      renderDraft();
    };
  });
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

function render(){
  const active = state && state.stops?.length;
  $('setup').classList.toggle('hidden', !!active);
  $('route').classList.toggle('hidden', !active);

  if(!active){
    $('status').textContent='Keine Tour';
    renderDraft();
    return;
  }

  const i = Math.min(state.index, state.stops.length-1);
  const stop = state.stops[i];

  $('counter').textContent=`Stopp ${i+1} von ${state.stops.length}`;
  $('status').textContent=`${i+1}/${state.stops.length}`;
  $('customer').textContent=stop.name || 'Kunde';
  $('address').textContent=fullAddress(stop);
  $('progress').value=((i+1)/state.stops.length)*100;
  $('back').disabled=i===0;
}

$('addStop').onclick=()=>{
  const name=$('customerName').value.trim();
  const address=$('streetAddress').value.trim();
  const postal=$('postalCity').value.trim();

  if(!address) return alert('Bitte eine Adresse eingeben.');

  draftStops.push({name,address,postal});
  $('customerName').value='';
  $('streetAddress').value='';
  $('postalCity').value='';
  $('customerName').focus();
  renderDraft();
};

$('start').onclick=()=>{
  if(!draftStops.length) return alert('Bitte mindestens einen Stopp hinzufügen.');
  state={
    stops:draftStops,
    index:0,
    startedAt:new Date().toISOString()
  };
  draftStops=[];
  save();
};

$('waze').onclick=()=>{
  const stop=state.stops[state.index];
  const q=encodeURIComponent(fullAddress(stop));
  window.location.href=`https://waze.com/ul?q=${q}&navigate=yes`;
};

$('google').onclick=()=>{
  const stop=state.stops[state.index];
  const q=encodeURIComponent(googleQuery(stop));
  window.location.href=`https://www.google.com/maps/search/?api=1&query=${q}`;
};

$('done').onclick=()=>{
  if(state.index < state.stops.length-1){
    state.index++;
    save();
  } else {
    alert('Tour fertig! 🎉');
  }
};

$('skip').onclick=()=>{
  if(state.index < state.stops.length-1){
    state.index++;
    save();
  } else {
    alert('Das ist bereits der letzte Stopp.');
  }
};

$('back').onclick=()=>{
  if(state.index>0){
    state.index--;
    save();
  }
};

$('reset').onclick=()=>{
  if(confirm('Aktuelle Tour wirklich löschen?')){
    localStorage.removeItem(KEY);
    localStorage.removeItem(OLD_KEY);
    state=null;
    draftStops=[];
    render();
  }
};

render();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
