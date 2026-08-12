/* ---------- narrative + red flags ----------
   Greek strings here were reviewed by a linguist — keep the phrasing. */
import { U } from '../util.js';
import { state } from '../state.js';
import { yoy } from './blocks.js';

export function buildStory(){
  const S=state.stats,K=S.kpi;
  const PERIOD=['','μήνας','δίμηνο','τρίμηνο','τετράμηνο','πεντάμηνο','εξάμηνο','επτάμηνο','οκτάμηνο','εννεάμηνο','δεκάμηνο','εντεκάμηνο','έτος'];
  const per=PERIOD[S.mN]||'διάστημα';
  const s=[];
  const adm=yoy('adm');
  if(K.adm) s.push(`Το ${per} έκλεισε με ${U.fmt(K.adm.cur)} εισαγωγές, ${adm==null?'':(Math.abs(adm)<1?'στα ίδια επίπεδα με πέρσι':U.pct(adm)+' σε σχέση με πέρσι')}.`);
  const dc=yoy('dc');
  if(dc!=null&&dc>8) s.push(`Η ημερήσια νοσηλεία συνεχίζει να ανεβαίνει (${U.pct(dc)}) — η μετατόπιση από την κλασική νοσηλεία αποδίδει.`);
  const opd=yoy('opd');
  if(opd!=null&&Math.abs(opd)<2) s.push(`Τα εξωτερικά ιατρεία έμειναν ουσιαστικά στάσιμα (${U.pct(opd)}).`);
  else if(opd!=null) s.push(`Τα εξωτερικά ιατρεία κινήθηκαν ${U.pct(opd)}.`);
  const negs=['cath','minor','dial','surg','taepA'].map(k=>({k,v:yoy(k)})).filter(x=>x.v!=null&&x.v<-5);
  if(negs.length){ const nm={cath:'το επεμβατικό καρδιολογικό',minor:'τα μικρά χειρουργεία',dial:'οι αιμοκαθάρσεις',surg:'τα χειρουργεία',taepA:'το ΤΑΕΠ ενηλίκων'};
    const parts=negs.map(x=>nm[x.k]+' ('+U.pct(x.v)+')');
    const lst=parts.length>1?parts.slice(0,-1).join(', ')+' και '+parts[parts.length-1]:parts[0];
    s.push(`Θέλουν προσοχή ${lst}.`);}
  return s.join(' ');
}

export function buildFlags(){
  const S=state.stats,out=[];
  // occupancy per clinic, current-year average
  const occ=(S.blocks.occ||[]).map(b=>{
    const m=b.years[S.year]; if(!m) return null;
    const v=Object.values(m); if(!v.length) return null;
    return {name:b.name,avg:v.reduce((a,b)=>a+b,0)/v.length};
  }).filter(Boolean);
  occ.filter(o=>o.avg>100).sort((a,b)=>b.avg-a.avg).slice(0,4)
     .forEach(o=>out.push({t:'flag',m:`Πληρότητα πάνω από 100% στην κλινική ${o.name} (μ.ο. ${U.fmt(o.avg,1)}%) — συστηματική υπερφόρτωση κλινών.`}));
  occ.filter(o=>o.avg<50&&o.avg>0).sort((a,b)=>a.avg-b.avg).slice(0,3)
     .forEach(o=>out.push({t:'warn',m:`Χαμηλή πληρότητα στην κλινική ${o.name} (μ.ο. ${U.fmt(o.avg,1)}%) — περιθώριο ανακατανομής κλινών.`}));
  // KPI drops
  for(const [k,x] of Object.entries(S.kpi)){
    const d=yoy(k);
    if(d!=null&&d<=-8) out.push({t:'warn',m:`${x.label}: ${U.pct(d)} έναντι του ${S.year-1} (${U.fmt(x.prev)} → ${U.fmt(x.cur)}).`});
  }
  // biggest clinic movers (admissions)
  const admRows=(S.annual.adm?.rows||[]).map(r=>{
    const c=r.vals[S.year],p=r.vals[S.year-1];
    return (c!=null&&p>20)?{name:r.name,d:100*(c-p)/p,c,p}:null;
  }).filter(Boolean);
  admRows.sort((a,b)=>b.d-a.d);
  if(admRows.length>3){
    const top=admRows[0],bot=admRows[admRows.length-1];
    if(top.d>25) out.push({t:'good',m:`Μεγαλύτερη αύξηση εισαγωγών: ${top.name} (${U.pct(top.d)}, ${U.fmt(top.p)} → ${U.fmt(top.c)}).`});
    if(bot.d<-12) out.push({t:'warn',m:`Μεγαλύτερη πτώση εισαγωγών: ${bot.name} (${U.pct(bot.d)}, ${U.fmt(bot.p)} → ${U.fmt(bot.c)}).`});
  }
  // data-quality
  S.dq.forEach(m=>out.push({t:'info',m:'Ποιότητα δεδομένων: '+m}));
  return out;
}
