/* ---------- ΓεΣΥ coverage from paid claims (OS) ---------- */
import { U } from '../util.js';
import { state } from '../state.js';
import { computeOS } from '../model/os.js';
import { sumBlocksMonthly } from '../model/blocks.js';
import { C } from './charts.js';
import { el } from './dom.js';

export function renderOS(){
  const S=state.stats, box=el('os');
  if(!state.osClaims.size||!S){ el('secOs').classList.add('hidden'); return; }
  el('secOs').classList.remove('hidden');
  const O=computeOS(S);
  const tb=k=>{const b=(S.blocks.taep||[]).find(b=>k.test(b.name));return b?b.years[S.year]:null;};
  const va=tb(/Ενηλίκων/i)||{};
  const opM=sumBlocksMonthly('out',S.year)||{};
  const covCell=p=>{ if(p==null) return '<td></td>';
    const color=p>=95?C.green:p>=75?'#d9a400':C.neg;
    return `<td><div class="cov"><i style="width:${Math.min(p,100)}%;background:${color}"></i></div></td>`; };
  let rows='',sAe=[0,0],sOp=[0,0];
  for(let i=0;i<S.mN;i++){
    const immature=i>=O.maxM-2;   // payment lag: the newest invoice months are still filling up (A&E lags ~2 runs)
    const hv=va[i], pv=O.ae[i]; const ho=opM[i], po=O.op[i];
    const pctA=(hv&&pv)?100*pv/hv:null, pctO=(ho&&po)?100*po/ho:null;
    if(!immature){ if(hv&&pv){sAe[0]+=pv;sAe[1]+=hv;} if(ho&&po){sOp[0]+=po;sOp[1]+=ho;} }
    rows+=`<tr${immature?' style="color:#9a9b9d"':''}><td>${U.MONTHS_EL[i]}${immature?' <span class="pill">εκκρεμείς πληρωμές</span>':''}</td>
      <td class="r">${U.fmt(hv)}</td><td class="r">${U.fmt(pv)}</td><td class="r">${pctA?U.fmt(pctA,0)+'%':'—'}</td>${immature?'<td></td>':covCell(pctA)}
      <td class="r">${U.fmt(ho)}</td><td class="r">${U.fmt(po)}</td><td class="r">${pctO?U.fmt(pctO,0)+'%':'—'}</td>${immature?'<td></td>':covCell(pctO)}</tr>`;
  }
  const totA=sAe[1]?100*sAe[0]/sAe[1]:null, totO=sOp[1]?100*sOp[0]/sOp[1]:null;
  box.innerHTML=`<table class="ok"><thead>
    <tr><th rowspan="2">Μήνας</th><th colspan="4">ΤΑΕΠ ενηλίκων</th><th colspan="4">Εξωτερικά ιατρεία</th></tr>
    <tr><th class="r">Επισκέψεις</th><th class="r">Πληρωμένες ΓεΣΥ</th><th class="r">Κάλυψη</th><th></th>
        <th class="r">Επισκέψεις</th><th class="r">Πληρωμένες ΓεΣΥ</th><th class="r">Κάλυψη</th><th></th></tr></thead>
    <tbody>${rows}
    <tr><td><b>Πλήρεις μήνες</b></td><td class="r"><b>${U.fmt(sAe[1])}</b></td><td class="r"><b>${U.fmt(sAe[0])}</b></td>
    <td class="r"><b>${totA?U.fmt(totA,0)+'%':'—'}</b></td><td></td>
    <td class="r"><b>${U.fmt(sOp[1])}</b></td><td class="r"><b>${U.fmt(sOp[0])}</b></td><td class="r"><b>${totO?U.fmt(totO,0)+'%':'—'}</b></td><td></td></tr></tbody></table>
    <div class="note" style="margin-top:8px">Μοναδικές επισκέψεις (VISIT ID) πληρωμένων απαιτήσεων, κατά μήνα τιμολόγησης. Εξωτερικά: χωρίς εργαστηριακές/απεικονιστικές ειδικότητες, ώστε να συγκρίνονται με τις επισκέψεις κλινικών. Το υπόλοιπο έως το 100% = ασθενείς εκτός ΓεΣΥ + απορριφθείσες/εκκρεμείς απαιτήσεις + μη τιμολογημένη δραστηριότητα — θέλει ανάλυση, δεν είναι όλο διαρροή. Οι πρόσφατοι μήνες συμπληρώνονται με τα επόμενα αρχεία πληρωμών. Αρχεία πληρωμών: ${state.osFiles.size}${state.osCodes.size?' · κωδικοί: '+[...state.osCodes].join(', '):''}. Το ΤΑΕΠ αφορά μόνο ενήλικες (F1054)· για τα παιδιά χρειάζεται και το αντίστοιχο αρχείο του F1106.</div>`;
}
