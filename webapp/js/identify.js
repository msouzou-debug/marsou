/* Content-based file identification — JS port of recon/identify.py.
 * identify(name, bytes) -> { filename, data, reportType, hospitalCode,
 * year, month, warnings, error, rawText }.  Filenames are NEVER trusted. */
'use strict';

const F_CODE_RE = /\bF10(?:25|26|47|48|49|50|54|55)\b/;

function sniffFormat(bytes) {
  const b = bytes.subarray(0, 8);
  const ascii = String.fromCharCode(...b.subarray(0, 4));
  if (ascii === '%PDF') return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'xlsx';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'xls';
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  const head = new TextDecoder('utf-8').decode(bytes.subarray(i, i + 64)).replace(/^[\s\r\n\t]+/, '');
  if (head.startsWith('<')) return 'xml';
  return 'unknown';
}

/* ---------------------------------------------------- period / hospital */

const DD_MM_YYYY_RE = /\b([0-3]?\d)\s*\/\s*(0?[1-9]|1[0-2])\s*\/\s*(20\d\d)\b/;
const MM_YYYY_RE = /\b(0?[1-9]|1[0-2])\s*[/.\-]\s*(20\d\d)\b/;
const YYYY_MM_RE = /\b(20\d\d)\s*[-/.]\s*(0?[1-9]|1[0-2])\b(?!\s*[/.\-]\s*\d)/;

function findPeriod(text) {
  const up = stripAccents(text);
  // labeled «Μήνας: 3» + «Έτος: 2026» first (real ΟΑΥ PDFs)
  const ml = up.match(/ΜΗΝΑΣ\s*[:=]\s*(\d{1,2})\b/);
  const yl = up.match(/ΕΤΟΣ\s*[:=]\s*(20\d\d)\b/);
  if (ml && yl) return [parseInt(yl[1], 10), parseInt(ml[1], 10)];
  for (const [name, m] of Object.entries(GREEK_MONTHS)) {
    if (up.includes(name)) {
      const ym = up.match(new RegExp(name + '\\D{0,10}(20\\d\\d)'));
      if (ym) return [parseInt(ym[1], 10), m];
      const y = up.match(/\b(20\d\d)\b/);
      if (y) return [parseInt(y[1], 10), m];
    }
  }
  let m = String(text).match(DD_MM_YYYY_RE);
  if (m) return [parseInt(m[3], 10), parseInt(m[2], 10)];
  m = String(text).match(MM_YYYY_RE);
  if (m) return [parseInt(m[2], 10), parseInt(m[1], 10)];
  m = String(text).match(YYYY_MM_RE);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  return [null, null];
}

function prevMonth(year, month) {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

const PAY_DATE_LINE_RE = /PAYMENT\s*DATE|ΗΜΕΡΟΜΗΝΙΑ\s*ΠΛΗΡΩΜΗΣ/;

function findServicePeriod(text) {
  /* Service month for SRAs.  The SRA is ALWAYS dated one month after the
   * month it settles (ΟΑΥ pays in arrears): service month = document date
   * − 1 month.  Prefer the «Payment Date: ...» line — real SRAs also list
   * per-invoice dates which must not win. */
  for (const line of String(text).split('\n')) {
    if (PAY_DATE_LINE_RE.test(stripAccents(line))) {
      const [y, m] = findPeriod(line);
      if (y) return prevMonth(y, m);
    }
  }
  const [y, m] = findPeriod(text);
  if (y == null) return [null, null];
  return prevMonth(y, m);
}

function labeledYearMonth(rows, maxRows = 10) {
  /* Real Ενδ. summaries: «Έτος | Μήνας» header cells, values in the row
   * below (2026 | 3). */
  const n = Math.min(maxRows, rows.length - 1);
  for (let i = 0; i < n; i++) {
    let yearCol = null, monthCol = null;
    rows[i].forEach((v, j) => {
      if (v == null) return;
      const lab = normLabel(cellText(v));
      if (lab === 'ΕΤΟΣ') yearCol = j;
      else if (lab === 'ΜΗΝΑΣ') monthCol = j;
    });
    if (yearCol != null && monthCol != null) {
      const y = parseInt(cellText(rows[i + 1][yearCol]), 10);
      const m = parseInt(cellText(rows[i + 1][monthCol]), 10);
      if (y >= 2000 && y <= 2099 && m >= 1 && m <= 12) return [y, m];
    }
  }
  return [null, null];
}

function findHospital(text) {
  const m = String(text).match(F_CODE_RE);
  if (m) return m[0];
  const up = stripAccents(text);
  const hits = Object.entries(HOSPITALS)
    .filter(([, [gr]]) => up.includes(stripAccents(gr)))
    .map(([code]) => code);
  return hits.length === 1 ? hits[0] : null;
}

/* -------------------------------------------------------------- Excel */

function loadSheets(bytes) {
  // -> [{name, rows}] where rows are arrays of raw cell values
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }),
  }));
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v);
}

function cellsText(rows, maxRows = 40) {
  const parts = [];
  for (const row of rows.slice(0, maxRows)) {
    for (const v of row) {
      const t = cellText(v);
      if (t && t !== 'nan') parts.push(t);
    }
  }
  return parts.join(' | ');
}

function findHeaderRow(rows, needles, maxRows = 30) {
  // normLabel comparison: 'DR_SEGMENT' in a real export matches 'DR SEGMENT'
  const wanted = needles.map(normLabel);
  const n = Math.min(maxRows, rows.length);
  for (let i = 0; i < n; i++) {
    const joined = rows[i].filter((v) => v != null && cellText(v) !== 'nan')
      .map((v) => normLabel(cellText(v))).join(' | ');
    if (wanted.every((w) => joined.includes(w))) return i;
  }
  return null;
}

function columnValues(rows, headerRow, headerName) {
  const want = normLabel(headerName);
  const hdr = rows[headerRow].map((v) => (v == null ? '' : normLabel(cellText(v))));
  for (let j = 0; j < hdr.length; j++) {
    if (hdr[j].includes(want)) return rows.slice(headerRow + 1).map((r) => r[j]);
  }
  return null;
}

function excelProbe(sheets) {
  /* What the identifier saw — sheet names + first populated rows, for the
   * diagnostics panel. */
  const parts = [];
  for (const { name, rows } of sheets) {
    const cols = rows.length ? Math.max(...rows.slice(0, 5).map((r) => r.length)) : 0;
    parts.push(`Φύλλο (sheet) «${name}» — ${rows.length} γραμμές × ${cols} στήλες:`);
    let shown = 0;
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const cells = rows[i].slice(0, 20).filter((v) => v != null && cellText(v) !== 'nan')
        .map((v) => cellText(v).slice(0, 40));
      if (!cells.length) continue;
      parts.push(`  γραμμή ${i + 1}: ` + cells.join(' | '));
      shown += 1;
      if (shown >= 8) break;
    }
  }
  return parts.join('\n').slice(0, 4000);
}

function identifyExcel(f) {
  let sheets;
  try {
    sheets = loadSheets(f.data);
  } catch (e) {
    f.error = `Δεν διαβάζεται ως Excel (unreadable as Excel): ${e.message}`;
    return;
  }
  f.probe = excelProbe(sheets);
  let allText = '';
  for (const { name, rows } of sheets) allText += ` | ${name} | ` + cellsText(rows);
  const up = stripAccents(allText);

  for (const { name: sheetName, rows } of sheets) {
    if (findHeaderRow(rows, ['ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ'], 60) !== null
        && stripAccents(cellsText(rows, 60)).includes('ΚΩΔΙΚΟΣ ΓΕΣΥ ΠΑΡΟΧΕΑ')) {
      f.reportType = RT.INPATIENT_SUMMARY;
      const top = cellsText(rows, 6);
      f.hospitalCode = findHospital(top) || findHospital(allText);
      [f.year, f.month] = labeledYearMonth(rows);   // real files: Έτος|Μήνας cells
      if (f.year == null) [f.year, f.month] = findPeriod(top);
      if (f.year == null) [f.year, f.month] = findPeriod(allText);
      return;
    }
    let hr = findHeaderRow(rows, ['DR SEGMENT']);
    if (hr !== null) {
      f.reportType = RT.CLAIMS_ALL;
      fillFromTable(f, rows, hr, sheets);
      // diagnostics: the ACTUAL segment values with sums — the column sits
      // past the probe's visible width and its labels vary
      try {
        const c = extractClaimsAll(f.data);
        f.probe = (f.probe || '') + '\nDR SEGMENT σύνολα (values → sums): '
          + Object.entries(c.bySegment).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `«${k}»=${formatEur(v)}`).join(', ');
      } catch (e) {
        f.probe = (f.probe || '') + `\n(claims extract failed: ${e.message})`;
      }
      return;
    }
    hr = findHeaderRow(rows, ['TYPE']);
    if (hr !== null) {
      const vals = columnValues(rows, hr, 'TYPE');
      if (vals) {
        const got = new Set(vals.filter((v) => v != null).map((v) => stripAccents(cellText(v))));
        if (got.has('DRUGS') || got.has('CONSUMABLES')) {
          f.reportType = RT.PHARMA_CLAIMS;
          fillFromTable(f, rows, hr, sheets);
          try {
            const p = extractPharmaClaims(f.data);
            f.probe = (f.probe || '') + '\nTYPE σύνολα (values → sums): '
              + Object.entries(p.byType).sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `«${k}»=${formatEur(v)}`).join(', ');
          } catch (e) {
            f.probe = (f.probe || '') + `\n(pharma extract failed: ${e.message})`;
          }
          return;
        }
      }
    }
    hr = findHeaderRow(rows, ['VENDOR_CODE', 'EURO_AMOUNT']);
    if (hr !== null) {
      f.reportType = RT.GL_EXTRACT; // org-wide: no single hospital
      const m = sheetName.match(/(0?[1-9]|1[0-2])\s*[./]\s*(\d{2})\b/);
      if (m) { f.month = parseInt(m[1], 10); f.year = 2000 + parseInt(m[2], 10); }
      else [f.year, f.month] = findPeriod(cellsText(rows, 5));
      return;
    }
    hr = findHeaderRow(rows, ['BILLING PROVIDER NAME', 'DRG ID']);
    if (hr !== null) {
      f.reportType = RT.IS_AUDITOR; // org-wide
      // its rows carry historical invoice dates spanning years — a period
      // derived from them is meaningless, so don't claim one
      return;
    }
    // Quality criteria export: CLAIM DATE | CLAIM ID | QUALITY CRITERION |
    // AMOUNT | PERSONAL DOCTOR ... — note the SINGULAR «CRITERION»
    hr = findHeaderRow(rows, ['QUALITY CRITERI', 'AMOUNT']);
    if (hr !== null) {
      f.reportType = RT.QUALITY_CRITERIA;
      f.hospitalCode = findHospital(allText);
      [f.year, f.month] = findPeriod(allText);
      return;
    }
  }

  if ((up.includes('ΠΟΙΟΤΙΚ') && up.includes('ΚΡΙΤΗΡΙ')) || up.includes('QUALITY CRITERI')) f.reportType = RT.QUALITY_CRITERIA;
  else if (up.includes('CAPITATION') || up.includes('ΚΑΤΑ ΚΕΦΑΛΗΝ')) f.reportType = RT.CAPITATION;
  else if (up.includes('ΑΙΜΟΚΑΘΑΡΣ') || up.includes('HEMODIALYSIS') || up.includes('HAEMODIALYSIS')) f.reportType = RT.HEMODIALYSIS;
  else {
    f.error = 'Άγνωστος τύπος αναφοράς (unrecognised report type) — no known header signature found';
    return;
  }
  f.hospitalCode = findHospital(allText);
  [f.year, f.month] = findPeriod(allText);
}

function fillFromTable(f, rows, headerRow, sheets) {
  const bodyText = cellsText(rows, headerRow + 30);
  f.hospitalCode = findHospital(bodyText);
  [f.year, f.month] = findPeriod(bodyText);
  if (f.hospitalCode && f.year) return;
  for (const { rows: other } of sheets) {
    const t = cellsText(other, 40);
    if (!f.hospitalCode) f.hospitalCode = findHospital(t);
    if (!f.year) [f.year, f.month] = findPeriod(t);
    if (f.hospitalCode && f.year) return;
  }
}

/* ----------------------------------------------------------------- PDF */

async function extractPdfText(bytes) {
  // pdf.worker.min.js is loaded as a plain script, so pdf.js falls back to
  // the in-page worker — works from file:// too, no fetches
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const pageTexts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const lines = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let line = lines.find((l) => Math.abs(l.y - y) <= 2.5);
      if (!line) { line = { y, items: [] }; lines.push(line); }
      line.items.push({ x, str: it.str });
    }
    lines.sort((a, b) => b.y - a.y);
    pageTexts.push(lines.map((l) => l.items.sort((a, b) => a.x - b.x)
      .map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()).join('\n'));
  }
  return pageTexts.join('\n');
}

function identifyPdfText(text) {
  const up = stripAccents(text);
  // SRA first: its lines mention «Αμοιβή Φαρμακοποιού», capitation etc.
  if (up.includes('ΚΑΤΑΣΤΑΣΗ ΠΛΗΡΩΜΗΣ') || up.includes('REMITTANCE')) return RT.SRA;
  if (up.includes('ΑΜΟΙΒΗ ΦΑΡΜΑΚΟΠΟΙΟΥ')) return RT.PHARMACIST_FEE;
  if ((up.includes('ΠΟΙΟΤΙΚ') && up.includes('ΚΡΙΤΗΡΙ')) || up.includes('QUALITY CRITERI')) return RT.QUALITY_CRITERIA;
  if (up.includes('CAPITATION') || up.includes('ΚΑΤΑ ΚΕΦΑΛΗΝ')) return RT.CAPITATION;
  if (up.includes('ΑΙΜΟΚΑΘΑΡΣ') || up.includes('HEMODIALYSIS') || up.includes('HAEMODIALYSIS')) return RT.HEMODIALYSIS;
  if ((up.includes('ΕΠΙΤΑΓΗ') || up.includes('CHEQUE') || up.includes('ΑΡ. ΠΛΗΡΩΜΗΣ')
       || up.includes('PAYMENT')) && F_CODE_RE.test(text)) return RT.SRA;
  return null;
}

async function identifyPdf(f) {
  let text;
  try {
    text = await extractPdfText(f.data);
  } catch (e) {
    f.error = `Αποτυχία ανάγνωσης PDF (PDF read failed): ${e.message}`;
    return;
  }
  f.rawText = text;
  f.probe = 'Κείμενο PDF (extracted text, first 900 chars):\n' + text.slice(0, 900);
  if (text.trim().length <= 40) {
    f.error = 'Σαρωμένο PDF χωρίς επίπεδο κειμένου (scanned PDF, no text layer). '
      + 'Η έκδοση browser δεν κάνει OCR — επικολλήστε το κείμενο στο πεδίο διόρθωσης '
      + 'ή χρησιμοποιήστε την έκδοση server (Streamlit) που έχει OCR.';
    f.reportType = null;
    f.needsManualText = true;
    return;
  }
  const rt = identifyPdfText(text);
  if (!rt) { f.error = 'Άγνωστο PDF (unrecognised PDF report)'; return; }
  f.reportType = rt;
  f.hospitalCode = findHospital(text);
  // SRAs are dated in the payment month (arrears) — dig for the service period
  if (rt === RT.SRA) {
    [f.year, f.month] = findServicePeriod(text);
    f.probe = (f.probe || '') + '\n\n' + sraProbeSummary(text);
  } else {
    [f.year, f.month] = findPeriod(text);
  }
}

function sraProbeSummary(text) {
  /* Diagnostics: every distinct SRA line description with count, sum and the
   * bucket it was mapped to — unmapped descriptions visible at a glance. */
  let sra;
  try {
    sra = parseSraText(text);
  } catch (e) {
    return `SRA γραμμές (line parse): ΑΠΕΤΥΧΕ — ${e.message}`;
  }
  const groups = new Map();
  for (const l of sra.lines) {
    // strip the appended «(date #inv)» so daily invoices group together
    const base = l.description.split(' (')[0].slice(0, 45);
    const key = `${l.code}|${l.bucket}|${base}`;
    const g = groups.get(key) || { n: 0, s: 0 };
    g.n += 1; g.s += l.amount;
    groups.set(key, g);
  }
  const diff = round2(sra.linesTotal - sra.statedTotal);
  const out = [`SRA γραμμές: ${sra.lines.length} · επιταγή #${sra.chequeNo} · `
    + `δηλωμένο σύνολο ${formatEur(sra.statedTotal)} · άθροισμα γραμμών ${formatEur(sra.linesTotal)}`
    + ` · διαφορά ${formatEur(diff)}`,
  'Ταξινόμηση περιγραφών (description → code/bucket, count, sum):'];
  [...groups.entries()].sort((a, b) => b[1].s - a[1].s).forEach(([key, g]) => {
    const [code, bucket, desc] = key.split('|');
    out.push(`  «${desc}» → ${code} / ${bucket} · ×${g.n} · ${formatEur(g.s)}`
      + (code === '??' ? '  ⚠ UNMAPPED' : ''));
  });
  const suspicious = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || !findAmounts(line).length) continue;
    if (INVOICE_LINE_RE.test(line) || SRA_LINE_RE.test(line)) continue;
    suspicious.push(line.slice(0, 90));
  }
  if (suspicious.length) {
    out.push('Γραμμές με ποσά που ΔΕΝ αναλύθηκαν (lines with amounts NOT parsed):');
    for (const s of suspicious.slice(0, 15)) out.push(`  ✗ ${s}`);
  }
  return out.join('\n').slice(0, 4500);
}

/* ----------------------------------------------------------------- XML */

function parseXml(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('invalid XML');
  return doc;
}

function identifyXml(f) {
  let doc;
  try {
    doc = parseXml(f.data);
  } catch (e) {
    f.error = `Μη έγκυρο XML (invalid XML): ${e.message}`;
    return;
  }
  const names = new Set();
  for (const el of doc.getElementsByTagName('*')) names.add(el.localName.toLowerCase());
  const textAll = doc.documentElement.textContent;
  f.probe = `XML root: ${doc.documentElement.localName}\nΠεδία (fields): `
    + [...names].sort().slice(0, 25).join(', ');
  if (names.has('claimid') && names.has('activityreimbursementamount')) f.reportType = RT.XML_ACTIVITY;
  else if (names.has('drsegment') || names.has('segment')) f.reportType = RT.CLAIMS_ALL;
  else { f.error = 'Άγνωστο XML (unrecognised XML export — no known field names)'; return; }
  f.hospitalCode = findHospital(textAll);
  [f.year, f.month] = findPeriod(textAll);
}

/* ---------------------------------------------------------------- main */

async function identify(filename, bytes) {
  const f = { filename, data: bytes, reportType: null, hospitalCode: null,
              year: null, month: null, warnings: [], error: null, rawText: null,
              needsManualText: false, probe: null };
  const fmt = sniffFormat(bytes);
  if (fmt === 'xlsx' || fmt === 'xls') identifyExcel(f);
  else if (fmt === 'pdf') await identifyPdf(f);
  else if (fmt === 'xml') identifyXml(f);
  else f.error = 'Μη υποστηριζόμενη μορφή (unsupported file format)';
  return f;
}
