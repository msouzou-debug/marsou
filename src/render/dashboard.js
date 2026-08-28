/* ---------- dashboard render ---------- */
import { U } from '../util.js';
import { state } from '../state.js';
import { yoy, sumBlocksMonthly } from '../model/blocks.js';
import { buildStory, buildFlags } from '../model/story.js';
import { C, sparkline, lineChart, barChartSigned } from './charts.js';
import { renderClinics } from './clinics.js';
import { renderFinance } from './finance.js';
import { renderHIO } from './hio.js';
import { renderALLAE } from './allae.js';
import { renderOS } from './os.js';
import { el, wrapWideTables } from './dom.js';

export function render(){
  const S=state.stats; if(!S) return;
  el('dash').classList.remove('hidden');
  const hospGr=S.title.match(/ΓΕΝΙΚΟΥ ΝΟΣΟΚΟΜΕΙΟΥ\s+([Α-ΩΪΫ]+)/);
  const CITY={'ΛΕΥΚΩΣΙΑΣ':'Λευκωσίας','ΛΕΜΕΣΟΥ':'Λεμεσού','ΛΑΡΝΑΚΑΣ':'Λάρνακας','ΠΑΦΟΥ':'Πάφου','ΑΜΜΟΧΩΣΤΟΥ':'Αμμοχώστου','ΚΥΠΕΡΟΥΝΤΑΣ':'Κυπερούντας'};
  el('hTitle').textContent='Πίνακας Δεικτών — '+(hospGr?'ΓΝ '+(CITY[hospGr[1]]||hospGr[1]):'Νοσοκομείο');
  el('hPeriod').textContent=`Περίοδος: Ιανουάριος – ${['','Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος','Μάιος','Ιούνιος','Ιούλιος','Αύγουστος','Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος'][S.mN]} ${S.year} (σύγκριση με την ίδια περίοδο του ${S.year-1})`;
  el('hPeriod').classList.remove('hidden');
  el('story').textContent=buildStory();

  /* KPI tiles */
  const order=['adm','dc','opd','taepA','taepP','surg','minor','cath','dial','xray'];
  el('kpis').innerHTML=order.filter(k=>S.kpi[k]&&S.kpi[k].cur!=null).map(k=>{
    const x=S.kpi[k],d=yoy(k);
    const cls=d==null?'flat':d>1?'up':d<-1?'down':'flat';
    const arrow=d==null?'':d>1?'▲ ':d<-1?'▼ ':'≈ ';
    const spark=sparkFor(k);
    return `<div class="kpi"><div class="label">${x.label}</div><div class="value">${U.fmt(x.cur)}</div>
      <div class="delta ${cls}">${arrow}${U.pct(d)} <span style="font-weight:400;color:#8a8b8d">(${U.fmt(x.prev)})</span></div>${spark}</div>`;
  }).join('');

  /* trends */
  renderTrends();
  /* targets */
  renderTargets();
  /* financials and the per-clinic view */
  renderFinance();
  renderClinics();
  /* flags */
  el('flags').innerHTML=buildFlags().map(f=>`<div class="flag ${f.t==='flag'?'':f.t}">${U.esc(f.m)}</div>`).join('')||'<div class="flag good">Κανένα σημείο προσοχής με βάση τους κανόνες ελέγχου.</div>';
  /* HIO */
  renderHIO();
  renderALLAE();
  renderOS();
  /* method */
  wrapWideTables();
  el('method').innerHTML=`<b>Μεθοδολογία & παραδοχές.</b> Πηγή: το μηνιαίο αρχείο στατιστικών του νοσοκομείου· τα «${S.year}» μεγέθη αφορούν την περίοδο Ιανουαρίου–${['','Ιανουαρίου','Φεβρουαρίου','Μαρτίου','Απριλίου','Μαΐου','Ιουνίου','Ιουλίου','Αυγούστου','Σεπτεμβρίου','Οκτωβρίου','Νοεμβρίου','Δεκεμβρίου'][S.mN]} ${S.year} και συγκρίνονται με την ίδια περίοδο του ${S.year-1}. Οι στόχοι στο φύλλο ΣΤΟΧΟΣ είναι ετήσιοι και εδώ ανάγονται αναλογικά σε ${S.mN}/12. Η διασταύρωση ΟΑΥ βασίζεται στα IS Auditor Reports με καταμέτρηση κατά <i>ημερομηνία εξιτηρίου</i> (όχι μήνα υποβολής)· ο τελευταίος μήνας εμφανίζεται πάντα μειωμένος μέχρι να υποβληθούν όλα τα περιστατικά. Τα δύο συστήματα μετρούν διαφορετικούς πληθυσμούς (π.χ. ασθενείς εκτός ΓεΣΥ, ενδονοσοκομειακές διακομιδές, ψυχιατρική/παραπληγικό εκτός DRG) — οι αποκλίσεις είναι ενδείξεις για διερεύνηση, όχι αυτόματα «χαμένα έσοδα». Τα αρχεία ALL and AE περιέχουν πληρωμές (€), όχι αριθμούς επισκέψεων — τα «€ ανά επίσκεψη» συνδυάζουν πληρωμές ΟΑΥ με τις επισκέψεις των στατιστικών του νοσοκομείου.`;
}

function sparkFor(k){
  const S=state.stats,y=S.year;
  const src={taepA:['taep',/Ενηλίκων/i],taepP:['taep',/Παίδων/i]}[k];
  let m=null;
  if(src&&S.blocks[src[0]]){const b=S.blocks[src[0]].find(b=>src[1].test(b.name)); m=b?.years[y];}
  if(k==='adm') m=sumBlocksMonthly('adm',y);
  if(k==='dc') m=sumBlocksMonthly('dcm',y);
  if(!m) return '';
  const vals=[];for(let i=0;i<S.mN;i++)vals.push(m[i]??null);
  return sparkline(vals);
}

function renderTrends(){
  const S=state.stats,y=S.year,box=el('trends');box.innerHTML='';
  const mk=(title,series,note)=>{
    const labels=U.MONTHS_EL;
    const leg=series.map(s=>`<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    box.insertAdjacentHTML('beforeend',`<div class="card"><h3>${title}</h3><div class="legend">${leg}</div>${lineChart(series,labels)}${note?`<div class="note">${note}</div>`:''}</div>`);
  };
  const seriesFor=(m3,m2,m1)=>{ // month-maps for y-2,y-1,y
    const f=m=>{const v=[];for(let i=0;i<12;i++)v.push(m?.[i]??null);return v;};
    return [{name:String(y-2),color:C.old,vals:f(m3),w:1.6},
            {name:String(y-1),color:C.y1,vals:f(m2),dash:true,w:1.8},
            {name:String(y),color:C.y0,vals:f(m1),w:2.6}];
  };
  const adm=y=>sumBlocksMonthly('adm',y);
  const admTot=state.stats.annual.adm?.total?.vals[y];
  const admSum=Object.values(adm(y)||{}).reduce((a,b)=>a+b,0);
  const admOk=admTot?Math.abs(admSum-admTot)/admTot<0.05:true;
  if(adm(y)) mk('Εισαγωγές ανά μήνα',seriesFor(adm(y-2),adm(y-1),adm(y)),
     admOk?'Άθροισμα των κλινικών του φύλλου 2.':'Άθροισμα κλινικών — αποκλίνει >5% από το επίσημο σύνολο, ενδεικτική εικόνα.');
  const tb=k=>{const b=(S.blocks.taep||[]).find(b=>k.test(b.name));return b?b.years:null;};
  const ta=tb(/Ενηλίκων/i);
  if(ta) mk('ΤΑΕΠ ενηλίκων ανά μήνα',seriesFor(ta[y-2],ta[y-1],ta[y]));
  const dcm=y=>sumBlocksMonthly('dcm',y);
  if(dcm(y)) mk('Ημερήσια νοσηλεία ανά μήνα',seriesFor(dcm(y-2),dcm(y-1),dcm(y)),'Άθροισμα μονάδων ημερήσιας φροντίδας.');
  // clinic movers bar
  const rows=(S.annual.adm?.rows||[]).map(r=>{
    const c=r.vals[y],p=r.vals[y-1];
    return (c!=null&&p>30)?{name:r.name,val:100*(c-p)/p}:null;
  }).filter(Boolean).sort((a,b)=>b.val-a.val);
  if(rows.length>5){
    const sel=[...rows.slice(0,5),...rows.slice(-5)];
    box.insertAdjacentHTML('beforeend',`<div class="card"><h3>Εισαγωγές — μεγαλύτερες μεταβολές ανά κλινική</h3>${barChartSigned(sel)}<div class="note">Έναντι της ίδιας περιόδου του ${y-1}· κλινικές με περισσότερες από 30 εισαγωγές.</div></div>`);
  }
}

function renderTargets(){
  const S=state.stats,box=el('targets');box.innerHTML='';
  el('targetNote').textContent=`οι ετήσιοι στόχοι ανάγονται σε ${S.mN}/12`;
  const items=Object.values(S.kpi).filter(x=>x.target>0&&x.cur!=null)
    .map(x=>({label:x.label,cur:x.cur,pro:x.target*S.mN/12}))
    .map(x=>({...x,pct:100*x.cur/x.pro})).sort((a,b)=>a.pct-b.pct);
  if(!items.length){el('secTargets').classList.add('hidden');return;}
  const half=Math.ceil(items.length/2);
  [items.slice(0,half),items.slice(half)].forEach(col=>{
    box.insertAdjacentHTML('beforeend','<div class="card">'+col.map(x=>{
      const w=Math.min(x.pct,130)/130*100;
      const color=x.pct>=100?C.green:x.pct>=90?'#d9a400':C.neg;
      return `<div class="bullet"><div class="bl"><span>${U.esc(x.label)}</span><b>${U.fmt(x.pct,0)}%</b></div>
        <div class="track"><div class="fill" style="width:${w}%;background:${color}"></div>
        <div style="position:absolute;left:${100/1.3}%;top:0;bottom:0;width:2px;background:#58595B"></div></div>
        <div class="bl" style="margin-top:2px;color:#8a8b8d"><span>${U.fmt(x.cur)}</span><span>αναλογικός στόχος ${U.fmt(x.pro)}</span></div></div>`;
    }).join('')+'</div>');
  });
}
