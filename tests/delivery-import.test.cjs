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
const header=()=>[word('Kunde',20,20),word('Lieferung',380,20),word('Klasse',620,20),word('lief. / zur.',680,20),word('Preis',800,20),word('Anzahl',900,20)];
function customer(number,y,label,collection='',letter=''){
  return [word(`${number} KNR ${100000+number}`,20,y),word(`Firma Test ${number}`,20,y+18),word('Lindenweg 7',20,y+36),word('1234 Beispielstadt',20,y+54),
    ...(collection?[word(collection,680,y+18)]:[]),word(label,380,y+18),...(letter?[word(letter,480,y+18)]:[]),word('3',620,y+18),word('29,90',800,y+18),word('2',900,y+18)];
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
  const words=[...header(),...customer(1,60,'Kollektion','38'),word('(B)',380,94)];
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
test('delivery number before the slash wins over collection subtype, class and returns',()=>{
  const stop=parse([...header(),...customer(1,60,'Kollektion 2','38 / 37*','(A)')])[0];
  assert.equal(stop.deliveryType,'Kollektion 38 A');assert.equal(stop.deliveryReview,'');
  assert.equal(delivery.readDelivery('Kollektion 2 (A)',{column:true}).deliveryType,'Kollektion');
});
test('an additional retaining folder does not replace the collection',()=>{
  const stop=parse([...header(),...customer(1,60,'Kollektion 3','35 / -','(B)'),word('Behaltemappe COL',380,96),word('35',680,96)])[0];
  assert.equal(stop.deliveryType,'Kollektion 35 B');
});
test('slanted scanned headers still identify the correct columns',()=>{
  const headers=header().map((w,i)=>({...w,bbox:{...w.bbox,y0:20+i*3,y1:32+i*3}}));
  assert.equal(parse([...headers,...customer(1,60,'Kollektion 2','38/37','(A)')])[0].deliveryType,'Kollektion 38 A');
});
test('generic delivery labels omit the printed internal COL or WS suffix',()=>{
  assert.equal(delivery.readDelivery('Punktemappe WS').deliveryType,'Punktemappe');
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

// ----- scanned Morawa lists: skew, OCR noise, cell re-reads -----
test('collection names printed in the PDF keep their prefix; a Wunsch-Kollektion is just "Wunschkollektion"',()=>{
  const read=(label,n)=>delivery.readDelivery(label,{numbers:[n],column:true});
  assert.equal(read('Ladies Kollektion (L) COL','37').deliveryType,'Ladies Kollektion 37 L');
  assert.equal(read('Classic Kollektion (P)COL','38').deliveryType,'Classic Kollektion 38 P');
  for(const label of ['Wunsch-Kollektion WS','Wunsch Kollektion WS','Wunach Koltektion WS']){
    const value=read(label,'38');assert.equal(value.deliveryType,'Wunschkollektion');assert.equal(value.deliveryReview,'');
  }
  assert.deepEqual({...delivery.readDelivery('Wunsch-Kollektion WS',{column:true}),deliverySource:''},{deliveryType:'Wunschkollektion',deliveryReview:'',deliverySource:''});
  assert.equal(delivery.reviewValue('Ladies Kollektion 37 L'),'');
  for(const typed of ['Wunschkollektion','Wunsch-Kollektion','wunsch kollektion'])assert.equal(delivery.reviewValue(typed),'');
});
test('typical OCR damage is tolerated without inventing letters',()=>{
  assert.equal(delivery.readDelivery('KolleKtion 2A) COL',{numbers:['38'],column:true}).deliveryType,'Kollektion 38 A');
  assert.equal(delivery.readDelivery('Li ferpaket lt. GesamtLS').deliveryType,'Lieferpaket');
  assert.equal(delivery.readDelivery('It. GesamtLS').deliveryType,'Lieferpaket');
  assert.ok(delivery.readDelivery('Kollektion 2 A COL',{numbers:['38'],column:true}).deliveryReview);
});
test('only the delivered number of "lief. / zur." is taken',()=>{
  for(const [text,value] of [['38/ 37*','38'],['35/ -','35'],[':38/ 37"','38'],['1 37/36','37'],['38','38'],['371 36°',null],['38/37 40/39',null],['',null]])
    assert.equal(delivery.deliveredNumber(text),value,text);
});
test('a stop header whose running number was lost still starts its own customer',()=>{
  const words=[...header(),...customer(1,60,'Lieferpaket lt. GesamtLS'),...customer(2,160,'Kollektion 2 (A) COL','38/ 37*')];
  const lost=words.find(w=>w.text==='2 KNR 100002');lost.text='; KNr.: 100002';
  const stops=parse(words);
  assert.equal(stops.length,2);assert.deepEqual(stops.map(s=>s.deliveryType),['Lieferpaket','Kollektion 38 A']);
});
test('skewed scans are deskewed with the OCR baselines',()=>{
  const slope=0.04,tilt=words=>words.map(w=>({...w,bbox:{...w.bbox,y0:w.bbox.y0+slope*w.bbox.x0,y1:w.bbox.y1+slope*w.bbox.x0}}));
  const words=tilt([...header(),...customer(1,60,'Kollektion 2 (B) COL','35/ -'),...customer(2,160,'Kollektion 2 (A) COL','38/ 37*'),...customer(3,260,'Lieferpaket lt. GesamtLS')]);
  const lines=[0,1,2,3,4,5,6].map(i=>({bbox:{x0:20,x1:950,y0:20+i*40,y1:32+i*40+38},baseline:{x0:20,y0:30+i*40,x1:950,y1:30+i*40+slope*930}}));
  const context=app(),stops=delivery.parsePage(words,1000,context,{lines});
  assert.deepEqual(stops.map(s=>s.deliveryType),['Kollektion 35 B','Kollektion 38 A','Lieferpaket']);
});
test('cell re-reads confirm, complete or contradict the page read',()=>{
  const stop=label=>({_cells:{slope:0,h:12,label:{x0:0,x1:10,yd:0},number:{x0:0,x1:10,yd:0}},_page:{label,number:'38',confidence:90}});
  const n=text=>({text,confidence:80});
  assert.deepEqual(delivery.mergeReads(stop('Kollektion 2 (A) COL'),n('Kollektion 2 (A) COL'),[n('38/37*'),n('38/37')]).deliveryType,'Kollektion 38 A');
  const unclear=delivery.mergeReads(stop('Kollektion 2 (A) COL'),n('Kollektion 2 (A) COL'),[n('36/37'),n('36/37')]);
  assert.equal(unclear.deliveryType,'Kollektion');assert.match(unclear.deliveryReview,/38 oder 36|36 oder 38/);
  const letters=delivery.mergeReads(stop('Kollektion 2 (A) COL'),n('Kollektion 2 (B) COL'),[n('38/37')]);
  assert.ok(letters.deliveryReview);assert.ok(!/\b[AB]$/.test(letters.deliveryType));
  const completed=delivery.mergeReads({...stop('Kollektion 2 COL'),_page:{label:'Kollektion 2 COL',number:null,confidence:0}},n('Kollektion 2 (A) COL'),[n('38/37'),n('38/ 37')]);
  assert.equal(completed.deliveryType,'Kollektion 38 A');assert.equal(completed.deliveryReview,'');
  assert.ok(delivery.mergeReads(stop('Lieferpaket lt. GesamtLS'),n('Kollektion 2 (A) COL'),[]).deliveryReview);
  const other=delivery.mergeReads(stop('Punktemappe WS'),n('Punktemappe WS'),[]);
  assert.equal(other.deliveryType,'Punktemappe');assert.equal(other.deliveryReview,'');
});
test('refineStops reads label and two number variants only for unclear or collection stops',async()=>{
  const stops=parse([...header(),...customer(1,60,'Kollektion 2 (A) COL'),...customer(2,160,'Lieferpaket lt. GesamtLS')]);
  assert.equal(stops[0].deliveryType,'Kollektion');
  const asked=[];
  await delivery.refineStops(stops,async box=>{asked.push(`${box.kind}${box.variant}`);return box.kind==='label'?{text:'Kollektion 2 (A) COL',confidence:90}:{text:'38/ 37*',confidence:70};});
  assert.deepEqual(asked,['label0','number0','number1']);
  assert.equal(stops[0].deliveryType,'Kollektion 38 A');assert.equal(stops[1].deliveryType,'Lieferpaket');
});
test('cell cleaning drops rule dots, neighbours and cut shapes but keeps characters',()=>{
  const w=60,h=30,px=new Uint8ClampedArray(w*h*4).fill(255),ink=(x,y)=>px.fill(0,(y*w+x)*4,(y*w+x)*4+3);
  for(let y=8;y<20;y++)for(let x=20;x<26;x++)ink(x,y);      // a digit-sized stroke
  for(let y=2;y<28;y+=4)ink(5,y);                           // dotted rule
  for(let y=8;y<20;y++)for(let x=50;x<54;x++)ink(x,y);      // shape outside the cell
  delivery.clearNumberRules(px,w,h,12,165,{x0:0,x1:40,y0:0,y1:30});
  const dark=(x,y)=>px[(y*w+x)*4]===0;
  assert.ok(dark(22,12));assert.ok(!dark(5,10));assert.ok(!dark(51,12));
});
test('a skipped OCR block is reported and its re-read words are merged back',()=>{
  const context=app();
  const words=[...header(),word('2 KNr 100002',20,60),...customer(5,400,'Lieferpaket lt. GesamtLS')];
  const regions=delivery.unreadRegions(words,1000,context);
  assert.equal(regions.length,1);assert.ok(regions[0].yd>60&&regions[0].yd<400);
  const box=regions[0],g=delivery.cellGeometry(box);
  const toCell=w=>({...w,bbox:{x0:(w.bbox.x0-box.x0)*box.scale+g.pad,x1:(w.bbox.x1-box.x0)*box.scale+g.pad,
    y0:(w.bbox.y0-box.yd+box.half)*box.scale+g.pad,y1:(w.bbox.y1-box.yd+box.half)*box.scale+g.pad}});
  const fresh=customer(2,60,'Kollektion 2 (A) COL','38/ 37*').map(toCell);
  const merged=delivery.mergeRegionWords(words,box,fresh);
  const stops=delivery.parsePage(merged,1000,context);
  assert.deepEqual(stops.map(s=>s.deliveryType),['Kollektion 38 A','Lieferpaket']);
});

test('a customer re-read cannot erase a contradictory number from the original page',()=>{
  const original=parse([...header(),...customer(1,60,'Kollektion 2 (A) COL','35/-')]);
  const reread=parse([...header(),...customer(1,60,'Kollektion 2 (A) COL','38/-')]);
  delivery.retainPageEvidence(reread,original);
  const merged=delivery.mergeReads(reread[0],{text:'Kollektion 2 (A) COL',confidence:90},[{text:'38/-',confidence:90},{text:'38/-',confidence:90}]);
  assert.equal(merged.deliveryType,'Kollektion');assert.match(merged.deliveryReview,/35/);assert.match(merged.deliveryReview,/38/);
});

test('unrecognizable delivery labels are not silently accepted as another delivery type',()=>{
  const stop={_page:{label:'unleserlich',confidence:10,number:null}};
  const merged=delivery.mergeReads(stop,{text:'unbekannt',confidence:5});
  assert.equal(merged.deliveryType,'');assert.ok(merged.deliveryReview);
});

test('a differing retaining-folder number warns but never supplies a missing collection number',()=>{
  const stops=parse([...header(),...customer(1,60,'Kollektion 2 (A) COL','38/-'),word('Behaltemappe COL',380,96),word('35',680,96)]);
  const read={text:'38/-',confidence:90};
  const merged=delivery.mergeReads(stops[0],{text:'Kollektion 2 (A) COL',confidence:90},[read,read]);
  assert.equal(merged.deliveryType,'Kollektion');assert.match(merged.deliveryReview,/Abweichende Nummern/);
  const noNumber={_page:{label:'Kollektion 2 (A) COL',number:null,companionNumbers:['35'],confidence:90}};
  assert.equal(delivery.mergeReads(noNumber,{text:'Kollektion 2 (A) COL',confidence:90},[]).deliveryType,'Kollektion');
});

// ----- bent and obliquely photographed pages (V5.12) -----
function lineImage(width,height,lines){
  // White RGBA image with dark text-like bars along y = y0 + slope*(x - width).
  const px=new Uint8ClampedArray(width*height*4).fill(255);
  for(const {y0,slope} of lines)for(let x=10;x<width-10;x++){
    if(x%14>9)continue;
    const yc=Math.round(y0+slope*(x-width));
    for(let y=yc-4;y<=yc+4;y++)if(y>=0&&y<height)px.fill(0,(y*width+x)*4,(y*width+x)*4+3);
  }
  return px;
}
test('the customer column is straightened strip by strip, following a bend that changes down the page',()=>{
  const width=400,height=600,lines=[];
  for(let y=40;y<300;y+=30)lines.push({y0:y,slope:0.04});
  for(let y=330;y<580;y+=30)lines.push({y0:y,slope:0});
  const px=lineImage(width,height,lines),points=delivery.columnShear(px,width,height,{xref:width,charHeight:10});
  assert.ok(Math.abs(delivery.shearAt(points,120)-0.04)<=0.006,'top strip follows the strong tilt');
  assert.ok(Math.abs(delivery.shearAt(points,500))<=0.006,'bottom strip stays straight');
  const out=delivery.straightenColumn(px,width,height,points,width);
  const rowInk=y=>{let n=0;for(let x=0;x<width;x++)if(out[(y*width+x)*4]===0)n++;return n;};
  assert.ok(rowInk(100)>width*0.5,'a tilted line becomes one straight row');
});
test('words of a straightened line keep one row height and map back onto the page',()=>{
  const points=[{y:0,slope:0.05},{y:1000,slope:0.05}];
  const words=delivery.straightenedWords([{text:'2',bbox:{x0:10,x1:20,y0:100,y1:120}},{text:'KNr.:',bbox:{x0:200,x1:260,y0:100,y1:120}}],points,{xref:500});
  assert.equal(words[0].lineY,words[1].lineY);assert.equal(words[0].lineX,500);
  assert.ok(words[0].bbox.y0<words[1].bbox.y0,'on the page the left end of the line lies higher');
  const rows=delivery.rowsFromWords(words);assert.equal(rows.length,1);
});
test('a tilted first customer line keeps its customer and address',()=>{
  // "2 KNr.: …" climbs so steeply that, unstraightened, its right part sits on the name line.
  const tilt=0.06,words=[...header(),...customer(1,80,'Wunsch-Kollektion WS','41/ 40'),...customer(2,200,'Kollektion 1 (S) COL','40/ 39','')];
  const bent=words.map(w=>w.bbox.x0<370&&w.bbox.y0<170?{...w,bbox:{...w.bbox,y0:w.bbox.y0+tilt*w.bbox.x0,y1:w.bbox.y1+tilt*w.bbox.x0}}:w);
  const straight=bent.map(w=>w.bbox.x0<370&&w.bbox.y0<190?{...w,lineX:370,lineY:(w.bbox.y0+w.bbox.y1)/2-tilt*w.bbox.x0+tilt*370}:w);
  const stops=parse(straight);
  assert.equal(stops.length,2);assert.equal(stops[0].address,'Lindenweg 7');assert.equal(stops[0].deliveryType,'Wunschkollektion');
});
test('leaning columns are followed row by row on obliquely photographed pages',()=>{
  // Columns drift left down the page, more on the right than on the left (perspective).
  const lean=(x,y)=>x-(0.01+0.00005*x)*(y-20);
  const shift=w=>({...w,bbox:{...w.bbox,x0:lean(w.bbox.x0,w.bbox.y0),x1:lean(w.bbox.x1,w.bbox.y0)}});
  const words=[...header()];
  for(let i=0;i<6;i++)words.push(...customer(i+1,60+i*150,i%2?'Lieferpaket lt. GesamtLS':'Kollektion 2 (A) COL',i%2?'':'41/ 40'),word(`${10+i},50`,800,78+i*150),word(`0${i+1}/1${i}`,250,60+i*150));
  const stops=parse(words.map(shift));
  assert.equal(stops.length,6);
  assert.deepEqual(stops.map(s=>s.deliveryType),['Kollektion 41 A','Lieferpaket','Kollektion 41 A','Lieferpaket','Kollektion 41 A','Lieferpaket']);
});
test('a wide OCR box around "Klasse" is resolved by the other header words',()=>{
  const words=header().map(w=>w.text==='Klasse'?{...w,bbox:{...w.bbox,x1:w.bbox.x0+260}}:w);
  const layout=delivery.columns([...words,...customer(1,60,'Kollektion 2 (A) COL','38/ 37*')],1000);
  assert.ok(layout.deliveryStart<400&&layout.numberStart<700,'columns stay at the left end of the box');
  assert.equal(parse([...words,...customer(1,60,'Kollektion 2 (A) COL','38/ 37*')])[0].deliveryType,'Kollektion 38 A');
});
test('a table heading inside the first customer band is not taken as Lieferart',()=>{
  const stop=parse([...header().filter(w=>w.text!=='Lieferung'),word('Lieferung',380,62),...customer(1,60,'Lieferpaket lt. GesamtLS').map(w=>w.text==='Lieferpaket lt. GesamtLS'?{...w,bbox:{...w.bbox,y0:w.bbox.y0+16,y1:w.bbox.y1+16}}:w)])[0];
  assert.equal(stop.deliveryType,'Lieferpaket');
  assert.equal(delivery.readDelivery('Lieferung').deliveryType,'');
});
test('suffixes alone are no delivery type, short printed codes are',()=>{
  for(const label of ['COL','WS'])assert.equal(delivery.readDelivery(label).deliveryType,'');
  assert.equal(delivery.readDelivery('DS WS').deliveryType,'DS');assert.equal(delivery.readDelivery('DS DS').deliveryType,'DS DS');
});
test('a lone number is only a delivery number on the "lief." side; a dash means nothing returned',()=>{
  assert.equal(delivery.deliveredNumber('35 -'),'35');assert.equal(delivery.deliveredNumber('35-'),'35');
  const right=parse([...header(),...customer(1,60,'Kollektion 2 (A) COL'),word('40',720,78)])[0];
  assert.equal(right.deliveryType,'Kollektion');assert.ok(right.deliveryReview);
  const left=parse([...header(),...customer(1,60,'Kollektion 2 (A) COL'),word('38',684,78)])[0];
  assert.equal(left.deliveryType,'Kollektion 38 A');
});
test('wavy rows: a taller strip is read when the number is not on the label line',async()=>{
  const stops=parse([...header(),...customer(1,60,'Kollektion 3 (B) COL')]);
  const asked=[];
  await delivery.refineStops(stops,async box=>{
    asked.push(`${box.kind}${box.variant}`);
    if(box.kind==='label')return {text:'Kollektion 3 (B) COL',confidence:90};
    if(box.variant<2)return {text:'',confidence:0};
    const g=delivery.cellGeometry(box),x=g.pad+g.keep.x0+5;
    return {text:'38',confidence:95,words:[{text:'38',bbox:{x0:x,x1:x+20,y0:10,y1:30}}]};
  });
  assert.deepEqual(asked,['label0','number0','number1','number2']);
  assert.equal(stops[0].deliveryType,'Kollektion 38 B');
  // The same lone number on the "zur." side, or with a second delivery line, is not accepted.
  const other=parse([...header(),...customer(1,60,'Kollektion 3 (B) COL'),word('Behaltemappe COL',380,96)]);
  await delivery.refineStops(other,async box=>box.kind==='label'?{text:'Kollektion 3 (B) COL',confidence:90}:box.variant<2?{text:'',confidence:0}:{text:'38',confidence:95,words:[{text:'38',bbox:{x0:30,x1:50,y0:10,y1:30}}]});
  assert.equal(other[0].deliveryType,'Kollektion');assert.ok(other[0].deliveryReview);
});
test('number cells drop digits of the next line; label cells keep curved letters',()=>{
  const w=80,h=40,keep={x0:0,x1:80,y0:10,y1:26};
  const make=()=>{const px=new Uint8ClampedArray(w*h*4).fill(255);
    for(let y=21;y<34;y++)for(let x=30;x<36;x++)px.fill(0,(y*w+x)*4,(y*w+x)*4+3); // centre below the band, about half inside
    return px;};
  const number=delivery.clearNumberRules(make(),w,h,14,165,keep,false),label=delivery.clearNumberRules(make(),w,h,14,165,keep,true);
  assert.equal(number[(28*w+32)*4],255);assert.equal(label[(28*w+32)*4],0);
});
test('customer words come from the straightened read, the rest from the page read',()=>{
  const layout={deliveryStart:300,shiftX:(x,y)=>x+0.05*y}; // columns lean left further down
  const page=[{text:'Lieferpaket',bbox:{x0:290,x1:350,y0:390,y1:410}},{text:'garbled',bbox:{x0:100,x1:150,y0:100,y1:110}}];
  const column=[{text:'Paul,',bbox:{x0:100,x1:140,y0:100,y1:110}}];
  const merged=delivery.mergeColumnWords(page,column,layout).map(w=>w.text);
  assert.deepEqual(merged.sort(),['Lieferpaket','Paul,']);
});
test('street names containing a heading word and a faint "A-" postcode are kept',()=>{
  const context=app();
  assert.equal(context.addressFromLine('Sparkassegasse 16').address,'Sparkassegasse 16');
  assert.equal(context.addressFromLine('Horner Stra@e 26').address,'Horner Straße 26');
  assert.deepEqual({...context.parsePostal('4-2020 Hollabrunn')},{postal:'2020',city:'Hollabrunn'});
  assert.equal(context.parsePostal('4 2020 Hollabrunn'),null);
  assert.ok(context.isNoise('Klasse lief. / zur.'));
});

test('a Wunsch-Kollektion needs no number reads and stays "Wunschkollektion" after the cell check',async()=>{
  const stops=parse([...header(),...customer(1,60,'Wunsch-Kollektion WS','41/ 40')]);
  const asked=[];
  await delivery.refineStops(stops,async box=>{asked.push(box.kind);return {text:'Wunsch-Kollektion WS',confidence:90};});
  assert.deepEqual(asked,['label']);assert.equal(stops[0].deliveryType,'Wunschkollektion');assert.equal(stops[0].deliveryReview,'');
});

// ----- V5.13 -----
test('house numbers with staircase or door parts are addresses ("Gratzl 5/1")',()=>{
  const context=app();
  assert.equal(context.addressFromLine('Gratzl 5/1').address,'Gratzl 5/1');
  assert.equal(context.addressFromLine('Gratzl 5 / 1').address,'Gratzl 5/1');
  assert.equal(context.addressFromLine('Hauptplatz 16 / 2').address,'Hauptplatz 16/2');
  assert.equal(context.addressFromLine('Tel: 0664/59 31 540'),null);
  const [stop]=context.parseStops('22 KNr.: 6186802 09/16\nKosmetik & Fußpflege\nVogler, Margot\nGratzl 5/1\nA-3730 Eggenburg\nTel: 0664/59 31 540 (Salon)');
  assert.equal(stop.name,'Kosmetik & Fußpflege - Vogler, Margot');assert.equal(stop.address,'Gratzl 5/1');assert.equal(stop.postal,'3730 Eggenburg');
});
test('dotted-rule leftovers at the end of customer lines do not hide the address',()=>{
  const words=[...header(),...customer(1,60,'Lieferpaket lt. GesamtLS')].map(w=>w.text==='Lindenweg 7'?{...w,text:'Lindenweg 7 i'}:w.text==='1234 Beispielstadt'?{...w,text:'1234 Beispielstadt :'}:w);
  const [stop]=parse(words);assert.equal(stop.address,'Lindenweg 7');assert.equal(stop.postal,'1234 Beispielstadt');
});
test('a curved text line is followed and straightened through the middle of the cell',()=>{
  const width=300,height=80,px=new Uint8ClampedArray(width*height*4).fill(255);
  // letters along an arc that rises by 20 px towards the right
  for(let x=10;x<290;x++){if(x%12>7)continue;const yc=Math.round(40-20*((x-10)/280)**2);for(let y=yc-6;y<=yc+6;y++)px.fill(0,(y*width+x)*4,(y*width+x)*4+3);}
  const out=delivery.followTextLine(px,width,height,24);
  const centre=x=>{let n=0,sum=0;for(let y=0;y<height;y++)if(out[(y*width+x)*4]===0){n++;sum+=y;}return n?sum/n:null;};
  assert.ok(Math.abs(centre(16)-40)<=5);assert.ok(Math.abs(centre(280)-40)<=5,'the raised right end is moved back to the middle');
  const before=y=>{let n=0,sum=0;for(let r=0;r<height;r++)if(px[(r*width+y)*4]===0){n++;sum+=r;}return sum/n;};
  assert.ok(before(280)<25,'it really was raised before');
});
test('an unreadable curved label is read again along its line',async()=>{
  const stops=parse([...header(),...customer(1,60,'Classic (P? Co','')].map(w=>w.text==='Classic (P? Co'?{...w,confidence:44}:w));
  const asked=[];
  await delivery.refineStops(stops,async box=>{
    asked.push(`${box.kind}${box.variant}${box.follow?'f':''}`);
    if(box.kind==='label')return box.follow?{text:'Classic Kollektion (P) COL',confidence:94}:{text:'Classic Kon) ktion (P) cot',confidence:57};
    return {text:'41/ 40',confidence:80};
  });
  assert.deepEqual(asked.slice(0,2),['label0','label1f']);
  assert.equal(stops[0].deliveryType,'Classic Kollektion 41 P');
});
test('a lone number next to a second delivery line is replaced by the pair from a taller strip',async()=>{
  const stops=parse([...header(),...customer(1,60,'Classic Kollektion (P) COL'),word('Behaltemappe COL',380,96)]);
  const asked=[];
  await delivery.refineStops(stops,async box=>{
    asked.push(`${box.kind}${box.variant}:${box.psm}`);
    if(box.kind==='label')return {text:'Classic Kollektion (P) COL',confidence:94};
    if(box.variant<2)return {text:'41',confidence:95};   // the Behaltemappe line below
    return {text:'41/40 41',confidence:80,words:[
      {text:'41/',confidence:80,bbox:{x0:20,x1:50,y0:10,y1:30}},{text:'40',confidence:90,bbox:{x0:70,x1:90,y0:10,y1:30}},
      {text:'41',confidence:90,bbox:{x0:20,x1:40,y0:45,y1:65}}]};
  });
  assert.deepEqual(asked,['label0:7','number0:7','number1:7','number2:6']);
  assert.equal(stops[0].deliveryType,'Classic Kollektion 41 P');
  // On the page read alone such a lone number is not taken when a second line exists.
  const page=parse([...header(),...customer(1,60,'Classic Kollektion (P) COL'),word('Behaltemappe COL',380,96),word('44',684,96)]);
  assert.equal(page[0].deliveryType,'Classic Kollektion');
});
