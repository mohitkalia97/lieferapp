const {test}=require('node:test');
const assert=require('node:assert/strict');
const planner=require('../routing.js');

const points=[{lat:48.2,lon:16.3},{lat:48.3,lon:16.4},{lat:48.4,lon:16.5}];
const route=(duration=100,distance=1000)=>({duration,distance,legs:[{},{}]});
const trip=(duration=100)=>({code:'Ok',trips:[route(duration)],waypoints:[0,2,1].map(waypoint_index=>({waypoint_index,trips_index:0,distance:10}))});
const baseline=(duration=200)=>({code:'Ok',routes:[route(duration)],waypoints:points.map(()=>({distance:10}))});
const stop=(id,status='pending')=>({id,status,name:id,address:'Rennbahnweg 25',postal:'1220 Wien',note:'Hintereingang',completedAt:status==='done'?'2026-09-22':null});
const house={lat:48.25,lon:16.44,street:'Rennbahnweg',house:'25',postal:'1220',country:'AT',label:'Rennbahnweg 25, 1220 Wien'};

test('a shorter road route maps input waypoints to visiting order',()=>{
  const plan=planner.selectPlan(points,trip(),baseline());
  assert.deepEqual(plan.order,[0,2,1]);assert.equal(plan.savedSeconds,100);
});
test('never replace a route with a slower or equally fast suggestion',()=>{
  for(const duration of [200,201]){
    const plan=planner.selectPlan(points,trip(duration),baseline());
    assert.deepEqual(plan.order,[0,1,2]);assert.equal(plan.savedSeconds,0);assert.equal(plan.after.duration,200);
  }
});
test('a split or incomplete trip is rejected',()=>{
  const split=trip();split.trips.push(route());assert.throws(()=>planner.selectPlan(points,split,baseline()));
  const incomplete=trip();incomplete.waypoints.pop();assert.throws(()=>planner.selectPlan(points,incomplete,baseline()));
  const duplicate=trip();duplicate.waypoints[2].waypoint_index=2;assert.throws(()=>planner.selectPlan(points,duplicate,baseline()));
});
test('start position must remain fixed',()=>{
  const moved=trip();moved.waypoints[0].waypoint_index=2;moved.waypoints[1].waypoint_index=0;
  assert.throws(()=>planner.selectPlan(points,moved,baseline()));
});
test('unreachable or incomplete route metrics cannot be shown as savings',()=>{
  assert.throws(()=>planner.selectPlan(points,{code:'NoTrips'},baseline()));
  const broken=trip();broken.trips[0].duration=null;assert.throws(()=>planner.selectPlan(points,broken,baseline()));
  const missingLeg=baseline();missingLeg.routes[0].legs.pop();assert.throws(()=>planner.selectPlan(points,trip(),missingLeg));
  const remote=trip();remote.waypoints[1].distance=2000;assert.throws(()=>planner.selectPlan(points,remote,baseline()));
});
test('sort only selected stops and retain delivered/deferred data and positions',()=>{
  const stops=[stop('done','done'),stop('a'),stop('later','later'),stop('b'),stop('failed','not_delivered'),stop('c')];
  const snapshot=JSON.stringify(stops),sorted=planner.reorderStops(stops,['c','a','b']);
  assert.deepEqual(sorted.map(s=>s.id),['done','c','later','a','failed','b']);
  assert.equal(JSON.stringify(stops),snapshot);
  for(const s of stops)assert.equal(sorted.find(x=>x.id===s.id),s);
});
test('sort rejects stale IDs, duplicate IDs and newly completed stops',()=>{
  assert.throws(()=>planner.reorderStops([stop('a'),stop('b')],['a','missing']));
  assert.throws(()=>planner.reorderStops([stop('a'),stop('b')],['a','a']));
  assert.throws(()=>planner.reorderStops([stop('a'),stop('a')],['a']));
  assert.throws(()=>planner.reorderStops([stop('a','done'),stop('b')],['b','a']));
});
test('later stops are opt-in and completed stops are never eligible',()=>{
  const stops=[stop('a'),stop('b','later'),stop('c','done'),stop('d','not_delivered')];
  assert.deepEqual(planner.eligible(stops,false).map(s=>s.id),['a']);
  assert.deepEqual(planner.eligible(stops,true).map(s=>s.id),['a','b']);
});
test('undo survives delivery progress but not added, removed or manually reordered stops',()=>{
  const t={stops:[stop('b'),stop('a')],routeUndo:{before:['a','b'],after:['b','a']}};
  assert.equal(planner.undoAvailable(t),true);t.stops[0].status='done';assert.equal(planner.undoAvailable(t),true);
  t.stops.reverse();assert.equal(planner.undoAvailable(t),false);
  t.stops.push(stop('c'));assert.equal(planner.undoAvailable(t),false);
  assert.equal(planner.undoAvailable({stops:[stop('a')],routeUndo:{before:'a',after:['a']}}),false);
});
test('coordinates must be numeric, finite and within geographic bounds',()=>{
  for(const point of [null,{lat:'48',lon:16},{lat:NaN,lon:16},{lat:91,lon:16},{lat:48,lon:181}])assert.equal(planner.validPoint(point),false);
  assert.equal(planner.validPoint({lat:0,lon:0}),true);
});
test('automatic matching requires the exact house, street, postcode and country',()=>{
  assert.equal(planner.automaticMatch(stop('a'),[house],'AT'),house);
  for(const change of [{house:'26'},{street:'Hauptstraße'},{postal:'1210'},{country:'DE'},{house:''}]){
    assert.equal(planner.automaticMatch(stop('a'),[{...house,...change}],'AT'),null);
  }
  assert.equal(planner.automaticMatch(stop('a'),[house,{...house,lat:48.24}],'AT'),null);
});
test('cache keys change when address, postal code or country changes',()=>{
  const original=planner.addressKey(stop('a'),'AT');
  for(const entry of [{address:'Rennbahnweg 26'},{postal:'1210 Wien'}])assert.notEqual(planner.addressKey({...stop('a'),...entry},'AT'),original);
  assert.notEqual(planner.addressKey(stop('a'),'DE'),original);
  assert.equal(planner.addressKey({...stop('a'),name:'Other customer'},'AT'),original);
});
test('house number separators cannot collide in the cache or automatic matching',()=>{
  const slash={...stop('a'),address:'Rennbahnweg 1/2'};
  const plain={...stop('a'),address:'Rennbahnweg 12'};
  assert.notEqual(planner.addressKey(slash,'AT'),planner.addressKey(plain,'AT'));
  assert.equal(planner.automaticMatch(slash,[{...house,house:'12'}],'AT'),null);
  assert.ok(planner.automaticMatch(slash,[{...house,house:'1/2'}],'AT'));
});
test('duplicate building and business records do not interrupt the driver',()=>{
  const input={address:'Lindenweg 4c',postal:'1234 Beispielstadt'};
  const building={...house,street:'Lindenweg',house:'4c',postal:'1234',kind:'house',name:''};
  const business={...building,lat:building.lat+0.0001,kind:'other',name:'Cafe'};
  const entrance={...building,lon:building.lon+0.0001};
  assert.equal(planner.automaticMatch(input,[business,building,entrance],'AT'),building);
});
test('nearby businesses with the same full address are accepted even without a building record',()=>{
  const input={address:'Lindenweg 4c',postal:'1234 Beispielstadt'};
  const first={...house,street:'Lindenweg',house:'4c',postal:'1234',name:'Cafe',kind:'other'};
  const second={...first,lat:first.lat+0.0002,name:'Sporthalle'};
  assert.equal(planner.automaticMatch(input,[first,second],'AT'),first);
});
test('a single OCR I/l confusion is resolved with exact house number and postcode',()=>{
  const input={address:'Paui Meyer Strasse 7',postal:'1234 Beispielstadt'};
  const building={...house,street:'Paul-Meyer-Straße',house:'7',postal:'1234'};
  assert.equal(planner.automaticMatch(input,[building,{...building,lat:building.lat+0.0001}],'AT'),building);
  assert.equal(planner.automaticMatch({...input,postal:'4321 Anderstadt'},[building],'AT'),null);
  assert.equal(planner.automaticMatch(input,[{...building,house:'8'}],'AT'),null);
});
test('street abbreviations and common umlaut spellings match automatically',()=>{
  const input={address:'Muehlstr. 7',postal:'1234 Beispielstadt'};
  const building={...house,street:'Mühlstraße',house:'7',postal:'1234'};
  assert.equal(planner.automaticMatch(input,[building],'AT'),building);
});
test('umlaut handling does not collapse different ordinary street names',()=>{
  const input={address:'Neuenweg 7',postal:'1234 Beispielstadt'};
  assert.equal(planner.automaticMatch(input,[{...house,street:'Neunweg',house:'7',postal:'1234'}],'AT'),null);
});
test('exact spelling wins over an OCR-like alternative street',()=>{
  const input={address:'Paui Meyer Strasse 7',postal:'1234 Beispielstadt'};
  const exact={...house,street:'Paui-Meyer-Straße',house:'7',postal:'1234'};
  assert.equal(planner.automaticMatch(input,[{...exact,street:'Paul-Meyer-Straße'},exact],'AT'),exact);
});
test('duplicate records far apart still require a location choice',()=>{
  assert.equal(planner.automaticMatch(stop('a'),[house,{...house,lon:house.lon+0.01}],'AT'),null);
});
test('a house suffix is retained and an apartment record cannot replace another building',()=>{
  const input={address:'Birkenweg 7a',postal:'1234 Beispielstadt'};
  const building={...house,street:'Birkenweg',house:'7a',postal:'1234'};
  const unit={...building,house:'7a/2/6',lat:building.lat+0.0001};
  assert.equal(planner.automaticMatch(input,[unit,building,{...building,lat:building.lat+0.0001}],'AT'),building);
  assert.equal(planner.automaticMatch(input,[{...building,house:'7b'}],'AT'),null);
});
test('geocoder candidates drop invalid coordinates and duplicate locations',()=>{
  const feature={geometry:{coordinates:[16,48]},properties:{street:'Hauptplatz',housenumber:'1',postcode:'1010',city:'Wien'}};
  assert.equal(planner.candidates({features:[feature,feature,{...feature,geometry:{coordinates:[null,null]}}]}).length,1);
});
test('geocoding sends address and country only, with no customer name or notes',async()=>{
  let requested;
  const client=planner.createClient({interval:0,fetchImpl:async url=>{requested=new URL(url);return {ok:true,json:async()=>({features:[]})};}});
  await client.geocode({...stop('Private customer'),note:'Private note'},'AT');
  assert.equal(requested.searchParams.get('q'),'Rennbahnweg 25, 1220 Wien');
  assert.equal(requested.searchParams.get('countrycode'),'AT');
  assert.ok(!requested.toString().includes('Private'));
});
test('routing requests an open driving trip and compares with the original route',async()=>{
  const urls=[];
  const client=planner.createClient({interval:0,fetchImpl:async url=>{urls.push(new URL(url));return {ok:true,json:async()=>urls.length===1?trip():baseline()};}});
  const plan=await client.optimize(points);
  assert.equal(urls[0].searchParams.get('roundtrip'),'false');
  assert.equal(urls[0].searchParams.get('source'),'first');
  assert.equal(urls[0].searchParams.get('destination'),'any');
  assert.ok(urls[1].pathname.startsWith('/route/v1/driving/'));
  for(const url of urls){assert.equal(url.searchParams.get('overview'),'full');assert.equal(url.searchParams.get('geometries'),'geojson');}
  assert.deepEqual(plan.order,[0,2,1]);
});

test('map geometries follow the selected plan, including unchanged or slower proposals',()=>{
  const before=baseline(),after=trip();
  before.routes[0].geometry={type:'LineString',coordinates:[[16,48],[16.1,48.1],[16.2,48.2]]};
  after.trips[0].geometry={type:'LineString',coordinates:[[16,48],[16.2,48.2],[16.1,48.1]]};
  assert.equal(planner.selectPlan(points,after,before).after.geometry,after.trips[0].geometry);
  after.trips[0].duration=300;
  const kept=planner.selectPlan(points,after,before);
  assert.equal(kept.after.geometry,before.routes[0].geometry);
  assert.deepEqual(kept.order,[0,1,2]);
});
test('service throttling and network failures produce actionable errors',async()=>{
  const limited=planner.createClient({interval:0,fetchImpl:async()=>({ok:false,status:429})});
  await assert.rejects(limited.geocode(stop('a'),'AT'),/ausgelastet/);
  const offline=planner.createClient({interval:0,fetchImpl:async()=>{throw new TypeError('Failed to fetch');}});
  await assert.rejects(offline.geocode(stop('a'),'AT'),/Internetverbindung/);
});
test('cancelling prevents later routing requests',async()=>{
  const controller=new AbortController();let calls=0;
  const client=planner.createClient({interval:0,fetchImpl:async()=>{calls++;controller.abort();return {ok:true,json:async()=>trip()};}});
  await assert.rejects(client.optimize(points,controller.signal),{name:'AbortError'});assert.equal(calls,1);
});
test('timeouts release a stalled request',async()=>{
  const client=planner.createClient({interval:0,timeout:10,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError')),{once:true}))});
  await assert.rejects(client.geocode(stop('a'),'AT'),/antwortet nicht/);
});
test('too many stops are rejected before any network request',async()=>{
  const client=planner.createClient({fetchImpl:()=>assert.fail('Network should not be used')});
  await assert.rejects(client.optimize(Array.from({length:planner.MAX_STOPS+2},()=>points[0])),/Ungültige Anzahl/);
});
