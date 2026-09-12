const KEY='lieferroute-v1';
const $=id=>document.getElementById(id);
let state=JSON.parse(localStorage.getItem(KEY)||'null');

function save(){ localStorage.setItem(KEY,JSON.stringify(state)); render(); }
function render(){
  const active=state && state.addresses?.length;
  $('setup').classList.toggle('hidden',!!active);
  $('route').classList.toggle('hidden',!active);
  if(!active){ $('status').textContent='Keine Tour'; return; }
  const i=Math.min(state.index,state.addresses.length-1);
  $('counter').textContent=`Stopp ${i+1} von ${state.addresses.length}`;
  $('status').textContent=`${i+1}/${state.addresses.length}`;
  $('address').textContent=state.addresses[i];
  $('progress').value=((i+1)/state.addresses.length)*100;
  $('back').disabled=i===0;
}
$('start').onclick=()=>{
  const addresses=$('addresses').value.split('\n').map(x=>x.trim()).filter(Boolean);
  if(!addresses.length) return alert('Bitte mindestens eine Adresse eingeben.');
  state={addresses,index:0,startedAt:new Date().toISOString()};
  save();
};
$('nav').onclick=()=>{
  const q=encodeURIComponent(state.addresses[state.index]);
  // iOS Universal Link: öffnet Google Maps App, falls vorhanden, sonst Web.
  window.location.href=`https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
};
$('done').onclick=()=>{
  if(state.index < state.addresses.length-1){ state.index++; save(); }
  else alert('Tour fertig! 🎉');
};
$('back').onclick=()=>{ if(state.index>0){state.index--;save();} };
$('reset').onclick=()=>{
  if(confirm('Aktuelle Tour wirklich löschen?')){
    localStorage.removeItem(KEY); state=null; $('addresses').value=''; render();
  }
};
render();

if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
