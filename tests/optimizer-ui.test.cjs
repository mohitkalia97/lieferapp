const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const planner=require('../routing.js');
const source=fs.readFileSync(require.resolve('../optimizer-ui.js'),'utf8');

function environment(getCurrentPosition,isSecureContext=true,overrides={}){
  const elements=new Map();
  function element(){
    const classes=new Set();
    return {checked:false,children:[],append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];},
      classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle:(c,force)=>force?classes.add(c):classes.delete(c)}};
  }
  const context=vm.createContext({RoutePlanner:planner,DOMException,setTimeout,clearTimeout,window:{isSecureContext},navigator:{geolocation:{getCurrentPosition}},
    document:{querySelector:()=>({checked:false}),createElement:()=>element()},show:id=>{context.shown=id;},
    $:id=>{
      if(!elements.has(id))elements.set(id,element());
      return elements.get(id);
    },...overrides});
  vm.runInContext(source,context);
  return context;
}

test('GPS passes accurate coordinates through without rounding',async()=>{
  let options;
  const context=environment((success,error,settings)=>{options=settings;success({coords:{latitude:48.2082,longitude:16.3738,accuracy:12}});});
  context.signal=new AbortController().signal;
  const point=await vm.runInContext('getStartPosition(signal)',context);
  assert.equal(point.lat,48.2082);assert.equal(point.lon,16.3738);
  assert.equal(options.enableHighAccuracy,true);assert.equal(options.timeout,15000);
});
test('GPS denial provides an address-based alternative',async()=>{
  const context=environment((success,error)=>error({code:1}));context.signal=new AbortController().signal;
  await assert.rejects(vm.runInContext('getStartPosition(signal)',context),/Startadresse/);
});
test('insecure pages fail without requesting GPS',async()=>{
  const context=environment(()=>assert.fail('GPS should not be requested'),false);context.signal=new AbortController().signal;
  await assert.rejects(vm.runInContext('getStartPosition(signal)',context),/Standort nicht verfügbar/);
});
test('poor GPS accuracy cannot produce a misleading time estimate',async()=>{
  const context=environment(success=>success({coords:{latitude:48,longitude:16,accuracy:4000}}));context.signal=new AbortController().signal;
  await assert.rejects(vm.runInContext('getStartPosition(signal)',context),/ungenau/);
});
test('cancelling GPS rejects immediately and ignores a late fix',async()=>{
  let success;
  const context=environment(callback=>{success=callback;});const controller=new AbortController();context.signal=controller.signal;
  const pending=vm.runInContext('getStartPosition(signal)',context);
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
  success({coords:{latitude:48,longitude:16,accuracy:10}});
});

test('unanswered GPS permission requests time out independently of the browser',async()=>{
  let timeoutCallback,delay,cleared;
  const context=environment(()=>{},true,{setTimeout:(callback,ms)=>{timeoutCallback=callback;delay=ms;return 9;},clearTimeout:id=>{cleared=id;}});
  context.signal=new AbortController().signal;
  const pending=vm.runInContext('getStartPosition(signal)',context);
  timeoutCallback();
  await assert.rejects(pending,/Startadresse/);
  assert.equal(delay,15000);assert.equal(cleared,9);
});

test('optimizer buttons with one open stop still respond and explain the minimum',()=>{
  const context=environment(()=>{});context.currentTour={id:'tour',stops:[{id:'a',status:'pending'}]};
  vm.runInContext('renderOptimizationActions()',context);
  assert.equal(context.$('optimizeFromList').disabled,false);
  assert.equal(context.$('optimizeFromRoute').classList.contains('hidden'),false);
  context.$('optimizeFromRoute').onclick();
  assert.equal(context.shown,'optimizeScreen');
  assert.match(context.$('optimizationError').textContent,/Mindestens zwei offene Stopps/);
  assert.equal(context.$('optimizationError').classList.contains('hidden'),false);
});

test('completed tours explain why optimization cannot run from the tour list',()=>{
  const context=environment(()=>{});context.currentTour={id:'tour',stops:[{id:'a',status:'done'}]};
  vm.runInContext('renderOptimizationActions()',context);
  assert.equal(context.$('optimizeFromList').disabled,false);
  context.$('optimizeFromList').onclick();
  assert.equal(context.shown,'optimizeScreen');assert.match(context.$('optimizationError').textContent,/Mindestens zwei/);
});

test('both optimizer entry buttons open the screen for an eligible tour',()=>{
  const context=environment(()=>{});context.currentTour={id:'tour',stops:[{id:'a',status:'pending'},{id:'b',status:'pending'}]};
  for(const id of ['optimizeFromRoute','optimizeFromList']){
    context.$(id).onclick();assert.equal(context.shown,'optimizeScreen');
    assert.equal(context.$('optimizationError').classList.contains('hidden'),true);
  }
});

test('clear duplicate address matches bypass the choice screen and are reused from cache',async()=>{
  let lookups=0;const cache=new Map();
  const building={lat:48.2,lon:16.3,street:'Lindenweg',house:'4c',postal:'1234',country:'AT',kind:'house',name:'',label:'Lindenweg 4c'};
  const context=environment(()=>{},true,{
    RoutePlanner:{...planner,createClient:()=>({geocode:async()=>{lookups++;return [{...building,lat:48.2001,name:'Cafe',kind:'other'},building];}})},
    getMeta:async key=>cache.get(key),setMeta:async(key,value)=>cache.set(key,value),now:()=>new Date().toISOString()
  });
  context.signal=new AbortController().signal;context.stop={address:'Lindenweg 4c',postal:'1234 Beispielstadt'};
  vm.runInContext('chooseLocation=()=>{throw new Error("Unexpected address prompt");}',context);
  for(let i=0;i<2;i++)assert.equal(await vm.runInContext('locateStop(stop,"AT",signal)',context),building);
  assert.equal(lookups,1);assert.equal(cache.size,1);
});

function confirmationEnvironment(changed=false){
  const context=environment(()=>{},true,{
    fullAddress:stop=>`${stop.address}, ${stop.postal}`,now:()=>new Date().toISOString(),updateHeader:()=>{},
    renderRoute:()=>{context.shown='route';},renderTourList:()=>{context.shown='tourListScreen';},
    saveOrder:async(next,fingerprint)=>{context.saves.push({next,fingerprint});}
  });
  context.saves=[];
  context.currentTour={id:'tour',currentIndex:3,stops:[['done','done'],['a','pending'],['later','later'],['b','pending']].map(([id,status])=>({
    id,status,name:id,address:'Beispielweg 1',postal:'1234 Beispielstadt',note:'Hintereingang',completedAt:status==='done'?'2026-09-22T10:00:00Z':null
  })),routeUndo:{before:['done','b','later','a'],after:['done','a','later','b'],currentId:'b'}};
  context.testPreview={tourId:'tour',fingerprint:context.tourFingerprint(context.currentTour),originalIds:['a','b'],
    orderedStops:(changed?[3,1]:[1,3]).map(i=>context.currentTour.stops[i]),startLabel:'Teststart',
    plan:{before:{duration:1200,distance:10000},after:{duration:changed?900:1200,distance:changed?8000:10000},savedSeconds:changed?300:0}};
  vm.runInContext('commitTourOrder=saveOrder; optimizationPreview=testPreview; showOptimizationPreview(testPreview);',context);
  return context;
}

test('an unchanged preview has an enabled continuation button and a visible explanation',()=>{
  const context=confirmationEnvironment();
  assert.equal(context.$('applyOptimization').disabled,false);
  assert.equal(context.$('applyOptimization').textContent,'Tour fortsetzen');
  assert.equal(context.$('optimizationResultNote').classList.contains('hidden'),false);
  assert.match(context.$('optimizationResultNote').textContent,/Keine schnellere Reihenfolge/);
});

test('confirming an unchanged route preserves the current stop, delivery data and previous undo',async()=>{
  const context=confirmationEnvironment(),before=context.currentTour,undo=before.routeUndo;
  await context.$('applyOptimization').onclick();
  assert.equal(context.saves.length,1);assert.equal(context.shown,'route');
  assert.equal(context.currentTour.currentIndex,before.currentIndex);
  assert.equal(context.currentTour.routeUndo,undo);
  assert.deepEqual(Array.from(context.currentTour.stops),before.stops);
  assert.equal(vm.runInContext('optimizationPreview',context),null);
});

test('an improved preview still applies the new order and creates undo history',async()=>{
  const context=confirmationEnvironment(true);
  assert.equal(context.$('applyOptimization').disabled,false);
  assert.equal(context.$('applyOptimization').textContent,'Reihenfolge übernehmen');
  assert.equal(context.$('optimizationResultNote').classList.contains('hidden'),true);
  await context.$('applyOptimization').onclick();
  assert.deepEqual(Array.from(context.currentTour.stops,s=>s.id),['done','b','later','a']);
  assert.deepEqual(Array.from(context.currentTour.routeUndo.before),['done','a','later','b']);
  assert.equal(context.currentTour.currentIndex,1);assert.equal(context.shown,'tourListScreen');
});

test('a stale unchanged preview cannot overwrite edits or delivery progress',async()=>{
  const context=confirmationEnvironment();context.currentTour.stops[1].status='done';
  await context.$('applyOptimization').onclick();
  assert.equal(context.saves.length,0);assert.equal(context.shown,undefined);
  assert.match(context.$('optimizationError').textContent,/Tour wurde geändert/);
  assert.equal(context.$('applyOptimization').disabled,false);
});

test('a failed confirmation keeps the preview available for retry',async()=>{
  const context=confirmationEnvironment(),before=context.currentTour;
  context.saveOrder=async()=>{throw new Error('Speichern fehlgeschlagen');};
  vm.runInContext('commitTourOrder=saveOrder;',context);
  await context.$('applyOptimization').onclick();
  assert.equal(context.currentTour,before);assert.equal(context.shown,undefined);
  assert.equal(context.$('applyOptimization').disabled,false);
  assert.equal(vm.runInContext('optimizationPreview',context),context.testPreview);
  assert.match(context.$('optimizationError').textContent,/Speichern fehlgeschlagen/);
});

test('repeated taps cannot start two confirmation writes',async()=>{
  const context=confirmationEnvironment();let writes=0,finish;
  context.saveOrder=()=>{writes++;return new Promise(resolve=>{finish=resolve;});};
  vm.runInContext('commitTourOrder=saveOrder;',context);
  const first=context.$('applyOptimization').onclick();
  await context.$('applyOptimization').onclick();
  assert.equal(writes,1);assert.equal(context.$('applyOptimization').disabled,true);
  finish();await first;assert.equal(context.shown,'route');
});
