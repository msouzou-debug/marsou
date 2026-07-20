#!/usr/bin/env node
/* Έλεγχοι αποδοχής πάνω στα συνθετικά αρχεία του test/fixtures/. */
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const C = require('../src/core');
const { MONTH_INPUTS, CONSO, DISCOUNTS } = require('./fixture-data');

const DIR = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const { IS_FILES, CONSO_FILES } = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL:', label); }
}
function close(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, label + ' (got ' + a + ', want ' + b + ' ±' + tol + ')');
}
function section(t) { console.log('▸ ' + t); }

function readWb(fn) {
  return XLSX.read(fs.readFileSync(path.join(DIR, fn)), { type: 'buffer' });
}

/* ---------- 1. Ανίχνευση μήνα/έτους ---------- */
section('Ανίχνευση μήνα/έτους από ονόματα αρχείων');
[
  ['IS_Auditor_Report_JAN_2026.xlsx', 1, 2026],
  ['IS Auditor Report Φεβρουαρίου 2026.xlsx', 2, 2026],
  ['IS_Auditor_March_26.xlsx', 3, 2026],
  ['is_auditor_2026-04.xlsx', 4, 2026],
  ['IS_Auditor_ΜΑΪΟΥ_2026.xlsx', 5, 2026],
  ['ΙΑΝΟΥΑΡΙΟΣ 2026', 1, 2026],
  ['ΜΑΪΟΣ 2026', 5, 2026],
  ['report_December_2026.xlsx', 12, 2026],
  ['claims 2026_11 final.xlsx', 11, 2026],
  ['Αύγουστος_2026.xlsx', 8, 2026]
].forEach(([name, m, y]) => {
  const d = C.detectMonthYear(name);
  ok(d.month === m && d.year === y, name + ' → ' + JSON.stringify(d) + ' (want ' + m + '/' + y + ')');
});
ok(C.detectMonthYear('random_file.xlsx').month === null, 'άγνωστο όνομα → month null');

/* ---------- 2. IS Auditor parsing ---------- */
section('Ανάγνωση IS Auditor Reports');
const isParsed = {};
for (const m of Object.keys(IS_FILES).map(Number)) {
  const p = C.parseISAuditor(XLSX, readWb(IS_FILES[m]), IS_FILES[m]);
  isParsed[m] = p;
  ok(p.ok && !p.error, 'μήνας ' + m + ': ok χωρίς σφάλμα' + (p.error ? ' — ' + p.error : ''));
  ok(!p.incomplete, 'μήνας ' + m + ': δεν σημαίνεται ελλιπές (' + p.totalRows + ' γραμμές)');
  ok(p.specialisedRows >= 200 && p.specialisedRows <= 600, 'μήνας ' + m + ': εύλογος αριθμός Specialised (' + p.specialisedRows + ')');
  for (const code of Object.keys(MONTH_INPUTS[m])) {
    const want = MONTH_INPUTS[m][code], got = p.perProvider[code];
    close(got.pos, want.pos, 1e-6, m + '/' + code + ' pos');
    close(got.posAe, want.posAe, 1e-6, m + '/' + code + ' posAe');
    close(got.neg, want.neg, 1e-6, m + '/' + code + ' neg');
    close(got.negAe, want.negAe, 1e-6, m + '/' + code + ' negAe');
  }
}
{
  const p = C.parseISAuditor(XLSX, readWb('IS_Auditor_TRUNCATED_JAN_2026.xlsx'), 'trunc');
  ok(p.ok && p.incomplete, 'κομμένο αρχείο → σημαία «πιθανώς ελλιπές»');
  const bad = C.parseISAuditor(XLSX, readWb('IS_Auditor_BAD_COLUMNS.xlsx'), 'bad');
  ok(!bad.ok && /AE Referral/.test(bad.error || ''), 'αρχείο χωρίς στήλη AE Referral → σφάλμα');
}

/* ---------- 3. Conso parsing ---------- */
section('Ανάγνωση Conso >15%');
const consoParsed = {};
for (const m of Object.keys(CONSO_FILES).map(Number)) {
  const p = C.parseConso(XLSX, readWb(CONSO_FILES[m]), CONSO_FILES[m]);
  consoParsed[m] = p;
  ok(p.ok, 'conso μήνας ' + m + ' ok');
  for (const code of Object.keys(CONSO[m])) {
    close(p.over15[code] || 0, CONSO[m][code], 1e-9, 'conso ' + m + '/' + code);
  }
  ok(!('TOTAL' in p.over15), 'φύλλο TOTAL αγνοείται');
  ok(p.over15['F1055'] === undefined, 'νοσηλευτήριο εκτός αρχείου → απουσιάζει (θα γίνει 0)');
  const det = C.detectMonthYear(p.b1);
  ok(det.month === m, 'B1 «' + p.b1 + '» → μήνας ' + m);
}

{
  // «Βρόμικη» διάταξη σαν τα πραγματικά αρχεία: ετικέτα εκτός στήλης B /
  // κεφαλαία / κενά, κωδικός μέσα σε μεγαλύτερο όνομα φύλλου, τιμή ως κείμενο.
  const p = C.parseConso(XLSX, readWb('Conso_MESSY_LAYOUT.xlsx'), 'messy');
  ok(p.ok, 'messy conso: parse ok');
  close(p.over15['F1047'] || 0, 45, 1e-9, 'messy: «f1047 - ΓΝ Λεμεσού» + ΕΞΕΙΔΙΚΕΥΜΕΝΑ στη στήλη A → 45');
  close(p.over15['F1054'] || 0, 223.85, 1e-9, 'messy: «Εξειδικευμένα » με κενό + τιμή-κείμενο → 223.85');
  ok(p.over15['F1050'] === undefined, 'messy: φύλλο χωρίς γραμμή «Εξειδικευμένα» → καμία τιμή');
  ok((p.warnings || []).some(w => /F1050/.test(w)), 'messy: προειδοποίηση για το F1050');
  ok(Object.values(p.over15).every(v => v !== 9999), 'messy: το φύλλο ΣΥΝΟΛΟ αγνοείται');
  const det = C.detectMonthYear(p.b1);
  ok(det.month === 1 && det.year === 2026, 'messy: B1 πρώτου φύλλου → Ιανουάριος 2026');
}

/* ---------- 4. Αρχείο εκπτώσεων ---------- */
section('Ανάγνωση αρχείου εκπτώσεων ΟΑΥ');
{
  const p = C.parseDiscountFile(XLSX, readWb('ΟΑΥ_Εκπτώσεις_2026.xlsx'), 'disc');
  ok(p.ok, 'parse ok');
  ok(p.entries.length === 6, '6 εγγραφές (5×2026 + 1×2025), got ' + p.entries.length);
  for (const m of Object.keys(DISCOUNTS).map(Number)) {
    const e = p.entries.find(e => e.year === 2026 && e.month === m);
    ok(e && Math.abs(e.pct - DISCOUNTS[m]) < 1e-9, 'έκπτωση 2026/' + m);
  }
  ok(p.entries.some(e => e.year === 2025 && e.month === 12), 'εγγραφή 2025/Δεκεμβρίου διαβάζεται');
}

/* ---------- 5. Υπολογισμός ---------- */
section('Υπολογισμός — δείγματα-άγκυρες προδιαγραφών');
const assumptions = C.defaultAssumptions();

function monthRows(m) {
  return C.computeMonthRows(m, {
    is: isParsed[m].perProvider,
    over15: consoParsed[m] ? consoParsed[m].over15 : {}
  }, assumptions);
}

{
  const jan = monthRows(1);
  const f54 = jan.find(r => r.code === 'F1054');
  close(f54.pos, 1260.42, 1e-6, 'F1054 Ιαν pos');
  close(f54.posAe, 734.31, 1e-6, 'F1054 Ιαν posAe');
  close(f54.over15, 223.85, 1e-9, 'F1054 Ιαν over15');
  close(f54.counted, 749.96, 1e-6, 'F1054 Ιαν προσμετρώμενες');
  close(f54.agreedMonthly, 5239 / 12, 1e-9, 'F1054 Ιαν συμφωνημένες μηνιαίες (436.58)');
  close(f54.excess, 749.96 - 5239 / 12, 1e-6, 'F1054 Ιαν υπέρβαση (≈313.38)');
  // Οι προδιαγραφές δίνουν −613.054 € με τα πλήρη (μη στρογγυλεμένα) δεδομένα πηγής·
  // με τις στρογγυλεμένες τιμές pos/posAe των προδιαγραφών βγαίνει −613.067 €.
  close(f54.impact, -613054, 100, 'F1054 Ιαν επίπτωση ≈ −613.054 €');
  const f25 = jan.find(r => r.code === 'F1025');
  ok(f25.amberFlag === true, 'F1025 Ιαν: πορτοκαλί σήμανση (posAe>0, over15=0)');
  ok(f54.amberFlag === false, 'F1054 Ιαν: χωρίς πορτοκαλί σήμανση');
}
{
  const mar = monthRows(3);
  const f47 = mar.find(r => r.code === 'F1047');
  close(f47.excess, 194.1, 1e-6, 'F1047 Μαρ υπέρβαση 194.1');
  close(f47.impact, -506994, 5, 'F1047 Μαρ επίπτωση ≈ −506.994 €');
}
{
  const may = monthRows(5);
  ok(may.every(r => r.impact === 0), 'Μάιος: όλες οι επιπτώσεις 0 € (έκπτωση 0%)');
  const f54 = may.find(r => r.code === 'F1054');
  close(f54.excess, 48.1, 1e-6, 'F1054 Μάιος υπέρβαση 48.1 (εμφανίζεται παρά το 0%)');
}
{
  // Ανεξάρτητος επανυπολογισμός του γενικού συνόλου από τα δεδομένα εισόδου.
  let expectedTotal = 0;
  for (const m of [1, 2, 3, 4, 5]) {
    for (const h of C.HOSPITALS) {
      const t = MONTH_INPUTS[m][h.code];
      const o15 = (CONSO[m] && CONSO[m][h.code]) || 0;
      const counted = t.pos - t.posAe + o15; // toggle ΟΧΙ
      const excess = Math.max(0, counted - h.agreed / 12);
      expectedTotal += excess * h.brH1 * DISCOUNTS[m];
    }
  }
  const total = [1, 2, 3, 4, 5].flatMap(monthRows).reduce((s, r) => s + r.impact, 0);
  close(total, expectedTotal, 0.01, 'γενικό σύνολο επίπτωσης = ανεξάρτητος επανυπολογισμός (' + Math.round(expectedTotal) + ' €)');
}
{
  // Διακόπτης πιστωτικών ΝΑΙ: το counted του F1054 Ιαν μειώνεται κατά neg−negAe = −6.3.
  const aYes = C.defaultAssumptions();
  aYes.creditToggle = 'ΝΑΙ';
  const jan = C.computeMonthRows(1, { is: isParsed[1].perProvider, over15: consoParsed[1].over15 }, aYes);
  const f54 = jan.find(r => r.code === 'F1054');
  close(f54.counted, 749.96 - 6.3, 1e-6, 'toggle ΝΑΙ: counted −6.3');
}

/* ---------- 6. Έλεγχοι εξαγωγής ---------- */
section('Έλεγχοι πριν την εξαγωγή');
function baseState() {
  return {
    isFiles: [1, 2, 3, 4, 5].map(m => ({ filename: IS_FILES[m], month: m, parsed: isParsed[m], includeAnyway: false })),
    consoFiles: Object.keys(CONSO_FILES).map(Number).map(m => ({ filename: CONSO_FILES[m], month: m, parsed: consoParsed[m] })),
    assumptions: C.defaultAssumptions()
  };
}
ok(C.validateForExport(baseState()).length === 0, 'πλήρης κατάσταση Ιαν–Μάι → κανένα σφάλμα');
{
  const s = baseState();
  s.assumptions.discounts[3] = null;
  const errs = C.validateForExport(s);
  ok(errs.some(e => /Μάρτιος/.test(e) && /έκπτωσης/.test(e)), 'κενή έκπτωση Μαρτίου → μπλοκάρει');
}
{
  const s = baseState();
  s.isFiles[0].month = null;
  ok(C.validateForExport(s).some(e => /δεν έχει αντιστοιχιστεί/.test(e)), 'IS χωρίς μήνα → μπλοκάρει');
}
{
  const s = baseState();
  const trunc = C.parseISAuditor(XLSX, readWb('IS_Auditor_TRUNCATED_JAN_2026.xlsx'), 'trunc');
  s.isFiles.push({ filename: 'trunc.xlsx', month: 6, parsed: trunc, includeAnyway: false });
  s.assumptions.discounts[6] = -0.1;
  ok(C.validateForExport(s).some(e => /ελλιπές/.test(e)), 'ελλιπές χωρίς επιβεβαίωση → μπλοκάρει');
  s.isFiles[s.isFiles.length - 1].includeAnyway = true;
  ok(!C.validateForExport(s).some(e => /ελλιπές/.test(e)), 'ελλιπές με επιβεβαίωση → περνά');
}
{
  const s = baseState();
  s.isFiles.push({ filename: 'jul.xlsx', month: 7, parsed: isParsed[5], includeAnyway: false });
  s.assumptions.discounts[7] = -0.2;
  const errs = C.validateForExport(s);
  ok(errs.some(e => /Β΄ εξαμήνου/.test(e)), 'μήνας 7 χωρίς τιμή Β΄ εξαμήνου → μπλοκάρει (' + errs.length + ' σφάλματα)');
  C.HOSPITALS.forEach(h => { s.assumptions.hospitals[h.code].brH2 = 4000; });
  ok(!C.validateForExport(s).some(e => /Β΄ εξαμήνου/.test(e)), 'με τιμές Β΄ εξαμήνου → περνά');
}
{
  const s = baseState();
  s.isFiles[1].month = 1; // δύο αρχεία στον Ιανουάριο
  ok(C.validateForExport(s).some(e => /Δύο IS Auditor/.test(e)), 'διπλός μήνας IS → μπλοκάρει');
}
{
  const s = baseState();
  s.consoFiles.push({ filename: 'conso_jun.xlsx', month: 6, parsed: consoParsed[1] });
  ok(C.validateForExport(s).some(e => /χωρίς αντίστοιχο IS/.test(e)), 'Conso χωρίς IS μήνα → μπλοκάρει');
}

/* ---------- 7. Workbook εξόδου ---------- */
section('Workbook εξόδου (ExcelJS)');
(async () => {
  const months = [1, 2, 3, 4, 5];
  const rows = months.flatMap(monthRows);
  const payload = {
    year: 2026, months, rows,
    assumptions,
    sources: {
      isFiles: months.map(m => IS_FILES[m]),
      consoFiles: Object.values(CONSO_FILES),
      discountFile: 'ΟΑΥ_Εκπτώσεις_2026.xlsx'
    }
  };
  const wb = await C.buildWorkbook(ExcelJS, payload);

  // Data validation του διακόπτη (έλεγχος πριν την αποθήκευση).
  const dv = wb.getWorksheet('Εισαγωγές').getCell('B29').dataValidation;
  ok(dv && dv.type === 'list' && /ΝΑΙ,ΟΧΙ/.test(dv.formulae[0]), 'διακόπτης: data validation ΝΑΙ/ΟΧΙ');

  const fn = C.exportFilename(2026, 5);
  ok(fn === 'Επίπτωση_Υπέρβασης_Εξειδικευμένων_2026_05.xlsx', 'όνομα αρχείου: ' + fn);
  const outPath = path.join(OUT, fn);
  await wb.xlsx.writeFile(outPath);

  // Επαναφόρτωση και δομικοί έλεγχοι.
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(outPath);
  const sheetNames = wb2.worksheets.map(w => w.name);
  ok(JSON.stringify(sheetNames) === JSON.stringify(['Σύνοψη', 'Υπολογισμός', 'Δεδομένα', 'Εισαγωγές']),
    'σειρά φύλλων: ' + sheetNames.join(', '));

  const calc = wb2.getWorksheet('Υπολογισμός');
  const data = wb2.getWorksheet('Δεδομένα');
  const syn = wb2.getWorksheet('Σύνοψη');
  const inp = wb2.getWorksheet('Εισαγωγές');

  const f = (ws, addr) => {
    const c = ws.getCell(addr);
    return c.formula || (c.value && c.value.formula) || '';
  };
  const res = (ws, addr) => {
    const c = ws.getCell(addr);
    return (c.value && typeof c.value === 'object' && 'result' in c.value) ? c.value.result : c.value;
  };

  // Γραμμή 5 = Ιανουάριος F1054 (μήνες ταξινομημένοι, νοσηλευτήρια με τη σειρά των προεπιλογών).
  ok(f(calc, 'A5').includes('Δεδομένα'), 'Υπολογισμός A5 σύνδεση στο Δεδομένα: ' + f(calc, 'A5'));
  ok(f(calc, 'I5') === 'E5-F5+G5+H5', 'I5 = E5-F5+G5+H5, got ' + f(calc, 'I5'));
  ok(/^MAX\(0,I5-J5\)$/.test(f(calc, 'K5')), 'K5 = MAX(0,I5-J5)');
  ok(/INDEX\('Εισαγωγές'!\$D\$5:\$D\$12,MATCH\(\$A5/.test(f(calc, 'J5')), 'J5 INDEX/MATCH στις Εισαγωγές');
  ok(/IF\('Εισαγωγές'!\$B\$29="ΝΑΙ"/.test(f(calc, 'H5')), 'H5 διαβάζει τον διακόπτη');
  ok(/IF\(C5<=6,INDEX\('Εισαγωγές'!\$E\$5/.test(f(calc, 'L5')), 'L5 επιλέγει τιμή Α΄/Β΄ εξαμήνου');
  ok(/INDEX\('Εισαγωγές'!\$C\$16:\$C\$27,MATCH\(\$C5/.test(f(calc, 'M5')), 'M5 έκπτωση με INDEX/MATCH στον μήνα');
  ok(f(calc, 'N5') === 'L5*(1+M5)', 'N5 = L5*(1+M5)');
  ok(f(calc, 'Q5') === 'P5-O5', 'Q5 = P5-O5');

  const f54jan = rows[0];
  close(res(calc, 'Q5'), f54jan.impact, 1, 'Q5 αποθηκευμένο αποτέλεσμα = επίπτωση F1054 Ιαν');
  close(res(data, 'D5'), 1260.42, 1e-6, 'Δεδομένα D5 = 1260.42');

  // Σύνοψη: πίνακας 1 — τίτλος στη γραμμή 4, αριθμοί μηνών στη γραμμή 5,
  // επικεφαλίδες στη 6, δεδομένα 7–14, Σύνολο ΟΚΥπΥ στη 15. F1054 = γραμμή 7.
  ok(/^SUMIFS\('Υπολογισμός'!\$Q\$5:\$Q\$44,'Υπολογισμός'!\$A\$5:\$A\$44,\$A7,'Υπολογισμός'!\$C\$5:\$C\$44,C\$5\)$/.test(f(syn, 'C7')),
    'Σύνοψη C7 SUMIFS: ' + f(syn, 'C7'));
  close(res(syn, 'C7'), f54jan.impact, 1, 'Σύνοψη C7 = επίπτωση F1054 Ιαν');
  ok(res(syn, 'C5') === 1 && res(syn, 'C6') === 'Ιανουάριος', 'Σύνοψη: γραμμή κριτηρίων (αρ. μήνα) + επικεφαλίδα μήνα');
  const grand = rows.reduce((s, r) => s + r.impact, 0);
  close(res(syn, 'H15'), grand, 1, 'Σύνοψη H15 (Σύνολο ΟΚΥπΥ × Σύνολο) = γενικό σύνολο');
  const grandExcess = rows.reduce((s, r) => s + r.excess, 0);
  // Πίνακας 2 (μονάδες υπέρβασης): τίτλος στη 17, δεδομένα 20–27, σύνολο στη 28.
  ok(/^SUMIFS\('Υπολογισμός'!\$K\$5:\$K\$44/.test(f(syn, 'C20')), 'Σύνοψη πίνακας 2: SUMIFS στη στήλη K');
  close(res(syn, 'H28'), grandExcess, 0.01, 'Σύνοψη H28 = συνολικές μονάδες υπέρβασης');

  // Εισαγωγές: μηνιαίες = ετήσιες/12 (ζωντανή φόρμουλα).
  ok(f(inp, 'D5') === 'C5/12', 'Εισαγωγές D5 = C5/12');
  close(res(inp, 'D5'), 5239 / 12, 1e-9, 'Εισαγωγές D5 αποτέλεσμα');

  // Χρώματα: μπλε τιμές εισαγωγής, πράσινες συνδέσεις.
  ok((data.getCell('D5').font || {}).color && data.getCell('D5').font.color.argb === 'FF0000FF', 'Δεδομένα D5 μπλε γραμματοσειρά');
  ok((calc.getCell('A5').font || {}).color && calc.getCell('A5').font.color.argb === 'FF008000', 'Υπολογισμός A5 πράσινη γραμματοσειρά');
  ok((inp.getCell('C5').font || {}).color && inp.getCell('C5').font.color.argb === 'FF0000FF', 'Εισαγωγές C5 μπλε γραμματοσειρά');

  // Μορφές αριθμών.
  ok(calc.getCell('I5').numFmt === '#,##0.0', 'μορφή μονάδων');
  ok(calc.getCell('Q5').numFmt === '€#,##0;(€#,##0);-', 'μορφή ευρώ');
  ok(calc.getCell('M5').numFmt === '0.0%', 'μορφή ποσοστού');

  // Απαγορευμένες συναρτήσεις πουθενά.
  let forbidden = 0;
  wb2.eachSheet(ws => ws.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, c => {
    const fx = c.formula || (c.value && c.value.formula) || '';
    if (/XLOOKUP|FILTER\(|SEQUENCE\(|LAMBDA|LET\(|SORT\(|UNIQUE\(/.test(fx)) forbidden++;
  })));
  ok(forbidden === 0, 'καμία XLOOKUP/FILTER/spill συνάρτηση');

  // Χωρίς γραμμές πλέγματος, τοπίο, fit-to-width.
  ok(syn.views && syn.views[0] && syn.views[0].showGridLines === false, 'Σύνοψη χωρίς γραμμές πλέγματος');
  ok(calc.pageSetup.orientation === 'landscape' && calc.pageSetup.fitToWidth === 1, 'Υπολογισμός landscape fit-to-width');

  /* ---------- 8. Μεταφορά προηγούμενης περιόδου ---------- */
  section('Εξαγωγή προηγούμενης περιόδου → year-to-date');
  // Φτιάχνουμε «προηγούμενη» εξαγωγή Ιαν–Μαρ και τη διαβάζουμε ξανά.
  const prevRows = [1, 2, 3].flatMap(monthRows);
  const wbPrev = await C.buildWorkbook(ExcelJS, {
    year: 2026, months: [1, 2, 3], rows: prevRows, assumptions,
    sources: { isFiles: [IS_FILES[1], IS_FILES[2], IS_FILES[3]], consoFiles: [CONSO_FILES[1], CONSO_FILES[3]], discountFile: null }
  });
  const prevPath = path.join(DIR, 'prev_output_2026_03.xlsx');
  await wbPrev.xlsx.writeFile(prevPath);

  const pp = C.parsePreviousOutput(XLSX, XLSX.read(fs.readFileSync(prevPath), { type: 'buffer' }), 'prev_output_2026_03.xlsx');
  ok(pp.ok && !pp.error, 'parsePreviousOutput ok' + (pp.error ? ' — ' + pp.error : ''));
  ok(JSON.stringify(pp.monthsList) === JSON.stringify([1, 2, 3]), 'μεταφερόμενοι μήνες: ' + pp.monthsList.join(','));
  close(pp.months[1].is['F1054'].pos, 1260.42, 1e-9, 'round-trip: F1054 Ιαν pos');
  close(pp.months[1].is['F1054'].negAe, -2.1, 1e-9, 'round-trip: F1054 Ιαν negAe');
  close(pp.months[1].over15['F1054'], 223.85, 1e-9, 'round-trip: F1054 Ιαν over15');
  close(pp.months[3].over15['F1047'], 45, 1e-9, 'round-trip: F1047 Μαρ over15');
  ok(pp.year === 2026, 'έτος από «Εισαγωγές»: ' + pp.year);
  ok(pp.assumptions && pp.assumptions.creditToggle === 'ΟΧΙ', 'διακόπτης από «Εισαγωγές»');
  close(pp.assumptions.hospitals['F1054'].agreed, 5239, 1e-9, 'agreed F1054 από «Εισαγωγές»');
  close(pp.assumptions.hospitals['F1047'].brH1, 4331, 1e-9, 'brH1 F1047 από «Εισαγωγές»');
  close(pp.assumptions.discounts[1], -0.4032, 1e-9, 'έκπτωση Ιαν από «Εισαγωγές»');
  close(pp.assumptions.discounts[3], -0.6031, 1e-9, 'έκπτωση Μαρ από «Εισαγωγές»');

  // Ο υπολογισμός πάνω στα μεταφερόμενα δεδομένα δίνει ίδια αποτελέσματα.
  for (const m of [1, 2, 3]) {
    const carried = C.computeMonthRows(m, { is: pp.months[m].is, over15: pp.months[m].over15 }, assumptions);
    const fresh = monthRows(m);
    const dImp = carried.reduce((s, r) => s + r.impact, 0) - fresh.reduce((s, r) => s + r.impact, 0);
    close(dImp, 0, 1e-6, 'μήνας ' + m + ': ίδια επίπτωση από μεταφορά και από αρχεία πηγής');
  }

  // Έλεγχοι εξαγωγής με prevMonths.
  {
    const s = { isFiles: [], consoFiles: [], prevMonths: [1, 2, 3], assumptions: C.defaultAssumptions() };
    ok(C.validateForExport(s).length === 0, 'μόνο μεταφορά Ιαν–Μαρ → κανένα σφάλμα');
    s.consoFiles.push({ filename: 'c2.xlsx', month: 2, parsed: consoParsed[1] });
    ok(!C.validateForExport(s).some(e => /χωρίς αντίστοιχο/.test(e)), 'Conso σε μεταφερόμενο μήνα → επιτρέπεται');
    s.consoFiles.push({ filename: 'c6.xlsx', month: 6, parsed: consoParsed[1] });
    ok(C.validateForExport(s).some(e => /Ιούνιος/.test(e) && /χωρίς αντίστοιχο/.test(e)), 'Conso σε μη καλυμμένο μήνα → μπλοκάρει');
    s.consoFiles.pop();
    s.isFiles.push({ filename: IS_FILES[3], month: 3, parsed: isParsed[3], includeAnyway: false });
    ok(!C.validateForExport(s).some(e => /Δύο IS Auditor/.test(e)), 'νέο IS σε μεταφερόμενο μήνα → επιτρέπεται (υπερισχύει)');
    s.isFiles.push({ filename: 'x.xlsx', month: 3, parsed: isParsed[3], includeAnyway: false });
    ok(C.validateForExport(s).some(e => /Δύο IS Auditor/.test(e)), 'δύο ΝΕΑ IS στον ίδιο μήνα → μπλοκάρει');
    const s7 = { isFiles: [], consoFiles: [], prevMonths: [7], assumptions: C.defaultAssumptions() };
    s7.assumptions.discounts[7] = -0.2;
    ok(C.validateForExport(s7).some(e => /Β΄ εξαμήνου/.test(e)), 'μεταφερόμενος μήνας >6 χωρίς τιμή Β΄ εξαμήνου → μπλοκάρει');
    const sBad = C.parsePreviousOutput(XLSX, readWb('IS_Auditor_Report_JAN_2026.xlsx'), 'not-an-output');
    ok(!sBad.ok && /Δεδομένα/.test(sBad.error), 'IS Auditor αντί εξαγωγής → καθαρό σφάλμα');
  }

  console.log('\n' + passed + ' πέρασαν, ' + failed + ' απέτυχαν');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
