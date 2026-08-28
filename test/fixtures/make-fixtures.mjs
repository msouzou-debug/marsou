#!/usr/bin/env node
/* Synthetic test workbooks for the four file families.
 *
 * The real files cannot live in this repo — the OS paid-claims files carry
 * patient names. These fixtures reproduce the *structure* the parsers depend
 * on (wide monthly blocks anchored on month-name runs, the ΣΤΟΧΟΣ title cell,
 * IS Auditor column names, the ALL/A&E two-tab layout, OS claim rows) at
 * roughly a tenth of the real hospital's volume, so the ratios read like the
 * real ones (ΤΑΕΠ coverage ~81%, εξωτερικά ~83%) without shipping any PII.
 *
 * Everything is deterministic: same inputs, same bytes, so the golden
 * comparison between v1.4 and the rebuilt bundle is stable.
 *
 * The acceptance numbers in the build brief (Εισαγωγές 5.949 κ.λπ.) can only be
 * checked against the real Jan–Mar 2026 files; see README «Δοκιμές».
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const XLSX = require(join(HERE, '../../src/vendor/xlsx.full.min.cjs'));
export const OUT_DIR = join(HERE, 'generated');

/* deterministic PRNG so regenerating never churns the fixtures */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const YEAR = 2026, MN = 3;                       // period: Ιαν–Μαρ 2026
const MONTH_ROWS = ['Ιαν.','Φεβ.','Μαρ.','Απρ.','Μάι.','Ιουν.','Ιουλ.','Αυγ.','Σεπ.','Οκτ.','Νοε.','Δεκ.'];

/* ---------- the synthetic hospital ---------- */

/* monthly series per clinic; 2026 carries zeros for the future months, exactly
   like the real workbook (parseStats trims them) */
const pad = (v3) => [...v3, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const ADM_CLINICS = [
  { name: 'Παθολογική',    2024: [58,55,60,57,59,56,54,50,57,60,58,56], 2025: [60,57,62,58,60,57,55,51,58,61,59,57], 2026: pad([64,63,60]) },
  { name: 'Γενική Χειρουργική', 2024: [40,38,41,39,40,38,36,33,39,41,40,38], 2025: [42,40,43,41,42,40,38,34,41,43,42,40], 2026: pad([41,39,38]) },
  { name: 'Καρδιολογική',  2024: [25,24,26,25,25,24,23,21,25,26,25,24], 2025: [26,25,27,26,26,25,24,22,26,27,26,25], 2026: pad([34,33,31]) },
  { name: 'Ορθοπεδική',    2024: [22,21,23,22,22,21,20,18,22,23,22,21], 2025: [23,22,24,23,23,22,21,19,23,24,23,22], 2026: pad([21,20,19]) },
  { name: 'Παιδιατρική',   2024: [17,16,18,17,17,16,15,14,17,18,17,16], 2025: [18,17,19,18,18,17,16,15,18,19,18,17], 2026: pad([19,19,18]) },
  { name: 'Γυναικολογική', 2024: [30,29,31,30,30,29,28,25,30,31,30,29], 2025: [31,30,32,31,31,30,29,26,31,32,31,30], 2026: pad([26,26,24]) },
];
const DC_UNITS = [
  { name: 'Ογκολογικό',     2024: [55,53,56,54,55,53,52,48,54,56,55,53], 2025: [57,55,58,56,57,55,54,50,56,58,57,55], 2026: pad([64,66,60]) },
  { name: 'Ρευματολογικό',  2024: [30,29,31,30,30,29,28,26,30,31,30,29], 2025: [31,30,32,31,31,30,29,27,31,32,31,30], 2026: pad([36,39,34]) },
];
const OPD_CLINICS = [
  { name: 'Παθολογικά',   2024: [520,505,530,515,522,508,498,455,518,532,524,510], 2025: [536,520,546,531,538,523,513,469,534,548,540,526], 2026: pad([548,573,594]) },
  { name: 'Γενική Χειρουργική', 2024: [410,398,418,406,412,400,392,358,408,420,413,402], 2025: [422,410,430,418,424,412,404,369,420,432,425,414], 2026: pad([431,451,466]) },
  { name: 'Παιδιατρικά',  2024: [232,225,236,229,233,226,222,203,231,237,233,227], 2025: [239,232,243,236,240,233,229,209,238,244,240,234], 2026: pad([244,256,265]) },
];
const TAEP_BLOCKS = [
  { name: 'ΤΑΕΠ Ενηλίκων', 2024: [372,360,378,366,372,360,354,324,368,380,374,362], 2025: [383,371,389,377,383,371,365,334,379,391,385,373], 2026: pad([399,410,356]) },
  { name: 'ΤΑΕΠ Παίδων',   2024: [133,129,135,131,133,129,127,116,132,136,134,130], 2025: [137,133,139,135,137,133,131,120,136,140,138,134], 2026: pad([143,147,127]) },
];
const OCC_CLINICS = [   // πληρότητα % — one over 100, one under 50 (flag rules)
  { name: 'Παθολογική',    2024: [ 98, 99,100, 97, 98, 96, 94, 90, 97, 99, 98, 97], 2025: [101,102,103,100,101, 99, 97, 93,100,102,101,100], 2026: pad([106,109,104]) },
  { name: 'Γεν. Χειρουργική', 2024: [ 84, 85, 86, 83, 84, 82, 80, 76, 83, 85, 84, 83], 2025: [ 85, 86, 87, 84, 85, 83, 81, 77, 84, 86, 85, 84], 2026: pad([ 86, 88, 84]) },
  { name: 'Γυναικολογική', 2024: [ 52, 53, 54, 51, 52, 50, 48, 44, 51, 53, 52, 51], 2025: [ 48, 49, 50, 47, 48, 46, 44, 40, 47, 49, 48, 47], 2026: pad([ 44, 46, 42]) },
];
const ALOS_CLINICS = [
  { name: 'Παθολογική',  2024: [5.1,5.2,5.0,5.1,5.2,5.1,5.0,4.9,5.1,5.2,5.1,5.0], 2025: [5.0,5.1,4.9,5.0,5.1,5.0,4.9,4.8,5.0,5.1,5.0,4.9], 2026: pad([4.8,4.9,4.7]) },
  { name: 'Γεν. Χειρουργική', 2024: [3.4,3.5,3.3,3.4,3.5,3.4,3.3,3.2,3.4,3.5,3.4,3.3], 2025: [3.3,3.4,3.2,3.3,3.4,3.3,3.2,3.1,3.3,3.4,3.3,3.2], 2026: pad([3.2,3.3,3.1]) },
];
const SURG_CLINICS = [
  { name: 'Γενική Χειρουργική', 2024: [48,46,49,47,48,46,45,41,47,49,48,46], 2025: [50,48,51,49,50,48,47,43,49,51,50,48], 2026: pad([49,47,45]) },
  { name: 'Ορθοπεδική',  2024: [12,11,12,12,12,11,11,10,12,12,12,11], 2025: [13,12,13,13,13,12,12,11,13,13,13,12], 2026: pad([10,10, 8]) },
];

/* every column of the annual table is the same Ιαν–Μαρ window, so «2025» means
   the same period last year — the comparison the report actually makes */
const sumYTD = (series, y) => series[y].slice(0, MN).reduce((a, b) => a + b, 0);
const totalYTD = (list, y) => list.reduce((a, c) => a + sumYTD(c, y), 0);
/* the real sheets carry six year columns; parseAnnualTable needs at least five
   to recognise the header, so the older ones are scaled off 2024 */
const OLD_YEARS = { [YEAR - 5]: 0.88, [YEAR - 4]: 0.92, [YEAR - 3]: 0.96 };
const ytd = (series, y) => (series[y] ? sumYTD(series, y) : Math.round(sumYTD(series, YEAR - 2) * OLD_YEARS[y]));

/* ---------- sheet builders ---------- */

/* Wide monthly block layout:
     [title row]   ·  Παθολογική          Χειρουργική
     [year  row]   Μήνας  2024 2025 2026  2024 2025 2026
     [month rows]  Ιαν.   …                                  */
function monthlyBlocks(clinics, years = [YEAR - 2, YEAR - 1, YEAR]) {
  const width = 1 + clinics.length * years.length;
  const titles = Array(width).fill(null);
  const yrow = Array(width).fill(null);
  yrow[0] = 'Μήνας';
  clinics.forEach((c, i) => {
    const base = 1 + i * years.length;
    titles[base] = c.name;
    years.forEach((y, j) => { yrow[base + j] = y; });
  });
  const rows = MONTH_ROWS.map((label, mi) => {
    const r = Array(width).fill(null);
    r[0] = label;
    clinics.forEach((c, i) => years.forEach((y, j) => { r[1 + i * years.length + j] = c[y][mi]; }));
    return r;
  });
  return [titles, yrow, ...rows];
}

/* Annual per-clinic table at the top of sheets 2/6/7 — YTD per year, ΣΥΝΟΛΟ last */
function annualTable(caption, clinics, cols = [YEAR - 5, YEAR - 4, YEAR - 3, YEAR - 2, YEAR - 1, YEAR]) {
  const head = ['Κλινική', ...cols];
  const body = clinics.map(c => [c.name, ...cols.map(y => ytd(c, y))]);
  const total = ['ΣΥΝΟΛΟ', ...cols.map(y => clinics.reduce((a, c) => a + ytd(c, y), 0))];
  return [[caption], head, ...body, total, []];
}

function statsWorkbook() {
  const wb = XLSX.utils.book_new();

  /* --- ΣΤΟΧΟΣ: title cell carries hospital + genitive period, targets are ANNUAL --- */
  const K = (label, target, cur, prev) => [label, target, cur,
    prev && typeof cur === 'number' ? Math.round(1000 * (cur - prev) / prev) / 10 : null, prev, null];
  const stoxos = [
    ['ΣΤΑΤΙΣΤΙΚΑ ΣΤΟΙΧΕΙΑ ΓΕΝΙΚΟΥ ΝΟΣΟΚΟΜΕΙΟΥ ΛΕΥΚΩΣΙΑΣ ΙΑΝΟΥΑΡΙΟΥ - ΜΑΡΤΙΟΥ 2026'],
    [],
    ['Δείκτης', 'Στόχος', YEAR, '%', YEAR - 1, '%'],
    K('Εισαγωγές Ασθενών', 2400, 595, 619),
    K('Ημερήσια Νοσηλεία Ασθενών', 1200, 299, 274),
    K('Επισκέψεις Εξωτερικά Ιατρεία', 15000, 3828, 3865),
    K('Αριθμός Χειρουργικών Επεμβάσεων', 720, 169, 181),
    K('Μικρά Χειρουργεία', 400, 81, 91),
    K('Αριθμός Ακτινολογικών Εξετάσεων', 6000, 1542, 1498),
    /* data-quality junk the app must survive: text where a number belongs */
    ['Αριθμός Βιοπαθολογικών Εξετάσεων', 90000, 'μ.δ.', null, 21430, null],
    K('Επεμβατικό Καρδιολογικό Εργαστήριο', 160, 35, 40),
    K('Επισκέψεις ΤΑΕΠ Ενηλίκων', 4800, 1165, 1124),
    K('Επισκέψεις ΤΑΕΠ Παίδων', 1700, 417, 402),
    K('Αριθμός Αιμοδιαλύσεων', 3300, 813, 809),
    /* ...and a broken target reference */
    ['Αριθμός Φυσιοθεραπειών', '#REF!', 982, 5.5, 931, null],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stoxos), 'ΣΤΟΧΟΣ');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ...annualTable('ΝΟΣΗΛΕΥΘΕΝΤΕΣ ΑΣΘΕΝΕΙΣ ΑΝΑ ΚΛΙΝΙΚΗ', ADM_CLINICS),
    ...monthlyBlocks(ADM_CLINICS),
  ]), '2. Νοσηλευθέντες');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ΠΛΗΡΟΤΗΤΑ ΚΛΙΝΩΝ (%)'], [],
    ...monthlyBlocks(OCC_CLINICS),
  ]), '3. Πληρότητα κλινών');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ΜΕΣΗ ΔΙΑΡΚΕΙΑ ΝΟΣΗΛΕΙΑΣ'], [],
    ...monthlyBlocks(ALOS_CLINICS),
  ]), '4. Μέση διάρκεια νοσηλείας');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ΤΜΗΜΑ ΑΤΥΧΗΜΑΤΩΝ ΚΑΙ ΕΠΕΙΓΟΝΤΩΝ ΠΕΡΙΣΤΑΤΙΚΩΝ'], [],
    ...monthlyBlocks(TAEP_BLOCKS),
  ]), 'ΤΑΕΠ');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ΗΜΕΡΗΣΙΑ ΝΟΣΗΛΕΙΑ ΑΝΑ ΜΟΝΑΔΑ'], [],
    ...monthlyBlocks(DC_UNITS),
  ]), 'ΗΜΕΡΗΣΙΑ ΝΟΣΗΛΕΙΑ');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ...annualTable('ΕΞΩΤΕΡΙΚΟΙ ΑΣΘΕΝΕΙΣ ΑΝΑ ΚΛΙΝΙΚΗ', OPD_CLINICS),
    ...monthlyBlocks(OPD_CLINICS),
  ]), '6. Εξωτερικοί ασθενείς');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ...annualTable('ΧΕΙΡΟΥΡΓΙΚΕΣ ΕΠΕΜΒΑΣΕΙΣ', SURG_CLINICS),
    ...monthlyBlocks(SURG_CLINICS),
  ]), '7. Χειρουργικές επεμβάσεις');

  /* «Μικρά Χειρουργεία»: a per-clinic table by year, not a monthly block */
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Κλινική', ...[YEAR - 5, YEAR - 4, YEAR - 3, YEAR - 2, YEAR - 1, YEAR, YEAR + 1].map(y => `${y}  Νο`)],
    [],
    ['Γενική Χειρουργική', 41, 44, 47, 50, 52, 48, null],
    ['Ορθοπεδική',  18, 19, 21, 22, 24, 20, null],   // the sheet spells it with -ε-
  ]), 'Μικρά Χειρουργεία');

  /* bed snapshot, with the group subtotals the real sheet carries */
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [`${['','Ιανουάριος','Φεβρουάριος','Μάρτιος'][MN]} ${YEAR}`],
    ['Κλινική', 'Κλίνες', 'Αναλογία', 'Ημερήσια Φροντίδα'],
    [null, 'Αρ.', '%', 'Αρ.'],
    ['Γενική Χειρουργική', 54, 0.31, null],
    ['Ορθοπαιδική', 22, 0.12, null],
    ['Γυναικολογική', 18, 0.10, null],
    ['Σύνολο Χειρουργικών Κλινικών', 94, 0.53, null],
    ['Παθολογική', 52, 0.29, null],
    ['Καρδιολογική', 20, 0.11, null],
    ['Ογκολογικό', 10, 0.06, 8],
    ['Σύνολο Παθολογικών Κλινικών', 82, 0.47, 8],
    ['ΣΥΝΟΛΟ ΚΛΙΝΩΝ', 176, 1, 8],
  ]), 'Συνολο Κλινών');

  /* «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ»: ΟΑΥ revenue per clinic, two periods side by side.
     «Ογκολογία: …» is billed on two lines that belong to one clinic, and the
     rows after ΣΥΝΟΛΟ are pharmacy lines and adjustments, not clinics. */
  const rev = (name, c, p) => [name, ...c, c.reduce((a, b) => a + b, 0), ...p, p.reduce((a, b) => a + b, 0)];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ΠΙΝΑΚΑΣ ΣΥΝΟΛΙΚΩΝ ΕΣΟΔΩΝ'],
    [],
    [null, `JAN-ΜΑΡ ${YEAR}`, null, null, null, `JAN-ΜΑΡ${YEAR - 1}`],
    ['Κλινική /Τμήμα', 'INPATIENT', 'OUTPATIENT', 'DAY CARE', 'TOTAL', 'INPATIENT', 'OUTPATIENT', 'DAY CARE', 'TOTAL'],
    [null, '€', '€', '€', '€', '€', '€', '€', '€'],
    rev('Παθολογία',            [214600, 18400, 9200],  [232700, 17900, 8100]),
    rev('Γενική Χειρουργική',   [186900, 12300, 4100],  [201400, 11800, 5200]),
    rev('Καρδιολογία',          [163400,  9800, 2600],  [128900,  9200,    0]),
    rev('Ορθοπαιδική',          [ 98200,  7400,  500],  [ 86300,  7100,  300]),
    rev('Παιδιατρική',          [ 61500,  6900,  700],  [ 58800,  6400,  600]),
    rev('Γυναικολογία',         [ 54300,  5200,  200],  [ 66100,  5600,  400]),
    rev('Ογκολογία: Ιατρική',   [ 21400,     0, 12800], [ 19100,     0, 11200]),
    rev('Ογκολογία: Παθολογική',[     0,  3100,     0], [     0,  2800,     0]),
    rev('Νεφρολογία',           [ 18900,  4100, 41200], [ 16400,  3900, 38700]),
    ['Σύνολο', 819200, 67200, 71300, 957700, 809700, 64700, 64500, 938900],
    ['Αναλώσιμα', null, 508, null, 508, null, 631, null, 631],
    ['Προσαρμογή 05/2025', -12000, null, null, -12000, 0, null, null, 0],
  ]), 'ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [`ΛΟΓΑΡΙΑΣΜΟΣ ΑΠΟΤΕΛΕΣΜΑΤΩΝ ΓΙΑ ΤΗΝ ΠΕΡΙΟΔΟ ΙΑΝΟΥΑΡΙΟΣ - ΜΑΡΤΙΟΣ ${YEAR}`],
    [],
    [null, YEAR, YEAR - 1],
    ['ΕΣΟΔΑ'],
    ['Ενδονοσοκομειακή Φρ. ΟΑΥ', 819200, 809700],
    ['Εξωνοσοκομειακή Φρ. ΟΑΥ', 67200, 64700],
    ['Ημερήσιες Νοσηλείες ΟΑΥ', 71300, 64500],
    ['ΤΑΕΠ Ενηλίκων ΟΑΥ', 84500, 78200],
    ['ΥΠΑΣ ΟΑΥ²'],
    ['ΣΥΝΟΛΟ ΕΣΟΔΩΝ', 1042200, 1017100],
    [],
    ['ΕΞΟΔΑ'],
    ['Έξοδα Μισθοδοσίας'],
    ['Συμβόλαιο ΟΚΥπΥ', 611400, 588300],
    ['Σύνολο', 611400, 588300],
    ['Λειτουργικές Δαπάνες'],
    ['Ανάλωση Προμηθειών', 288300, 301700],
    ['Σύνολο', 288300, 301700],
    ['ΣΥΝΟΛΟ ΕΞΟΔΩΝ', 899700, 890000],
    [],
    ['ΠΛΕΟΝΑΣΜΑ / (ΕΛΛΕΙΜΜΑ)', 142500, -9400],
    ['² ΥΠΑΣ = Υπηρεσία Ασθενοφόρων'],
  ]), 'P&L');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Υ.Γ.Ο.Σ.', YEAR, YEAR - 1, YEAR - 2, null, null, 'Αρμόδιες Αρχές', null, YEAR, YEAR - 1],
    [null, '€', '€', '€'],
    ['Μεταμοσχευτική Κλινική', 114899, 112646, 110437, null, null, 'Δημόσια Υγεία', null, 31522, 31449],
    ['Κέντρο Τραύματος', 108513, 106385, 104299],
    ['ΣΥΝΟΛΟ', 223412, 219031, 214736],
    ['Για να βρω τα αναλυτικά ποσά υπολογίζω 2% αύξηση.'],
  ]), 'ΥΓΟΣ&ΤΑΕΠ');

  return wb;
}

/* ---------- IS Auditor ----------
   One file per submission month; discharges are dated independently, so the
   January file mostly carries December discharges. */
const IS_COLUMNS = ['Billing Provider Name','Case Nbr','DRG Id','Procedure Id','Hospitalisation Type',
  'Admission Type','Discharge Type','Quantity','Adjusted Cost Weight','Actual Length Of Stay',
  'DRG/FF Total Amount(Hospital + Total Doctor)','Procedures Total Amount','Claim Speciality',
  'Discharge Date','Submission Date'];

/* `Claim Speciality` is written in English in the ΟΑΥ files; these map onto the
   Greek clinic names of the stats workbook. NEPHROLOGY deliberately has no
   clinic on the stats side — it exercises the «unmatched specialty» path. */
const IS_SPECIALITIES = ['INTERNAL MEDICINE','GENERAL SURGERY','CARDIOLOGY','ORTHOPAEDICS','PAEDIATRICS','OBSTETRICS AND GYNAECOLOGY'];
const NGH = 'ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ';
const MAK = 'ΜΑΚΑΡΕΙΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ';   // must not be counted as Λευκωσίας

const dmy = (y, m, d) => `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;

/* per submission month: [inpatient DRG discharges by discharge month, day-care, dialysis sessions] */
const IS_PLAN = {
  1: { drg: { '2025-12': 40, '2026-1': 120 }, day: { '2026-1': 62 }, dial: { '2026-1': 250 } },
  2: { drg: { '2026-1':  62, '2026-2': 150 }, day: { '2026-2': 70 }, dial: { '2026-2': 258 } },
  3: { drg: { '2026-2':  30, '2026-3': 128 }, day: { '2026-3': 66 }, dial: { '2026-3': 240 } },
  4: { drg: { '2026-3':  10 },                day: {},               dial: {} },
};

function isWorkbook(subMonth) {
  const rnd = lcg(1000 + subMonth);
  const plan = IS_PLAN[subMonth];
  const rows = [IS_COLUMNS];
  let caseSeq = subMonth * 10000;

  /* every claim of a run is filed in that run's month, with a handful of old
     stragglers — which is what makes the modal month the run's month */
  const filed = (i) => (i % 40 === 7
    ? `${dmy(2024, 1 + (i % 11), 1 + (i % 27))} 09:12:03`
    : `${dmy(2026, subMonth, 1 + (i % 27))} 09:12:03`);
  let filedSeq = 0;
  const push = (o) => rows.push(IS_COLUMNS.map(c =>
    (c === 'Submission Date' ? filed(filedSeq++) : (c in o ? o[c] : null))));
  const dischargeCell = (y, m, d) =>
    /* the real files mix text dd/mm/yyyy with Excel serial dates — cover both */
    (d % 7 === 0) ? new Date(Date.UTC(y, m - 1, d)) : dmy(y, m, d);

  for (const [key, n] of Object.entries(plan.drg)) {
    const [y, m] = key.split('-').map(Number);
    for (let i = 0; i < n; i++) {
      const day = 1 + Math.floor(rnd() * 27);
      push({
        'Billing Provider Name': NGH,
        'Case Nbr': `C${++caseSeq}`,
        'DRG Id': `F${60 + Math.floor(rnd() * 20)}A`,
        'Procedure Id': '',
        'Hospitalisation Type': '1 - Regular',
        'Admission Type': rnd() < 0.62 ? 'E - Emergency' : 'P - Planned',
        'Discharge Type': '1 - Home',
        'Quantity': 1,
        'Adjusted Cost Weight': Math.round((0.6 + rnd() * 1.8) * 1000) / 1000,
        'Actual Length Of Stay': 1 + Math.floor(rnd() * 9),
        'DRG/FF Total Amount(Hospital + Total Doctor)': Math.round(900 + rnd() * 4200),
        'Procedures Total Amount': 0,
        'Claim Speciality': IS_SPECIALITIES[Math.floor(rnd() * IS_SPECIALITIES.length)],
        'Discharge Date': dischargeCell(y, m, day),
      });
    }
  }
  for (const [key, n] of Object.entries(plan.day)) {
    const [y, m] = key.split('-').map(Number);
    for (let i = 0; i < n; i++) {
      push({
        'Billing Provider Name': NGH,
        'Case Nbr': `D${++caseSeq}`,
        'DRG Id': 'nan',
        'Procedure Id': 'ZA-100',
        'Hospitalisation Type': '3 - Day care',
        'Admission Type': 'P - Planned',
        'Discharge Type': '1 - Home',
        'Quantity': 1,
        'Adjusted Cost Weight': 0,
        'Actual Length Of Stay': 0,
        'DRG/FF Total Amount(Hospital + Total Doctor)': Math.round(180 + rnd() * 400),
        'Procedures Total Amount': Math.round(200 + rnd() * 900),   // biologics / chemo
        'Claim Speciality': rnd() < 0.6 ? 'ONCOLOGY' : 'RHEUMATOLOGY',
        'Discharge Date': dmy(y, m, 1 + Math.floor(rnd() * 27)),
      });
    }
  }
  for (const [key, n] of Object.entries(plan.dial)) {
    const [y, m] = key.split('-').map(Number);
    /* dialysis is billed in batches: volume is Σ Quantity, not a row count */
    const batches = Math.ceil(n / 10);
    for (let i = 0; i < batches; i++) {
      const qty = i === batches - 1 ? n - 10 * (batches - 1) : 10;
      push({
        'Billing Provider Name': NGH,
        'Case Nbr': `H${++caseSeq}`,
        'DRG Id': '',
        'Procedure Id': 'ZF-041 Haemodialysis',
        'Hospitalisation Type': '2 - Outpatient',
        'Admission Type': 'P - Planned',
        'Discharge Type': '1 - Home',
        'Quantity': qty,
        'Adjusted Cost Weight': 0,
        'Actual Length Of Stay': 0,
        'DRG/FF Total Amount(Hospital + Total Doctor)': qty * 92,
        'Procedures Total Amount': qty * 14,
        'Claim Speciality': 'NEPHROLOGY',   // no clinic on the stats side
        'Discharge Date': dmy(y, m, 1 + Math.floor(rnd() * 27)),
      });
    }
  }
  /* a specialty the stats workbook has no clinic for: it is billed, it is not
     day-care and not DRG, and it must stay visible instead of being folded into
     someone else's row */
  for (let i = 0; i < 4; i++) {
    push({
      'Billing Provider Name': NGH,
      'Case Nbr': `P${++caseSeq}`,
      'DRG Id': 'nan',
      'Procedure Id': 'ZP-200',
      'Hospitalisation Type': '2 - Outpatient',
      'Admission Type': 'P - Planned',
      'Discharge Type': '1 - Home',
      'Quantity': 1,
      'Adjusted Cost Weight': 0,
      'Actual Length Of Stay': 0,
      'DRG/FF Total Amount(Hospital + Total Doctor)': 640,
      'Procedures Total Amount': 120,
      'Claim Speciality': 'PALLIATIVE CARE',
      'Discharge Date': dmy(2026, Math.min(subMonth, 3), 6 + i),
    });
  }

  /* Makarios rows in the same file — they must stay out of the Nicosia figures */
  for (let i = 0; i < 12; i++) {
    push({
      'Billing Provider Name': MAK,
      'Case Nbr': `M${++caseSeq}`,
      'DRG Id': 'P60B',
      'Procedure Id': '',
      'Hospitalisation Type': '1 - Regular',
      'Admission Type': 'E - Emergency',
      'Discharge Type': '1 - Home',
      'Quantity': 1,
      'Adjusted Cost Weight': 1.2,
      'Actual Length Of Stay': 3,
      'DRG/FF Total Amount(Hospital + Total Doctor)': 2100,
      'Procedures Total Amount': 0,
      'Claim Speciality': 'PAEDIATRICS',
      'Discharge Date': dmy(2026, Math.min(subMonth, 3), 10),
    });
  }
  /* reversals: two credited cases, one of them resubmitted (net back to positive) */
  if (subMonth >= 2) {
    const reversed = `C${subMonth * 10000 + 5}`;
    push({ 'Billing Provider Name': NGH, 'Case Nbr': reversed, 'DRG Id': 'F62A', 'Procedure Id': '',
      'Hospitalisation Type': '1 - Regular', 'Admission Type': 'E - Emergency', 'Discharge Type': '1 - Home',
      'Quantity': 1, 'Adjusted Cost Weight': 1.1, 'Actual Length Of Stay': 4,
      'DRG/FF Total Amount(Hospital + Total Doctor)': -2400, 'Procedures Total Amount': 0,
      'Claim Speciality': 'CARDIOLOGY', 'Discharge Date': dmy(2026, subMonth, 12) });
    push({ 'Billing Provider Name': NGH, 'Case Nbr': reversed, 'DRG Id': 'F62A', 'Procedure Id': '',
      'Hospitalisation Type': '1 - Regular', 'Admission Type': 'E - Emergency', 'Discharge Type': '1 - Home',
      'Quantity': 1, 'Adjusted Cost Weight': 1.1, 'Actual Length Of Stay': 4,
      'DRG/FF Total Amount(Hospital + Total Doctor)': 2400, 'Procedures Total Amount': 0,
      'Claim Speciality': 'CARDIOLOGY', 'Discharge Date': dmy(2026, subMonth, 12) });
    /* left open — no resubmission */
    push({ 'Billing Provider Name': NGH, 'Case Nbr': `X${subMonth}9`, 'DRG Id': 'F71B', 'Procedure Id': '',
      'Hospitalisation Type': '1 - Regular', 'Admission Type': 'P - Planned', 'Discharge Type': '1 - Home',
      'Quantity': 1, 'Adjusted Cost Weight': 0.9, 'Actual Length Of Stay': 2,
      'DRG/FF Total Amount(Hospital + Total Doctor)': -1750, 'Procedures Total Amount': 0,
      'Claim Speciality': 'GENERAL SURGERY', 'Discharge Date': dmy(2026, subMonth, 18) });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'IS Auditor Report');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Lookup'], ['DRG']]), 'Lists');
  return wb;
}

/* ---------- ALL and AE (HIO payments: € amounts only, no visit counts) ---------- */
const AE_PLAN = { 1: { F1054: 28562, F1106: 10705 }, 2: { F1054: 29380, F1106: 11020 }, 3: { F1054: 25940, F1106: 9615 } };
const OP_FFS_PLAN = { 1: 41250, 2: 43110, 3: 44980 };

function allaeWorkbook(month) {
  const mm = String(month).padStart(2, '0');
  const wb = XLSX.utils.book_new();

  /* ALL tab: code | vendor name (carries the hospital tag) | … | cost centre | … | account | amount
     F1054 uses the «-NGH-» form, F1106 the « NGH-» (space) form. */
  const all = [
    ['Code', 'Vendor Name', 'Doc', 'Ref', 'Cost Centre', 'Period', 'Account', 'Amount'],
    ['F1054', 'NICOSIA GENERAL HOSPITAL INCOME-NGH-F1054', 'D1', 'R1', 'OUTPATIENT CLINICS', mm, 'Fee for Service - Specialists', OP_FFS_PLAN[month]],
    ['F1054', 'NICOSIA GENERAL HOSPITAL INCOME-NGH-F1054', 'D2', 'R2', 'PHARMACEUTICALS PHARMA', mm, 'Fee for Service - Drugs', 88400],
    ['F1054', 'NICOSIA GENERAL HOSPITAL INCOME-NGH-F1054', 'D3', 'R3', 'BASIC TESTS', mm, 'Fee for Service - Lab', 15300],
    ['F1054', 'NICOSIA GENERAL HOSPITAL INCOME-NGH-F1054', 'D4', 'R4', 'Inpatient DRGS', mm, 'Fee per diem - Inpatient', 512000],
    ['F1054', 'NICOSIA GENERAL HOSPITAL INCOME-NGH-F1054', 'D5', 'R5', 'OUTPATIENT CLINICS', mm, 'Capitation - not FFS', 9000],
    ['F1106', 'NICOSIA GENERAL PAEDIATRIC INCOME NGH-F1106', 'D6', 'R6', 'OUTPATIENT CLINICS', mm, 'Fee for Service - Paediatrics', 12800],
    ['F1200', 'OTHER PROVIDER WITHOUT TAG', 'D7', 'R7', 'OUTPATIENT CLINICS', mm, 'Fee for Service - Other', 4100],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(all), `ALL ${mm}.${YEAR}`);

  /* A&E tab: the amount is the last number on the row */
  const ae = [
    ['Code', 'Provider', 'Account', 'Units', 'Amount'],
    ['F1054', 'NICOSIA GENERAL HOSPITAL', 'A&E Fee for service', 0, AE_PLAN[month].F1054],
    ['F1054', 'NICOSIA GENERAL HOSPITAL', 'A&E Co-payments', 0, -1200],
    ['F1106', 'NICOSIA GENERAL HOSPITAL — ΠΑΙΔΩΝ', 'A&E Fee for service', 0, AE_PLAN[month].F1106],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ae), `A&E ${mm}.${YEAR}`);
  return wb;
}

/* ---------- OS paid claims ----------
   One file per invoice month per provider code. The April file is the «next
   month» that matures January. Claim IDs repeat across files on purpose —
   the app dedupes by CLAIM ID. */
const OS_CODES = ['F1054'];   // the ΤΑΕΠ comparison is adults-only, as in the test set
const OS_PLAN = {
  F1054: { 1: { ae: 322, op: 1015 }, 2: { ae: 330, op: 1050 }, 3: { ae: 150, op: 500 }, 4: { ae: 40, op: 120 } },
};
const OS_SPECS = ['CARDIOLOGY', 'GENERAL SURGERY', 'PAEDIATRICS', 'ORTHOPAEDICS'];

function osWorkbook(code, month) {
  const rnd = lcg(month * 31 + (code === 'F1054' ? 7 : 13));
  const plan = OS_PLAN[code][month];
  const rows = [['CLAIM ID', 'VISIT ID', 'DR SEGMENT', 'DR SPECIALITY', 'INVOICE DATE', 'HIO REIMB.', 'PATIENT NAME']];
  let seq = 0;
  const add = (visit, seg, spec) => {
    /* a visit can produce more than one paid claim line */
    const lines = 1 + (rnd() < 0.3 ? 1 : 0);
    for (let l = 0; l < lines; l++) {
      rows.push([`${code}-${month}-${++seq}`, visit, seg, spec,
        month % 2 ? `${YEAR}-${String(month).padStart(2, '0')}` : new Date(Date.UTC(YEAR, month - 1, 15)),
        Math.round((18 + rnd() * 60) * 100) / 100, '—']);
    }
  };
  for (let i = 0; i < plan.ae; i++) add(`${code}V${month}A${i}`, 'Accident & Emergency Department', 'EMERGENCY MEDICINE');
  for (let i = 0; i < plan.op; i++) add(`${code}V${month}O${i}`, 'Outpatient Specialists', OS_SPECS[i % OS_SPECS.length]);
  /* lab/imaging specialties: excluded from the outpatient comparison */
  for (let i = 0; i < Math.round(plan.op * 0.4); i++) add(`${code}V${month}L${i}`, 'Outpatient Specialists', 'DIAGNOSTIC RADIOLOGY');
  /* the previous month's tail is re-sent in every run — must dedupe away */
  if (month > 1) {
    const prev = OS_PLAN[code][month - 1];
    for (let i = 0; i < Math.min(20, prev.ae); i++) {
      rows.push([`${code}-${month - 1}-${i + 1}`, `${code}V${month - 1}A${i}`, 'Accident & Emergency Department',
        'EMERGENCY MEDICINE', `${YEAR}-${String(month - 1).padStart(2, '0')}`, 25, '—']);
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Paid Claims');
  return wb;
}

/* ---------- «Έκθεση Στατιστικών» (.docx) ----------
   A Word file is a ZIP of XML. Only the parts the reader looks at are written,
   and every entry is stored uncompressed — which the app's ZIP reader supports
   without inflating, so the fixture needs no compression library. */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function storedZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);                       // stored
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    const dir = Buffer.alloc(46 + nameBuf.length);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    nameBuf.copy(dir, 46);
    locals.push(local, data); central.push(dir);
    offset += local.length + data.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}

const REPORT_PARAGRAPHS = [
  'ΣΤΑΤΙΣΤΙΚΑ ΣΤΟΙΧΕΙΑ 2019-2026',
  'Περίοδος Σύγκρισης: Ιανουάριος - Μάρτιος 2019-2026',
  'Αγαπητοί Διευθυντές Κλινικών / Τμημάτων,',
  'ΑΝΑΛΥΣΗ ΣΤΑΤΙΣΤΙΚΩΝ ΔΕΔΟΜΕΝΩΝ',
  'Επισκέψεις Εξωτερικών Ιατρείων (Διαφάνεια 6)',
  'Οι επισκέψεις στα Εξωτερικά Ιατρεία παρουσίασαν μικρή αύξηση σε σχέση με το 2025.',
  'Παθολογική',
  '2026 → 1.715',
  '2025 → 1.602',
  'Η Ορθοπαιδική και η Καρδιολογική συνέχισαν την ανοδική τους πορεία.',
  'Εισαγωγές Ασθενών (Διαφάνεια 8)',
  'Οι εισαγωγές της Γενικής Χειρουργικής υποχώρησαν σε σχέση με την αντίστοιχη περίοδο του 2025.',
];

function reportDocx() {
  const body = REPORT_PARAGRAPHS
    .map(p => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`)
    .join('');
  return storedZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`],
  ]);
}

/* ---------- an unrecognised file, to prove the error path ---------- */
function junkWorkbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Λογαριασμός', 'Ποσό'], ['Χαρτικά', 120]]), 'Φύλλο1');
  return wb;
}

/* ---------- write them out ---------- */
const write = async (wb, name) => {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  await writeFile(join(OUT_DIR, name), buf);
  return name;
};

export const FIXTURES = {
  stats: 'ΣΤΑΤΙΣΤΙΚΑ ΣΤΟΙΧΕΙΑ ΓΝ ΛΕΥΚΩΣΙΑΣ 03.2026.xlsx',
  is: [1, 2, 3, 4].map(m => `IS Auditor Report ${String(m).padStart(2, '0')}.2026.xlsx`),
  allae: [1, 2, 3].map(m => `ALL and AE ${String(m).padStart(2, '0')}.2026.xlsx`),
  os: OS_CODES.flatMap(c => [1, 2, 3, 4].map(m => `${c} Πληρωμένες Απαιτήσεις OS ${String(m).padStart(2, '0')}.2026.xlsx`)),
  junk: 'Τιμολόγιο Προμηθευτή.xlsx',
  report: 'Έκθεση Στατιστικών ΓΝ Λευκωσίας Ιανουάριος Μάρτιος 2026.docx',
};

export async function makeFixtures({ quiet = false } = {}) {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  await write(statsWorkbook(), FIXTURES.stats);
  for (let m = 1; m <= 4; m++) await write(isWorkbook(m), FIXTURES.is[m - 1]);
  for (let m = 1; m <= 3; m++) await write(allaeWorkbook(m), FIXTURES.allae[m - 1]);
  let i = 0;
  for (const c of OS_CODES) for (let m = 1; m <= 4; m++) await write(osWorkbook(c, m), FIXTURES.os[i++]);
  await write(junkWorkbook(), FIXTURES.junk);
  await writeFile(join(OUT_DIR, FIXTURES.report), reportDocx());
  if (!quiet) console.log(`✓ ${OUT_DIR}`);
  return OUT_DIR;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  makeFixtures().catch(e => { console.error(e); process.exit(1); });
}
