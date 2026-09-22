const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const planner=require('../routing.js');
const source=fs.readFileSync(require.resolve('../optimizer-ui.js'),'utf8');

function environment(getCurrentPosition,isSecureContext=true){
  const elements=new Map();
  const context=vm.createContext({RoutePlanner:planner,DOMException,window:{isSecureContext},navigator:{geolocation:{getCurrentPosition}},
    $:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}});
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
