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

const ALL_MONTHS = [1, 2, 3, 4, 5];
function seriesAll(a) {
  const dataByMonth = {};
  for (const m of ALL_MONTHS) dataByMonth[m] = { is: isParsed[m].perProvider, over15: consoParsed[m] ? consoParsed[m].over15 : {} };
  return C.computeSeries(ALL_MONTHS, dataByMonth, a || assumptions);
}
function monthRows(m) { return seriesAll().filter(r => r.month === m); }

{
  const jan = monthRows(1);
  const f54 = jan.find(r => r.code === 'F1054');
  close(f54.pos, 1260.42, 1e-6, 'F1054 Ιαν pos');
  close(f54.posAe, 734.31, 1e-6, 'F1054 Ιαν posAe');
  close(f54.over15, 223.85, 1e-9, 'F1054 Ιαν over15');
  close(f54.counted, 749.96, 1e-6, 'F1054 Ιαν προσμετρώμενες');
  close(f54.carryover, 0, 1e-12, 'F1054 Ιαν μεταφορά = 0 (πρώτος μήνας)');
  close(f54.agreedMonth, 5239 / 12, 1e-9, 'F1054 Ιαν συμφ. μονάδες μηνός (436.58)');
  close(f54.excess, 749.96 - 5239 / 12, 1e-6, 'F1054 Ιαν υπέρβαση (≈313.38)');
  // Οι προδιαγραφές δίνουν −613.054 € με τα πλήρη (μη στρογγυλεμένα) δεδομένα πηγής·
  // με τις στρογγυλεμένες τιμές pos/posAe των προδιαγραφών βγαίνει −613.067 €.
  close(f54.impact, -613054, 100, 'F1054 Ιαν επίπτωση ≈ −613.054 €');
  const f25 = jan.find(r => r.code === 'F1025');
  ok(f25.amberFlag === true, 'F1025 Ιαν: πορτοκαλί σήμανση (posAe>0, over15=0)');
  ok(f54.amberFlag === false, 'F1054 Ιαν: χωρίς πορτοκαλί σήμανση');
}
{
  // Μεταφορά πλεονάσματος — αναλυτικός έλεγχος για το F1047 (κάτω τον Ιαν/Φεβ,
  // πάνω τον Μαρ, οπότε το πλεόνασμα Ιαν+Φεβ μειώνει την υπέρβαση Μαρτίου).
  const base47 = 1519 / 12;
  const series = seriesAll().filter(r => r.code === 'F1047');
  const jan = series.find(r => r.month === 1), feb = series.find(r => r.month === 2), mar = series.find(r => r.month === 3);
  close(jan.counted, 150 - 40 + 10, 1e-9, 'F1047 Ιαν counted 120');
  close(jan.carryover, 0, 1e-12, 'F1047 Ιαν μεταφορά 0');
  close(jan.excess, 0, 1e-12, 'F1047 Ιαν υπέρβαση 0 (κάτω από το όριο)');
  close(feb.carryover, Math.max(0, base47 - jan.counted), 1e-9, 'F1047 Φεβ μεταφορά = πλεόνασμα Ιαν');
  close(feb.agreedMonth, base47 + (base47 - jan.counted), 1e-9, 'F1047 Φεβ συμφ. μονάδες = βάση + μεταφορά');
  close(mar.carryover, Math.max(0, feb.agreedMonth - feb.counted), 1e-9, 'F1047 Μαρ μεταφορά = πλεόνασμα Φεβ');
  // Με μεταφορά, η υπέρβαση Μαρτίου είναι μικρότερη από την «χωρίς μεταφορά» (194.1).
  close(mar.excess, mar.counted - mar.agreedMonth, 1e-9, 'F1047 Μαρ υπέρβαση = counted − συμφ. μονάδες μηνός');
  ok(mar.excess < 194.1 - 1, 'F1047 Μαρ υπέρβαση μειωμένη λόγω μεταφοράς (' + mar.excess.toFixed(2) + ' < 194.1)');
}
{
  const may = monthRows(5);
  ok(may.every(r => r.impact === 0), 'Μάιος: όλες οι επιπτώσεις 0 € (έκπτωση 0%)');
  const f54 = may.find(r => r.code === 'F1054');
  close(f54.excess, 48.1, 1e-6, 'F1054 Μάιος υπέρβαση 48.1 (εμφανίζεται παρά το 0%)');
}
{
  // Ανεξάρτητος επανυπολογισμός του γενικού συνόλου, χρονολογικά ανά νοσηλευτήριο.
  let expectedTotal = 0;
  for (const h of C.HOSPITALS) {
    let prevAgreed = null, prevCounted = null;
    for (const m of ALL_MONTHS) {
      const t = MONTH_INPUTS[m][h.code];
      const o15 = (CONSO[m] && CONSO[m][h.code]) || 0;
      const counted = t.pos - t.posAe + o15; // toggle ΟΧΙ
      const carry = prevAgreed === null ? 0 : Math.max(0, prevAgreed - prevCounted);
      const agreed = h.agreed / 12 + carry;
      const excess = Math.max(0, counted - agreed);
      expectedTotal += excess * h.brH1 * DISCOUNTS[m];
      prevAgreed = agreed; prevCounted = counted;
    }
  }
  const total = seriesAll().reduce((s, r) => s + r.impact, 0);
  close(total, expectedTotal, 0.01, 'γενικό σύνολο επίπτωσης = ανεξάρτητος επανυπολογισμός με μεταφορά (' + Math.round(expectedTotal) + ' €)');
}
{
  // Διακόπτης πιστωτικών ΝΑΙ: το counted του F1054 Ιαν μειώνεται κατά neg−negAe = −6.3.
  const aYes = C.defaultAssumptions();
  aYes.creditToggle = 'ΝΑΙ';
  const f54 = seriesAll(aYes).find(r => r.code === 'F1054' && r.month === 1);
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
  const rows = seriesAll(); // ανά νοσηλευτήριο, μήνες αύξοντες (όπως το απαιτεί το buildWorkbook)
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

  // Σειρά ανά νοσηλευτήριο, μήνες αύξοντες: γραμμή 5 = F1054 Ιαν, 6 = F1054 Φεβ …
  ok(f(calc, 'A5').includes('Δεδομένα'), 'Υπολογισμός A5 σύνδεση στο Δεδομένα: ' + f(calc, 'A5'));
  ok(f(calc, 'I5') === 'E5-F5+G5+H5', 'I5 = E5-F5+G5+H5, got ' + f(calc, 'I5'));
  ok(/INDEX\('Εισαγωγές'!\$D\$5:\$D\$12,MATCH\(\$A5/.test(f(calc, 'J5')), 'J5 βάση μηνός INDEX/MATCH (÷12)');
  ok(res(calc, 'K5') === 0 && !f(calc, 'K5'), 'K5 μεταφορά = 0 (πρώτος μήνας F1054, χωρίς φόρμουλα)');
  ok(f(calc, 'K6') === 'MAX(0,L5-I5)', 'K6 μεταφορά = MAX(0,L5-I5) (προηγούμενη γραμμή ίδιου νοσηλευτηρίου), got ' + f(calc, 'K6'));
  ok(f(calc, 'L5') === 'J5+K5', 'L5 συμφ. μονάδες μηνός = J5+K5');
  ok(f(calc, 'M5') === 'MAX(0,I5-L5)', 'M5 υπέρβαση = MAX(0,I5-L5)');
  ok(/IF\(C5<=6,INDEX\('Εισαγωγές'!\$E\$5/.test(f(calc, 'N5')), 'N5 επιλέγει βασική τιμή Α΄/Β΄ εξαμήνου');
  ok(/IF\('Εισαγωγές'!\$B\$29="ΝΑΙ"/.test(f(calc, 'H5')), 'H5 διαβάζει τον διακόπτη');
  ok(/INDEX\('Εισαγωγές'!\$C\$16:\$C\$27,MATCH\(\$C5/.test(f(calc, 'O5')), 'O5 έκπτωση με INDEX/MATCH στον μήνα');
  ok(f(calc, 'P5') === 'N5*(1+O5)', 'P5 = N5*(1+O5)');
  ok(f(calc, 'Q5') === 'M5*N5', 'Q5 = M5*N5 (πλήρες)');
  ok(f(calc, 'R5') === 'M5*P5', 'R5 = M5*P5 (μειωμένο)');
  ok(f(calc, 'S5') === 'R5-Q5', 'S5 = R5-Q5 (επίπτωση)');

  const f54jan = rows[0];
  close(res(calc, 'S5'), f54jan.impact, 1, 'S5 αποθηκευμένο αποτέλεσμα = επίπτωση F1054 Ιαν');
  close(res(data, 'D5'), 1260.42, 1e-6, 'Δεδομένα D5 = 1260.42');
  // Έλεγχος ότι η carryover-φόρμουλα δίνει το σωστό: F1047 (row 15 = F1047 Ιαν).
  ok(rows[10].code === 'F1047' && rows[10].month === 1, 'σειρά ανά νοσηλευτήριο: γραμμή 15 = F1047 Ιαν');
  ok(res(calc, 'K15') === 0, 'K15 (F1047 Ιαν) μεταφορά 0');
  ok(f(calc, 'K16') === 'MAX(0,L15-I15)', 'K16 (F1047 Φεβ) μεταφορά από Ιαν');

  // Σύνοψη: πίνακας 1 — τίτλος 4, αριθμοί μηνών 5, επικεφαλίδες 6, δεδομένα 7–14,
  // Σύνολο ΟΚΥπΥ 15. F1054 = γραμμή 7. SUMIFS στη στήλη S (επίπτωση).
  ok(/^SUMIFS\('Υπολογισμός'!\$S\$5:\$S\$44,'Υπολογισμός'!\$A\$5:\$A\$44,\$A7,'Υπολογισμός'!\$C\$5:\$C\$44,C\$5\)$/.test(f(syn, 'C7')),
    'Σύνοψη C7 SUMIFS στη στήλη S: ' + f(syn, 'C7'));
  close(res(syn, 'C7'), f54jan.impact, 1, 'Σύνοψη C7 = επίπτωση F1054 Ιαν');
  ok(res(syn, 'C5') === 1 && res(syn, 'C6') === 'Ιανουάριος', 'Σύνοψη: γραμμή κριτηρίων (αρ. μήνα) + επικεφαλίδα μήνα');
  const grand = rows.reduce((s, r) => s + r.impact, 0);
  close(res(syn, 'H15'), grand, 1, 'Σύνοψη H15 (Σύνολο ΟΚΥπΥ × Σύνολο) = γενικό σύνολο');
  const grandExcess = rows.reduce((s, r) => s + r.excess, 0);
  // Πίνακας 2 (μονάδες υπέρβασης): SUMIFS στη στήλη M.
  ok(/^SUMIFS\('Υπολογισμός'!\$M\$5:\$M\$44/.test(f(syn, 'C20')), 'Σύνοψη πίνακας 2: SUMIFS στη στήλη M');
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
  ok(calc.getCell('S5').numFmt === '€#,##0;(€#,##0);-', 'μορφή ευρώ (επίπτωση S)');
  ok(calc.getCell('O5').numFmt === '0.0%', 'μορφή ποσοστού (έκπτωση O)');

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
  const prevDataByMonth = {};
  for (const m of [1, 2, 3]) prevDataByMonth[m] = { is: isParsed[m].perProvider, over15: consoParsed[m] ? consoParsed[m].over15 : {} };
  const prevRows = C.computeSeries([1, 2, 3], prevDataByMonth, assumptions); // ανά νοσηλευτήριο
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

  // Ο υπολογισμός πάνω στα μεταφερόμενα δεδομένα (σειρά με μεταφορά πλεονάσματος)
  // δίνει ίδια αποτελέσματα με τα αρχεία πηγής.
  const carriedSeries = C.computeSeries([1, 2, 3], pp.months, assumptions);
  for (const m of [1, 2, 3]) {
    const carried = carriedSeries.filter(r => r.month === m);
    const fresh = monthRows(m);
    const dImp = carried.reduce((s, r) => s + r.impact, 0) - fresh.reduce((s, r) => s + r.impact, 0);
    close(dImp, 0, 1e-6, 'μήνας ' + m + ': ίδια επίπτωση από μεταφορά και από αρχεία πηγής');
    const dCarry = carried.reduce((s, r) => s + r.carryover, 0) - fresh.reduce((s, r) => s + r.carryover, 0);
    close(dCarry, 0, 1e-6, 'μήνας ' + m + ': ίδια μεταφορά πλεονάσματος από τα δύο μονοπάτια');
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

  /* ---------- 9. Αποθήκη YTD (τοπική) ---------- */
  section('Αποθήκη YTD — στιγμιότυπο & επαναχρησιμοποίηση');
  {
    // Στιγμιότυπο από τις γραμμές Ιαν–Μαρ και αναδόμηση σειράς από αυτό.
    const janMar = C.computeSeries([1, 2, 3], prevDataByMonth, assumptions);
    const store = C.ytdStoreFromRows(2026, janMar);
    store.savedAt = new Date().toISOString();
    ok(store.year === 2026, 'αποθήκη: έτος 2026');
    ok(JSON.stringify(store.monthsList) === JSON.stringify([1, 2, 3]), 'αποθήκη: monthsList Ιαν–Μαρ');
    ok(store.lastMonth === 3, 'αποθήκη: lastMonth = 3');
    close(store.months[1].is['F1054'].pos, 1260.42, 1e-9, 'αποθήκη: F1054 Ιαν pos διατηρήθηκε');
    close(store.months[1].is['F1054'].negAe, -2.1, 1e-9, 'αποθήκη: F1054 Ιαν negAe διατηρήθηκε');
    close(store.months[1].over15['F1054'], 223.85, 1e-9, 'αποθήκη: F1054 Ιαν over15 διατηρήθηκε');
    close(store.months[3].over15['F1047'], 45, 1e-9, 'αποθήκη: F1047 Μαρ over15 διατηρήθηκε');

    // Ίδια δομή με parsePreviousOutput → εναλλάξιμα ως βάση: ίδια αποτελέσματα.
    const fromStore = C.computeSeries([1, 2, 3], store.months, assumptions);
    for (const m of [1, 2, 3]) {
      const a = fromStore.filter(r => r.month === m).reduce((s, r) => s + r.impact, 0);
      const b = janMar.filter(r => r.month === m).reduce((s, r) => s + r.impact, 0);
      close(a, b, 1e-6, 'μήνας ' + m + ': αποθήκη YTD δίνει ίδια επίπτωση με τα αρχεία πηγής');
    }

    // JSON round-trip (όπως το localStorage) διατηρεί τα δεδομένα.
    const round = JSON.parse(JSON.stringify(store));
    const fromRound = C.computeSeries([1, 2, 3], round.months, assumptions);
    close(fromRound.reduce((s, r) => s + r.impact, 0), janMar.reduce((s, r) => s + r.impact, 0), 1e-6,
      'JSON round-trip αποθήκης → ίδιο γενικό σύνολο');

    // Επέκταση: αποθήκη Ιαν–Μαρ + φρέσκος Απρ → year-to-date Ιαν–Απρ.
    const dataAprFresh = Object.assign({}, round.months,
      { 4: { is: isParsed[4].perProvider, over15: {} } });
    const ytd4 = C.computeSeries([1, 2, 3, 4], dataAprFresh, assumptions);
    const ref4 = C.computeSeries([1, 2, 3, 4], {
      1: prevDataByMonth[1], 2: prevDataByMonth[2], 3: prevDataByMonth[3],
      4: { is: isParsed[4].perProvider, over15: {} }
    }, assumptions);
    close(ytd4.reduce((s, r) => s + r.impact, 0), ref4.reduce((s, r) => s + r.impact, 0), 1e-6,
      'αποθήκη Ιαν–Μαρ + φρέσκος Απρ = πλήρες year-to-date Ιαν–Απρ');
  }

  console.log('\n' + passed + ' πέρασαν, ' + failed + ' απέτυχαν');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
