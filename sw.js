const CACHE='lieferroute-shell-v5-6';
const ASSETS=['./','./index.html','./app.js?v=5.6','./routing.js?v=5.6','./optimizer-ui.js?v=5.6','./style.css?v=5.6','./manifest.webmanifest?v=5.6','./icon.svg'];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE)
    .then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'}))))
    .then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith('lieferroute-shell-')&&key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(event.request,{cache:'no-cache'});
      if(response.ok){
        event.waitUntil(cache.put(event.request,response.clone()).catch(()=>{}));
        return response;
      }
      return await cache.match(event.request)||response;
    }catch(error){
      const cached=await cache.match(event.request);
      if(cached)return cached;
      throw error;
    }
  })());
});
