const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function app(){
  const elements=new Map(),buttons=[];
  function element(){return {value:'',textContent:'',dataset:{},children:[],attributes:{},classList:{list:new Set(),toggle(c,on){on?this.list.add(c):this.list.delete(c);},add(c){this.list.add(c);},remove(c){this.list.delete(c);}},
    setAttribute(k,v){this.attributes[k]=v;},appendChild(node){this.children.push(node);},querySelectorAll(){return [];}};}
  for(const value of ['waze','google','off']){const b=element();b.dataset.autoNav=value;buttons.push(b);}
  const location={href:''};
  const context=vm.createContext({DeliveryImport:require('../delivery-import.js'),RoutePlanner:require('../routing.js'),RouteMap:require('../route-map.js'),
    crypto:{randomUUID:()=>String(Math.random())},window:{addEventListener(){},location,scrollTo(){}},navigator:{},console,
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
      querySelectorAll:selector=>selector==='[data-auto-nav]'?buttons:[],createElement:element}});
  vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
  const saved=[];
  vm.runInContext('saveCurrent=async()=>{};renderRoute=()=>{};setMeta=async(k,v)=>{metaSaved.push([k,v]);};',Object.assign(context,{metaSaved:saved}));
  context.tour=stops=>{context.input=context.normalizeTour({stops:stops.map(([name,address,postal,status])=>({name,address,postal,status:status||'pending'}))});vm.runInContext('currentTour=input;currentTour.currentIndex=0;',context);};
  return {context,location,buttons,elements,saved};
}

test('"Zugestellt & Weiter" opens Waze for the next stop right away',async()=>{
  const {context,location}=app();
  context.tour([['A','Lindenweg 7','1234 Beispielstadt'],['B','Hauptplatz 9','2020 Hollabrunn']]);
  await context.document.getElementById('done').onclick();
  assert.equal(context.currentTourStatus=vm.runInContext('currentTour.stops[0].status',context),'done');
  assert.equal(location.href,'https://waze.com/ul?q='+encodeURIComponent('Hauptplatz 9, 2020 Hollabrunn')+'&navigate=yes');
});
test('Google Maps can be chosen instead, and "Aus" opens nothing',async()=>{
  const {context,location,buttons,saved}=app();
  context.tour([['A','Lindenweg 7','1234 Beispielstadt'],['B','Hauptplatz 9','2020 Hollabrunn'],['C','Gratzl 5/1','3730 Eggenburg']]);
  await buttons.find(b=>b.dataset.autoNav==='google').onclick();
  assert.equal(JSON.stringify(saved.at(-1)),'["autoNav","google"]');
  assert.ok(buttons.find(b=>b.dataset.autoNav==='google').classList.list.has('active'));
  assert.equal(context.document.getElementById('done').textContent,'✓ Zugestellt & Weiter mit Google Maps');
  await context.document.getElementById('done').onclick();
  assert.ok(location.href.startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.ok(decodeURIComponent(location.href).includes('B, Hauptplatz 9, 2020 Hollabrunn'));
  await buttons.find(b=>b.dataset.autoNav==='off').onclick();location.href='';
  await context.document.getElementById('done').onclick();
  assert.equal(location.href,'');assert.equal(context.document.getElementById('done').textContent,'✓ Zugestellt & Weiter');
});
test('"Nicht zugestellt" also continues to the next stop; the last stop opens nothing',async()=>{
  const {context,location}=app();
  context.tour([['A','Lindenweg 7','1234 Beispielstadt'],['B','Hauptplatz 9','2020 Hollabrunn']]);
  await context.document.getElementById('notDelivered').onclick();
  assert.ok(location.href.includes(encodeURIComponent('Hauptplatz 9')));
  location.href='';
  await context.document.getElementById('done').onclick();
  assert.equal(location.href,'','after the last open stop the tour is finished, no app is opened');
});
test('"Später" moves the stop without opening a navigation app',async()=>{
  const {context,location}=app();
  context.tour([['A','Lindenweg 7','1234 Beispielstadt'],['B','Hauptplatz 9','2020 Hollabrunn']]);
  const later=context.document.getElementById('later').onclick;
  if(later)await later();
  assert.equal(location.href,'');
});
test('the saved choice is restored when the app starts',async()=>{
  const {context,buttons}=app();
  vm.runInContext("getMeta=async k=>k==='autoNav'?'google':null;",context);
  await context.loadAutoNav();
  assert.ok(buttons.find(b=>b.dataset.autoNav==='google').classList.list.has('active'));
  vm.runInContext("getMeta=async()=>'unbekannt';autoNav='waze';",context);
  await context.loadAutoNav();
  assert.ok(buttons.find(b=>b.dataset.autoNav==='waze').classList.list.has('active'),'an unknown value keeps Waze');
});
