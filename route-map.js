(function(root){
  'use strict';
  const COLORS={before:'#2563eb',after:'#087765'};
  const validPoint=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
  const tourKey=stops=>JSON.stringify(stops.map(s=>[s.id,s.name,s.address,s.postal]));
  const distance=value=>`${(value/1000).toLocaleString('de-AT',{maximumFractionDigits:1})} km`;
  function time(seconds){
    const minutes=Math.round(seconds/60);
    return minutes<1?'< 1 Min.':minutes>=60?`${Math.floor(minutes/60)} Std. ${minutes%60} Min.`:`${minutes} Min.`;
  }
  function geometry(route){
    const g=route?.geometry;
    if(g?.type!=='LineString'||!Array.isArray(g.coordinates)||g.coordinates.length<2||g.coordinates.length>200000)return null;
    if(!g.coordinates.every(c=>Array.isArray(c)&&c.length>=2&&validPoint({lon:c[0],lat:c[1]})))return null;
    return {type:'LineString',coordinates:g.coordinates.map(c=>[c[0],c[1]])};
  }
  function snapshot({plan,points,stops,mode,startLabel},createdAt){
    const offset=mode==='first'?0:1;
    const compact=route=>({duration:route.duration,distance:route.distance,geometry:geometry(route)});
    return {version:1,createdAt,startLabel,order:[...plan.order],
      points:points.map((p,i)=>{
        const stop=stops[i-offset];
        return {lat:p.lat,lon:p.lon,id:stop?.id||null,name:stop?.name||'Startpunkt',address:stop?[stop.address,stop.postal].filter(Boolean).join(', '):startLabel};
      }),before:compact(plan.before),after:compact(plan.after)};
  }
  function valid(data){
    return !!data&&data.version===1&&Array.isArray(data.points)&&data.points.length>=2&&data.points.length<=81&&
      data.points.every((p,i)=>validPoint(p)&&typeof p.name==='string'&&typeof p.address==='string'&&(typeof p.id==='string'&&p.id.length>0||i===0&&p.id===null))&&
      new Set(data.points.map(p=>p.id)).size===data.points.length&&
      Array.isArray(data.order)&&data.order.length===data.points.length&&data.order[0]===0&&new Set(data.order).size===data.points.length&&
      data.order.every(i=>Number.isInteger(i)&&i>=0&&i<data.points.length)&&
      [data.before,data.after].every(r=>r&&Number.isFinite(r.duration)&&r.duration>=0&&Number.isFinite(r.distance)&&r.distance>=0);
  }
  const isCurrent=tour=>valid(tour?.routeMap)&&tour.routeMap.tourKey===tourKey(tour.stops);
  function visits(data,mode){
    const order=mode==='before'?data.points.map((_,i)=>i):data.order;
    const offset=data.points[0].id===null?1:0;
    return order.map((input,index)=>({point:data.points[input],input,number:index<offset?'S':String(index+1-offset),
      before:input<offset?'S':String(input+1-offset),after:input<offset?'S':String(data.order.indexOf(input)+1-offset),
      start:index===0,end:index===order.length-1}));
  }
  function render(host,data,{leaflet=root.L}={}){
    host.replaceChildren();
    let map=null,observer=null,disposed=false,mode='after';
    function el(tag,className,text){
      const node=document.createElement(tag);node.className=className||'';
      if(text!==undefined)node.textContent=text;
      return node;
    }
    const destroy=()=>{disposed=true;observer?.disconnect();map?.remove();map=null;host.replaceChildren();};
    if(!valid(data)){
      host.append(el('p','hint small','Keine Kartendaten vorhanden. Bitte die Tour neu berechnen.'));
      return {destroy};
    }
    const toolbar=el('div','routeMapToolbar'),modes=el('div','routeMapModes');
    modes.setAttribute('role','group');modes.setAttribute('aria-label','Routenvergleich');
    const buttons={};
    for(const [value,label] of [['before','Vorher'],['after','Nachher'],['compare','Vergleich']]){
      const button=el('button','',label);button.type='button';button.onclick=()=>select(value);buttons[value]=button;modes.append(button);
    }
    const fit=el('button','routeMapFit');fit.type='button';fit.title='Gesamte Tour anzeigen';fit.setAttribute('aria-label',fit.title);
    const icon=el('img');icon.src='vendor/lucide/scan.svg';icon.alt='';icon.width=20;icon.height=20;fit.append(icon);
    toolbar.append(modes,fit);
    const summary=el('div','routeMapSummary');summary.setAttribute('aria-live','polite');
    const canvas=el('div','routeMapCanvas');canvas.setAttribute('role','region');canvas.setAttribute('aria-label','Tourkarte');
    const legend=el('div','routeMapLegend');
    const status=el('p','routeMapStatus hint small');status.setAttribute('role','status');
    const details=el('details','routeMapStops'),list=el('ol','routeMapStopList');
    details.append(el('summary','',`Stopps (${data.points.filter(p=>p.id!==null).length})`),list);
    host.append(toolbar,summary,canvas,legend,status,details);
    let paths=null,markers=null,tiles=null,tileFailed=false;
    const lines={before:geometry(data.before),after:geometry(data.after)};
    const boundsPoints=[...data.points.map(p=>[p.lat,p.lon]),...Object.values(lines).flatMap(g=>g?g.coordinates.map(c=>[c[1],c[0]]):[])];
    function fitAll(){map?.invalidateSize({pan:false});map?.fitBounds(boundsPoints,{padding:[34,34],maxZoom:16,animate:false});}
    fit.onclick=fitAll;
    function mapStatus(){
      const missing=(mode!=='after'&&!lines.before)||(mode!=='before'&&!lines.after);
      status.textContent=!map?'Karte nicht verfügbar. Die Stoppliste und die berechnete Reihenfolge bleiben verfügbar.':
        missing?'Ein Straßenverlauf fehlt. Verfügbare Routen und Stopps werden angezeigt.':
        tileFailed?'Hintergrundkarte nicht erreichbar. Routen und Stopps bleiben sichtbar.':'';
      status.classList.toggle('hidden',!status.textContent);
    }
    try{
      if(leaflet){
        map=leaflet.map(canvas,{scrollWheelZoom:false,zoomControl:false,zoomSnap:0.25});
        leaflet.control.zoom({zoomInTitle:'Vergrößern',zoomOutTitle:'Verkleinern'}).addTo(map);
        tiles=leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
          maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',referrerPolicy:'strict-origin-when-cross-origin'
        });
        tiles.on('tileerror',()=>{tileFailed=true;mapStatus();});
        tiles.on('loading',()=>{tileFailed=false;mapStatus();});
        tiles.addTo(map);
        paths=leaflet.layerGroup().addTo(map);markers=leaflet.layerGroup().addTo(map);
        fitAll();
        if(root.ResizeObserver){observer=new root.ResizeObserver(()=>{if(!disposed)map?.invalidateSize({pan:false});});observer.observe(canvas);}
      }
    }catch(error){map?.remove();map=null;}
    fit.disabled=!map;
    canvas.classList.toggle('hidden',!map);
    function select(value){
      mode=value;
      for(const [key,button] of Object.entries(buttons))button.setAttribute('aria-pressed',String(key===mode));
      const selected=mode==='before'?data.before:data.after;
      summary.textContent=mode==='compare'?`Vorher: ${time(data.before.duration)} · ${distance(data.before.distance)} | Nachher: ${time(data.after.duration)} · ${distance(data.after.distance)}`:
        `${time(selected.duration)} · ${distance(selected.distance)} · Ohne Rückfahrt`;
      legend.replaceChildren();
      for(const key of ['before','after'])if(mode===key||mode==='compare'){
        const label=el('span','routeMapKey');label.append(el('i',`routeMapSwatch ${key}`),el('span','',key==='before'?'Vorher':'Nachher'));legend.append(label);
      }
      if(mode==='compare')legend.append(el('span','routeMapNumberKey','Nummern: Nachher'));
      paths?.clearLayers();markers?.clearLayers();list.replaceChildren();
      // Both modes keep the same camera so a route change is easy to compare.
      for(const key of ['before','after'])if(map&&(mode===key||mode==='compare')&&lines[key]){
        leaflet.geoJSON(lines[key],{style:{color:COLORS[key],weight:key==='before'&&mode==='compare'?8:5,opacity:0.85,dashArray:key==='before'?'10 7':null},interactive:false}).addTo(paths);
      }
      const ordered=visits(data,mode),groups=new Map();
      for(const visit of ordered){
        const key=`${visit.point.lat},${visit.point.lon}`;
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(visit);
      }
      function description(visit,number=true){
        const wrap=el('div','routeMapPopup');
        wrap.append(el('strong','',`${number?visit.number+' · ':''}${visit.point.name}`),el('span','',visit.point.address));
        if(visit.start||visit.end)wrap.append(el('small','',visit.start?'Start':'Ziel'));
        if(visit.point.id!==null)wrap.append(el('small','',`Vorher ${visit.before} → Nachher ${visit.after}`));
        return wrap;
      }
      const markerByInput=new Map();
      for(const group of groups.values())if(map){
        const first=group[0],badge=el('span','routeMapBadge',first.number+(group.length>1?'+':''));
        const isEnd=group.some(v=>v.end),isStart=group.some(v=>v.start);
        const pin=leaflet.marker([first.point.lat,first.point.lon],{
          icon:leaflet.divIcon({html:badge,className:`routeMapMarker ${mode==='before'?'before':'after'}${isEnd?' routeMapEnd':''}${isStart?' routeMapStart':''}`,iconSize:[32,32],iconAnchor:[16,16]}),
          title:group.map(v=>`${v.number} · ${v.point.name}${v.start?' (Start)':v.end?' (Ziel)':''}`).join('; '),riseOnHover:true
        });
        const content=el('div');group.forEach(v=>content.append(description(v)));
        pin.bindPopup(content,{maxWidth:260,maxHeight:250}).addTo(markers);
        pin.getElement?.()?.setAttribute('aria-label',pin.options.title);
        group.forEach(v=>markerByInput.set(v.input,pin));
      }
      for(const visit of ordered){
        const li=el('li'),button=el('button','routeMapStop');button.type='button';
        button.append(el('span','routeMapListNumber',visit.number),description(visit,false));
        button.disabled=!map;
        button.onclick=()=>{const pin=markerByInput.get(visit.input);map.setView([visit.point.lat,visit.point.lon],Math.max(map.getZoom(),15));pin.openPopup();canvas.scrollIntoView({block:'nearest',behavior:'smooth'});};
        li.append(button);list.append(li);
      }
      mapStatus();
    }
    select('after');
    return {destroy};
  }
  const api={snapshot,valid,isCurrent,tourKey,geometry,visits,render};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RouteMap=api;
})(typeof window==='object'?window:globalThis);
