/* ---------- ΟΑΥ cross-check section ---------- */
import { U } from '../util.js';
import { state } from '../state.js';
import { computeHIO } from '../model/hio.js';
import { C } from './charts.js';
import { el } from './dom.js';

export function renderHIO(){
  if(!state.isRows.length||!state.stats){el('secHio').classList.add('hidden');return;}
  const S=state.stats,H=computeHIO(state.isRows,S);
  el('secHio').classList.remove('hidden');
  const K=S.kpi;
  const covRow=(label,stat,hio,note)=>{
    if(stat==null||hio==null) return '';
    const pct=100*hio/stat;
    const color=pct>=95&&pct<=110?C.green:pct>=80?'#d9a400':C.neg;
    return `<tr><td>${label}</td><td class="r">${U.fmt(stat)}</td><td class="r">${U.fmt(hio)}</td>
      <td class="r">${U.fmt(pct,0)}%</td><td><div class="cov"><i style="width:${Math.min(pct,100)}%;background:${color}"></i></div></td><td style="font-size:12px;color:#8a8b8d">${note}</td></tr>`;
  };
  const dcTot=K.dc?.cur;
  let html=`<table class="ok"><thead><tr><th>Μέγεθος</th><th class="r">Στατιστικά νοσοκομείου</th><th class="r">Τιμολογημένα (ΟΑΥ)</th><th class="r">Κάλυψη</th><th></th><th>Σχόλιο</th></tr></thead><tbody>`;
  html+=covRow('Νοσηλεία (εισαγωγές ↔ εξιτήρια DRG)',K.adm?.cur,H.inpTot,'Στο κενό: ασθενείς εκτός ΓεΣΥ, διακομιδές μεταξύ κλινικών, ψυχιατρική/παραπληγικό, εκκρεμείς υποβολές.');
  html+=covRow('Ημερήσια νοσηλεία (ασθενείς ↔ day-care claims)',dcTot,H.dcCount,'Ο ΟΑΥ μετρά ευρύτερο φάσμα (π.χ. συνεδρίες βιολογικών ρευματολογίας/γαστρεντερολογίας).');
  html+=covRow('Αιμοκαθάρσεις (συνεδρίες ↔ ποσότητα ZF-041)',K.dial?.cur,H.dialSum,'Καλή ευθυγράμμιση = πλήρης τιμολόγηση του νεφρολογικού.');
  html+='</tbody></table>';
  const chips=[
    ['CMI (θετικά βάρη)',H.cmi?U.fmt(H.cmi,3):'—',''],
    ['Μέση διάρκεια νοσηλείας (ΟΑΥ)',H.alos?U.fmt(H.alos,1)+' ημ.':'—',''],
    ['Επείγουσες εισαγωγές',H.emergPct?U.fmt(H.emergPct,0)+'%':'—',''],
    ['ΟΑΥ Απορρίψεις / Αναθεωρήσεις',U.fmt(H.revRows)+' · '+U.fmt(H.revAmt,0)+' €',
     `ανακτήθηκαν με επανυποβολή ${U.fmt(Math.abs(H.revAmt-H.revOpenAmt),0)} € · ανοιχτά ${U.fmt(H.revOpenCases)} περιστατικά / ${U.fmt(Math.abs(H.revOpenAmt),0)} €`],
  ];
  html+='<div class="kpis" style="margin-top:16px">'+chips.map(c=>`<div class="kpi" style="border-top-color:${C.green}"><div class="label">${c[0]}</div><div class="value" style="font-size:22px">${c[1]}</div>${c[2]?`<div class="note" style="margin-top:4px">${c[2]}</div>`:''}</div>`).join('')+'</div>';
  if(H.tailLag) html+=`<div class="flag info" style="margin-top:12px">Ο τελευταίος μήνας της περιόδου εμφανίζει λιγότερα εξιτήρια στον ΟΑΥ — αναμενόμενο: μέρος των υποβολών γίνεται τους επόμενους μήνες. Η κάλυψη θα ανέβει όταν προστεθεί το επόμενο μηνιαίο αρχείο.</div>`;
  html+=`<div class="note" style="font-size:11.5px;color:#8a8b8d;margin-top:8px">Αρχεία ΟΑΥ: ${[...state.isFiles].map(U.esc).join(' · ')} — καταμέτρηση κατά ημερομηνία εξιτηρίου εντός της περιόδου.</div>`;
  el('hio').innerHTML=html;
}
