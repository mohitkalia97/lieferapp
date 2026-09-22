const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../sw.js'),'utf8');
const origin='https://example.org';

function environment(fetchImpl=async()=>new Response('fresh')){
  const handlers={},stores=new Map(),requests=[],removed=[],added=[];
  const cacheFor=name=>{
    if(!stores.has(name))stores.set(name,new Map());
    const values=stores.get(name);
    return {
      addAll:async items=>{added.push(...items);},
      put:async(request,response)=>{values.set(request.url,response);},
      match:async request=>values.get(request.url)?.clone()
    };
  };
  const context=vm.createContext({URL,Request:class extends Request{constructor(url,options){super(new URL(url,origin+'/lieferapp/'),options);}},
    self:{location:{origin},addEventListener:(type,handler)=>{handlers[type]=handler;},skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    caches:{open:async name=>cacheFor(name),keys:async()=>[...stores.keys()],delete:async name=>{removed.push(name);return stores.delete(name);}},
    fetch:async(request,options)=>{requests.push({request,options});return fetchImpl(request,options);}});
  vm.runInContext(source,context);
  return {context,stores,requests,removed,added,async dispatch(type,extra={}){
    const pending=[];let response;
    handlers[type]({...extra,waitUntil:promise=>pending.push(promise),respondWith:promise=>{response=promise;}});
    const result=await response;await Promise.all(pending);return result;
  }};
}

test('install precaches the versioned optimizer and bypasses stale HTTP assets',async()=>{
  const env=environment();await env.dispatch('install');
  assert.ok(env.added.some(request=>request.url.endsWith('optimizer-ui.js?v=5.7')));
  assert.ok(env.added.some(request=>request.url.endsWith('routing.js?v=5.7')));
  assert.ok(env.added.every(request=>request.cache==='reload'));
});
test('script fetches revalidate instead of silently reusing stale HTTP scripts',async()=>{
  const env=environment();
  const response=await env.dispatch('fetch',{request:new Request(origin+'/lieferapp/app.js?v=5.7')});
  assert.equal(await response.text(),'fresh');assert.equal(env.requests[0].options.cache,'no-cache');
});
test('offline fetches serve only the matching version of a cached script',async()=>{
  const env=environment(async()=>{throw new TypeError('offline');});
  env.stores.set('lieferroute-shell-v5-7',new Map([[origin+'/lieferapp/app.js?v=5.7',new Response('current cached script')]]));
  const response=await env.dispatch('fetch',{request:new Request(origin+'/lieferapp/app.js?v=5.7')});
  assert.equal(await response.text(),'current cached script');
  await assert.rejects(env.dispatch('fetch',{request:new Request(origin+'/lieferapp/app.js?v=5.8')}),/offline/);
});
test('a deployment error cannot overwrite a working cached optimizer',async()=>{
  const env=environment(async()=>new Response('not found',{status:404}));
  env.stores.set('lieferroute-shell-v5-7',new Map([[origin+'/lieferapp/optimizer-ui.js?v=5.7',new Response('working optimizer')]]));
  const response=await env.dispatch('fetch',{request:new Request(origin+'/lieferapp/optimizer-ui.js?v=5.7')});
  assert.equal(await response.text(),'working optimizer');
});
test('activation removes old app shells without clearing unrelated caches',async()=>{
  const env=environment();
  for(const key of ['lieferroute-shell-v5-6','lieferroute-shell-v5-7','another-project'])env.stores.set(key,new Map());
  await env.dispatch('activate');assert.deepEqual(env.removed,['lieferroute-shell-v5-6']);
});
