const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const routeMap=require('../route-map.js');
const points=[{lat:48,lon:16},{lat:48.1,lon:16.1},{lat:48.2,lon:16.2}];
const stops=points.map((p,i)=>({id:String(i),name:`Stop ${i}`,address:`Example ${i}`,postal:'1234 Example',note:'private',status:'pending'}));
const line={type:'LineString',coordinates:[[16,48],[16.1,48.1],[16.2,48.2]]};
const before={duration:1200,distance:10000,geometry:line,legs:[{},{}]};
const after={duration:900,distance:8000,geometry:{...line,coordinates:[line.coordinates[0],line.coordinates[2],line.coordinates[1]]}};
function fixture(mode='first'){
  return routeMap.snapshot({plan:{order:[0,2,1],before,after},points,stops:mode==='first'?stops:stops.slice(1),mode,startLabel:'Start'},'2026-09-22T12:00:00Z');
}

test('snapshots retain road geometry, do not mutate inputs, and omit notes and routing legs',()=>{
  const data=fixture();assert.ok(routeMap.valid(data));
  assert.deepEqual(data.before.geometry,line);assert.notEqual(data.before.geometry,line);
  assert.notEqual(data.before.geometry.coordinates,line.coordinates);
  assert.equal(data.before.legs,undefined);assert.equal(data.points[0].note,undefined);
  assert.equal(JSON.stringify(data).includes('private'),false);
});
test('first-stop maps number both orders correctly and identify their endpoints',()=>{
  const data=fixture(),before=routeMap.visits(data,'before'),after=routeMap.visits(data,'after');
  assert.deepEqual(before.map(v=>v.point.id),['0','1','2']);
  assert.deepEqual(after.map(v=>v.point.id),['0','2','1']);
  assert.deepEqual(after.map(v=>v.number),['1','2','3']);
  assert.deepEqual(after.map(v=>v.before),['1','3','2']);
  assert.equal(after[0].start,true);assert.equal(after[2].end,true);
  assert.deepEqual(routeMap.visits(data,'compare'),after);
});
test('GPS and address starts are marked S without consuming a delivery number',()=>{
  for(const mode of ['gps','address']){
    const data=fixture(mode),visits=routeMap.visits(data,'after');
    assert.equal(data.points[0].id,null);assert.equal(visits[0].number,'S');
    assert.deepEqual(visits.map(v=>v.number),['S','1','2']);
    assert.deepEqual(visits.map(v=>v.before),['S','2','1']);
  }
});
test('stored maps survive delivery progress and notes but not structural edits',()=>{
  const tour={stops:structuredClone(stops),routeMap:{...fixture(),tourKey:routeMap.tourKey(stops)}};
  assert.equal(routeMap.isCurrent(tour),true);
  tour.stops[0].status='done';tour.stops[0].note='new note';assert.equal(routeMap.isCurrent(tour),true);
  for(const field of ['address','postal','name','id']){
    const edited=structuredClone(tour);edited.stops[0][field]='changed';assert.equal(routeMap.isCurrent(edited),false);
  }
  tour.stops.reverse();assert.equal(routeMap.isCurrent(tour),false);
  tour.stops.pop();assert.equal(routeMap.isCurrent(tour),false);
});
test('malformed or older saved map data cannot enable the map action',()=>{
  for(const data of [null,{}, {...fixture(),version:2},{...fixture(),order:[0,1,1]},{...fixture(),order:[1,0,2]},
    {...fixture(),points:[{lat:'48',lon:16},...points.slice(1)]},{...fixture(),before:{duration:-1,distance:1}}]){
    assert.equal(routeMap.valid(data),false);
  }
});
test('invalid geometries are unavailable rather than fabricated straight road lines',()=>{
  for(const geometry of [null,{type:'Point',coordinates:[16,48]},{type:'LineString',coordinates:[[16,48]]},
    {type:'LineString',coordinates:[[16,48],[181,48]]},{type:'LineString',coordinates:[[16,48],[null,48]]}]){
    assert.equal(routeMap.geometry({geometry}),null);
  }
});

function environment({missingLibrary=false,brokenLibrary=false}={}){
  function element(tag){
    return {tag,children:[],attributes:{},textContent:'',className:'',classList:{toggle(){}},
      append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=[...nodes];},
      setAttribute(key,value){this.attributes[key]=value;},scrollIntoView(){}};
  }
  const calls={lines:[],markers:[],fits:0,removes:0,events:{}};
  const map={fitBounds(){calls.fits++;},invalidateSize(){},remove(){calls.removes++;},setView(){},getZoom(){return 10;}};
  const layer=()=>({addTo(){return this;},clearLayers(){}});
  const leaflet={map(){if(brokenLibrary)throw new Error('Map failed');return map;},
    control:{zoom:layer},tileLayer(url,options){calls.tileUrl=url;calls.tileOptions=options;return {...layer(),on(name,fn){calls.events[name]=fn;return this;}};},
    layerGroup:layer,geoJSON(data,options){calls.lines.push({data,options});return layer();},divIcon:options=>options,
    marker(point,options){const pin={...layer(),bindPopup(content){this.popup=content;return this;},openPopup(){}};calls.markers.push({point,options,pin});return pin;}
  };
  const context=vm.createContext({document:{createElement:element},window:{L:missingLibrary?undefined:leaflet}});
  vm.runInContext(fs.readFileSync(require.resolve('../route-map.js'),'utf8'),context);
  const host=element('div');
  return {api:context.window.RouteMap,host,calls};
}
function descendants(node){return [node,...node.children.flatMap(descendants)];}
function button(host,name){return descendants(host).find(n=>n.tag==='button'&&n.textContent===name);}

test('map switches geometry and stop numbering without changing the camera',()=>{
  const {api,host,calls}=environment();api.render(host,fixture());
  assert.equal(calls.fits,1);assert.deepEqual(JSON.parse(JSON.stringify(calls.lines[0].data)),after.geometry);
  button(host,'Vorher').onclick();assert.deepEqual(JSON.parse(JSON.stringify(calls.lines.at(-1).data)),line);
  button(host,'Vergleich').onclick();assert.equal(calls.lines.length,4);assert.equal(calls.fits,1);
  assert.equal(button(host,'Vergleich').attributes['aria-pressed'],'true');
  assert.equal(calls.lines.at(-2).options.style.dashArray,'10 7');
  assert.equal(calls.lines.at(-1).options.style.dashArray,null);
  assert.equal(calls.tileUrl,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(calls.tileOptions.attribution,/OpenStreetMap/);
});
test('same-coordinate deliveries share one marker but each stays in its popup and stop list',()=>{
  const data=fixture();data.points[2]={...data.points[2],lat:data.points[1].lat,lon:data.points[1].lon};
  const {api,host,calls}=environment();api.render(host,data);
  assert.equal(calls.markers.length,2);
  assert.equal(calls.markers[1].pin.popup.children.length,2);
  assert.equal(descendants(host).filter(n=>n.className==='routeMapStop').length,3);
});
test('customer text is rendered as text, never inserted as popup HTML',()=>{
  const data=fixture();data.points[0].name='<img src=x onerror=alert(1)>';
  const {api,host,calls}=environment();api.render(host,data);
  assert.ok(descendants(calls.markers[0].pin.popup).some(n=>n.textContent.includes('<img')));
  assert.equal(descendants(calls.markers[0].pin.popup).some(n=>n.tag==='img'),false);
});
test('missing library or map initialization failure keeps a readable ordered list',()=>{
  for(const options of [{missingLibrary:true},{brokenLibrary:true}]){
    const {api,host}=environment(options);assert.doesNotThrow(()=>api.render(host,fixture()));
    assert.equal(descendants(host).filter(n=>n.className==='routeMapStop').length,3);
    assert.ok(descendants(host).some(n=>n.textContent.includes('Karte nicht verfügbar')));
    assert.equal(button(host,'Nachher').attributes['aria-pressed'],'true');
  }
});
test('tile failures report the missing background without removing route paths',()=>{
  const {api,host,calls}=environment();api.render(host,fixture());calls.events.tileerror();
  assert.ok(descendants(host).some(n=>n.textContent.includes('Hintergrundkarte nicht erreichbar')));
  assert.equal(calls.lines.length,1);
});
test('missing geometry never draws straight lines between stops',()=>{
  const data=fixture();data.after.geometry=null;
  const {api,host,calls}=environment();api.render(host,data);
  assert.equal(calls.lines.length,0);assert.equal(calls.markers.length,3);
  assert.ok(descendants(host).some(n=>n.textContent.includes('Straßenverlauf fehlt')));
});
test('disposing a map releases Leaflet and clears its UI',()=>{
  const {api,host,calls}=environment(),view=api.render(host,fixture());view.destroy();
  assert.equal(calls.removes,1);assert.equal(host.children.length,0);
});
