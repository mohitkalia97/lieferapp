(function(root){
  'use strict';
  // Reads the delivery type ("Lieferart") that belongs to each customer block of a
  // Morawa tour list. Scanned pages are skewed and full of dotted column rules, so
  // columns are located from the table header, rows are deskewed, and the two
  // cells that matter (Lieferung, lief.) can be re-read individually.
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
  const missing='Lieferart nicht eindeutig erkannt. Bitte am PDF prüfen.';
  const incomplete='Kollektion unvollständig oder mehrdeutig: Nummer und Klammerbuchstabe am PDF prüfen.';

  function distance(a,b){
    const row=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      let prev=row[0];row[0]=i;
      for(let j=1;j<=b.length;j++){const next=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=next;}
    }
    return row[b.length];
  }
  const core=text=>String(text||'').toLowerCase().replace(/ä/g,'a').replace(/ö/g,'o').replace(/ü/g,'u').replace(/[^a-z]/g,'');
  // OCR spellings such as "KolleKtion" or "Behaltemappe" are mapped to one form.
  const vocabulary=[['kollektion','Kollektion'],['wunschkollektion','Wunsch-Kollektion'],['lieferpaket','Lieferpaket'],
    ['punktemappe','Punktemappe'],['behaltemappe','Behältemappe']];
  function canonicalWord(word){
    const c=core(word);if(c.length<6)return word;
    for(const [key,value] of vocabulary)if(distance(c,key)<=Math.floor(key.length/5)){
      // Keep a parenthesised letter glued to the word, e.g. "Kollektion(B)".
      const tail=word.match(/[([{]\s*[A-Za-z]\s*[)\]}].*$/);
      return tail?`${value} ${tail[0]}`:value;
    }
    return word;
  }
  // Approximate substring search: does `text` contain `word` with at most k edits?
  function containsApprox(text,word,k){
    let row=new Array(word.length+1).fill(0).map((_,j)=>j);
    if(row[word.length]<=k)return true;
    for(const ch of text){
      const next=[0];
      for(let j=1;j<=word.length;j++)next[j]=Math.min(row[j]+1,next[j-1]+1,row[j-1]+(word[j-1]===ch?0:1));
      if(next[word.length]<=k)return true;
      row=next;
    }
    return false;
  }
  function canonicalLabel(label){
    let text=clean(label).split(' ').map(canonicalWord).join(' ');
    // "Wunsch Kollektion", "Wunach Kollektion" -> "Wunsch-Kollektion"
    text=text.replace(/(\S+)[\s-]+Kollektion\b/g,(all,before)=>distance(core(before),'wunsch')<=2&&core(before).length>=5?'Wunsch-Kollektion':all);
    // "Lieferpaket lt. GesamtLS" split or garbled by OCR, e.g. "Li ferpaket"
    if(!/Lieferpaket|Kollektion/.test(text)&&(containsApprox(core(text),'lieferpaket',2)||containsApprox(core(text),'gesamtls',1)))text='Lieferpaket';
    return text;
  }

  function reviewValue(value){
    const text=clean(value);
    if(!text)return missing;
    if(/^Wunsch-Kollektion\s+\d+$/i.test(text))return 'Kollektion ohne Klammerbuchstaben. Bitte am PDF prüfen.';
    if(/\bkollektion\b/i.test(text)&&!/^(?:(?:[A-ZÄÖÜ][a-zäöüß]+\s+)?Kollektion|Wunsch-Kollektion)\s+\d+\s+[A-Z]$/i.test(text))return 'Kollektion unvollständig: Nummer und Buchstabe prüfen.';
    return '';
  }

  // The letter is always printed in parentheses. One lost parenthesis is tolerated
  // ("2A)"), a bare letter without any parenthesis is not taken.
  function collectionLetters(text){
    const letters=new Set();
    for(const m of String(text).matchAll(/[([{]\s*([A-Za-z])\s*[)\]}]/g))letters.add(m[1].toUpperCase());
    if(!letters.size)for(const m of String(text).matchAll(/(?:^|[\s\d])([A-Z])[)\]}]|[([{]([A-Z])(?=\s|$|COL\b|WS\b)/g))letters.add((m[1]||m[2]).toUpperCase());
    return [...letters];
  }
  function deliveredNumber(value){
    if(Array.isArray(value))value=value.map(w=>typeof w==='string'?w:w.text).join(' ');
    const text=clean(value).replace(/[°º‘’'"“”^]/g,'*').replace(/^[^\d]+/,'').replace(/[|;:'{}!\s.,_]+$/,'');
    // "lief. / zur.": the first number is delivered, the second one returned.
    let m=text.match(/^(\d{1,2})\s*\/\s*(?:-+|\d{1,2}\s*\*?|\*)?\s*\*?$/);
    if(m)return m[1];
    // A rule in front can be read as "1": accept one clear "38/37" or "35/-" pair anywhere.
    const pairs=[...text.matchAll(/(?:^|[^\d\/])(\d{1,2})\s*\/\s*(?:-|\d{1,2}(?!\d))/g)];
    if(pairs.length===1)return pairs[0][1];
    m=text.match(/^(\d{1,2})(?:\s+\d{1,2}\s*\*?)?$/);
    return m?m[1]:null;
  }

  // Splits a label into the parts the output is built from.
  function labelParts(label){
    label=canonicalLabel(label);
    if(/\blieferpaket\b/i.test(label))return {type:'Lieferpaket'};
    const kind=label.match(/^(.*?)\b(Wunsch-Kollektion|Kollektion)\b(.*)$/i);
    if(kind){
      const wish=/^wunsch/i.test(kind[2]);
      const prefix=wish?'':kind[1].split(' ').filter(w=>/^[A-ZÄÖÜ][a-zäöüß]{2,}$/.test(w)).join(' ');
      const rest=kind[3].replace(/\b(?:COL|WS)\b/gi,' ');
      return {type:'collection',wish,title:wish?'Wunsch-Kollektion':prefix?`${prefix} Kollektion`:'Kollektion',
        letters:collectionLetters(rest),bracket:/[([{)\]}]/.test(rest),rest,before:kind[1]};
    }
    const plain=label.replace(/\s+(?:COL|WS|lt\.?\s+Gesamt\s*LS)$/i,'').replace(/^[^A-Za-zÄÖÜäöü]+|[^A-Za-zÄÖÜäöüß)]+$/g,'');
    return {type:'other',title:plain&&/[A-Za-zÄÖÜäöü]{3}/.test(plain)?plain:''};
  }

  function readDelivery(label,{numbers=[],source=label,column=false}={}){
    source=clean(source);
    const result=(deliveryType,deliveryReview='')=>({deliveryType,deliveryReview,deliverySource:source});
    const parts=labelParts(label);
    if(parts.type==='Lieferpaket')return result('Lieferpaket');
    if(parts.type==='collection'){
      const inline=[];
      if(!column){
        for(const m of parts.rest.matchAll(/(?:^|\s)(\d+)\s*[([{]\s*[A-Za-z]\s*[)\]}]/g))inline.push(m[1]);
        for(const m of parts.rest.matchAll(/^\s*(\d+)(?=\s|\(|$)/g))inline.push(m[1]);
        for(const m of parts.before.matchAll(/(?:^|\s)(\d+)\s*$/g))inline.push(m[1]);
      }
      const found=[...new Set([...inline,...numbers.map(clean).filter(n=>/^\d+$/.test(n))])];
      if(parts.wish&&!parts.letters.length&&!parts.bracket){
        if(found.length===1)return result(`Wunsch-Kollektion ${found[0]}`,'Kollektion ohne Klammerbuchstaben. Bitte am PDF prüfen.');
        return result('Wunsch-Kollektion','Wunsch-Kollektion: Nummer unter „lief.“ am PDF prüfen.');
      }
      if(found.length===1&&parts.letters.length===1)return result(`${parts.title} ${found[0]} ${parts.letters[0]}`);
      return result(parts.title,incomplete);
    }
    if(parts.title)return result(parts.title);
    return result('',missing);
  }

  // ----- geometry -----
  // slopeAt(y) gives the local skew of a text line; deskewed y = y - slope * x.
  function prepare(words,slopeAt=()=>0){
    return words.filter(w=>clean(w.text)&&w.bbox&&['x0','x1','y0','y1'].every(k=>Number.isFinite(w.bbox[k])))
      .map(w=>{const y=(w.bbox.y0+w.bbox.y1)/2,xc=(w.bbox.x0+w.bbox.x1)/2;return {...w,text:clean(w.text),x:w.bbox.x0,y,yd:y-slopeAt(y)*xc,h:Math.max(1,w.bbox.y1-w.bbox.y0)};});
  }
  function group(words){
    const sorted=[...words].sort((a,b)=>a.yd-b.yd||a.x-b.x),rows=[];
    for(const word of sorted){
      const row=rows.at(-1);
      if(row&&Math.abs(row.yd-word.yd)<=Math.min(row.h,word.h)*0.55){row.words.push(word);row.yd=row.words.reduce((n,w)=>n+w.yd,0)/row.words.length;row.h=Math.max(row.h,word.h);}
      else rows.push({yd:word.yd,h:word.h,words:[word]});
    }
    for(const row of rows){row.words.sort((a,b)=>a.x-b.x);row.y=row.yd;}
    return rows;
  }
  const rowsFromWords=(words,slope=0)=>group(prepare(words,()=>slope));
  const rowText=words=>clean(words.map(w=>w.text).join(' '));
  function pdfWords(items,viewport){
    return items.filter(item=>typeof item.str==='string'&&item.str.trim()&&item.transform).map(item=>{
      const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
      const height=Math.max(1,Math.abs(item.height*viewport.scale));
      return {text:item.str,bbox:{x0:x,x1:x+item.width*viewport.scale,y0:y-height,y1:y},confidence:100};
    });
  }

  // Header labels are matched loosely ("Lieferang", "Licferung", "lief,", "Pres").
  function findHeader(words,width){
    const scored=words.map(w=>({w,c:core(w.text)}));
    const first=(test,pool=scored)=>pool.filter(test).sort((a,b)=>a.w.y-b.w.y)[0]?.w;
    let klasse=first(v=>v.c.length>=4&&distance(v.c,'klasse')<=2&&distance(v.c,'klasse')<distance(v.c,'kasse'));
    if(!klasse)return null;
    // OCR boxes sometimes swallow a rule in front of the word; the right edge stays reliable.
    const klasseX=klasse.bbox.x1-klasse.bbox.x0>width*0.065?klasse.bbox.x1-width*0.051:klasse.x;
    const near=scored.filter(v=>Math.abs(v.w.y-klasse.y)<=width*0.06);
    const gap=(v,lo,hi)=>v.w.x-klasseX>=width*lo&&v.w.x-klasseX<=width*hi;
    return {klasse,klasseX,
      lief:first(v=>v.c.length>=2&&v.c.length<=8&&distance(v.c.slice(0,4),'lief')<=2&&gap(v,0.04,0.085),near),
      preis:first(v=>v.c.length>=3&&v.c.length<=6&&distance(v.c,'preis')<=2&&gap(v,0.155,0.215),near),
      kasse:first(v=>v.c.length>=3&&distance(v.c,'kasse')<=1&&gap(v,0.25,0.4),near),
      lieferung:first(v=>v.c.length>=6&&distance(v.c,'lieferung')<=3&&gap(v,-0.26,-0.19),near),
      kunde:first(v=>v.c.length>=4&&distance(v.c,'kunde')<=1&&gap(v,-0.6,-0.4),near)};
  }
  const headerWords=header=>['klasse','lief','preis','kasse','lieferung','kunde'].map(k=>header[k]).filter(Boolean);
  // Theil-Sen slope over the header words: one misread word cannot tilt the page.
  function headerSlope(header,width){
    const pts=headerWords(header).map(w=>({x:(w.bbox.x0+w.bbox.x1)/2,y:w.y}));
    if(pts.length<3||Math.max(...pts.map(p=>p.x))-Math.min(...pts.map(p=>p.x))<width*0.35)return 0;
    const slopes=[];
    for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++)if(Math.abs(pts[j].x-pts[i].x)>width*0.15)slopes.push((pts[j].y-pts[i].y)/(pts[j].x-pts[i].x));
    return median(slopes)??0;
  }
  const median=values=>{if(!values.length)return null;const v=[...values].sort((a,b)=>a-b);return v[Math.floor(v.length/2)];};
  // Photographed pages bend, so the skew is taken from the OCR baselines near each line.
  function slopeFunction(lines,width,fallback){
    const list=(lines||[]).map(line=>{
      const b=line.baseline,box=line.bbox;
      if(!b||!box||!Number.isFinite(b.x0)||!Number.isFinite(b.x1)||b.x1-b.x0<width*0.12||b.has_baseline===false)return null;
      const slope=(b.y1-b.y0)/(b.x1-b.x0);
      return Math.abs(slope)<=0.1?{y:(box.y0+box.y1)/2,slope}:null;
    }).filter(Boolean);
    const clamp=s=>Math.max(-0.08,Math.min(0.08,s));
    if(list.length<3)return ()=>clamp(fallback);
    const all=median(list.map(l=>l.slope));
    return y=>{
      const near=list.filter(l=>Math.abs(l.y-y)<=width*0.12).map(l=>l.slope);
      return clamp(near.length>=3?median(near):all);
    };
  }
  function columns(words,width,lines){
    const header=findHeader(prepare(words),width);
    // Without a readable header the usual Morawa proportions are used.
    if(!header){
      const slopeAt=slopeFunction(lines,width,0);
      return {slopeAt,headerY:-Infinity,deliveryStart:width*0.318,deliveryEnd:width*0.545,numberStart:width*0.6,numberEnd:width*0.675,found:false};
    }
    const slopeAt=slopeFunction(lines,width,headerSlope(header,width)),k=header.klasseX;
    const lieferung=header.lieferung?.x??k-width*0.22,lief=header.lief?.x??k+width*0.062,preis=header.preis?.x??k+width*0.183;
    const headerY=Math.max(...headerWords(header).map(w=>w.y-slopeAt(w.y)*((w.bbox.x0+w.bbox.x1)/2)+w.h*0.5));
    return {slopeAt,headerY,deliveryStart:lieferung-width*0.012,deliveryEnd:k-width*0.006,numberStart:Math.max(k+width*0.045,lief-width*0.009),numberEnd:Math.min(preis-width*0.012,lief+width*0.066),found:true};
  }

  // Dotted rules become ":" or "i", and the "26/01" reference number belongs to the customer.
  const junk=w=>/^[^A-Za-zÄÖÜäöü0-9()[\]{}]+$/.test(w.text)||/^[a-z]$/.test(w.text)||/^\d{2}\/\d{2}[.:;,]?$/.test(w.text);
  function headerLine(text){
    const s=clean(text);
    // A stop starts with "<Nr> KNr.: <Kundennummer>"; a lost "Nr" still leaves "KNr" + digits.
    return /^\d{1,3}\s+(?:k\s*n\s*r|knr)[.:]?\s*\d{4,}/i.test(s)||/(?:^|[^A-Za-z])K\s*N\s*[A-Za-z]?\s*[.:,;]*\s*\d{5,8}\b/.test(s);
  }
  const tidyCustomerLine=text=>clean(clean(text).replace(/^[^A-Za-zÄÖÜäöü0-9]+/,'').replace(/[—–-]+(?=K\s*N)/,' '));

  function deliveryForBand(dWords,nWords,anchor,from,to,layout){
    const rows=group(dWords.filter(w=>w.yd>=from&&w.yd<to&&!junk(w)));
    const labelled=rows.filter(r=>/[A-Za-zÄÖÜäöü]{3}/.test(rowText(r.words)));
    const main=labelled.filter(r=>Math.abs(r.yd-anchor.yd)<=Math.max(r.h,anchor.h)*1.5).sort((a,b)=>Math.abs(a.yd-anchor.yd)-Math.abs(b.yd-anchor.yd))[0]||labelled[0];
    const lineY=main?main.yd:anchor.yd,h=median((main||anchor).words.map(w=>w.h));
    const cells={slope:layout.slopeAt(main?main.y:anchor.y),h,label:{x0:layout.deliveryStart,x1:layout.deliveryEnd,yd:lineY},number:{x0:layout.numberStart,x1:layout.numberEnd,yd:lineY}};
    if(!main)return {deliveryType:'',deliveryReview:missing,deliverySource:'',_cells:cells,_page:{label:'',number:null,confidence:0}};
    let label=rowText(main.words);const words=[...main.words];
    const next=rows[rows.indexOf(main)+1];
    // A wrapped "(B)" on the next line still belongs to this customer's collection.
    if(labelParts(label).type==='collection'&&!collectionLetters(label).length&&next&&next.yd-main.yd<h*2.5&&/^(?:\d+\s*)?[([{]\s*[A-Za-z]\s*[)\]}]$/.test(rowText(next.words))){
      label+=' '+rowText(next.words);words.push(...next.words);
    }
    const numberWords=nWords.filter(w=>Math.abs(w.yd-main.yd)<=Math.max(w.h,main.h)*0.9).sort((a,b)=>a.x-b.x);
    const number=deliveredNumber(numberWords);
    const companionNumbers=rows.filter(row=>row!==main&&/beh[aä]ltemappe/i.test(canonicalLabel(rowText(row.words))))
      .map(row=>deliveredNumber(nWords.filter(w=>w.yd>=from&&w.yd<to&&Math.abs(w.yd-row.yd)<=Math.max(w.h,row.h)*0.9).sort((a,b)=>a.x-b.x))).filter(Boolean);
    const source=[label,rowText(numberWords)].filter(Boolean).join(' | ');
    const parsed=readDelivery(label,{numbers:number?[number]:[],source,column:true});
    const confidence=Math.min(100,...[...words,...numberWords].map(w=>Number.isFinite(w.confidence)?w.confidence:100));
    if(!parsed.deliveryReview&&/\d/.test(parsed.deliveryType)&&numberWords.some(w=>Number.isFinite(w.confidence)&&w.confidence<55))parsed.deliveryReview='Liefermenge unsicher erkannt. Bitte am PDF prüfen.';
    return {...parsed,_cells:cells,_page:{label,number,confidence,numberText:rowText(numberWords),companionNumbers}};
  }

  function analyse(words,width,{parseStops,looksLikeStopHeader,parsePostal,normalizeLines},{lines}={}){
    const layout=columns(words,width,lines),all=prepare(words,layout.slopeAt);
    const body=all.filter(w=>w.yd>layout.headerY);
    const customer=group(body.filter(w=>w.x<layout.deliveryStart));
    const lineOf=row=>tidyCustomerLine(rowText(row.words));
    const anchors=customer.map((row,i)=>{const s=lineOf(row);return headerLine(s)||looksLikeStopHeader(s)?i:-1;}).filter(i=>i>=0);
    const bands=[];
    const byPostal=rows=>{let start=0;for(let i=0;i<rows.length;i++)if(normalizeLines(lineOf(rows[i])).some(line=>parsePostal(line))){bands.push(rows.slice(start,i+1));start=i+1;}};
    if(anchors.length){
      byPostal(customer.slice(0,anchors[0]));
      anchors.forEach((index,i)=>bands.push(customer.slice(index,anchors[i+1]??customer.length)));
    }else byPostal(customer);
    const result=bands.filter(band=>band.length).map(band=>{
      const first=band[0],next=customer[customer.indexOf(band.at(-1))+1];
      return {band,first,next,parsed:parseStops(band.map(lineOf).filter(Boolean).join('\n')),from:first.yd-first.h*0.8,to:next?next.yd-next.h*0.8:Infinity};
    });
    return {layout,body,customer,bands:result};
  }
  function parsePage(words,width,parser,options={}){
    const {layout,body,bands}=analyse(words,width,parser,options);
    const dWords=body.filter(w=>w.x>=layout.deliveryStart&&w.x<layout.deliveryEnd);
    const nWords=body.filter(w=>w.x>=layout.numberStart&&w.x<layout.numberEnd);
    const stops=[];
    for(const {parsed,first,from,to} of bands){
      const delivery=parsed.length===1?deliveryForBand(dWords,nWords,first,from,to,layout):{deliveryType:'',deliveryReview:missing,deliverySource:''};
      stops.push(...parsed.map(stop=>({...stop,...delivery})));
    }
    return stops;
  }
  // Page OCR sometimes skips a whole table block. Returns deskewed strips (as cell boxes)
  // that look unread: a customer block without an address, or a tall empty gap.
  function unreadRegions(words,width,parser,options={}){
    const {layout,customer,bands}=analyse(words,width,parser,options);
    if(!customer.length)return [];
    const h=median(customer.map(r=>r.h)),spans=[];
    for(const b of bands)if(!b.parsed.length&&Number.isFinite(b.to)&&b.to-b.from>h*4.5)spans.push([b.from,b.to]);
    const top=Number.isFinite(layout.headerY)?layout.headerY:null;
    if(top!==null&&customer[0].yd-top>h*4)spans.push([top,customer[0].yd-customer[0].h*0.8]);
    for(let i=1;i<customer.length;i++)if(customer[i].yd-customer[i-1].yd>h*4)spans.push([customer[i-1].yd+customer[i-1].h*0.8,customer[i].yd-customer[i].h*0.8]);
    spans.sort((a,b)=>a[0]-b[0]);
    const merged=[];
    for(const span of spans){const last=merged.at(-1);if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else merged.push([...span]);}
    return merged.map(([from,to])=>{
      const yd=(from+to)/2;
      return {kind:'region',x0:0,x1:width,yd,half:(to-from)/2,margin:0,pad:h*0.5,slope:layout.slopeAt(yd),charHeight:h,scale:1,threshold:165};
    });
  }
  // Replaces the words inside a re-read region; `fresh` uses region pixel coordinates.
  function mergeRegionWords(words,box,fresh){
    const g=cellGeometry(box),s=box.scale,m=box.margin;
    const toPage=(u,v)=>{const x=(u-g.pad)/s+box.x0-m;return [x,(v-g.pad)/s-m-box.half+box.yd+box.slope*x];};
    const inside=w=>{const x=(w.bbox.x0+w.bbox.x1)/2,y=(w.bbox.y0+w.bbox.y1)/2,yd=y-box.slope*x;return yd>=box.yd-box.half&&yd<=box.yd+box.half;};
    const mapped=fresh.filter(w=>clean(w.text)&&w.bbox).map(w=>{
      const c=[toPage(w.bbox.x0,w.bbox.y0),toPage(w.bbox.x1,w.bbox.y0),toPage(w.bbox.x0,w.bbox.y1),toPage(w.bbox.x1,w.bbox.y1)];
      return {...w,bbox:{x0:Math.min(...c.map(p=>p[0])),x1:Math.max(...c.map(p=>p[0])),y0:(c[0][1]+c[1][1])/2,y1:(c[2][1]+c[3][1])/2}};
    });
    return [...words.filter(w=>!inside(w)),...mapped];
  }

  // ----- second, targeted read of the two cells -----
  // Binarises a cell image and keeps only letter/digit-sized shapes whose centre lies in
  // the cell (`keep`): rule dots, long rules and the neighbouring lines are removed.
  function clearNumberRules(pixels,width,height,charHeight=height/2.2,threshold=165,keep=null){
    const visited=new Uint8Array(width*height),stack=[];
    for(let i=0;i<visited.length;i++){
      const gray=pixels[i*4]*0.3+pixels[i*4+1]*0.59+pixels[i*4+2]*0.11,value=gray<threshold?0:255;
      pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=value;pixels[i*4+3]=255;
    }
    for(let i=0;i<visited.length;i++){
      if(visited[i]||pixels[i*4]!==0)continue;
      const component=[];visited[i]=1;stack.push(i);
      let x0=i%width,x1=x0,y0=Math.floor(i/width),y1=y0;
      while(stack.length){
        const p=stack.pop(),x=p%width,y=(p-x)/width;component.push(p);
        if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy,k=ny*width+nx;
          if(nx>=0&&nx<width&&ny>=0&&ny<height&&!visited[k]&&pixels[k*4]===0){visited[k]=1;stack.push(k);}
        }
      }
      const w=x1-x0+1,h=y1-y0+1,cx=(x0+x1)/2,cy=(y0+y1)/2;
      const dot=Math.max(w,h)<charHeight*0.2;
      const rule=(h>charHeight*1.7&&w<charHeight*0.35)||(w>charHeight*2.5&&h<charHeight*0.25);
      const cut=x0===0||y0===0||x1===width-1||y1===height-1;
      const outside=keep&&(cx<keep.x0||cx>keep.x1||cy<keep.y0||cy>keep.y1);
      if(dot||rule||cut||outside)for(const k of component)pixels[k*4]=pixels[k*4+1]=pixels[k*4+2]=255;
    }
    return pixels;
  }
  // Cell in page pixels; y is deskewed: page y = yd + slope * x. Variant 1 is a second,
  // independent look (other zoom and threshold) that counts as a separate vote.
  function cellBox(stop,kind,variant=0){
    const cells=stop._cells;if(!cells)return null;
    const cell=cells[kind],h=cells.h;
    return {kind,variant,x0:cell.x0,x1:cell.x1,yd:cell.yd,half:h*0.62,margin:h*0.6,pad:h*0.4,slope:cells.slope,charHeight:h,
      scale:variant?3:2,threshold:variant?135:165};
  }
  // Canvas size, page->cell transform (for setTransform) and the keep rectangle.
  function cellGeometry(box){
    const s=box.scale,m=box.margin;
    return {width:Math.round((box.x1-box.x0+2*m)*s),height:Math.round((2*box.half+2*m)*s),pad:Math.round(box.pad*s),
      transform:[s,-box.slope*s,0,s,-(box.x0-m)*s,(box.half+m-box.yd)*s],
      keep:{x0:m*s,x1:(m+box.x1-box.x0)*s,y0:m*s,y1:(m+2*box.half)*s}};
  }
  // Browser helper: cuts, deskews and cleans one cell of the rendered page.
  function renderCell(pageCanvas,box,doc){
    const g=cellGeometry(box),cell=doc.createElement('canvas');
    cell.width=g.width;cell.height=g.height;
    const ctx=cell.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,g.width,g.height);
    ctx.setTransform(...g.transform);ctx.drawImage(pageCanvas,0,0);ctx.setTransform(1,0,0,1,0,0);
    const image=ctx.getImageData(0,0,g.width,g.height);
    if(box.kind!=='region')clearNumberRules(image.data,g.width,g.height,box.charHeight*box.scale,box.threshold,g.keep);
    const out=doc.createElement('canvas');out.width=g.width+2*g.pad;out.height=g.height+2*g.pad;
    const octx=out.getContext('2d');octx.fillStyle='#fff';octx.fillRect(0,0,out.width,out.height);octx.putImageData(image,g.pad,g.pad);
    cell.width=0;cell.height=0;
    return out;
  }
  // readCell(box) must return {text, confidence} for the deskewed, cleaned cell image.
  async function refineStops(stops,readCell){
    for(const stop of stops){
      if(!stop._cells||(stop.deliveryType==='Lieferpaket'&&/\blieferpaket\b/i.test(stop._page?.label||'')))continue;
      try{
        const label=await readCell(cellBox(stop,'label'));
        const kind=labelParts(label?.text||'').type,pageKind=labelParts(stop._page?.label||'').type;
        const numbers=[];
        if(kind==='collection'||pageKind==='collection')for(const variant of [0,1])numbers.push(await readCell(cellBox(stop,'number',variant)));
        Object.assign(stop,mergeReads(stop,label,numbers));
      }catch(error){/* keep the page result */}
    }
    return stops;
  }
  function retainPageEvidence(stops,original){
    const used=new Set();
    for(const stop of stops){
      if(!stop._cells)continue;
      const sameAddress=candidate=>stop.address&&stop.postal&&core(candidate.address)===core(stop.address)&&candidate.address.match(/\d+/g)?.join()===stop.address.match(/\d+/g)?.join()&&clean(candidate.postal).toLowerCase()===clean(stop.postal).toLowerCase();
      const uniqueAddress=stops.filter(s=>s.address===stop.address&&s.postal===stop.postal).length===1;
      const byAddress=uniqueAddress?original.filter(candidate=>candidate._cells&&!used.has(candidate)&&sameAddress(candidate)):[];
      const matches=byAddress.length===1?byAddress:original.filter(candidate=>candidate._cells&&!used.has(candidate)&&
        Math.abs(candidate._cells.number.yd-stop._cells.number.yd)<Math.max(candidate._cells.h,stop._cells.h)*2)
        .sort((a,b)=>Math.abs(a._cells.number.yd-stop._cells.number.yd)-Math.abs(b._cells.number.yd-stop._cells.number.yd));
      if(matches.length===1){stop._originalPage=matches[0]._page;used.add(matches[0]);}
    }
  }
  // Combines the page read with the cell reads. A disagreement is reported, never guessed.
  function mergeReads(stop,labelRead,numberReads=[]){
    if(numberReads&&!Array.isArray(numberReads))numberReads=[numberReads];
    const page=stop._page||{label:'',number:null,confidence:0};
    const cellText=clean(labelRead?.text);
    const a=labelParts(page.label),b=labelParts(cellText);
    const shown=numberReads.map(r=>clean(r?.text)).find(Boolean)||page.numberText;
    const source=[cellText||page.label,shown].filter(Boolean).join(' | ')||stop.deliverySource;
    const done=(deliveryType,deliveryReview='')=>({deliveryType,deliveryReview,deliverySource:source});
    let label;
    if((a.type==='Lieferpaket'&&b.type==='collection')||(b.type==='Lieferpaket'&&a.type==='collection'))return done('','Lieferpaket oder Kollektion? Bitte am PDF prüfen.');
    if(a.type==='collection'||b.type==='collection'){
      const both=a.type==='collection'&&b.type==='collection';
      const title=!both?(a.type==='collection'?a:b).title:b.title.length>=a.title.length?b.title:a.title;
      const letters=[...new Set([...(a.type==='collection'?a.letters:[]),...(b.type==='collection'?b.letters:[])])];
      if(letters.length>1)return done(title,`Buchstabe unklar (${letters.join(' oder ')}). Bitte am PDF prüfen.`);
      const wish=(a.type==='collection'&&a.wish)||(b.type==='collection'&&b.wish);
      const bracket=(a.type==='collection'&&a.bracket)||(b.type==='collection'&&b.bracket);
      label=`${title}${letters.length?` (${letters[0]})`:bracket&&!wish?' ()':''}`;
    }else if(a.type==='Lieferpaket'||b.type==='Lieferpaket')return done('Lieferpaket');
    else{
      const same=a.title&&b.title&&core(a.title)===core(b.title);
      const confident=a.title&&page.confidence>=75?a.title:b.title&&labelRead?.confidence>=75?b.title:null;
      return same?done(a.title):confident?done(confident):done('',missing);
    }
    // Votes for the "lief." number: page read plus the independent cell reads.
    const votes=[];
    if(page.number)votes.push({value:page.number,confidence:page.confidence});
    if(stop._originalPage?.number&&labelParts(stop._originalPage.label).type==='collection')votes.push({value:stop._originalPage.number,confidence:stop._originalPage.confidence});
    for(const read of numberReads){const value=read?deliveredNumber(read.text):null;if(value)votes.push({value,confidence:read.confidence});}
    const counts=new Map();for(const v of votes)counts.set(v.value,(counts.get(v.value)||0)+1);
    const ranked=[...counts.entries()].sort((x,y)=>y[1]-x[1]);
    let number=null,note='';
    if(ranked.length>1){
      const choices=ranked.map(r=>r[0]).join(' oder ');
      // Conflicting reads: no number is chosen, the candidates are listed for checking.
      note=`Liefermenge unklar (${choices}). Bitte am PDF prüfen.`;
    }else if(ranked.length===1){
      number=ranked[0][0];
      if(ranked[0][1]===1&&Number.isFinite(votes[0].confidence)&&votes[0].confidence<55)note='Liefermenge unsicher erkannt. Bitte am PDF prüfen.';
    }
    // A retaining-folder row is only a cross-check, never a source of a missing collection number.
    const companions=[...(page.companionNumbers||[]),...(stop._originalPage?.companionNumbers||[])];
    if(number&&companions.some(value=>value!==number)){
      number=null;note='Abweichende Nummern im Kundenblock. Kollektionsnummer am PDF prüfen.';
    }
    const merged=readDelivery(label,{numbers:number?[number]:[],source,column:true});
    if(note&&(ranked.length>1||!number||!merged.deliveryReview))merged.deliveryReview=note;
    return merged;
  }

  const api={reviewValue,readDelivery,rowsFromWords,pdfWords,columns,deliveredNumber,parsePage,clearNumberRules,cellBox,cellGeometry,renderCell,refineStops,retainPageEvidence,unreadRegions,mergeRegionWords,mergeReads,canonicalLabel};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DeliveryImport=api;
})(typeof window==='object'?window:globalThis);
