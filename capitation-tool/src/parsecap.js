// Capitation Reimbursement Report parser (shared with browser build)
function num(s){s=String(s).replace(/€/g,'').replace(/,/g,'').trim();return s===''||s==='-'?0:Number(s);}
function parseCapItems(pages){ // pages: [[{x,y,s}]]
  const invoices=[];let inv=null,doc=null,row=null,last=null,month=null,year=null;
  for(const items of pages){
    const lines=[];
    for(const it of items){ if(it.y<55||!it.s.trim())continue;
      let L=lines.find(l=>Math.abs(l.y-it.y)<2.5); if(!L){L={y:it.y,t:[]};lines.push(L);} L.t.push(it);}
    lines.sort((a,b)=>b.y-a.y); for(const L of lines)L.t.sort((a,b)=>a.x-b.x);
    for(const L of lines){
      const col=(a,b)=>L.t.filter(t=>t.x>=a&&t.x<b).map(t=>t.s.trim()).join(' ').trim();
      const txt=L.t.map(t=>t.s).join(' ');
      if(/^Μήνας/.test(col(100,190))){month=num(col(190,260));continue;}
      if(/^Έτος/.test(col(100,190))){year=num(col(190,260));continue;}
      const id=col(0,110), nm=col(110,325), amt=col(700,900);
      if(/^\d{5,}$/.test(id)&&/^F\d+/.test(nm)){
        inv={id:Number(id),provider:nm,type:col(325,500),date:(txt.match(/\d\d\/\d\d\/\d{4}/)||[''])[0],amount:num(amt),doctors:[]};
        invoices.push(inv);doc=null;row=null;last='prov';continue;}
      if(/^D\d{3,}\s/.test(nm)&&inv){
        doc={code:nm.split(/\s/)[0],name:nm,amount:num(amt),rows:[]};inv.doctors.push(doc);row=null;last='doc';continue;}
      const age=col(320,400);
      if(/years/.test(age)&&doc){
        row={age,comment:col(400,490),rate:col(490,570),count:num(col(570,650)),days:num(col(650,720)),amount:num(col(720,900))};
        doc.rows.push(row);last='row';continue;}
      // continuation lines
      if(last==='prov'&&nm&&!/^D\d/.test(nm)&&inv)inv.provider+=' '+nm;
      else if(last==='doc'&&nm&&doc)doc.name+=' '+nm;
      else if(last==='row'&&row&&col(400,490))row.comment+=' '+col(400,490);
    }
  }
  return {month,year,invoices};
}
if(typeof module!=='undefined')module.exports={parseCapItems,num};
