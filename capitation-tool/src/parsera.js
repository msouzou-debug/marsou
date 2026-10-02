// HIO Remittance Advice (SRA) parser
function parseRaItems(pages){
  const num=s=>Number(String(s).replace(/,/g,''));
  let supplier='',payNo='',payDate='',total=null;const lines=[];let rec=null;
  for(const items of pages){
    const Ls=[];
    for(const it of items){ if(!it.s.trim())continue;
      let L=Ls.find(l=>Math.abs(l.y-it.y)<2.5); if(!L){L={y:it.y,t:[]};Ls.push(L);} L.t.push(it);}
    Ls.sort((a,b)=>b.y-a.y);for(const L of Ls)L.t.sort((a,b)=>a.x-b.x);
    for(const L of Ls){
      const t=L.t.map(x=>x.s.trim()).filter(Boolean), txt=t.join(' ');
      let m;
      if(!supplier&&(m=txt.match(/(?:^|[-\s])(F\d{4})\b/)))supplier=m[1];
      if(m=txt.match(/Payment Date:\s*(\d\d\/\d\d\/\d{4})/))payDate=m[1];
      if(m=txt.match(/Payment\/Cheque No:\s*(\S+)/))payNo=m[1];
      if(m=txt.match(/Total paid in this batch:\s*(-?[\d,.]+)/))total=num(m[1]);
      if(/^\d\d\/\d\d\/\d{4}$/.test(t[0])&&L.t[0].x<100){
        const e=t.lastIndexOf('EUR');
        if(e>2){rec={invDate:t[0],invNo:t[1],desc:t.slice(2,e-1).join(' '),invTotal:num(t[e-1]),paid:num(t[e+1]),x1:L.t[1].x,x2:L.t[2]?L.t[2].x:999};lines.push(rec);continue;}
      }
      if(rec&&L.t[0].x>=rec.x1-3&&!/Subtotal|Total|Υποσύνολο|Σύνολο|Invoice|Τιμολογίου|Page/.test(txt)&&L.t.length<=3){
        for(const it of L.t){ if(Math.abs(it.x-rec.x1)<20)rec.invNo+=it.s.trim(); else if(it.x>=rec.x2-5&&it.x<rec.x2+150)rec.desc+=' '+it.s.trim(); }
      } else if(!/^\d\d\/\d\d/.test(t[0]||'')) rec=null;
    }
  }
  lines.forEach(l=>{delete l.x1;delete l.x2;});
  return {supplier,payNo,payDate,total,lines};
}
if(typeof module!=='undefined')module.exports={parseRaItems};
