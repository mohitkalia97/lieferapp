const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const delivery=require('../delivery-import.js');

function app(){
  const elements=new Map();
  function element(){return {value:'',children:[],classList:{toggle(){},add(){},remove(){}},appendChild(node){this.children.push(node);},querySelectorAll(){return [];}};}
  const context=vm.createContext({DeliveryImport:delivery,RoutePlanner:require('../routing.js'),RouteMap:require('../route-map.js'),
    crypto:{randomUUID:()=>String(Math.random())},window:{addEventListener(){}},navigator:{},console,
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelectorAll:()=>[],createElement:element}});
  vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
  return context;
}
const word=(text,x,y)=>({text,bbox:{x0:x,x1:x+Math.max(10,text.length*5),y0:y,y1:y+12},confidence:99});
const header=()=>[word('Kunde',20,20),word('Klasse',380,20),word('Lieferung',460,20),word('Preis',700,20),word('Anzahl',820,20)];
function customer(number,y,label,collection='',letter=''){
  return [word(`${number} KNR ${100000+number}`,20,y),word(`Firma Test ${number}`,20,y+18),word('Lindenweg 7',20,y+36),word('1234 Beispielstadt',20,y+54),
    ...(collection?[word(collection,380,y+18)]:[]),word(label,460,y+18),...(letter?[word(letter,565,y+18)]:[]),word('29,90',700,y+18),word('2',820,y+18)];
}
function parse(words){const context=app();return delivery.parsePage(words,1000,context);}

test('collection retains the exact number and parenthesized letter',()=>{
  for(const label of ['Kollektion 38 (B)','38 Kollektion (B)','Kollektion 38(B)','Kollektion 38 ( B )'])assert.equal(delivery.readDelivery(label).deliveryType,'Kollektion 38 B');
  assert.equal(delivery.readDelivery('Kollektion (C)',{numbers:['07']}).deliveryType,'Kollektion 07 C');
});
test('a package is never turned into a collection even if a number and letter are present',()=>{
  assert.equal(delivery.readDelivery('Lieferpaket 38 (B)').deliveryType,'Lieferpaket');
  assert.equal(delivery.readDelivery('Lieferpaket Kollektion 38 (B)').deliveryType,'Lieferpaket');
});
test('missing, unparenthesized, or conflicting collection details are not invented',()=>{
  for(const label of ['Kollektion','Kollektion 38','Kollektion (B)','Kollektion 38 B','Kollektion 38 (B) 40 (C)']){
    const value=delivery.readDelivery(label);assert.equal(value.deliveryType,'Kollektion');assert.ok(value.deliveryReview);assert.equal(value.deliverySource,label);
  }
  assert.ok(delivery.readDelivery('Kollektion (B)',{numbers:['38','39']}).deliveryReview);
});
test('other delivery names are preserved verbatim',()=>{
  for(const label of ['Punktemappe','Sondermappe','Lesemappe Premium'])assert.equal(delivery.readDelivery(label).deliveryType,label);
});
test('prices and quantities in other columns cannot become collection numbers',()=>{
  const stops=parse([...header(),...customer(1,60,'Kollektion','','(B)')]);
  assert.equal(stops.length,1);assert.equal(stops[0].deliveryType,'Kollektion');assert.ok(stops[0].deliveryReview);
  assert.equal(stops[0].address,'Lindenweg 7');assert.equal(stops[0].postal,'1234 Beispielstadt');
});
test('adjacent customers receive only their own delivery type, including identical addresses',()=>{
  const stops=parse([...header(),...customer(1,60,'Kollektion','38','(B)'),...customer(2,160,'Lieferpaket','99','(C)'),...customer(3,260,'Punktemappe'),...customer(4,360,'Sondermappe')]);
  assert.equal(stops.length,4);assert.deepEqual(stops.map(s=>s.deliveryType),['Kollektion 38 B','Lieferpaket','Punktemappe','Sondermappe']);
  assert.ok(stops.every(s=>!s.deliveryReview));
  assert.ok(stops[0].deliverySource.includes('38'));assert.ok(!stops[0].deliverySource.includes('99'));
});
test('a missing letter cannot be borrowed from the next customer',()=>{
  const stops=parse([...header(),...customer(1,60,'Kollektion','38'),...customer(2,160,'Kollektion','42','(B)')]);
  assert.equal(stops[0].deliveryType,'Kollektion');assert.ok(stops[0].deliveryReview);assert.equal(stops[1].deliveryType,'Kollektion 42 B');
});
test('separate pages cannot lend numbers or letters to each other',()=>{
  const first=parse([...header(),...customer(1,60,'Kollektion','38')]),second=parse([...header(),...customer(2,60,'Kollektion','','(B)')]);
  assert.ok(first[0].deliveryReview);assert.ok(second[0].deliveryReview);
});
test('a wrapped parenthesized letter stays inside the same customer block',()=>{
  const words=[...header(),...customer(1,60,'Kollektion','38'),word('(B)',460,94)];
  assert.equal(parse(words)[0].deliveryType,'Kollektion 38 B');
});
test('low-confidence OCR is marked for review instead of silently accepted',()=>{
  const words=[...header(),...customer(1,60,'Kollektion','38','(B)')];words.find(w=>w.text==='38').confidence=42;
  assert.ok(parse(words)[0].deliveryReview);
});
test('unlabelled or empty delivery cells stay unknown',()=>{
  const words=[...header(),...customer(1,60,'')];const stop=parse(words)[0];
  assert.equal(stop.deliveryType,'');assert.ok(stop.deliveryReview);
});
test('native PDF coordinates use the same layout as OCR words',()=>{
  const source=[...header(),...customer(1,60,'Kollektion','38','(B)')];
  const items=source.map(w=>({str:w.text,width:w.bbox.x1-w.bbox.x0,height:12,transform:[1,0,0,1,w.bbox.x0,1000-w.bbox.y1]}));
  const words=delivery.pdfWords(items,{scale:1,convertToViewportPoint:(x,y)=>[x,1000-y]});
  assert.equal(parse(words)[0].deliveryType,'Kollektion 38 B');
});
test('delivery metadata survives normalization and older backups remain valid',()=>{
  const context=app(),data={name:'Test',address:'Lindenweg 7',postal:'1234 Beispielstadt',...delivery.readDelivery('Kollektion 38 (B)')};
  const normalized=context.normalizeTour({stops:[data]});assert.equal(normalized.stops[0].deliveryType,'Kollektion 38 B');
  assert.equal(normalized.stops[0].deliverySource,'Kollektion 38 (B)');assert.equal(context.stopTemplate({}).deliveryType,'');
});
test('CSV output and the route view include the delivery type',()=>{
  const context=app();context.input=context.normalizeTour({stops:[{name:'Test',address:'Lindenweg 7',postal:'1234 Beispielstadt',deliveryType:'Kollektion 38 B'}]});
  vm.runInContext('currentTour=input; renderOptimizationActions=()=>{}; show=()=>{}; downloadBlob=(name,type,text)=>{csv=text;};',context);
  context.renderRoute();assert.equal(context.document.getElementById('deliveryType').textContent,'Kollektion 38 B');
  context.document.getElementById('exportCsv').onclick();assert.match(context.csv,/"Lieferart"/);assert.match(context.csv,/"Kollektion 38 B"/);
});
