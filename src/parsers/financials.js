/* ---------- financial sheets of the stats workbook ----------
   The same monthly workbook carries the ΟΑΥ revenue per clinic and the
   hospital's P&L. This is the authoritative per-clinic € figure: it is already
   split into inpatient / outpatient / day-care and already compared with the
   same period of the previous year. Nothing here is apportioned or estimated.

     ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ   Κλινική | INPATIENT OUTPATIENT DAY CARE TOTAL  (× 2 έτη)
     P&L               ΕΣΟΔΑ / ΕΞΟΔΑ, δύο στήλες ετών
     ΥΓΟΣ&ΤΑΕΠ        Υπηρεσίες Γενικού Οικονομικού Συμφέροντος, 3 έτη

   From 06.2026 the hospital splits the per-clinic revenue across three sheets,
   one per stream, and «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ» holds a historical monthly matrix
   instead. Both shapes are read: the combined sheet first, the three streams
   when it yields nothing.
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

/* ---------- the 06.2026 shape: one sheet per revenue stream ----------
   ΕΝΔΟΝΟΣ-ΚΛΙΝΙΚΕΣ · ΕΞΩΝΟΣ-ΚΛΙΝΙΚΕΣ · ΗΜΕΡΗΣΙΕΣ ΦΡ, each

     ΚΛΙΝΙΚΗ/ΤΜΗΜΑ | 2026 Ιανουάριος - Ιούνιος € | 2025 Ιανουάριος - Ιούνιος € | …
     …clinics…
     ΣΥΝΟΛΟ        | …                           | …

   The historical monthly matrices sit far to the right of the same sheets, so
   only the first block — the one whose first column is the clinic — is read. */
function streamByClinic(ws) {
  if (!ws) return null;
  const g = grid(ws);
  for (let r = 0; r < g.length; r++) {
    const row = g[r] || [];
    if (!/^(ΚΛΙΝΙΚΗ|CLINIC)/i.test(String(row[0] ?? '').trim())) continue;
    const years = [];
    row.forEach((v, c) => {
      if (c === 0) return;
      const m = String(v ?? '').match(/(20\d\d)/);
      if (m) years.push({ c, y: +m[1] });
    });
    if (years.length < 2 || years[0].y !== years[1].y + 1) continue;
    const out = new Map();
    let totals = null;
    for (let rr = r + 1; rr < g.length; rr++) {
      const label = typeof g[rr]?.[0] === 'string' ? g[rr][0].trim() : '';
      if (!label) continue;
      const cur = cash(g[rr][years[0].c]), prev = cash(g[rr][years[1].c]);
      if (cur == null && prev == null) continue;
      if (isTotalRow(label)) { totals = { cur, prev }; break; }
      out.set(label, { cur, prev });
    }
    if (out.size) return { rows: out, totals };
  }
  return null;
}

const STREAM_SHEETS = [
  ['inpatient', /^ΕΝΔΟΝΟΣ[\s-]*ΚΛΙΝΙΚΕΣ\s*$/i],
  ['outpatient', /^ΕΞΩΝΟΣ[\s-]*ΚΛΙΝΙΚΕΣ\s*$/i],
  ['daycare', /^ΗΜΕΡΗΣΙΕΣ\s*ΦΡ\s*$/i],
];

/* The «(ΛΚ)» copies of the same three sheets are a second set of books; the
   anchored patterns above leave them alone. */
function revenueFromStreams(wb) {
  const streams = {};
  for (const [key, re] of STREAM_SHEETS) {
    const s = streamByClinic(findSheet(wb, re));
    if (s) streams[key] = s;
  }
  const keys = Object.keys(streams);
  if (!keys.length) return null;

  const names = [];
  for (const key of keys) for (const name of streams[key].rows.keys()) if (!names.includes(name)) names.push(name);
  const blank = () => ({ inpatient: null, outpatient: null, daycare: null, total: 0 });
  const rows = names.map(name => {
    const cur = blank(), prev = blank();
    for (const key of keys) {
      const v = streams[key].rows.get(name);
      if (!v) continue;
      cur[key] = v.cur; prev[key] = v.prev;
      cur.total += v.cur ?? 0; prev.total += v.prev ?? 0;
    }
    return { name, cur, prev };
  /* a clinic that is listed in all three sheets with nothing in any of them is
     not a clinic of this period */
  }).filter(r => r.cur.total || r.prev.total);

  const totals = { cur: blank(), prev: blank() };
  for (const key of keys) {
    const t = streams[key].totals;
    if (!t) continue;
    totals.cur[key] = t.cur; totals.prev[key] = t.prev;
    totals.cur.total += t.cur ?? 0; totals.prev.total += t.prev ?? 0;
  }
  return { rows, totals: totals.cur.total ? totals : null };
}

/* P&L: label in column A, current year and previous year in the two numeric
   columns. Section headings (ΕΣΟΔΑ / ΕΞΟΔΑ) carry no figures. */
/* A column heading *starts* with its year («2026   Ιανουάριος - Ιούνιος   €»);
   a title ends with one («ΛΟΓΑΡΙΑΣΜΟΣ ΑΠΟΤΕΛΕΣΜΑΤΩΝ … ΙΟΥΝΙΟΣ 2026»). The
   distinction matters from 06.2026, where the sheet carries a second copy of
   the whole table for the previous quarter beside the first: two titles
   ending in a year on one row, which a looser test read as the two year
   columns and pointed the parser at the labels. */
const yearHeading = (v) => {
  if (typeof v === 'number') return (v >= 2015 && v <= 2035) ? v : null;
  const m = String(v ?? '').trim().match(/^(20\d\d)\b/);
  return m ? +m[1] : null;
};

function profitAndLoss(ws) {
  const g = grid(ws);
  let cCur = null, cPrev = null;
  for (let r = 0; r < Math.min(g.length, 8) && cCur == null; r++) {
    const years = [];
    (g[r] || []).forEach((v, c) => { const y = yearHeading(v); if (y != null) years.push({ c, y }); });
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
  /* the combined sheet up to 03.2026, the three per-stream sheets from 06.2026 */
  const revenue = (wsRev ? revenueByClinic(wsRev) : null) ?? revenueFromStreams(wb);
  const pl = wsPL ? profitAndLoss(wsPL) : null;
  const services = wsUgos ? ugos(wsUgos) : null;
  if (!revenue && !pl && !services) return null;
  return { revenue, pl, services };
}
