/* ---------- ΟΑΥ revenue per visit (ALL and AE) ---------- */
import { U } from '../util.js';
import { state } from '../state.js';
import { TAG2HOSP } from '../domain.js';
import { el } from './dom.js';

export function renderALLAE(){
  const S=state.stats, box=el('allae');
  if(!state.allae.length||!S){ el('secAllae').classList.add('hidden'); return; }
  el('secAllae').classList.remove('hidden');
  const myTag=Object.entries(TAG2HOSP).find(([t,h])=>h===S.hospital)?.[0];
  const inYear=state.allae.filter(f=>f.year===S.year&&f.month>=1&&f.month<=S.mN);
  // hospital's A&E codes = codes in aeClaims tagged with myTag; adult = biggest claims YTD
  const codeTot={};
  for(const f of inYear) for(const [c,v] of Object.entries(f.aeClaims)) if(f.tag[c]===myTag) codeTot[c]=(codeTot[c]||0)+v;
  const codes=Object.keys(codeTot).sort((a,b)=>codeTot[b]-codeTot[a]);
  const adultCode=codes[0], paedCode=codes[1];
  // monthly visits from stats
  const tb=k=>{const b=(S.blocks.taep||[]).find(b=>k.test(b.name));return b?b.years[S.year]:null;};
  const va=tb(/Ενηλίκων/i)||{}, vp=tb(/Παίδων/i)||{};
  let rows='',sumC=0,sumV=0,sumCp=0,sumVp=0;
  for(const f of inYear.sort((a,b)=>a.month-b.month)){
    const mA=f.aeClaims[adultCode], vis=va[f.month-1];
    const mP=paedCode?f.aeClaims[paedCode]:null, visP=vp[f.month-1];
    if(mA&&vis){sumC+=mA;sumV+=vis;}
    if(mP&&visP){sumCp+=mP;sumVp+=visP;}
    rows+=`<tr><td>${U.MONTHS_EL[f.month-1]}</td><td class="r">${U.fmt(mA)} €</td><td class="r">${vis?U.fmt(mA/vis,2)+' €':'—'}</td>
      <td class="r">${mP?U.fmt(mP)+' €':'—'}</td><td class="r">${(mP&&visP)?U.fmt(mP/visP,2)+' €':'—'}</td></tr>`;
  }
  let html=`<div class="grid2"><div class="card"><h3>ΤΑΕΠ — απαιτήσεις ΟΑΥ ανά επίσκεψη</h3>
    <table class="ok"><thead><tr><th>Μήνας</th><th class="r">Ενηλίκων €</th><th class="r">€/επίσκεψη</th><th class="r">Παίδων €</th><th class="r">€/επίσκεψη</th></tr></thead>
    <tbody>${rows}<tr><td><b>Σύνολο</b></td><td class="r"><b>${U.fmt(sumC)} €</b></td><td class="r"><b>${sumV?U.fmt(sumC/sumV,2)+' €':'—'}</b></td>
    <td class="r"><b>${sumCp?U.fmt(sumCp)+' €':'—'}</b></td><td class="r"><b>${sumVp?U.fmt(sumCp/sumVp,2)+' €':'—'}</b></td></tr></tbody></table>
    <div class="note">Απαιτήσεις (claims) προ συμμετοχών· χωρίς το true-up οροφής, που κατανέμεται παγκύπρια. Ο μήνας πληρωμής μπορεί να μην ταυτίζεται απόλυτα με τον μήνα επίσκεψης.</div></div>`;
  // outpatient card
  let opRows='',opSum=0;
  for(const f of inYear.sort((a,b)=>a.month-b.month)){
    const v=f.opFFS[myTag]||0; opSum+=v;
    opRows+=`<tr><td>${U.MONTHS_EL[f.month-1]}</td><td class="r">${U.fmt(v)} €</td></tr>`;
  }
  const opd=S.kpi.opd?.cur;
  html+=`<div class="card"><h3>Εξωτερικά ιατρεία — κλινικά έσοδα ΟΑΥ (FFS)</h3>
    <table class="ok"><thead><tr><th>Μήνας</th><th class="r">€</th></tr></thead><tbody>${opRows}
    <tr><td><b>Σύνολο</b></td><td class="r"><b>${U.fmt(opSum)} €</b></td></tr></tbody></table>
    <div style="margin-top:10px;font-size:14px">≈ <b>${opd?U.fmt(opSum/opd,2):'—'} €</b> ανά επίσκεψη εξωτερικών ιατρείων (${U.fmt(opd)} επισκέψεις)</div>
    <div class="note">Κωδικοί ${myTag||'—'}, λογαριασμοί Fee-for-Service κλινικών ειδικοτήτων — χωρίς φάρμακα, βασικές εξετάσεις, ενδονοσοκομειακά και ΤΑΕΠ. Τα ποσά είναι πληρωμές ΟΑΥ, όχι αριθμός επισκέψεων — τα αρχεία ALL and AE δεν περιέχουν αριθμούς επισκέψεων.</div></div></div>`;
  box.innerHTML=html;
}
