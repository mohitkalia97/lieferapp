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
    // "Kollektion" broken by OCR on a curved line ("Kon) ktion", "Koll ektion", "K ll ktion"):
    // up to three neighbouring fragments that together come close to "Kollektion" count,
    // but only when a bracketed collection letter like "(P)" follows.
    if(!/Kollektion/.test(text)){
      const tokens=text.split(' ');
      search:for(let i=0;i<tokens.length;i++)for(let n=3;n>=1;n--){
        const part=tokens.slice(i,i+n),c=core(part.join(''));
        if(i+n>tokens.length||c.length<6||c.length>13||!/^k/.test(c))continue;
        if(distance(c,'kollektion')>3)continue;
        if(!collectionLetters(tokens.slice(i+n).join(' ')).length)continue;
        tokens.splice(i,n,'Kollektion');text=tokens.join(' ');break search;
      }
    }
    // "Lieferpaket lt. GesamtLS" split or garbled by OCR, e.g. "Li ferpaket"
    if(!/Lieferpaket|Kollektion/.test(text)&&(containsApprox(core(text),'lieferpaket',2)||containsApprox(core(text),'gesamtls',1)))text='Lieferpaket';
    return text;
  }

  function reviewValue(value){
    const text=clean(value);
    if(!text)return missing;
    if(/^wunsch[- ]?kollektion$/i.test(text))return '';
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
    if(m)return m[1];
    // "35/ -" whose thin slash got lost: a dash means nothing returned, so 35 was delivered.
    m=text.match(/^(\d{1,2})\s*-+$/);
    return m?m[1]:null;
  }

  const headingText=text=>{const c=core(text);return c.length>=5&&(distance(c,'lieferung')<=2||distance(c,'lieferart')<=2);};
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
    const plain=label.replace(/\s+(?:COL|WS|lt\.?\s+Gesamt\s*LS)$/i,'').replace(/^(?:COL|WS)$/i,'').replace(/^[^A-Za-zÄÖÜäöü]+|[^A-Za-zÄÖÜäöüß)]+$/g,'');
    // Short printed codes such as "DS" count as well; "COL"/"WS" alone are only suffixes.
    const valid=plain&&!headingText(plain)&&(/[A-Za-zÄÖÜäöü]{3}/.test(plain)||/^[A-ZÄÖÜ]{2}(?:\s+[A-ZÄÖÜ]{2})*$/.test(plain))&&!/^(?:COL|WS|LS)$/i.test(plain);
    return {type:'other',title:valid?plain:''};
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
      // A Wunsch-Kollektion is listed simply as "Wunschkollektion" (no number, no letter).
      if(parts.wish)return result('Wunschkollektion');
      if(found.length===1&&parts.letters.length===1)return result(`${parts.title} ${found[0]} ${parts.letters[0]}`);
      return result(parts.title,incomplete);
    }
    if(parts.title)return result(parts.title);
    return result('',missing);
  }

  // ----- geometry -----
  // slopeAt(y) gives the local skew of a text line; deskewed y = y - slope * x.
  function prepare(words,slopeAt=()=>0,shiftX=null){
    return words.filter(w=>clean(w.text)&&w.bbox&&['x0','x1','y0','y1'].every(k=>Number.isFinite(w.bbox[k])))
      .map(w=>{
        const y=(w.bbox.y0+w.bbox.y1)/2,xc=(w.bbox.x0+w.bbox.x1)/2;
        // Words from a straightened column carry the height of their text line at x = lineX,
        // so all words of one OCR line stay in one row however the paper is bent.
        const yd=Number.isFinite(w.lineY)&&Number.isFinite(w.lineX)?w.lineY-slopeAt(w.lineY)*w.lineX:y-slopeAt(y)*xc;
        // xd: x as it would be at the header row, so leaning columns can be cut straight.
        const xd=shiftX?shiftX(w.bbox.x0,y):w.bbox.x0;
        return {...w,text:clean(w.text),x:w.bbox.x0,xd,y,yd,h:Math.max(1,w.bbox.y1-w.bbox.y0)};
      });
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
    const near=scored.filter(v=>Math.abs(v.w.y-klasse.y)<=width*0.06);
    const build=klasseX=>{
      const gap=(v,lo,hi)=>v.w.x-klasseX>=width*lo&&v.w.x-klasseX<=width*hi;
      return {klasse,klasseX,
        lief:first(v=>v.c.length>=2&&v.c.length<=8&&distance(v.c.slice(0,4),'lief')<=2&&gap(v,0.04,0.085),near),
        preis:first(v=>v.c.length>=3&&v.c.length<=6&&distance(v.c,'preis')<=2&&gap(v,0.155,0.215),near),
        kasse:first(v=>v.c.length>=3&&distance(v.c,'kasse')<=1&&gap(v,0.25,0.4),near),
        lieferung:first(v=>v.c.length>=6&&distance(v.c,'lieferung')<=3&&gap(v,-0.26,-0.19),near),
        kunde:first(v=>v.c.length>=4&&distance(v.c,'kunde')<=1&&gap(v,-0.6,-0.4),near)};
    };
    // An OCR box can swallow a rule or a neighbouring word on either side of "Klasse".
    // Both ends are tried; the other header words and the table body decide.
    const wide=klasse.bbox.x1-klasse.bbox.x0>width*0.065;
    const candidates=wide?[klasse.bbox.x0,klasse.bbox.x1-width*0.051]:[klasse.x];
    const below=scored.filter(v=>v.w.y>klasse.y&&v.w.y<klasse.y+width*0.5);
    const score=h=>{
      const k=h.klasseX,inside=(v,lo,hi)=>v.w.x-k>=width*lo&&v.w.x-k<=width*hi;
      return ['lief','preis','kasse','lieferung','kunde'].filter(key=>h[key]).length*2
        +below.filter(v=>(canonicalWord(v.w.text)==='Lieferpaket'||canonicalWord(v.w.text)==='Kollektion')&&inside(v,-0.25,-0.17)).length
        +below.filter(v=>/^neu$/i.test(v.w.text)&&inside(v,-0.01,0.05)).length;
    };
    return candidates.map(build).map(h=>({h,s:score(h)})).sort((a,b)=>b.s-a.s)[0].h;
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
  // On rotated or obliquely photographed pages the columns lean: a column's x changes with y,
  // and by a different amount on the left and on the right of the page. Words that always
  // line up vertically (KNr., the dd/dd reference, "Lieferpaket", "neu", prices) measure it.
  function columnDrift(words,width,yref,approx){
    const ws=prepare(words),families=[];
    const take=test=>{const pts=ws.filter(test).map(w=>({x:w.x,y:w.y}));if(pts.length>=3)families.push(pts);};
    take(w=>w.x<approx.deliveryStart&&/^K\s*N\s*[A-Za-z]?\s*[.:,;]*$/i.test(w.text));
    take(w=>w.x>width*0.15&&w.x<approx.deliveryStart+width*0.02&&/^\d{2}\/\d{2}[.:;,!]?$/.test(w.text));
    take(w=>w.x>approx.deliveryStart-width*0.08&&w.x<approx.deliveryEnd&&canonicalWord(w.text)==='Lieferpaket');
    take(w=>w.x>approx.deliveryEnd-width*0.06&&w.x<approx.numberStart&&/^neu$/i.test(w.text));
    take(w=>w.x>approx.numberEnd-width*0.03&&w.x<approx.numberEnd+width*0.15&&/^\d{1,3},\d{2}$/.test(w.text));
    const fits=[];
    for(const pts of families){
      const span=Math.max(...pts.map(p=>p.y))-Math.min(...pts.map(p=>p.y));
      if(span<width*0.3)continue;
      const slopes=[];
      for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++)if(Math.abs(pts[j].y-pts[i].y)>width*0.12)slopes.push((pts[j].x-pts[i].x)/(pts[j].y-pts[i].y));
      const d=median(slopes);if(d===null||Math.abs(d)>0.12)continue;
      // Points far off the line (another column, OCR noise) are dropped before refitting.
      const at=median(pts.map(p=>p.x-d*(p.y-yref)));
      const good=pts.filter(p=>Math.abs(p.x-d*(p.y-yref)-at)<width*0.02);
      if(good.length<3)continue;
      const refit=[];
      for(let i=0;i<good.length;i++)for(let j=i+1;j<good.length;j++)if(Math.abs(good[j].y-good[i].y)>width*0.12)refit.push((good[j].x-good[i].x)/(good[j].y-good[i].y));
      const dd=median(refit);if(dd!==null)fits.push({x:median(good.map(p=>p.x)),d:dd,w:good.length});
    }
    const clamp=v=>Math.max(-0.1,Math.min(0.1,v));
    if(!fits.length)return ()=>0;
    const W=fits.reduce((n,f)=>n+f.w,0),mx=fits.reduce((n,f)=>n+f.w*f.x,0)/W,md=fits.reduce((n,f)=>n+f.w*f.d,0)/W;
    const sxx=fits.reduce((n,f)=>n+f.w*(f.x-mx)**2,0);
    const spread=Math.max(...fits.map(f=>f.x))-Math.min(...fits.map(f=>f.x));
    const b=fits.length>=2&&spread>width*0.2&&sxx>0?fits.reduce((n,f)=>n+f.w*(f.x-mx)*(f.d-md),0)/sxx:0;
    return x=>clamp(md+b*(x-mx));
  }
  function columns(words,width,lines){
    const header=findHeader(prepare(words),width);
    // Without a readable header the usual Morawa proportions are used.
    if(!header){
      const slopeAt=slopeFunction(lines,width,0);
      return {slopeAt,headerY:-Infinity,deliveryStart:width*0.318,deliveryEnd:width*0.545,numberStart:width*0.6,numberEnd:width*0.675,found:false,
        drift:()=>0,yref:0,shiftX:x=>x,pageX:x=>x};
    }
    const slopeAt=slopeFunction(lines,width,headerSlope(header,width)),k=header.klasseX;
    const lieferung=header.lieferung?.x??k-width*0.22,lief=header.lief?.x??k+width*0.062,preis=header.preis?.x??k+width*0.183;
    const headerY=Math.max(...headerWords(header).map(w=>w.y-slopeAt(w.y)*((w.bbox.x0+w.bbox.x1)/2)+w.h*0.5));
    const layout={slopeAt,headerY,deliveryStart:lieferung-width*0.012,deliveryEnd:k-width*0.006,numberStart:Math.max(k+width*0.045,lief-width*0.009),numberEnd:Math.min(preis-width*0.014,lief+width*0.085),found:true};
    const yref=header.klasse.y,drift=columnDrift(words,width,yref,layout);
    return {...layout,drift,yref,
      shiftX:(x,y)=>x-drift(x)*(y-yref),
      pageX:(xd,y)=>xd+drift(xd)*(y-yref)};
  }


  // Dotted rules become ":" or "i", and the "26/01" reference number belongs to the customer.
  const junk=w=>/^[^A-Za-zÄÖÜäöü0-9()[\]{}]+$/.test(w.text)||/^[a-z]$/.test(w.text)||/^\d{2}\/\d{2}[.:;,]?$/.test(w.text);
  function headerLine(text){
    const s=clean(text);
    // A stop starts with "<Nr> KNr.: <Kundennummer>"; a lost "Nr" still leaves "KNr" + digits.
    return /^\d{1,3}\s+(?:k\s*n\s*r|knr)[.:]?\s*\d{4,}/i.test(s)||/(?:^|[^A-Za-z])K\s*N\s*[A-Za-z]?\s*[.:,;]*\s*\d{5,8}\b/.test(s);
  }
  // The dotted rule right of the customer column is often read as a trailing ":", ";", "|", "i" or "l".
  const tidyCustomerLine=text=>clean(clean(text).replace(/^[^A-Za-zÄÖÜäöü0-9]+/,'').replace(/[—–-]+(?=K\s*N)/,' ')
    .replace(/(?:\s+[:;|!¦'‘’`,_il])+\s*$/,''));

  function deliveryForBand(dWords,nWords,anchor,from,to,layout,kWords=[]){
    const rows=group(dWords.filter(w=>w.yd>=from&&w.yd<to&&!junk(w)));
    // On rotated pages a table heading ("Lieferung") can fall into the first customer's band.
    const labelled=rows.filter(r=>/[A-Za-zÄÖÜäöü]{3}/.test(rowText(r.words))&&!headingText(rowText(r.words)));
    const main=labelled.filter(r=>Math.abs(r.yd-anchor.yd)<=Math.max(r.h,anchor.h)*1.5).sort((a,b)=>Math.abs(a.yd-anchor.yd)-Math.abs(b.yd-anchor.yd))[0]||labelled[0];
    const h=median((main||anchor).words.map(w=>w.h));
    // Bent paper: the row's own words (label and class value) give its real course,
    // so the "lief." cell is cut along that line and not along the page average.
    let slope=layout.slopeAt(main?main.y:anchor.y),lineY=main?main.yd:anchor.yd;
    if(main){
      const fit=[...main.words,...kWords.filter(w=>Math.abs(w.yd-main.yd)<=h*1.5)].map(w=>({x:(w.bbox.x0+w.bbox.x1)/2,y:w.y}));
      const pairs=[];
      for(let i=0;i<fit.length;i++)for(let j=i+1;j<fit.length;j++)if(Math.abs(fit[j].x-fit[i].x)>h*4)pairs.push((fit[j].y-fit[i].y)/(fit[j].x-fit[i].x));
      const own=median(pairs);
      if(own!==null&&Math.abs(own-slope)<=0.1){slope=own;lineY=median(fit.map(p=>p.y-own*p.x));}
    }
    const onRow=w=>Math.abs(w.y-(lineY+slope*(w.bbox.x0+w.bbox.x1)/2))<=Math.max(w.h,h)*0.9;
    // The cell is cut where the leaning column actually is at this row.
    const cell=(x0,x1)=>{const y=lineY+slope*(x0+x1)/2,px=x=>layout.pageX?layout.pageX(x,y):x;return {x0:px(x0),x1:px(x1),yd:lineY};};
    const cells={slope,h,label:cell(layout.deliveryStart,layout.deliveryEnd),number:cell(layout.numberStart,layout.numberEnd)};
    if(!main)return {deliveryType:'',deliveryReview:missing,deliverySource:'',_cells:cells,_page:{label:'',number:null,confidence:0}};
    let label=rowText(main.words);const words=[...main.words];
    const next=rows[rows.indexOf(main)+1];
    // A wrapped "(B)" on the next line still belongs to this customer's collection.
    if(labelParts(label).type==='collection'&&!collectionLetters(label).length&&next&&next.yd-main.yd<h*2.5&&/^(?:\d+\s*)?[([{]\s*[A-Za-z]\s*[)\]}]$/.test(rowText(next.words))){
      label+=' '+rowText(next.words);words.push(...next.words);
    }
    const numberWords=nWords.filter(w=>w.yd>=from-h&&w.yd<to&&onRow(w)).sort((a,b)=>a.x-b.x);
    // Without the slash a lone number may be the returned one ("zur.", right half of the cell).
    const leftHalf=w=>(w.xd-layout.numberStart)/Math.max(1,layout.numberEnd-layout.numberStart)<0.45;
    // With a second delivery line (e.g. Behaltemappe) a lone number may also belong to that line.
    const number=numberWords.some(w=>w.text.includes('/'))||(labelled.length===1&&numberWords.filter(w=>/\d/.test(w.text)).every(leftHalf))?deliveredNumber(numberWords):null;
    const companionNumbers=rows.filter(row=>row!==main&&/beh[aä]ltemappe/i.test(canonicalLabel(rowText(row.words))))
      .map(row=>deliveredNumber(nWords.filter(w=>w.yd>=from&&w.yd<to&&Math.abs(w.yd-row.yd)<=Math.max(w.h,row.h)*0.9).sort((a,b)=>a.x-b.x))).filter(Boolean);
    const source=[label,rowText(numberWords)].filter(Boolean).join(' | ');
    const parsed=readDelivery(label,{numbers:number?[number]:[],source,column:true});
    const confidence=Math.min(100,...[...words,...numberWords].map(w=>Number.isFinite(w.confidence)?w.confidence:100));
    if(!parsed.deliveryReview&&/\d/.test(parsed.deliveryType)&&numberWords.some(w=>Number.isFinite(w.confidence)&&w.confidence<55))parsed.deliveryReview='Liefermenge unsicher erkannt. Bitte am PDF prüfen.';
    return {...parsed,_cells:cells,_page:{label,number,confidence,numberText:rowText(numberWords),companionNumbers,otherRows:labelled.length-1}};
  }

  function analyse(words,width,{parseStops,looksLikeStopHeader,parsePostal,normalizeLines},{lines}={}){
    const layout=columns(words,width,lines),all=prepare(words,layout.slopeAt,layout.shiftX);
    const body=all.filter(w=>w.yd>layout.headerY);
    const customer=group(body.filter(w=>w.xd<layout.deliveryStart));
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
    const dWords=body.filter(w=>w.xd>=layout.deliveryStart&&w.xd<layout.deliveryEnd);
    const nWords=body.filter(w=>w.xd>=layout.numberStart&&w.xd<layout.numberEnd);
    const kWords=body.filter(w=>w.xd>=layout.deliveryEnd&&w.xd<layout.numberStart);
    const stops=[];
    for(const {parsed,first,from,to} of bands){
      const delivery=parsed.length===1?deliveryForBand(dWords,nWords,first,from,to,layout,kWords):{deliveryType:'',deliveryReview:missing,deliverySource:''};
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
  function clearNumberRules(pixels,width,height,charHeight=height/2.2,threshold=165,keep=null,keepSpecks=false){
    const visited=new Uint8Array(width*height),stack=[],parts=[];
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
      parts.push({component,x0,x1,y0,y1});
    }
    const small=c=>Math.max(c.x1-c.x0+1,c.y1-c.y0+1)<charHeight*0.2;
    const letters=parts.filter(c=>!small(c));
    // A faint letter can break into specks. In text cells (keepSpecks) specks right next to a
    // letter-sized shape stay; in number cells they would fill the holes of bold digits.
    const reach=charHeight*0.15;
    const besideLetter=c=>letters.some(l=>c.x0<=l.x1+reach&&c.x1>=l.x0-reach&&c.y0<=l.y1+reach&&c.y1>=l.y0-reach);
    for(const c of parts){
      const w=c.x1-c.x0+1,h=c.y1-c.y0+1,cx=(c.x0+c.x1)/2,cy=(c.y0+c.y1)/2;
      const dot=small(c)&&!(keepSpecks&&besideLetter(c));
      const rule=(h>charHeight*1.7&&w<charHeight*0.35)||(w>charHeight*2.5&&h<charHeight*0.25);
      const cut=c.x0===0||c.y0===0||c.x1===width-1||c.y1===height-1;
      // Curved labels: a letter counts as inside when a good part of it overlaps the band.
      // Number cells stay strict, so digits of the line below cannot slip in.
      const overlap=keep?Math.max(0,Math.min(c.y1,keep.y1)-Math.max(c.y0,keep.y0)+1)/h:1;
      const outside=keep&&(cx<keep.x0||cx>keep.x1||((cy<keep.y0||cy>keep.y1)&&!(keepSpecks&&overlap>=0.45)));
      if(dot||rule||cut||outside)for(const k of c.component)pixels[k*4]=pixels[k*4+1]=pixels[k*4+2]=255;
    }
    return pixels;
  }

  // Curved labels: follows the text line from left to right (dynamic programming over
  // narrow vertical slices, smooth and limited steps) and shifts each slice so the line
  // runs straight through the middle of the cell. Neighbouring lines stay outside.
  function followTextLine(pixels,width,height,charHeight){
    const H=Math.max(4,charHeight),sw=Math.max(2,Math.round(H*0.35)),win=Math.max(3,Math.round(H*0.8));
    const center=Math.round(height/2),range=Math.min(Math.round(H*0.9),Math.floor(center-win/2)-1),step=Math.max(1,Math.round(H*0.15));
    if(range<1)return pixels;
    const slices=Math.ceil(width/sw),D=2*range+1,ink=new Float64Array(slices*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      if(pixels[i]*0.3+pixels[i+1]*0.59+pixels[i+2]*0.11<150)ink[Math.floor(x/sw)*height+y]++;
    }
    const cost=new Float64Array(slices*D),from=new Int32Array(slices*D),score=new Float64Array(D);
    for(let sl=0;sl<slices;sl++){
      // ink inside the window around centre+d
      const base=sl*height;
      for(let k=0;k<D;k++){
        const top=center+(k-range)-Math.floor(win/2);let n=0;
        for(let y=top;y<top+win;y++)n+=ink[base+y];
        score[k]=n;
      }
      for(let k=0;k<D;k++){
        const keep=-score[k]+0.3*Math.abs(k-range);
        if(sl===0){cost[k]=keep;from[k]=k;continue;}
        let best=Infinity,arg=k;
        for(let j=Math.max(0,k-step);j<=Math.min(D-1,k+step);j++){const c=cost[(sl-1)*D+j]+Math.abs(k-j);if(c<best){best=c;arg=j;}}
        cost[sl*D+k]=best+keep;from[sl*D+k]=arg;
      }
    }
    let k=0;for(let j=1;j<D;j++)if(cost[(slices-1)*D+j]<cost[(slices-1)*D+k])k=j;
    const shift=new Float64Array(slices);
    for(let sl=slices-1;sl>=0;sl--){shift[sl]=k-range;k=from[sl*D+k];}
    const out=new Uint8ClampedArray(pixels.length).fill(255);
    for(let x=0;x<width;x++){
      const t=x/sw-0.5,a=Math.max(0,Math.min(slices-1,Math.floor(t))),b=Math.min(slices-1,a+1),f=Math.max(0,Math.min(1,t-a));
      const d=Math.round(shift[a]*(1-f)+shift[b]*f);
      for(let y=0;y<height;y++){
        const sy=y+d;if(sy<0||sy>=height)continue;
        const i=(y*width+x)*4,j=(sy*width+x)*4;out[i]=pixels[j];out[i+1]=pixels[j+1];out[i+2]=pixels[j+2];out[i+3]=255;
      }
    }
    return out;
  }
  // Cell in page pixels; y is deskewed: page y = yd + slope * x. Variant 1 is a second,
  // independent look (other zoom and threshold) that counts as a separate vote.
  function cellBox(stop,kind,variant=0){
    const cells=stop._cells;if(!cells)return null;
    const cell=cells[kind],h=cells.h;
    // label 1: taller strip whose text line is followed.
    // number 2: taller strip for wavy rows (block mode, may hold two lines).
    // number 3: the row is followed from the start of the label across to "lief."; only the
    //           "lief." part is kept, so a curved row cannot slip onto the line below.
    const along=kind==='number'&&variant===3;
    const tall=(kind==='number'&&(variant===2||along))||(kind==='label'&&variant===1);
    const x0=along?cells.label.x0:cell.x0;
    return {kind,variant,psm:kind==='number'&&variant===2?'6':'7',follow:(kind==='label'&&variant===1)||along,
      keepX0:along?cell.x0:null,keepX1:along?cell.x1:null,
      x0,x1:cell.x1,yd:cell.yd,half:h*(tall?1.5:0.62),margin:h*0.6,pad:h*0.4,slope:cells.slope,charHeight:h,
      scale:variant===1&&kind==='number'?3:2,threshold:variant===1&&kind==='number'?135:165};
  }
  // Canvas size, page->cell transform (for setTransform) and the keep rectangle.
  function cellGeometry(box){
    const s=box.scale,m=box.margin;
    return {width:Math.round((box.x1-box.x0+2*m)*s),height:Math.round((2*box.half+2*m)*s),pad:Math.round(box.pad*s),
      transform:[s,-box.slope*s,0,s,-(box.x0-m)*s,(box.half+m-box.yd)*s],
      // A followed line is moved to the middle; only a normal-height band around it is kept.
      keep:box.follow?{x0:(m+(Number.isFinite(box.keepX0)?box.keepX0-box.x0:0))*s,x1:(m+(Number.isFinite(box.keepX1)?box.keepX1:box.x1)-box.x0)*s,
          y0:(m+box.half-box.charHeight*0.62)*s,y1:(m+box.half+box.charHeight*0.62)*s}
        :{x0:m*s,x1:(m+box.x1-box.x0)*s,y0:m*s,y1:(m+2*box.half)*s}};
  }
  // Browser helper: cuts, deskews and cleans one cell of the rendered page.
  function renderCell(pageCanvas,box,doc){
    const g=cellGeometry(box),cell=doc.createElement('canvas');
    cell.width=g.width;cell.height=g.height;
    const ctx=cell.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,g.width,g.height);
    ctx.setTransform(...g.transform);ctx.drawImage(pageCanvas,0,0);ctx.setTransform(1,0,0,1,0,0);
    const image=ctx.getImageData(0,0,g.width,g.height);
    if(box.follow)image.data.set(followTextLine(image.data,g.width,g.height,box.charHeight*box.scale));
    if(box.kind!=='region')clearNumberRules(image.data,g.width,g.height,box.charHeight*box.scale,box.threshold,g.keep,box.kind==='label');
    const out=doc.createElement('canvas');out.width=g.width+2*g.pad;out.height=g.height+2*g.pad;
    const octx=out.getContext('2d');octx.fillStyle='#fff';octx.fillRect(0,0,out.width,out.height);octx.putImageData(image,g.pad,g.pad);
    cell.width=0;cell.height=0;
    return out;
  }
  // readCell(box) must return {text, confidence} for the deskewed, cleaned cell image.
  // A lone number from the tall strip counts only when it sits on the "lief." side of the
  // cell and the customer has no second delivery line (e.g. Behaltemappe) with its own number.
  function probeLoneNumber(read,box,stop){
    if(!read||!deliveredNumber(read.text)||stop._page?.otherRows)return false;
    const g=cellGeometry(box),digits=(read.words||[]).filter(w=>/\d/.test(w.text||'')&&w.bbox);
    if(!digits.length)return false;
    const span=g.keep.x1-g.keep.x0;
    return digits.every(w=>((w.bbox.x0+w.bbox.x1)/2-g.pad-g.keep.x0)/span<0.45);
  }
  // "lief. / zur." as printed on the main row: "41/ 40", "35/ -", or "41 40" with a lost slash.
  // A lone number is not a pair: it may be the second delivery line (e.g. Behaltemappe).
  const isPair=text=>{const t=clean(text);return /\d\s*\/|\d\s*-+\s*$/.test(t)||/^\D{0,2}\d{1,2}\s+\d{1,2}\s*\*?\D{0,2}$/.test(t);};
  // The one line of a multi-line read that holds a "lief./zur." pair, or null.
  function pairLine(read){
    if(!read)return null;
    const pair=text=>isPair(text)&&deliveredNumber(text);
    const words=(read.words||[]).filter(w=>w.bbox&&clean(w.text));
    let lines;
    if(words.length){
      lines=group(prepare(words)).map(row=>({text:rowText(row.words),confidence:Math.min(...row.words.map(w=>Number.isFinite(w.confidence)?w.confidence:0))}));
    }else lines=String(read.text||'').split(/\n+/).map(text=>({text:clean(text),confidence:read.confidence}));
    const found=lines.filter(line=>pair(line.text));
    return found.length===1?found[0]:null;
  }
  async function refineStops(stops,readCell){
    for(const stop of stops){
      if(!stop._cells||(stop.deliveryType==='Lieferpaket'&&/\blieferpaket\b/i.test(stop._page?.label||'')))continue;
      try{
        let label=await readCell(cellBox(stop,'label'));
        // Curved labels: unless one read already shows Lieferpaket or a Kollektion, the label
        // is read once more along its own line. A recognised kind wins; otherwise the more
        // confident plain text is kept (e.g. "Punktemappe").
        const kindOf=read=>labelParts(read?.text||'').type;
        if(kindOf(label)==='other'&&kindOf({text:stop._page?.label})==='other'){
          const followed=await readCell(cellBox(stop,'label',1));
          if(kindOf(followed)!=='other'||(labelParts(followed?.text||'').title&&(followed.confidence||0)>(label?.confidence||0)))label=followed;
        }
        const kind=labelParts(label?.text||'').type,pageKind=labelParts(stop._page?.label||'').type;
        const numbers=[];
        const wish=[label?.text,stop._page?.label].some(text=>labelParts(text||'').wish);
        if((kind==='collection'||pageKind==='collection')&&!wish){
          for(const variant of [0,1])numbers.push(await readCell(cellBox(stop,'number',variant)));
          // Wavy or curved rows: the "lief./zur." pair can sit above or below the label's line,
          // and the cell may then hit a neighbouring line (e.g. the lone "41" of a Behaltemappe).
          // The main row always shows a pair ("41/ 40", "35/ -"); without one a taller strip is
          // read, and a pair found there replaces the lone numbers.
          const pair=read=>isPair(read?.text);
          if(!numbers.some(pair)){
            // First follow the row from the label across to "lief." (stays on a curved row),
            const along=await readCell(cellBox(stop,'number',3));
            const alongLine=pairLine(along);
            if(alongLine){numbers.splice(0,numbers.length,alongLine);}
            else{
            // then read a taller strip and pick the line with the pair.
            const box=cellBox(stop,'number',2),probe=await readCell(box);
            const line=pairLine(probe);
            if(line)numbers.splice(0,numbers.length,line);
            else if(!numbers.some(read=>deliveredNumber(read?.text||''))&&probeLoneNumber(probe,box,stop))numbers.push(probe);
            }
          }
        }
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
      if(wish)return done('Wunschkollektion');
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
    if(page.number)votes.push({value:page.number,confidence:page.confidence,pair:isPair(page.numberText)});
    if(stop._originalPage?.number&&labelParts(stop._originalPage.label).type==='collection')votes.push({value:stop._originalPage.number,confidence:stop._originalPage.confidence,pair:isPair(stop._originalPage.numberText)});
    for(const read of numberReads){const value=read?deliveredNumber(read.text):null;if(value)votes.push({value,confidence:read.confidence,pair:isPair(read.text)});}
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
    // A number read as a "lief. / zur." pair certainly comes from the main row: a differing
    // (possibly misread) Behaltemappe number then only adds a check note.
    const companions=[...(page.companionNumbers||[]),...(stop._originalPage?.companionNumbers||[])];
    const fromPair=number&&votes.some(v=>v.value===number&&v.pair);
    const other=number&&companions.find(value=>value!==number);
    if(other&&fromPair){
      if(!note)note=`Behaltemappe zeigt ${other}. Liefermenge am PDF prüfen.`;
    }else if(other){
      number=null;note='Abweichende Nummern im Kundenblock. Kollektionsnummer am PDF prüfen.';
    }
    const merged=readDelivery(label,{numbers:number?[number]:[],source,column:true});
    if(note&&(ranked.length>1||!number||!merged.deliveryReview||other))merged.deliveryReview=note;
    return merged;
  }

  // ----- straightening the customer column -----
  // Photographed lists are bent: the tilt changes from the top to the bottom of the page
  // and is often much stronger at the left edge. For horizontal strips of the column the
  // tilt is measured from the ink itself (the shear that gives the sharpest row profile).
  function columnShear(pixels,width,height,{xref=width,charHeight=height/60,maxSlope=0.08,stepSlope=0.002}={}){
    const band=Math.max(40,Math.round(charHeight*7)),step=Math.max(20,Math.round(band/2)),points=[];
    const dark=[];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(pixels[i]*0.3+pixels[i+1]*0.59+pixels[i+2]*0.11<150)dark.push(x,y);}
    for(let top=0;top<height;top+=step){
      const bottom=Math.min(height,top+band),pts=[];
      for(let i=0;i<dark.length;i+=2)if(dark[i+1]>=top&&dark[i+1]<bottom)pts.push(dark[i],dark[i+1]);
      if(pts.length<band*2){points.push({y:(top+bottom)/2,slope:null});continue;}
      let best=0,bestScore=-1;
      const hist=new Float64Array(bottom-top+Math.ceil(maxSlope*width*2)+4),off=Math.ceil(maxSlope*width)+2;
      for(let s=-maxSlope;s<=maxSlope+1e-9;s+=stepSlope){
        hist.fill(0);
        for(let i=0;i<pts.length;i+=2)hist[Math.round(pts[i+1]-top-s*(pts[i]-xref))+off]++;
        let score=0;for(let k=0;k<hist.length;k++)score+=hist[k]*hist[k];
        if(score>bestScore+1e-9||(Math.abs(score-bestScore)<=1e-9&&Math.abs(s)<Math.abs(best))){bestScore=score;best=s;}
      }
      points.push({y:(top+bottom)/2,slope:best});
      if(bottom===height)break;
    }
    // Empty strips take their neighbours' tilt; a single outlier is smoothed by a median of three.
    const known=points.filter(p=>p.slope!==null);
    if(!known.length)return [{y:0,slope:0}];
    for(const p of points)if(p.slope===null)p.slope=known.reduce((a,b)=>Math.abs(b.y-p.y)<Math.abs(a.y-p.y)?b:a).slope;
    return points.map((p,i)=>({y:p.y,slope:median([points[i-1],p,points[i+1]].filter(Boolean).map(q=>q.slope))}));
  }
  function shearAt(points,y){
    if(y<=points[0].y)return points[0].slope;
    for(let i=1;i<points.length;i++)if(y<=points[i].y){const a=points[i-1],b=points[i],t=(y-a.y)/(b.y-a.y);return a.slope+(b.slope-a.slope)*t;}
    return points.at(-1).slope;
  }
  // Output pixel (u,v) shows the page pixel (u, v + shear(v)*(u - xref)); xref is kept in place.
  function straightenColumn(pixels,width,height,points,xref=width){
    const out=new Uint8ClampedArray(pixels.length).fill(255);
    for(let v=0;v<height;v++){
      const s=shearAt(points,v);
      for(let u=0;u<width;u++){
        const y=Math.round(v+s*(u-xref));
        if(y<0||y>=height)continue;
        const i=(v*width+u)*4,j=(y*width+u)*4;
        out[i]=pixels[j];out[i+1]=pixels[j+1];out[i+2]=pixels[j+2];out[i+3]=255;
      }
    }
    return out;
  }
  // Maps OCR words of the straightened column (column pixels, top at `top`) back to the page.
  function straightenedWords(words,points,{left=0,top=0,xref}){
    return words.filter(w=>clean(w.text)&&w.bbox).map(w=>{
      const v0=w.bbox.y0,v1=w.bbox.y1,vc=(v0+v1)/2,s=shearAt(points,vc),dy=u=>s*(u-xref);
      return {...w,lineX:left+xref,lineY:top+vc,
        bbox:{x0:left+w.bbox.x0,x1:left+w.bbox.x1,y0:top+v0+Math.min(dy(w.bbox.x0),dy(w.bbox.x1)),y1:top+v1+Math.max(dy(w.bbox.x0),dy(w.bbox.x1))}};
    });
  }
  // Customer column of a page image (RGBA, page width): everything right of the leaning
  // column boundary is blanked, then the column is straightened strip by strip.
  function straightColumnPixels(pagePixels,pageWidth,height,layout){
    const width=Math.max(1,Math.min(pageWidth,Math.ceil(Math.max(layout.deliveryStart,
      ...[0,height/2,height].map(y=>layout.pageX?layout.pageX(layout.deliveryStart,y):layout.deliveryStart)))));
    const pixels=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++){
      const edge=layout.pageX?layout.pageX(layout.deliveryStart,y):layout.deliveryStart;
      for(let x=0;x<width;x++){
        const i=(y*width+x)*4,j=(y*pageWidth+x)*4;
        if(x<edge){pixels[i]=pagePixels[j];pixels[i+1]=pagePixels[j+1];pixels[i+2]=pagePixels[j+2];}
        else pixels[i]=pixels[i+1]=pixels[i+2]=255;
        pixels[i+3]=255;
      }
    }
    const points=columnShear(pixels,width,height,{xref:width,charHeight:pageWidth/60});
    return {pixels:straightenColumn(pixels,width,height,points,width),width,height,points,xref:width};
  }
  // Browser helper: straightened customer column of the rendered page as a canvas.
  function renderStraightColumn(pageCanvas,layout,doc){
    const page=pageCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,pageCanvas.width,pageCanvas.height);
    const column=straightColumnPixels(page.data,pageCanvas.width,pageCanvas.height,layout);
    const canvas=doc.createElement('canvas');canvas.width=column.width;canvas.height=column.height;
    canvas.getContext('2d').putImageData(new ImageData(column.pixels,column.width,column.height),0,0);
    return {canvas,points:column.points,xref:column.xref};
  }
  // Customer words come from the straightened read, everything else from the page read.
  function mergeColumnWords(pageWords,columnWords,layout){
    const xd=w=>{const y=(w.bbox.y0+w.bbox.y1)/2;return layout.shiftX?layout.shiftX(w.bbox.x0,y):w.bbox.x0;};
    return [...pageWords.filter(w=>w.bbox&&xd(w)>=layout.deliveryStart),...columnWords.filter(w=>w.bbox&&xd(w)<layout.deliveryStart)];
  }


  const api={followTextLine,columnShear,shearAt,straightenColumn,straightenedWords,straightColumnPixels,renderStraightColumn,mergeColumnWords,reviewValue,readDelivery,rowsFromWords,pdfWords,columns,deliveredNumber,parsePage,clearNumberRules,cellBox,cellGeometry,renderCell,refineStops,retainPageEvidence,unreadRegions,mergeRegionWords,mergeReads,canonicalLabel};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DeliveryImport=api;
})(typeof window==='object'?window:globalThis);
