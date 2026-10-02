// Capitation fees workbook builder (OKYpY primary care).
// Pure logic: takes parsed capitation reports, parsed remittances (SRA), the roster
// and last month's history, and returns an ExcelJS workbook with live formulas.
// Every formula cell also carries a cached result so the file reads correctly
// before Excel recalculates it.

const SHEETS = { NAM: 'ΠΙΠ ΝΑΜ ΙΙΙ', CHILD: 'ΠΙΠ ΑΛΛΟΙ', ADULT: 'ΠΙ ΕΝΗΛΙΚΩΝ' };
const SHEET_ORDER = ['NAM', 'CHILD', 'ADULT'];
const DEFAULT_CFG = {
  bands: {
    NAM: { lower: [0, 300, 500], rate: [0.094, 0.15, 0.20] },
    CHILD: { lower: [0, 300, 500], rate: [0.094, 0.18, 0.25] },
    ADULT: { lower: [0, 500, 750, 1500, 2000], rate: [0.094, 0.15, 0.27, 0.40, 0.45] },
  },
  namProviders: ['F1050'],
  payLag: 2,
};
const BAND_COLS = ['N', 'O', 'P', 'Q', 'R'];
const ROSTER_HEAD = ['Κωδικός ιατρού', 'Ονοματεπώνυμο', 'Κατηγορία', 'ΑΚΑ', 'ΑΔΤ', 'ΠΕ/ΠΠ', 'Κέντρο Υγείας',
  'Κίνητρο απομακρυσμένων', 'Επίδομα υπευθύνου ΚΥ', 'Νέα ποιοτικά κίνητρα', 'Τύπος υπερωρίας', 'Σημειώσεις'];
const CATS = ['ΔΥ', 'ΟΚΥΠΥ', 'ΑΓΟΡΑ ΥΠΗΡΕΣΙΩΝ', 'ΠΑΡΑΙΤΗΣΕΙΣ_ΑΦΥΠΗ'];
const OUT_OF_ROSTER = 'ΕΚΤΟΣ ΜΗΤΡΩΟΥ';
const TOL = 0.005;

const q = s => `'${s}'`;
const r2 = v => Math.round(v * 100) / 100;
const codeOf = s => String(s || '').trim().split(/\s+/)[0];
const isAdultList = rows => rows.some(r => /^(18|51|71)\b/.test(r.age));

function classifyRa(desc) {
  let m = desc.match(/KPIs?-[\d-]*?-?(ADULT|CHILD)-(D\d+)/i);
  if (m) return { cat: 'KPI', list: m[1].toUpperCase(), doctor: m[2] };
  if (/^PD\s*-\s*HCP/i.test(desc)) return { cat: 'HCP' };
  if (/VBM/i.test(desc)) return { cat: 'VBM' };
  if (/^PD\s*-\s*VBR/i.test(desc)) return { cat: 'VBR' };
  if (/^PD\s*-\s*OOH/i.test(desc)) return { cat: 'OOH' };
  if (/^PD\b/i.test(desc)) return { cat: 'PD-ΑΛΛΟ' };
  return null; // not primary care, ignored
}

// Band split of one list: same rule as the July workbook.
function bandSplit(L, M, band) {
  const out = [];
  for (let i = 0; i < band.lower.length; i++) {
    const hi = i < band.lower.length - 1 ? Math.min(L, band.lower[i + 1]) : L;
    out.push(Math.max(0, hi - band.lower[i]) * M * band.rate[i]);
  }
  return out;
}

function prepare({ capFiles, raFiles, roster, history, cfg }) {
  cfg = cfg || DEFAULT_CFG;
  const log = [];
  const periods = [...new Set(capFiles.filter(f => f.month).map(f => f.year + '-' + f.month))];
  if (periods.length !== 1) throw new Error('Οι αναφορές κατά κεφαλήν πρέπει να αφορούν ένα μήνα. Βρέθηκαν: ' + (periods.join(', ') || 'κανένας'));
  const [year, month] = periods[0].split('-').map(Number);
  const days = new Date(year, month, 0).getDate();

  // Invoices, deduplicated by EBS id
  const invoices = [], seen = new Map(), duplicates = [], empty = [];
  for (const f of capFiles) {
    if (!f.invoices.length) empty.push(f.file);
    for (const inv of f.invoices) {
      if (seen.has(inv.id)) { duplicates.push({ id: inv.id, file: f.file, first: seen.get(inv.id) }); continue; }
      seen.set(inv.id, f.file);
      invoices.push({ ...inv, file: f.file, providerCode: codeOf(inv.provider) });
    }
  }

  // Remittance lines relevant to primary care
  const ra = [];
  for (const f of raFiles) for (const l of f.lines) {
    const c = classifyRa(l.desc);
    if (!c) continue;
    ra.push({ file: f.file, supplier: f.supplier, payNo: f.payNo, payDate: f.payDate, ...l, ...c,
      invKey: /^\d+$/.test(l.invNo) ? Number(l.invNo) : l.invNo });
  }
  const kpi = new Map();
  for (const l of ra) if (l.cat === 'KPI') { const k = l.doctor + '|' + l.list; kpi.set(k, (kpi.get(k) || 0) + l.paid); }

  // Doctor list blocks
  const blocks = [], kpiUsed = new Set();
  for (const inv of invoices) for (const d of inv.doctors) {
    const list = isAdultList(d.rows) ? 'ADULT' : 'CHILD';
    const key = list === 'CHILD' && cfg.namProviders.includes(inv.providerCode) ? 'NAM' : list;
    const k = d.code + '|' + list;
    const first = !kpiUsed.has(k); kpiUsed.add(k);
    const H = d.amount, J = first ? (kpi.get(k) || 0) : 0, K = H + J;
    const L = d.rows.reduce((a, r) => a + r.days, 0) / days;
    const M = L ? K / L : 0;
    const bands = bandSplit(L, M, cfg.bands[key]);
    blocks.push({ inv, d, list, key, first, H, J, K, L, M, bands, S: bands.reduce((a, b) => a + b, 0) });
  }

  // Doctors (unique codes)
  const rosterBy = new Map(roster.map(r => [r.code, r]));
  const docs = new Map();
  for (const b of blocks) {
    const x = docs.get(b.d.code) || { code: b.d.code, name: b.d.name, total: 0 };
    x.total += b.S; docs.set(b.d.code, x);
  }
  for (const x of docs.values()) x.cat = rosterBy.has(x.code) ? rosterBy.get(x.code).cat : OUT_OF_ROSTER;

  const kpiNoList = ra.filter(l => l.cat === 'KPI' && !blocks.some(b => b.d.code === l.doctor && b.list === l.list));
  const rosterNoCap = roster.filter(r => !docs.has(r.code));
  const outOfRoster = [...docs.values()].filter(x => x.cat === OUT_OF_ROSTER);
  log.push(`${capFiles.length} αναφορές, ${invoices.length} τιμολόγια, ${blocks.length} λίστες ιατρών, ${docs.size} ιατροί.`);
  return { cfg, year, month, days, invoices, blocks, ra, docs, roster, rosterBy, history: history || [],
    duplicates, empty, kpiNoList, rosterNoCap, outOfRoster, log };
}

// ---------- workbook styling helpers ----------
const BLUE = 'FF069FEC', DEEP = 'FF1B75BB', GREY = 'FFEAEAEA', TEXT = 'FF58595B', INPUT = 'FFFFF2CC';
const FONT = { name: 'Arial', size: 10, color: { argb: TEXT } };
const NUM = '#,##0.00';
function head(ws, row, cols) {
  for (const c of cols) {
    const cell = ws.getCell(c + row);
    cell.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  }
}
function f(ws, addr, formula, result, fmt = NUM) {
  const c = ws.getCell(addr);
  c.value = { formula, result: typeof result === 'number' ? (isFinite(result) ? result : 0) : result };
  if (fmt) c.numFmt = fmt;
  return c;
}
function v(ws, addr, value, fmt) { const c = ws.getCell(addr); c.value = value; if (fmt) c.numFmt = fmt; return c; }
function totalStyle(ws, row, cols) {
  for (const c of cols) { const x = ws.getCell(c + row); x.font = { ...FONT, bold: true }; x.border = { top: { style: 'thin' }, bottom: { style: 'double' } }; }
}
function widths(ws, w) { Object.entries(w).forEach(([c, n]) => { ws.getColumn(c).width = n; }); }
function toDate(s) { const m = String(s).match(/(\d\d)\/(\d\d)\/(\d{4})/); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : s; }

// ---------- sheet writers ----------
function writeAll(ws, M) {
  v(ws, 'A1', 'Μήνας:'); v(ws, 'B1', M.month); v(ws, 'A2', 'Έτος:'); v(ws, 'B2', M.year);
  const hdr = { A: 'ID Τιμολογίου EBS', B: 'Παροχέας Υγείας', C: 'Τύπος Τιμολογίου / Ηλικίες', D: 'Σχόλια', E: 'Ημερομηνία / Ημερήσια αμοιβή',
    F: 'Αριθμός Δικαιούχων', G: 'Συνολικός Αρ. Ημερών', H: 'Αμοιβή από ΟΑΥ', I: 'Αρχείο', J: 'Γραμμή', K: 'Φύλλο υπολογισμού' };
  Object.entries(hdr).forEach(([c, t]) => v(ws, c + 3, t)); head(ws, 3, Object.keys(hdr));
  let r = 4;
  for (const inv of M.invoices) {
    v(ws, 'A' + r, inv.id); v(ws, 'B' + r, inv.provider); v(ws, 'C' + r, inv.type); v(ws, 'E' + r, toDate(inv.date), 'dd/mm/yyyy');
    v(ws, 'H' + r, inv.amount, NUM); v(ws, 'I' + r, inv.file); v(ws, 'J' + r, 'ΠΑΡΟΧΟΣ');
    ws.getRow(r).font = { ...FONT, bold: true }; r++;
    for (const d of inv.doctors) {
      const b = M.blocks.find(x => x.d === d);
      v(ws, 'B' + r, d.name); v(ws, 'C' + r, 'Ηλικίες'); v(ws, 'H' + r, d.amount, NUM); v(ws, 'J' + r, 'ΙΑΤΡΟΣ'); v(ws, 'K' + r, SHEETS[b.key]); r++;
      for (const a of d.rows) {
        v(ws, 'C' + r, a.age); v(ws, 'D' + r, a.comment); v(ws, 'E' + r, Number(a.rate), '0.000'); v(ws, 'F' + r, a.count);
        v(ws, 'G' + r, a.days); v(ws, 'H' + r, a.amount, NUM); v(ws, 'J' + r, 'ΗΛΙΚΙΑ'); r++;
      }
    }
  }
  widths(ws, { A: 12, B: 46, C: 16, D: 22, E: 12, F: 11, G: 11, H: 13, I: 30, J: 10, K: 14 });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

function writeCalc(ws, key, M) {
  const band = M.cfg.bands[key], nb = band.lower.length, cols = BAND_COLS.slice(0, nb);
  v(ws, 'A1', 'Μήνας:'); v(ws, 'B1', M.month); v(ws, 'A2', 'Έτος:'); v(ws, 'B2', M.year);
  v(ws, 'C1', 'Ημέρες μήνα:'); f(ws, 'D1', 'DAY(EOMONTH(DATE(B2,B1,1),0))', M.days, '0');
  v(ws, 'M1', 'Κλίμακα'); v(ws, 'M2', 'Από (μέσος όρος εγγραφών)'); v(ws, 'M3', 'Ποσοστό');
  cols.forEach((c, i) => {
    const next = cols[i + 1];
    const lbl = next ? `${band.lower[i] === 0 ? 0 : band.lower[i] + 1}-${band.lower[i + 1]}` : `>${band.lower[i]}`;
    f(ws, c + '1', next ? `IF(${c}2=0,"0",TEXT(${c}2+1,"0"))&"-"&TEXT(${next}2,"0")` : `">"&TEXT(${c}2,"0")`, lbl, null);
    const lo = v(ws, c + '2', band.lower[i], '#,##0'), rt = v(ws, c + '3', band.rate[i], '0.0%');
    [lo, rt].forEach(x => { x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT } }; });
  });
  const hdr = { A: 'ID Τιμολογίου EBS', B: 'Παροχέας Υγείας', C: 'Τύπος Τιμολογίου', E: 'Ημερομηνία Τιμολογίου', H: 'Αμοιβή από ΟΑΥ',
    J: 'KPIs (SRA)', K: 'ΣΥΝΟΛΙΚΗ ΑΜΟΙΒΗ', L: 'ΜΕΣΟΣ ΟΡΟΣ ΕΓΓΡΑΦΩΝ', M: 'ΜΕΣΟΣ ΟΡΟΣ CAP FEES', S: 'TOTAL', T: 'Κωδ. ιατρού', U: 'Λίστα', V: 'Σημείωση' };
  Object.entries(hdr).forEach(([c, t]) => v(ws, c + 4, t));
  cols.forEach((c, i) => f(ws, c + 4, `${c}1`, ws.getCell(c + '1').value.result, null));
  head(ws, 4, [...'ABCDEFGHIJKLM', ...BAND_COLS, 'S', 'T', 'U', 'V']);

  const blocks = M.blocks.filter(b => b.key === key);
  let r = 5, lastInv = null; const first = r;
  for (const b of blocks) {
    if (b.inv !== lastInv) {
      lastInv = b.inv;
      v(ws, 'A' + r, b.inv.id); v(ws, 'B' + r, b.inv.provider); v(ws, 'C' + r, b.inv.type);
      v(ws, 'E' + r, toDate(b.inv.date), 'dd/mm/yyyy'); v(ws, 'H' + r, b.inv.amount, NUM);
      ws.getRow(r).font = { ...FONT, bold: true }; r++;
    }
    const n = b.d.rows.length, R = r; b.row = R; b.sheet = SHEETS[key];
    v(ws, 'B' + R, b.d.name); v(ws, 'C' + R, 'Ηλικίες'); v(ws, 'D' + R, 'Σχόλια'); v(ws, 'E' + R, 'Ημερήσια Κατά Κεφαλήν Αμοιβή');
    v(ws, 'F' + R, 'Αριθμός Δικαιούχων'); v(ws, 'G' + R, 'Συνολικός Αρ. Ημερών'); v(ws, 'H' + R, b.H, NUM);
    if (b.first) f(ws, 'J' + R, `SUMIFS('SRA_PD'!$J:$J,'SRA_PD'!$I:$I,$T${R},'SRA_PD'!$H:$H,$U${R},'SRA_PD'!$G:$G,"KPI")`, b.J);
    else { v(ws, 'J' + R, 0, NUM); v(ws, 'V' + R, 'KPI ήδη στη λίστα του ίδιου ιατρού πιο πάνω'); }
    f(ws, 'K' + R, `H${R}+J${R}`, b.K);
    f(ws, 'L' + R, n ? `SUM(G${R + 1}:G${R + n})/$D$1` : '0', b.L);
    f(ws, 'M' + R, `IFERROR(K${R}/L${R},0)`, b.M);
    cols.forEach((c, i) => {
      const next = cols[i + 1];
      f(ws, c + R, next ? `MAX(0,MIN($L${R},${next}$2)-${c}$2)*$M${R}*${c}$3` : `MAX(0,$L${R}-${c}$2)*$M${R}*${c}$3`, b.bands[i]);
    });
    f(ws, 'S' + R, `SUM(N${R}:R${R})`, b.S);
    v(ws, 'T' + R, b.d.code); v(ws, 'U' + R, b.list);
    ws.getRow(R).font = { ...FONT, bold: true };
    r++;
    for (const a of b.d.rows) {
      v(ws, 'C' + r, a.age); v(ws, 'D' + r, a.comment); v(ws, 'E' + r, Number(a.rate), '0.000');
      v(ws, 'F' + r, a.count); v(ws, 'G' + r, a.days); v(ws, 'H' + r, a.amount, NUM); r++;
    }
  }
  const last = Math.max(first, r - 1), T = r + 1;
  const sum = k => blocks.reduce((a, b) => a + b[k], 0);
  v(ws, 'B' + T, 'ΣΥΝΟΛΟ ΦΥΛΛΟΥ');
  for (const [c, k] of [['H', 'H'], ['J', 'J'], ['K', 'K'], ['L', 'L']])
    f(ws, c + T, `SUMIF($C$${first}:$C$${last},"Ηλικίες",${c}${first}:${c}${last})`, sum(k));
  cols.forEach((c, i) => f(ws, c + T, `SUM(${c}${first}:${c}${last})`, blocks.reduce((a, b) => a + b.bands[i], 0)));
  f(ws, 'S' + T, `SUM(S${first}:S${last})`, sum('S'));
  totalStyle(ws, T, ['B', 'H', 'J', 'K', 'L', ...cols, 'S']);
  widths(ws, { A: 11, B: 44, C: 14, D: 16, E: 12, F: 10, G: 10, H: 12, I: 2, J: 11, K: 13, L: 11, M: 11, N: 11, O: 11, P: 11, Q: 11, R: 11, S: 12, T: 9, U: 8, V: 24 });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return { totalRow: T, sums: { H: sum('H'), J: sum('J'), K: sum('K'), L: sum('L'), S: sum('S') } };
}

function writeSynolika(ws, M) {
  v(ws, 'A1', 'Μήνας:'); v(ws, 'B1', M.month); v(ws, 'A2', 'Έτος:'); v(ws, 'B2', M.year);
  const hdr = { A: 'ID Τιμολογίου EBS', B: 'Παροχέας Υγείας', C: 'Τύπος Τιμολογίου', E: 'Ημερομηνία Τιμολογίου', H: 'Αμοιβή από ΟΑΥ',
    J: 'KPIs (SRA)', K: 'ΣΥΝΟΛΙΚΗ ΑΜΟΙΒΗ', L: 'ΜΕΣΟΣ ΟΡΟΣ ΕΓΓΡΑΦΩΝ', M: 'ΜΕΣΟΣ ΟΡΟΣ CAP FEES', N: 'Κλίμακα 1', O: 'Κλίμακα 2',
    P: 'Κλίμακα 3', Q: 'Κλίμακα 4', R: 'Κλίμακα 5', S: 'TOTAL', T: 'Κωδ. ιατρού', U: 'Λίστα', V: 'Φύλλο' };
  Object.entries(hdr).forEach(([c, t]) => v(ws, c + 3, t)); head(ws, 3, [...'ABCDEFGHIJKLMNOPQRS', 'T', 'U', 'V']);
  let r = 4; const first = r;
  for (const inv of M.invoices) {
    v(ws, 'A' + r, inv.id); v(ws, 'B' + r, inv.provider); v(ws, 'C' + r, inv.type); v(ws, 'E' + r, toDate(inv.date), 'dd/mm/yyyy');
    v(ws, 'H' + r, inv.amount, NUM); ws.getRow(r).font = { ...FONT, bold: true }; r++;
    for (const d of inv.doctors) {
      const b = M.blocks.find(x => x.d === d), src = c => `${q(b.sheet)}!${c}${b.row}`;
      v(ws, 'B' + r, d.name); v(ws, 'C' + r, 'Ηλικίες');
      for (const [c, val] of [['H', b.H], ['J', b.J], ['K', b.K], ['L', b.L], ['M', b.M], ['S', b.S]]) f(ws, c + r, src(c), val);
      b.bands.forEach((val, i) => f(ws, BAND_COLS[i] + r, src(BAND_COLS[i]), val));
      v(ws, 'T' + r, d.code); v(ws, 'U' + r, b.list); v(ws, 'V' + r, b.sheet);
      ws.getRow(r).font = { ...FONT, bold: true }; r++;
      for (const a of d.rows) {
        v(ws, 'C' + r, a.age); v(ws, 'D' + r, a.comment); v(ws, 'E' + r, Number(a.rate), '0.000');
        v(ws, 'F' + r, a.count); v(ws, 'G' + r, a.days); v(ws, 'H' + r, a.amount, NUM); r++;
      }
    }
  }
  const last = r - 1, T = r + 1;
  const H = M.blocks.reduce((a, b) => a + b.H, 0), L = M.blocks.reduce((a, b) => a + b.L, 0), S = M.blocks.reduce((a, b) => a + b.S, 0);
  v(ws, 'G' + T, 'Μήνας'); v(ws, 'H' + T, 'Αμοιβή ΟΑΥ'); v(ws, 'I' + T, 'Μέση αμοιβή ανά εγγεγραμμένο'); v(ws, 'J' + T, 'Μέσος όρος εγγραφών'); v(ws, 'S' + T, 'TOTAL ιατρών');
  head(ws, T, ['G', 'H', 'I', 'J', 'S']);
  const C = T + 1;
  v(ws, 'G' + C, new Date(Date.UTC(M.year, M.month - 1, 1)), 'mm/yyyy');
  f(ws, 'H' + C, `SUMIF($C$${first}:$C$${last},"Ηλικίες",H${first}:H${last})`, H);
  f(ws, 'I' + C, `IFERROR(H${C}/J${C},0)`, L ? H / L : 0, '0.0000');
  f(ws, 'J' + C, `SUMIF($C$${first}:$C$${last},"Ηλικίες",L${first}:L${last})`, L);
  f(ws, 'S' + C, `SUM(S${first}:S${last})`, S);
  totalStyle(ws, C, ['G', 'H', 'I', 'J', 'S']);
  let h = C + 1;
  const cur = Date.UTC(M.year, M.month - 1, 1);
  for (const x of M.history) {
    if (Date.UTC(x.date.getUTCFullYear(), x.date.getUTCMonth(), 1) >= cur) continue;
    v(ws, 'G' + h, x.date, 'mm/yyyy'); v(ws, 'H' + h, x.H, NUM); v(ws, 'I' + h, x.I, '0.0000'); v(ws, 'J' + h, x.J, NUM); h++;
  }
  widths(ws, { A: 11, B: 44, C: 14, D: 16, E: 12, F: 10, G: 11, H: 13, I: 12, J: 12, K: 13, L: 11, M: 11, S: 12, V: 14 });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  return { currentRow: C };
}

function writeOnomastika(ws, M, docRows) {
  ['Παροχέας Υγείας', 'TOTAL', 'Κατηγορία', 'Κωδ. ιατρού'].forEach((t, i) => v(ws, 'ABCD'[i] + 1, t)); head(ws, 1, ['A', 'B', 'C', 'D']);
  const docs = [...M.docs.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  let r = 2;
  for (const d of docs) {
    v(ws, 'A' + r, d.name);
    f(ws, 'B' + r, SHEET_ORDER.map(k => `SUMIF(${q(SHEETS[k])}!$T:$T,$D${r},${q(SHEETS[k])}!$S:$S)`).join('+'), d.total);
    f(ws, 'C' + r, `IFERROR(INDEX('ROSTER'!$C:$C,MATCH($D${r},'ROSTER'!$A:$A,0)),"${OUT_OF_ROSTER}")`, d.cat, null);
    v(ws, 'D' + r, d.code); docRows.set(d.code, r); r++;
  }
  const T = r + 1, tot = docs.reduce((a, d) => a + d.total, 0);
  v(ws, 'A' + T, 'ΣΥΝΟΛΟ'); f(ws, 'B' + T, `SUM(B2:B${r - 1})`, tot); totalStyle(ws, T, ['A', 'B']);
  widths(ws, { A: 60, B: 14, C: 20, D: 10 });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return { totalRow: T, total: tot };
}

function rosterVal(M, code, field) { const r = M.rosterBy.get(code); return r ? Number(r[field]) || 0 : 0; }

function writeCategory(ws, M, cat) {
  const rows = M.roster.filter(x => x.cat === cat);
  const full = cat === 'ΔΥ' || cat === 'ΟΚΥΠΥ';
  const capOf = c => (M.docs.get(c) || { total: 0 }).total;
  const look = (col, R) => `IFERROR(INDEX('ROSTER'!$${col}:$${col},MATCH($K${R},'ROSTER'!$A:$A,0)),0)`;
  if (!full) {
    ['Παροχέας Υγείας', 'TOTAL', 'Κωδ. ιατρού'].forEach((t, i) => v(ws, 'ABC'[i] + 1, t)); head(ws, 1, ['A', 'B', 'C']);
    let r = 2;
    for (const x of rows) {
      v(ws, 'A' + r, x.name); f(ws, 'B' + r, `SUMIF('ΟΝΟΜΑΣΤΙΚΑ'!$D:$D,$C${r},'ΟΝΟΜΑΣΤΙΚΑ'!$B:$B)`, capOf(x.code)); v(ws, 'C' + r, x.code); r++;
    }
    const T = r + 1, tot = rows.reduce((a, x) => a + capOf(x.code), 0);
    v(ws, 'A' + T, 'ΣΥΝΟΛΟ'); f(ws, 'B' + T, `SUM(B2:B${Math.max(2, r - 1)})`, tot); totalStyle(ws, T, ['A', 'B']);
    widths(ws, { A: 60, B: 14, C: 10 });
    return { totalRow: T, capCol: 'B', cap: tot };
  }
  const mm = `${M.month}/${M.year}`, next = new Date(Date.UTC(M.year, M.month, 1));
  const hdr = { A: 'ΑΚΑ', B: 'ΑΔΤ', C: 'ΠΡΟΣΩΠΙΚΟΣ ΙΑΤΡΟΣ ΕΝΗΛΙΚΩΝ/ ΠΑΙΔΩΝ', D: 'ΟΝΟΜΑΤΕΠΩΝΥΜΟ', E: 'ΚΕΝΤΡΟ ΥΓΕΙΑΣ', F: `CAP FEES ${mm}`,
    G: 'ΚΙΝΗΤΡΟ ΑΠΟΜΑΚΡΥΣΜΕΝΩΝ', H: `ΕΠΙΔΟΜΑ ΥΠΕΥΘΥΝΟΥ ΚΥ (αφορά ${next.getUTCMonth() + 1}/${next.getUTCFullYear()})`, I: 'ΝΕΑ ΠΟΙΟΤΙΚΑ ΚΙΝΗΤΡΑ', J: 'ΣΥΝΟΛΟ', K: 'Κωδ. ιατρού' };
  if (cat === 'ΔΥ') hdr.L = 'ΤΥΠΟΣ ΥΠΕΡΩΡΙΑΣ';
  Object.entries(hdr).forEach(([c, t]) => v(ws, c + 1, t)); head(ws, 1, Object.keys(hdr));
  let r = 2; const sums = { F: 0, G: 0, H: 0, I: 0, J: 0 };
  for (const x of rows) {
    v(ws, 'A' + r, x.aka); v(ws, 'B' + r, x.adt); v(ws, 'C' + r, x.pepp); v(ws, 'D' + r, x.name); v(ws, 'E' + r, x.centre);
    const F = capOf(x.code), G = rosterVal(M, x.code, 'remote'), H = rosterVal(M, x.code, 'head'), I = rosterVal(M, x.code, 'quality');
    f(ws, 'F' + r, `SUMIF('ΟΝΟΜΑΣΤΙΚΑ'!$D:$D,$K${r},'ΟΝΟΜΑΣΤΙΚΑ'!$B:$B)`, F);
    f(ws, 'G' + r, look('H', r), G); f(ws, 'H' + r, look('I', r), H); f(ws, 'I' + r, look('J', r), I);
    f(ws, 'J' + r, `SUM(F${r}:I${r})`, F + G + H + I);
    v(ws, 'K' + r, x.code); if (cat === 'ΔΥ') v(ws, 'L' + r, x.overtime);
    sums.F += F; sums.G += G; sums.H += H; sums.I += I; sums.J += F + G + H + I; r++;
  }
  const T = r, lastR = Math.max(2, r - 1);
  for (const c of 'FGHIJ') f(ws, c + T, `SUM(${c}2:${c}${lastR})`, sums[c]);
  totalStyle(ws, T, [...'FGHIJ']);
  if (cat === 'ΔΥ') {
    v(ws, 'I' + (T + 2), 'Σύνολο κατάστασης Υπουργείου Υγείας (MOH)');
    const inp = v(ws, 'J' + (T + 2), null, NUM); inp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT } };
    v(ws, 'I' + (T + 3), 'Διαφορά');
    f(ws, 'J' + (T + 3), `IF(J${T + 2}="","",J${T}-J${T + 2})`, '');
  }
  widths(ws, { A: 10, B: 12, C: 10, D: 52, E: 46, F: 13, G: 14, H: 16, I: 14, J: 13, K: 9, L: 14 });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return { totalRow: T, capCol: 'F', cap: sums.F };
}

function writeSra(ws, M) {
  const hdr = ['Αρχείο', 'Παροχέας', 'Αρ. πληρωμής', 'Ημ. πληρωμής', 'Ημ. τιμολογίου', 'Αρ. τιμολογίου', 'Κατηγορία', 'Λίστα', 'Ιατρός', 'Ποσό πληρωμής', 'Περιγραφή', 'Έλεγχος'];
  hdr.forEach((t, i) => v(ws, 'ABCDEFGHIJKL'[i] + 1, t)); head(ws, 1, [...'ABCDEFGHIJKL']);
  let r = 2;
  for (const l of M.ra) {
    v(ws, 'A' + r, l.file); v(ws, 'B' + r, l.supplier); v(ws, 'C' + r, l.payNo); v(ws, 'D' + r, toDate(l.payDate), 'dd/mm/yyyy');
    v(ws, 'E' + r, toDate(l.invDate), 'dd/mm/yyyy'); v(ws, 'F' + r, l.invKey); v(ws, 'G' + r, l.cat); v(ws, 'H' + r, l.list || '');
    v(ws, 'I' + r, l.doctor || ''); v(ws, 'J' + r, l.paid, NUM); v(ws, 'K' + r, l.desc);
    if (l.cat === 'KPI') {
      const ok = !M.kpiNoList.includes(l);
      f(ws, 'L' + r, `IF(${SHEET_ORDER.map(k => `COUNTIFS(${q(SHEETS[k])}!$T:$T,$I${r},${q(SHEETS[k])}!$U:$U,$H${r})`).join('+')}>0,"OK","ΧΩΡΙΣ ΛΙΣΤΑ")`, ok ? 'OK' : 'ΧΩΡΙΣ ΛΙΣΤΑ', null);
    }
    r++;
  }
  widths(ws, { A: 18, B: 9, C: 11, D: 11, E: 11, F: 18, G: 10, H: 8, I: 8, J: 12, K: 40, L: 13 });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = 'A1:L1';
}

function writeRoster(ws, M) {
  ROSTER_HEAD.forEach((t, i) => v(ws, 'ABCDEFGHIJKL'[i] + 1, t)); head(ws, 1, [...'ABCDEFGHIJKL']);
  M.roster.forEach((x, i) => {
    const r = i + 2;
    [x.code, x.name, x.cat, x.aka, x.adt, x.pepp, x.centre, x.remote, x.head, x.quality, x.overtime, x.notes]
      .forEach((val, j) => v(ws, 'ABCDEFGHIJKL'[j] + r, val === undefined ? null : val));
  });
  widths(ws, { A: 10, B: 52, C: 20, D: 10, E: 12, F: 8, G: 46, H: 12, I: 12, J: 12, K: 14, L: 30 });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function writeChecks(ws, M, ctx) {
  v(ws, 'A1', `Έλεγχοι – αμοιβές κατά κεφαλήν ${String(M.month).padStart(2, '0')}/${M.year}`).font = { ...FONT, bold: true, size: 13, color: { argb: DEEP } };
  ['#', 'Έλεγχος', 'Αναμενόμενο', 'Πραγματικό', 'Διαφορά', 'Κατάσταση'].forEach((t, i) => v(ws, 'ABCDEF'[i] + 3, t)); head(ws, 3, [...'ABCDEF']);
  const sumAll = kind => kind === 'ΠΑΡΟΧΟΣ' ? M.invoices.reduce((a, i) => a + i.amount, 0)
    : kind === 'ΙΑΤΡΟΣ' ? M.blocks.reduce((a, b) => a + b.H, 0) : M.blocks.reduce((a, b) => a + b.d.rows.reduce((s, x) => s + x.amount, 0), 0);
  const allF = kind => `SUMIF('ALL'!$J:$J,"${kind}",'ALL'!$H:$H)`;
  const calcRef = col => SHEET_ORDER.map(k => `${q(SHEETS[k])}!${col}${ctx.calc[k].totalRow}`).join('+');
  const calcVal = key => SHEET_ORDER.reduce((a, k) => a + ctx.calc[k].sums[key], 0);
  const kpiSra = M.ra.filter(l => l.cat === 'KPI').reduce((a, l) => a + l.paid, 0);
  const catRef = CATS.map(c => `${q(c)}!${ctx.cats[c].capCol}${ctx.cats[c].totalRow}`).join('+');
  const catVal = CATS.reduce((a, c) => a + ctx.cats[c].cap, 0);
  const invStart = 17;
  const invRows = M.invoices.map(inv => ({ inv, sra: M.ra.filter(l => l.cat === 'HCP' && l.invKey === inv.id).reduce((a, l) => a + l.paid, 0) }));
  const invBad = invRows.filter(x => Math.abs(x.inv.amount - x.sra) > TOL).length;
  const invEnd = invStart + Math.max(invRows.length, 1) - 1;
  const outRoster = M.outOfRoster.length;
  const checks = [
    ['Τιμολόγια ΟΑΥ = σύνολο λιστών ιατρών (ALL)', allF('ΠΑΡΟΧΟΣ'), sumAll('ΠΑΡΟΧΟΣ'), allF('ΙΑΤΡΟΣ'), sumAll('ΙΑΤΡΟΣ')],
    ['Λίστες ιατρών = σύνολο ηλικιακών ομάδων (ALL)', allF('ΙΑΤΡΟΣ'), sumAll('ΙΑΤΡΟΣ'), allF('ΗΛΙΚΙΑ'), sumAll('ΗΛΙΚΙΑ')],
    ['Όλες οι λίστες μοιράστηκαν στα 3 φύλλα υπολογισμού', allF('ΙΑΤΡΟΣ'), sumAll('ΙΑΤΡΟΣ'), calcRef('H'), calcVal('H')],
    ['Τιμολόγια κατά κεφαλήν = SRA "PD - HCP SERVICES"', `SUM(C${invStart}:C${invEnd})`, invRows.reduce((a, x) => a + x.inv.amount, 0), `SUM(D${invStart}:D${invEnd})`, invRows.reduce((a, x) => a + x.sra, 0)],
    ['Τιμολόγια που δεν συμφωνούν με SRA (πλήθος)', '0', 0, `COUNTIF(F${invStart}:F${invEnd},"ΕΛΕΓΞΤΕ")`, invBad],
    ['KPIs στα SRA = KPIs που μπήκαν στον υπολογισμό', `SUMIFS('SRA_PD'!$J:$J,'SRA_PD'!$G:$G,"KPI")`, kpiSra, calcRef('J'), calcVal('J')],
    ['KPIs χωρίς λίστα ιατρού (πλήθος)', '0', 0, `COUNTIF('SRA_PD'!$L:$L,"ΧΩΡΙΣ ΛΙΣΤΑ")`, M.kpiNoList.length],
    ['ΟΝΟΜΑΣΤΙΚΑ = σύνολο 3 φύλλων', calcRef('S'), calcVal('S'), `'ΟΝΟΜΑΣΤΙΚΑ'!B${ctx.ono.totalRow}`, ctx.ono.total],
    ['Ιατροί εκτός μητρώου (πλήθος)', '0', 0, `COUNTIF('ΟΝΟΜΑΣΤΙΚΑ'!$C:$C,"${OUT_OF_ROSTER}")`, outRoster],
    ['ΟΝΟΜΑΣΤΙΚΑ = ΔΥ + ΟΚΥΠΥ + ΑΓΟΡΑ ΥΠΗΡΕΣΙΩΝ + ΠΑΡΑΙΤΗΣΕΙΣ', `'ΟΝΟΜΑΣΤΙΚΑ'!B${ctx.ono.totalRow}`, ctx.ono.total, catRef, catVal],
  ];
  const results = [];
  checks.forEach(([name, fc, vc, fd, vd], i) => {
    const r = 4 + i;
    v(ws, 'A' + r, i + 1); v(ws, 'B' + r, name);
    f(ws, 'C' + r, fc, vc); f(ws, 'D' + r, fd, vd); f(ws, 'E' + r, `D${r}-C${r}`, vd - vc);
    const ok = Math.abs(vd - vc) < TOL;
    f(ws, 'F' + r, `IF(ABS(E${r})<${TOL},"OK","ΕΛΕΓΞΤΕ")`, ok ? 'OK' : 'ΕΛΕΓΞΤΕ', null);
    results.push({ name, expected: vc, actual: vd, ok });
  });
  v(ws, 'A' + (invStart - 2), 'Τιμολόγια κατά κεφαλήν και SRA').font = { ...FONT, bold: true, color: { argb: DEEP } };
  ['ID Τιμολογίου', 'Παροχέας', 'Κατά κεφαλήν (ΟΑΥ)', 'SRA (PD - HCP)', 'Διαφορά', 'Κατάσταση'].forEach((t, i) => v(ws, 'ABCDEF'[i] + (invStart - 1), t));
  head(ws, invStart - 1, [...'ABCDEF']);
  invRows.forEach((x, i) => {
    const r = invStart + i;
    v(ws, 'A' + r, x.inv.id); v(ws, 'B' + r, x.inv.provider); v(ws, 'C' + r, x.inv.amount, NUM);
    f(ws, 'D' + r, `SUMIFS('SRA_PD'!$J:$J,'SRA_PD'!$F:$F,A${r},'SRA_PD'!$G:$G,"HCP")`, x.sra);
    f(ws, 'E' + r, `D${r}-C${r}`, x.sra - x.inv.amount);
    f(ws, 'F' + r, `IF(ABS(E${r})<${TOL},"OK","ΕΛΕΓΞΤΕ")`, Math.abs(x.sra - x.inv.amount) < TOL ? 'OK' : 'ΕΛΕΓΞΤΕ', null);
  });
  // Information lists (values, for follow-up)
  let r = invEnd + 3;
  const section = (title, rows) => {
    v(ws, 'A' + r, title).font = { ...FONT, bold: true, color: { argb: DEEP } }; r++;
    if (!rows.length) { v(ws, 'B' + r, 'Κανένα'); r++; }
    for (const row of rows) { row.forEach((val, j) => v(ws, 'BCDE'[j] + r, val, typeof val === 'number' ? NUM : undefined)); r++; }
    r++;
  };
  section('Ιατροί με κατά κεφαλήν αλλά εκτός μητρώου (προσθέστε τους στο ROSTER)', M.outOfRoster.map(d => [d.name, d.total]));
  section('Ιατροί του μητρώου χωρίς κατά κεφαλήν αυτό τον μήνα', M.rosterNoCap.map(x => [x.name, x.cat]));
  section('KPIs στα SRA χωρίς λίστα ιατρού', M.kpiNoList.map(l => [l.desc, l.supplier, l.paid]));
  const other = {};
  M.ra.filter(l => !['HCP', 'KPI'].includes(l.cat)).forEach(l => { other[l.cat] = (other[l.cat] || 0) + l.paid; });
  section('Άλλες γραμμές PD στα SRA που ΔΕΝ μπαίνουν στον υπολογισμό (για ενημέρωση)', Object.entries(other).map(([k, x]) => [k, x]));
  section('Αναφορές κατά κεφαλήν χωρίς ιατρούς', M.empty.map(x => [x]));
  section('Διπλά τιμολόγια που αγνοήθηκαν', M.duplicates.map(d => [String(d.id), d.file, 'πρώτη φορά: ' + d.first]));
  widths(ws, { A: 12, B: 58, C: 18, D: 18, E: 14, F: 12 });
  return results;
}

async function buildWorkbook(ExcelJS, M) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Capitation Fees tool'; wb.calcProperties.fullCalcOnLoad = true;
  const add = n => { const ws = wb.addWorksheet(n); ws.properties.defaultRowHeight = 14; return ws; };
  const wsChecks = add('CHECKS'), wsAll = add('ALL');
  const calcWs = {}; SHEET_ORDER.forEach(k => { calcWs[k] = add(SHEETS[k]); });
  const wsSyn = add('ΣΥΝΟΛΙΚΑ'), wsOno = add('ΟΝΟΜΑΣΤΙΚΑ');
  const catWs = {}; CATS.forEach(c => { catWs[c] = add(c); });
  const wsSra = add('SRA_PD'), wsRoster = add('ROSTER');

  writeAll(wsAll, M);
  const ctx = { calc: {}, cats: {} };
  SHEET_ORDER.forEach(k => { ctx.calc[k] = writeCalc(calcWs[k], k, M); });
  writeSynolika(wsSyn, M);
  ctx.ono = writeOnomastika(wsOno, M, new Map());
  CATS.forEach(c => { ctx.cats[c] = writeCategory(catWs[c], M, c); });
  writeSra(wsSra, M);
  writeRoster(wsRoster, M);
  const checks = writeChecks(wsChecks, M, ctx);
  wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => { if (!c.font || !c.font.name) c.font = { ...FONT, ...(c.font || {}) }; })));
  [wsChecks, wsRoster].forEach(ws => { ws.properties.tabColor = { argb: 'FF8BC53F' }; });
  const summary = {
    period: { month: M.month, year: M.year },
    invoices: M.invoices.length, lists: M.blocks.length, doctors: M.docs.size,
    oay: M.blocks.reduce((a, b) => a + b.H, 0), kpi: M.blocks.reduce((a, b) => a + b.J, 0), total: ctx.ono.total,
    bySheet: SHEET_ORDER.map(k => ({ name: SHEETS[k], lists: M.blocks.filter(b => b.key === k).length, total: ctx.calc[k].sums.S })),
    byCat: CATS.map(c => ({ name: c, total: ctx.cats[c].cap, n: M.roster.filter(x => x.cat === c).length })),
    checks, outOfRoster: M.outOfRoster, rosterNoCap: M.rosterNoCap, kpiNoList: M.kpiNoList, empty: M.empty, duplicates: M.duplicates,
  };
  return { wb, summary };
}

// ---------- reading roster / history from uploaded workbooks ----------
function cellVal(c) {
  const x = c && c.value;
  if (x && typeof x === 'object' && !(x instanceof Date)) {
    if ('result' in x) return x.result;
    if (x.richText) return x.richText.map(t => t.text).join('');
    if ('text' in x) return x.text;
  }
  return x;
}
function readRoster(wb) {
  const ws = wb.getWorksheet('ROSTER') || wb.worksheets[0];
  const head = [];
  ws.getRow(1).eachCell((c, i) => { head[i] = String(cellVal(c) || '').trim(); });
  if (!/κωδικ/i.test(head[1] || '')) throw new Error('Το μητρώο πρέπει να έχει στην πρώτη στήλη "Κωδικός ιατρού". Χρησιμοποιήστε το πρότυπο.');
  const out = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const g = i => cellVal(row.getCell(i));
    const code = codeOf(g(1));
    if (!/^D\d+/.test(code)) return;
    const cat = String(g(3) || '').trim().toUpperCase().replace(/\s+/g, ' ');
    out.push({ code, name: String(g(2) || code).trim(), cat: CATS.find(c => c === cat || c.replace('_', ' ') === cat) || cat,
      aka: g(4), adt: g(5), pepp: g(6), centre: g(7), remote: Number(g(8)) || 0, head: Number(g(9)) || 0, quality: Number(g(10)) || 0,
      overtime: g(11), notes: g(12) });
  });
  return out;
}
function readHistory(wb) {
  const ws = wb.getWorksheet('ΣΥΝΟΛΙΚΑ');
  if (!ws) throw new Error('Το προηγούμενο αρχείο δεν έχει φύλλο ΣΥΝΟΛΙΚΑ.');
  const out = [];
  ws.eachRow(row => {
    const d = cellVal(row.getCell(7));
    if (!(d instanceof Date)) return;
    const H = Number(cellVal(row.getCell(8))), J = Number(cellVal(row.getCell(10))) || Number(cellVal(row.getCell(12)));
    const I = Number(cellVal(row.getCell(9)));
    if (!(H > 0 && J > 0 && I > 0)) return; // history rows carry all three; provider rows do not
    out.push({ date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), H, I, J });
  });
  const seen = new Set();
  return out.filter(x => { const k = +x.date; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.date - a.date);
}
function rosterTemplate(ExcelJS, roster) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ROSTER');
  writeRoster(ws, { roster: roster || [] });
  const help = wb.addWorksheet('ΟΔΗΓΙΕΣ');
  [['Κατηγορία', 'Μία από: ' + CATS.join(', ')], ['Κωδικός ιατρού', 'Ο κωδικός ΟΑΥ, π.χ. D1088'],
    ['Κίνητρο / Επίδομα / Ποιοτικά', 'Ποσά σε € για τον μήνα πληρωμής. Κενό = 0'],
    ['Νέος ιατρός', 'Προσθέστε γραμμή. Το εργαλείο σημαδεύει όποιον λείπει.']].forEach((x, i) => { help.getCell('A' + (i + 1)).value = x[0]; help.getCell('B' + (i + 1)).value = x[1]; });
  help.getColumn('A').width = 28; help.getColumn('B').width = 70;
  return wb;
}

if (typeof module !== 'undefined') module.exports = { cellVal, prepare, buildWorkbook, readRoster, readHistory, rosterTemplate, bandSplit, DEFAULT_CFG, SHEETS, CATS };
