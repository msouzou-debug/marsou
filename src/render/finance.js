/* ---------- «Οικονομικά αποτελέσματα» ----------
   The hospital-level financial picture that today lives on the last slides of
   the manual deck: the P&L, the ΟΑΥ revenue split by stream, and the ΥΓΟΣ
   services that are funded outside the per-case streams. Straight from the
   workbook — nothing here is recomputed. */
import { U } from '../util.js';
import { state } from '../state.js';
import { pctChange } from '../model/clinic.js';
import { C, barChartPaired } from './charts.js';
import { el } from './dom.js';

const money = (v) => (v == null ? '—' : U.fmt(v, 0) + ' €');

function delta(d) {
  if (d == null) return '—';
  const cls = d > 1 ? 'up' : d < -1 ? 'down' : 'flat';
  return `<span class="delta ${cls}">${d > 1 ? '▲ ' : d < -1 ? '▼ ' : '≈ '}${U.pct(d)}</span>`;
}

/* A percentage against a negative or zero base says nothing — «-2.106%» on a
   deficit that turned into a surplus is worse than no figure. Show the move in
   euro instead. */
function move(cur, prev) {
  if (cur == null || prev == null) return '—';
  if (prev > 0) return delta(pctChange(cur, prev));
  const d = cur - prev;
  return `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d >= 0 ? '+' : ''}${U.fmt(d, 0)} €</span>`;
}

export function renderFinance() {
  const S = state.stats, fin = S?.fin;
  if (!fin || (!fin.pl && !fin.revenue)) { el('secFinance').classList.add('hidden'); return; }
  el('secFinance').classList.remove('hidden');
  const y = S.year;

  let html = '';

  if (fin.revenue?.totals) {
    const t = fin.revenue.totals;
    const tile = (label, k, accent) => {
      const cur = t.cur[k], prev = t.prev[k];
      return `<div class="kpi"${accent ? ` style="border-top-color:${C.green}"` : ''}>
        <div class="label">${label}</div><div class="value" style="font-size:${accent ? 30 : 24}px">${money(cur)}</div>
        <div class="subline">${delta(pctChange(cur, prev))} <span style="color:#8a8b8d">(${money(prev)} το ${y - 1})</span></div></div>`;
    };
    html += `<div class="kpis">
      ${tile('Σύνολο εσόδων ΟΑΥ ανά κλινική', 'total', true)}
      ${tile('Ενδονοσοκομειακή φροντίδα', 'inpatient')}
      ${tile('Εξωτερικά ιατρεία', 'outpatient')}
      ${tile('Ημερήσια νοσηλεία', 'daycare')}
    </div>
    <div class="note">Άθροισμα των κλινικών του φύλλου «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ», πριν από τις λογιστικές προσαρμογές και χωρίς το ΤΑΕΠ.</div>`;
  }

  if (fin.pl) {
    const rows = fin.pl.map(l => l.heading
      ? `<tr class="plhead"><td colspan="4">${U.esc(l.label)}</td></tr>`
      : `<tr${l.strong ? ' class="plstrong"' : ''}><td>${U.esc(l.label)}</td><td class="r">${money(l.cur)}</td><td class="r">${money(l.prev)}</td>
         <td class="r">${move(l.cur, l.prev)}</td></tr>`).join('');
    html += `<div class="grid2" style="margin-top:20px">
      <div class="card"><h3>Λογαριασμός αποτελεσμάτων (P&amp;L)</h3>
        <div class="scrollx"><table class="ok pl"><thead><tr><th></th><th class="r">${y}</th><th class="r">${y - 1}</th><th class="r">Δ%</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <div class="note">Περίοδος Ιανουαρίου–${U.MONTHS_EL[S.mN - 1]}, όπως καταχωρίστηκε στο φύλλο «P&amp;L» του αρχείου.</div></div>`;

    if (fin.revenue?.totals) {
      const t = fin.revenue.totals;
      html += `<div class="card"><h3>Έσοδα ΟΑΥ ανά ροή</h3>
        ${barChartPaired([
          { name: 'Ενδονοσ.', cur: t.cur.inpatient, prev: t.prev.inpatient },
          { name: 'Εξωτερικά', cur: t.cur.outpatient, prev: t.prev.outpatient },
          { name: 'Ημερήσια', cur: t.cur.daycare, prev: t.prev.daycare },
        ], { curLabel: String(y), prevLabel: String(y - 1) })}</div>`;
    }
    html += '</div>';
  }

  if (fin.services?.rows.length) {
    const years = fin.services.years;
    const rows = fin.services.rows.map(r => `<tr${r.total ? ' style="font-weight:700"' : ''}>
      <td>${U.esc(r.name)}</td>${years.map(y2 => `<td class="r">${money(r.vals[y2])}</td>`).join('')}</tr>`).join('');
    html += `<div class="card" style="margin-top:20px"><h3>Υπηρεσίες Γενικού Οικονομικού Συμφέροντος (ΥΓΟΣ)</h3>
      <div class="scrollx"><table class="ok"><thead><tr><th>Υπηρεσία</th>${years.map(y2 => `<th class="r">${y2}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="note">Χρηματοδοτούνται εκτός των ανά περιστατικό ροών του ΟΑΥ και δεν κατανέμονται ανά κλινική.</div></div>`;
  }

  el('finance').innerHTML = html;
}
