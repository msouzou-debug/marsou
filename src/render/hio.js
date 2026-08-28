/* ---------- Διασταύρωση με ΟΑΥ (IS Auditor) ----------
   The comparison only means something for months whose claims have finished
   arriving. A month is submitted over the following two runs — in the real
   files, January's discharges came in as 91 claims in the January run, 996 in
   February and 349 in March — so the headline coverage is computed on the
   mature months alone, and the rest of the period is shown but not counted. */
import { U } from '../util.js';
import { state } from '../state.js';
import { computeHIO } from '../model/hio.js';
import { sumBlocksMonthly } from '../model/blocks.js';
import { C } from './charts.js';
import { el } from './dom.js';

const monthName = (key) => `${U.MONTHS_EL[key % 12]} ${Math.floor(key / 12)}`;

function covBar(pct) {
  if (pct == null) return '<td></td>';
  const color = pct >= 95 && pct <= 110 ? C.green : pct >= 80 ? '#d9a400' : C.neg;
  return `<td><div class="cov"><i style="width:${Math.min(pct, 100)}%;background:${color}"></i></div></td>`;
}

export function renderHIO() {
  if (!state.isRows.length || !state.stats) { el('secHio').classList.add('hidden'); return; }
  const S = state.stats, H = computeHIO(state.isRows, S);
  el('secHio').classList.remove('hidden');
  const K = S.kpi;

  /* ---- per month: what the hospital recorded against what the ΟΑΥ has ---- */
  const admM = sumBlocksMonthly('adm', S.year) || {};
  let rows = '', sStat = 0, sHio = 0;
  for (let i = 0; i < S.mN; i++) {
    const mature = H.maturity.mature[i];
    const stat = admM[i] ?? null, hio = H.byMonth[i];
    const pct = stat ? 100 * hio / stat : null;
    if (mature && stat) { sStat += stat; sHio += hio; }
    rows += `<tr${mature ? '' : ' style="color:#9a9b9d"'}>
      <td>${U.MONTHS_EL[i]}${mature ? '' : ' <span class="pill">εκκρεμείς υποβολές</span>'}</td>
      <td class="r">${U.fmt(stat)}</td><td class="r">${U.fmt(hio)}</td>
      <td class="r">${pct ? U.fmt(pct, 0) + '%' : '—'}</td>${mature ? covBar(pct) : '<td></td>'}
      <td class="r">${U.fmt(H.dcByMonth[i])}</td><td class="r">${U.fmt(H.dialByMonth[i])}</td></tr>`;
  }
  const totPct = sStat ? 100 * sHio / sStat : null;

  let html = `<table class="ok"><thead>
      <tr><th rowspan="2">Μήνας</th><th colspan="4">Νοσηλεία — εισαγωγές ↔ εξιτήρια DRG</th>
        <th class="r" rowspan="2">Ημερήσια<br>(ΟΑΥ)</th><th class="r" rowspan="2">Αιμοκαθάρσεις<br>(ΟΑΥ)</th></tr>
      <tr><th class="r">Στατιστικά</th><th class="r">Τιμολογημένα</th><th class="r">Κάλυψη</th><th></th></tr></thead>
    <tbody>${rows}
      <tr><td><b>Πλήρεις μήνες</b></td><td class="r"><b>${U.fmt(sStat)}</b></td><td class="r"><b>${U.fmt(sHio)}</b></td>
        <td class="r"><b>${totPct ? U.fmt(totPct, 0) + '%' : '—'}</b></td><td></td>
        <td class="r"><b>${U.fmt(H.matureDc)}</b></td><td class="r"><b>${U.fmt(H.matureDial)}</b></td></tr>
    </tbody></table>`;

  /* ---- what is still missing, said plainly ---- */
  if (H.maturity.missingRuns.length) {
    const runs = H.maturity.missingRuns.map(monthName).join(' και ');
    const immature = H.maturity.mature.map((m, i) => (m ? null : U.MONTHS_EL[i])).filter(Boolean).join(', ');
    html += `<div class="flag warn" style="margin-top:12px"><b>Η περίοδος δεν έχει υποβληθεί ολόκληρη.</b>
      Ένας μήνας εξιτηρίων υποβάλλεται στον ΟΑΥ κατά τους δύο επόμενους μήνες. Με τα αρχεία που φορτώθηκαν
      (τελευταία υποβολή ${monthName(H.maturity.lastSubmission)}), οι μήνες ${immature} είναι ακόμη ελλιπείς και
      <b>δεν προσμετρώνται</b> στην κάλυψη. Χρειάζονται τα IS Auditor ${runs}.</div>`;
  }

  /* ---- period totals, on the mature months only ---- */
  const covRow = (label, stat, hio, note) => {
    if (stat == null || hio == null) return '';
    const pct = 100 * hio / stat;
    return `<tr><td>${label}</td><td class="r">${U.fmt(stat)}</td><td class="r">${U.fmt(hio)}</td>
      <td class="r">${U.fmt(pct, 0)}%</td>${covBar(pct)}<td style="font-size:12px;color:#8a8b8d">${note}</td></tr>`;
  };
  /* the hospital's own figures have to be cut to the same months */
  const shareOfPeriod = (total, monthly) => {
    if (total == null) return null;
    const all = Object.values(monthly || {}).reduce((a, b) => a + b, 0);
    if (!all) return null;
    const part = Object.entries(monthly).reduce((a, [mi, v]) => a + (H.maturity.mature[+mi] ? v : 0), 0);
    return total * part / all;
  };
  const dcM = sumBlocksMonthly('dcm', S.year);
  if (H.matureCount) {
    const months = H.maturity.mature.map((m, i) => (m ? U.MONTHS_EL[i] : null)).filter(Boolean).join(', ');
    html += `<h3 class="clinic-h3">Κάλυψη στους πλήρεις μήνες (${months})</h3>
      <table class="ok"><thead><tr><th>Μέγεθος</th><th class="r">Στατιστικά νοσοκομείου</th><th class="r">Τιμολογημένα (ΟΑΥ)</th>
        <th class="r">Κάλυψη</th><th></th><th>Σχόλιο</th></tr></thead><tbody>`;
    html += covRow('Νοσηλεία (εισαγωγές ↔ εξιτήρια DRG)', sStat || null, sHio,
      'Στο κενό: ασθενείς εκτός ΓεΣΥ, διακομιδές μεταξύ κλινικών, ψυχιατρική/παραπληγικό, απορριφθείσες υποβολές.');
    html += covRow('Ημερήσια νοσηλεία (ασθενείς ↔ day-care claims)', Math.round(shareOfPeriod(K.dc?.cur, dcM)), H.matureDc,
      'Ο ΟΑΥ μετρά ευρύτερο φάσμα (π.χ. συνεδρίες βιολογικών ρευματολογίας/γαστρεντερολογίας).');
    html += covRow('Αιμοκαθάρσεις (συνεδρίες ↔ ποσότητα ZF-041)',
      K.dial?.cur == null ? null : Math.round(K.dial.cur * H.matureCount / S.mN), H.matureDial,
      'Καλή ευθυγράμμιση = πλήρης τιμολόγηση του νεφρολογικού. Οι μήνες του νοσοκομείου αναλογικά.');
    html += '</tbody></table>';
  }

  const chips = [
    ['CMI (θετικά βάρη)', H.cmi ? U.fmt(H.cmi, 3) : '—', ''],
    ['Μέση διάρκεια νοσηλείας (ΟΑΥ)', H.alos ? U.fmt(H.alos, 1) + ' ημ.' : '—', ''],
    ['Επείγουσες εισαγωγές', H.emergPct ? U.fmt(H.emergPct, 0) + '%' : '—', ''],
    ['ΟΑΥ Απορρίψεις / Αναθεωρήσεις', U.fmt(H.revRows) + ' · ' + U.fmt(H.revAmt, 0) + ' €',
     `ανακτήθηκαν με επανυποβολή ${U.fmt(Math.abs(H.revAmt - H.revOpenAmt), 0)} € · ανοιχτά ${U.fmt(H.revOpenCases)} περιστατικά / ${U.fmt(Math.abs(H.revOpenAmt), 0)} €`],
  ];
  html += '<div class="kpis" style="margin-top:16px">' + chips.map(c =>
    `<div class="kpi" style="border-top-color:${C.green}"><div class="label">${c[0]}</div>
      <div class="value" style="font-size:22px">${c[1]}</div>${c[2] ? `<div class="note" style="margin-top:4px">${c[2]}</div>` : ''}</div>`).join('') + '</div>';

  html += `<div class="note" style="font-size:11.5px;color:#8a8b8d;margin-top:8px">Αρχεία ΟΑΥ: ${[...state.isFiles].map(U.esc).join(' · ')}
    — καταμέτρηση κατά ημερομηνία εξιτηρίου εντός της περιόδου, ανεξάρτητα από τον μήνα υποβολής.
    Τα δύο συστήματα μετρούν διαφορετικούς πληθυσμούς· οι αποκλίσεις είναι ενδείξεις για διερεύνηση, όχι αυτόματα «χαμένα έσοδα».</div>`;
  el('hio').innerHTML = html;
}
