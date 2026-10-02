(function(root){
  'use strict';
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
  const known=/\b(?:Lieferpaket|(?:Wunsch[- ]?)?Kollektion|Punktemappe|Behältemappe)\b/i;
  const missing='Lieferart nicht eindeutig erkannt. Bitte am PDF prüfen.';
  function reviewValue(value){
    const text=clean(value);
    if(!text)return missing;
    if(/\bkollektion\b/i.test(text)&&!/^Kollektion\s+\d+\s+[A-Z]$/i.test(text))return 'Kollektion unvollständig: Nummer und Buchstabe prüfen.';
    return '';
  }
  function readDelivery(label,{numbers=[],source=label}={}){
    label=clean(label);source=clean(source);
    const result=(deliveryType,deliveryReview='')=>({deliveryType,deliveryReview,deliverySource:source});
    if(/\blieferpaket\b/i.test(label))return result('Lieferpaket');
    if(/\bkollektion\b/i.test(label)){
      const letters=[...new Set([...label.matchAll(/\(\s*([A-Za-z])\s*\)/g)].map(m=>m[1].toUpperCase()))];
      const inline=[...label.matchAll(/(?:^|\s)(\d+)\s*\(\s*[A-Za-z]\s*\)/g)].map(m=>m[1]);
      for(const m of label.matchAll(/\bkollektion\s+(\d+)(?=\s|\(|$)/ig))inline.push(m[1]);
      for(const m of label.matchAll(/(?:^|\s)(\d+)\s+(?:Wunsch[- ]?)?Kollektion\b/ig))inline.push(m[1]);
      const found=[...new Set([...inline,...numbers.map(clean).filter(n=>/^\d+$/.test(n))])];
      if(found.length===1&&letters.length===1)return result(`Kollektion ${found[0]} ${letters[0]}`);
      return result('Kollektion','Kollektion unvollständig oder mehrdeutig: Nummer und Klammerbuchstabe am PDF prüfen.');
    }
    if(label&&!/^[-\d\s.,€()]+$/.test(label))return result(label);
    return result('',missing);
  }
  function rowsFromWords(words){
    const valid=words.filter(w=>clean(w.text)&&w.bbox&&['x0','x1','y0','y1'].every(k=>Number.isFinite(w.bbox[k])))
      .map(w=>({...w,text:clean(w.text),x:w.bbox.x0,y:(w.bbox.y0+w.bbox.y1)/2,h:Math.max(1,w.bbox.y1-w.bbox.y0)}))
      .sort((a,b)=>a.y-b.y||a.x-b.x);
    const rows=[];
    for(const word of valid){
      const row=rows.at(-1);
      if(row&&Math.abs(row.y-word.y)<=Math.min(row.h,word.h)*0.55){row.words.push(word);row.y=row.words.reduce((n,w)=>n+w.y,0)/row.words.length;}
      else rows.push({y:word.y,h:word.h,words:[word]});
    }
    for(const row of rows)row.words.sort((a,b)=>a.x-b.x);
    return rows;
  }
  function pdfWords(items,viewport){
    return items.filter(item=>typeof item.str==='string'&&item.str.trim()&&item.transform).map(item=>{
      const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
      const height=Math.max(1,Math.abs(item.height*viewport.scale));
      return {text:item.str,bbox:{x0:x,x1:x+item.width*viewport.scale,y0:y-height,y1:y},confidence:100};
    });
  }
  const rowText=words=>clean(words.map(w=>w.text).join(' '));
  function columns(rows,width){
    for(const row of rows){
      const labels=row.words.map(w=>({word:w,text:w.text.toLowerCase().replace(/[:.]/g,'')}));
      const customer=labels.find(v=>/^(kunde|kundenname|adresse)$/.test(v.text));
      const delivery=labels.find(v=>/^(lieferart|lieferung)$/.test(v.text));
      if(!customer||!delivery||delivery.word.x<=customer.word.x)continue;
      const later=labels.filter(v=>v.word.x>customer.word.x&&/^(klasse|lieferart|lieferung|preis|kasse|menge|anzahl)$/.test(v.text)).sort((a,b)=>a.word.x-b.word.x);
      const number=later.find(v=>v.text==='klasse');
      const endOf=x=>later.find(v=>v.word.x>x)?.word.x??width;
      return {addressEnd:later[0].word.x-2,deliveryStart:delivery.word.x-2,deliveryEnd:endOf(delivery.word.x)-2,
        numberStart:number?number.word.x-2:null,numberEnd:number?endOf(number.word.x)-2:null,headerY:row.y};
    }
    return {addressEnd:width*0.372,deliveryStart:null,deliveryEnd:width,numberStart:null,numberEnd:null,headerY:-Infinity};
  }
  function deliveryForRows(rows,layout){
    const records=[];
    for(const row of rows){
      const right=row.words.filter(w=>w.x>=layout.addressEnd);
      let labelWords=layout.deliveryStart===null?right:right.filter(w=>w.x>=layout.deliveryStart&&w.x<layout.deliveryEnd);
      if(layout.deliveryStart===null){
        const start=labelWords.findIndex(w=>known.test(w.text));
        if(start<0)continue;
        labelWords=labelWords.slice(start);
      }
      const label=rowText(labelWords);
      if(!label||/^(?:preis|lieferung|lieferart|klasse|kasse|summe|gesamt)\b/i.test(label))continue;
      const numberWords=layout.numberStart===null?[]:right.filter(w=>w.x>=layout.numberStart&&w.x<layout.numberEnd);
      records.push({row,label,labelWords,numberWords});
    }
    const candidates=[],collections=records.filter(r=>/\bkollektion\b/i.test(r.label));
    const allNumbers=rows.flatMap(row=>layout.numberStart===null?[]:row.words.filter(w=>w.x>=layout.numberStart&&w.x<layout.numberEnd));
    for(let i=0;i<records.length;i++){
      const record=records[i],{row}=record;
      let {label,labelWords,numberWords}=record;
      if(/\bkollektion\b/i.test(label)){
        // Wrapped details stay inside this customer's delivery column and block.
        for(const neighbor of [records[i-1],records[i+1]])if(neighbor&&Math.abs(neighbor.row.y-row.y)<row.h*2.5&&/^(?:\d+\s*)?(?:\(\s*[A-Za-z]\s*\))$/.test(neighbor.label)){
          label+=' '+neighbor.label;labelWords=[...labelWords,...neighbor.labelWords];
        }
        if(collections.length===1)numberWords=allNumbers;
      }else if(/^\(\s*[A-Za-z]\s*\)$/.test(label))continue;
      const source=[rowText(numberWords),label].filter(Boolean).join(' | ');
      const parsed=readDelivery(label,{numbers:numberWords.map(w=>w.text),source});
      if(!parsed.deliveryType)continue;
      if([...labelWords,...numberWords].some(w=>Number.isFinite(w.confidence)&&w.confidence<70))parsed.deliveryReview='Lieferart unsicher erkannt. Bitte am PDF prüfen.';
      candidates.push(parsed);
    }
    // A package label must never be reinterpreted as a collection.
    const packet=candidates.find(c=>c.deliveryType==='Lieferpaket');
    if(packet)return packet;
    const unique=[...new Set(candidates.map(c=>c.deliveryType))];
    if(unique.length===1)return candidates.find(c=>c.deliveryReview)||candidates[0];
    return {deliveryType:'',deliveryReview:missing,deliverySource:candidates.map(c=>c.deliverySource).join(' / ')};
  }
  function parsePage(words,width,{parseStops,looksLikeStopHeader,parsePostal,normalizeLines}){
    const rows=rowsFromWords(words),layout=columns(rows,width);
    const customerText=row=>rowText(row.words.filter(w=>w.x<layout.addressEnd));
    const body=rows.filter(row=>row.y>layout.headerY);
    const anchors=body.map((row,i)=>looksLikeStopHeader(customerText(row))?i:-1).filter(i=>i>=0);
    const bands=[];
    if(anchors.length){
      anchors.forEach((index,i)=>bands.push(body.slice(index,anchors[i+1]??body.length)));
    }else{
      let start=0;
      for(let i=0;i<body.length;i++)if(normalizeLines(customerText(body[i])).some(line=>parsePostal(line))){
        bands.push(body.slice(start,i+1));start=i+1;
      }
    }
    const stops=[];
    for(const band of bands){
      const parsed=parseStops(band.map(customerText).filter(Boolean).join('\n'));
      const delivery=parsed.length===1?deliveryForRows(band,layout):{deliveryType:'',deliveryReview:missing,deliverySource:''};
      stops.push(...parsed.map(stop=>({...stop,...delivery})));
    }
    return stops;
  }
  const api={reviewValue,readDelivery,rowsFromWords,pdfWords,columns,deliveryForRows,parsePage};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DeliveryImport=api;
})(typeof window==='object'?window:globalThis);
