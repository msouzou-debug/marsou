/* ---------- financial sheets of the stats workbook ----------
   The same monthly workbook carries the ΟΑΥ revenue per clinic and the
   hospital's P&L. This is the authoritative per-clinic € figure: it is already
   split into inpatient / outpatient / day-care and already compared with the
   same period of the previous year. Nothing here is apportioned or estimated.

     ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ   Κλινική | INPATIENT OUTPATIENT DAY CARE TOTAL  (× 2 έτη)
     P&L               ΕΣΟΔΑ / ΕΞΟΔΑ, δύο στήλες ετών
     ΥΓΟΣ&ΤΑΕΠ        Υπηρεσίες Γενικού Οικονομικού Συμφέροντος, 3 έτη
*/
import { U } from '../util.js';
import { grid, findSheet } from '../workbook.js';

const isTotalRow = (label) => /^ΣΥΝΟΛ/.test(U.deacc(label).toUpperCase().trim());

/* U.numRaw turns an empty cell into 0 (Number(null) === 0), which would make
   every section heading of the P&L look like a zero. On these sheets a figure
   is always a real number, so anything else is «no value». */
const cash = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/* the header row that carries «INPATIENT … OUTPATIENT … DAY CARE … TOTAL»,
   twice: once for the current period and once for the previous one */
function revenueLayout(g) {
  for (let r = 0; r < Math.min(g.length, 12); r++) {
    const row = (g[r] || []).map(v => String(v ?? '').toUpperCase().trim());
    const inpatient = [], outpatient = [], daycare = [], total = [];
    row.forEach((v, c) => {
      if (v === 'INPATIENT') inpatient.push(c);
      else if (v === 'OUTPATIENT') outpatient.push(c);
      else if (v === 'DAY CARE' || v === 'DAYCARE') daycare.push(c);
      else if (v === 'TOTAL') total.push(c);
    });
    if (inpatient.length >= 2 && outpatient.length >= 2 && daycare.length >= 2) {
      return {
        headerRow: r,
        cur: { inpatient: inpatient[0], outpatient: outpatient[0], daycare: daycare[0], total: total[0] },
        prev: { inpatient: inpatient[1], outpatient: outpatient[1], daycare: daycare[1], total: total[1] },
      };
    }
  }
  return null;
}

function revenueByClinic(ws) {
  const g = grid(ws);
  const layout = revenueLayout(g);
  if (!layout) return null;
  const pick = (row, cols) => {
    const inpatient = cash(row[cols.inpatient]);
    const outpatient = cash(row[cols.outpatient]);
    const daycare = cash(row[cols.daycare]);
    const total = cols.total != null ? cash(row[cols.total]) : null;
    return {
      inpatient, outpatient, daycare,
      total: total != null ? total : (inpatient || 0) + (outpatient || 0) + (daycare || 0),
    };
  };
  const rows = [];
  let totals = null;
  for (let r = layout.headerRow + 1; r < g.length; r++) {
    const row = g[r] || [];
    const label = typeof row[0] === 'string' ? row[0].trim() : '';
    if (!label) continue;
    const cur = pick(row, layout.cur), prev = pick(row, layout.prev);
    if (cur.inpatient == null && cur.outpatient == null && cur.daycare == null && cur.total == null) continue;
    /* the first ΣΥΝΟΛΟ closes the clinic list; what follows are pharmacy lines
       and accounting adjustments, which belong to no clinic */
    if (isTotalRow(label)) { if (!totals) totals = { cur, prev }; break; }
    rows.push({ name: label, cur, prev });
  }
  return { rows, totals };
}

/* P&L: label in column A, current year and previous year in the two numeric
   columns. Section headings (ΕΣΟΔΑ / ΕΞΟΔΑ) carry no figures. */
function profitAndLoss(ws) {
  const g = grid(ws);
  let cCur = null, cPrev = null;
  for (let r = 0; r < Math.min(g.length, 8) && cCur == null; r++) {
    const years = [];
    (g[r] || []).forEach((v, c) => { const n = U.numRaw(String(v).replace(/[^\d]/g, '')); if (n >= 2015 && n <= 2035) years.push({ c, n }); });
    if (years.length >= 2) { cCur = years[0].c; cPrev = years[1].c; }
  }
  if (cCur == null) return null;
  const lines = [];
  for (const row of g) {
    const label = typeof row?.[0] === 'string' ? row[0].trim() : '';
    if (!label || label.startsWith('¹') || label.startsWith('²')) continue;
    const cur = cash(row[cCur]), prev = cash(row[cPrev]);
    /* A row with no figures is a section label — unless it carries a footnote
       marker, which marks a revenue line that simply had nothing this period
       («ΥΠΑΣ ΟΑΥ²»). The sheet's own title is longer than any section label. */
    const heading = cur == null && prev == null && !/[¹²³]/.test(label);
    if (heading && label.length > 30) continue;
    lines.push({ label, cur, prev, heading, strong: /^(ΣΥΝΟΛΟ|Σύνολο|ΠΛΕΟΝΑΣΜΑ|ΛΕΙΤΟΥΡΓΙΚΟ)/.test(label) });
  }
  /* a heading with nothing under it is noise */
  return lines.filter((l, i) => !l.heading || lines.slice(i + 1, i + 3).some(x => !x.heading));
}

/* ΥΓΟΣ: services funded outside the per-case ΟΑΥ streams, three years wide.
   A second, unrelated table («Αρμόδιες Αρχές / Δημόσια Υγεία») sits to the right
   with its own year columns, and working notes sit underneath — so only the
   first run of year columns is read, and only down to the first ΣΥΝΟΛΟ. */
function ugos(ws) {
  const g = grid(ws);
  const years = [];
  (g[0] || []).forEach((v, c) => {
    const n = cash(v);
    if (n >= 2015 && n <= 2035 && (!years.length || c === years[years.length - 1].c + 1)) years.push({ c, y: n });
  });
  if (years.length < 2) return null;
  const rows = [];
  for (let r = 1; r < g.length; r++) {
    const label = typeof g[r]?.[0] === 'string' ? g[r][0].trim() : '';
    if (!label) continue;
    const vals = {};
    for (const { c, y } of years) { const v = cash(g[r][c]); if (v != null) vals[y] = v; }
    if (!Object.keys(vals).length) continue;
    const total = isTotalRow(label);
    rows.push({ name: label, vals, total });
    if (total) break;
  }
  return rows.length ? { years: years.map(y => y.y), rows } : null;
}

export function parseFinancials(wb) {
  const wsRev = findSheet(wb, /ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ/i);
  const wsPL = findSheet(wb, /^P\s*&\s*L\s*$/i);
  const wsUgos = findSheet(wb, /ΥΓΟΣ/i);
  const revenue = wsRev ? revenueByClinic(wsRev) : null;
  const pl = wsPL ? profitAndLoss(wsPL) : null;
  const services = wsUgos ? ugos(wsUgos) : null;
  if (!revenue && !pl && !services) return null;
  return { revenue, pl, services };
}
