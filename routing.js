(function(root){
  'use strict';

  const SERVICES={geocoder:'https://photon.komoot.io/api/',router:'https://router.project-osrm.org'};
  const MAX_STOPS=80;
  const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ß/g,'ss').replace(/[^a-z0-9]/g,'');
  const keyPart=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
  const houseNumber=value=>String(value??'').toLowerCase().replace(/\s+/g,'');
  const addressKey=(stop,country)=>JSON.stringify([country,keyPart(stop.address),keyPart(stop.postal)]);
  const validPoint=p=>!!p&&typeof p.lat==='number'&&typeof p.lon==='number'&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
  const eligible=(stops,includeLater)=>stops.filter(s=>s.status==='pending'||(includeLater&&s.status==='later'));

  function candidates(data){
    return (data?.features||[]).map(f=>{
      const p=f.properties||{},c=f.geometry?.coordinates||[];
      return {lon:c[0],lat:c[1],street:p.street||'',house:p.housenumber||'',postal:p.postcode||'',country:p.countrycode||'',
        label:[p.name,[p.street,p.housenumber].filter(Boolean).join(' '),[p.postcode,p.city||p.town||p.village||p.district].filter(Boolean).join(' '),p.country].filter(Boolean).join(', ')};
    }).filter(p=>validPoint(p)&&p.label).filter((p,i,a)=>a.findIndex(other=>other.lat===p.lat&&other.lon===p.lon)===i);
  }

  function exactMatch(stop,points,country){
    const parts=String(stop.address).trim().match(/^(.*?)\s+(\d+\s*[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?)$/i);
    const postal=String(stop.postal).match(/\b\d{4,5}\b/)?.[0];
    if(!parts||!postal)return null;
    const matches=points.filter(p=>normalize(p.street)===normalize(parts[1])&&houseNumber(p.house)===houseNumber(parts[2])&&p.postal===postal&&(!country||p.country.toUpperCase()===country));
    return matches.length===1?matches[0]:null;
  }

  function checkRoute(route,count){
    if(!route||!Number.isFinite(route.duration)||route.duration<0||!Number.isFinite(route.distance)||route.distance<0||route.legs?.length!==count-1){
      throw new Error('Die Routenberechnung hat unvollständige Daten geliefert. Bitte erneut versuchen.');
    }
  }

  function selectPlan(points,trip,baseline){
    if(trip.code!=='Ok'||baseline.code!=='Ok'||trip.trips?.length!==1)throw new Error('Nicht alle Stopps sind über eine gemeinsame Autoroute erreichbar.');
    const n=points.length,waypoints=trip.waypoints||[],ranks=waypoints.map(w=>w.waypoint_index);
    if(waypoints.length!==n||ranks[0]!==0||new Set(ranks).size!==n||ranks.some(i=>!Number.isInteger(i)||i<0||i>=n)||waypoints.some(w=>w.trips_index!==0)){
      throw new Error('Die vorgeschlagene Reihenfolge ist unvollständig. Bitte erneut versuchen.');
    }
    if([...waypoints,...(baseline.waypoints||[])].some(w=>!Number.isFinite(w.distance)||w.distance>1500))throw new Error('Eine Adresse liegt zu weit von einer befahrbaren Straße entfernt. Bitte den Standort prüfen.');
    const proposed=trip.trips[0],original=baseline.routes?.[0];
    checkRoute(proposed,n);checkRoute(original,n);
    const improved=proposed.duration<original.duration;
    const order=improved?ranks.map((rank,input)=>({rank,input})).sort((a,b)=>a.rank-b.rank).map(p=>p.input):points.map((_,i)=>i);
    return {order,before:original,after:improved?proposed:original,savedSeconds:improved?original.duration-proposed.duration:0};
  }

  function reorderStops(stops,orderedIds){
    const selected=new Set(orderedIds),available=new Set(stops.map(s=>s.id));
    if(selected.size!==orderedIds.length||available.size!==stops.length||orderedIds.some(id=>!available.has(id)))throw new Error('Die Tour wurde geändert. Bitte neu berechnen.');
    const chosen=stops.filter(s=>selected.has(s.id));
    if(chosen.some(s=>s.status!=='pending'&&s.status!=='later'))throw new Error('Der Zustellstatus wurde geändert. Bitte neu berechnen.');
    const byId=new Map(chosen.map(s=>[s.id,s]));
    // Only replace selected slots: completed and deferred stops keep their positions.
    let next=0;
    return stops.map(s=>selected.has(s.id)?byId.get(orderedIds[next++]):s);
  }

  function undoAvailable(tour){
    const undo=tour?.routeUndo,ids=tour?.stops?.map(s=>s.id)||[];
    return !!undo&&Array.isArray(undo.before)&&Array.isArray(undo.after)&&undo.before.length===ids.length&&undo.after.length===ids.length&&
      new Set(undo.before).size===ids.length&&undo.before.every(id=>ids.includes(id))&&undo.after.every((id,i)=>id===ids[i]);
  }

  function abortError(){return new DOMException('Abgebrochen','AbortError');}
  function wait(ms,signal){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted)return reject(abortError());
      const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();};
      const timer=setTimeout(finish,ms);
      const cancel=()=>{clearTimeout(timer);reject(abortError());};
      signal?.addEventListener('abort',cancel,{once:true});
    });
  }

  function createClient({fetchImpl=(...args)=>fetch(...args),services=SERVICES,interval=1100,timeout=25000}={}){
    let lastRequest=0;
    async function request(url,signal){
      await wait(Math.max(0,interval-(Date.now()-lastRequest)),signal);
      if(signal?.aborted)throw abortError();
      lastRequest=Date.now();
      const controller=new AbortController(),cancel=()=>controller.abort();
      signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(()=>controller.abort(),timeout);
      try{
        const response=await fetchImpl(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
        if(!response.ok)throw new Error(response.status===429?'Der Kartendienst ist ausgelastet. Bitte später erneut versuchen.':'Der Kartendienst ist nicht erreichbar. Bitte später erneut versuchen.');
        return await response.json();
      }catch(error){
        if(signal?.aborted)throw abortError();
        if(error.name==='AbortError')throw new Error('Der Kartendienst antwortet nicht. Bitte erneut versuchen.');
        if(error instanceof TypeError)throw new Error('Keine Verbindung zum Kartendienst. Bitte Internetverbindung prüfen.');
        throw error;
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
    }
    return {
      async geocode(stop,country,signal){
        const url=new URL(services.geocoder);
        url.search=new URLSearchParams({q:[stop.address,stop.postal].filter(Boolean).join(', '),lang:'de',limit:'5',...(country?{countrycode:country}:{})}).toString();
        return candidates(await request(url,signal));
      },
      async optimize(points,signal){
        if(points.length<2||points.length>MAX_STOPS+1||!points.every(validPoint))throw new Error('Ungültige Anzahl oder Position der Stopps.');
        const coords=points.map(p=>`${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
        const trip=await request(`${services.router}/trip/v1/driving/${coords}?source=first&destination=any&roundtrip=false&overview=false&steps=false`,signal);
        if(trip.code!=='Ok')throw new Error('Keine durchgehende Autoroute gefunden. Bitte Adressen prüfen oder später erneut versuchen.');
        const baseline=await request(`${services.router}/route/v1/driving/${coords}?overview=false&steps=false`,signal);
        return selectPlan(points,trip,baseline);
      }
    };
  }

  const api={SERVICES,MAX_STOPS,addressKey,validPoint,eligible,candidates,exactMatch,selectPlan,reorderStops,undoAvailable,createClient};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RoutePlanner=api;
})(typeof window==='object'?window:globalThis);
