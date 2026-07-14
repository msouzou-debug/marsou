#!/usr/bin/env node
/*
 * Έλεγχος «ζωντανών» φορμουλών: παίρνουμε το xlsx που κατέβηκε από τον browser,
 * αλλάζουμε στο φύλλο «Εισαγωγές» τις συμφωνημένες μονάδες του F1054 (C5 → 6000)
 * και τον διακόπτη πιστωτικών (B29 → ΝΑΙ) ΧΩΡΙΣ να πειράξουμε τα αποθηκευμένα
 * αποτελέσματα, και βάζουμε το LibreOffice να επανυπολογίσει κατά το άνοιγμα.
 * Αν η Σύνοψη αλλάξει στις ανεξάρτητα υπολογισμένες τιμές, οι φόρμουλες είναι
 * ζωντανές σε όλη την αλυσίδα Εισαγωγές → Υπολογισμός → Σύνοψη.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const C = require('../src/core');

const OUT = path.join(__dirname, 'out');
const DIR = path.join(__dirname, 'fixtures');
const SRC = path.join(OUT, 'browser-download.xlsx');
const { IS_FILES, CONSO_FILES } = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

let soffice = null;
for (const p of ['/usr/bin/soffice', '/usr/local/bin/soffice']) {
  if (fs.existsSync(p)) { soffice = p; break; }
}
if (!soffice) {
  console.log('SKIP: δεν βρέθηκε LibreOffice (soffice) — ο έλεγχος επανυπολογισμού παραλείπεται.');
  process.exit(0);
}
if (!fs.existsSync(SRC)) {
  console.error('Λείπει το ' + SRC + ' — τρέξτε πρώτα το test/browser-e2e.js');
  process.exit(1);
}

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓', label); }
  else { failed++; console.error('  ✗ FAIL:', label); }
}
function close(a, b, tol, label) { ok(Math.abs(a - b) <= tol, label + ' (got ' + a + ', want ' + b + ' ±' + tol + ')'); }

(async () => {
  // 1. Τροποποίηση εισαγωγών με «μπαγιάτικα» αποθηκευμένα αποτελέσματα.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const inp = wb.getWorksheet('Εισαγωγές');
  inp.getCell('C5').value = 6000;      // F1054: συμφωνημένες ετήσιες 5239 → 6000
  inp.getCell('B29').value = 'ΝΑΙ';    // αφαίρεση πιστωτικών: ΟΧΙ → ΝΑΙ
  const modPath = path.join(OUT, 'recalc-input.xlsx');
  await wb.xlsx.writeFile(modPath);

  // 2. Προφίλ LibreOffice που επανυπολογίζει ΠΑΝΤΑ τα xlsx κατά το άνοιγμα.
  const prof = path.join(OUT, 'lo-profile');
  fs.rmSync(prof, { recursive: true, force: true });
  fs.mkdirSync(path.join(prof, 'user'), { recursive: true });
  fs.writeFileSync(path.join(prof, 'user', 'registrymodifications.xcu'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema">\n' +
    ' <item oor:path="/org.openoffice.Office.Calc/Formula/Load">\n' +
    '  <prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop>\n' +
    ' </item>\n' +
    '</oor:items>\n');

  const recalcDir = path.join(OUT, 'recalc');
  fs.rmSync(recalcDir, { recursive: true, force: true });
  fs.mkdirSync(recalcDir);
  execFileSync(soffice, [
    '-env:UserInstallation=file://' + prof,
    '--headless', '--convert-to', 'xlsx', '--outdir', recalcDir, modPath
  ], { stdio: 'pipe', timeout: 120000 });
  const recalced = path.join(recalcDir, 'recalc-input.xlsx');
  ok(fs.existsSync(recalced), 'το LibreOffice παρήγαγε επανυπολογισμένο αρχείο');

  // 3. Ανεξάρτητος υπολογισμός αναμενόμενων τιμών με τις νέες παραδοχές.
  const assumptions = C.defaultAssumptions();
  assumptions.hospitals['F1054'].agreed = 6000;
  assumptions.creditToggle = 'ΝΑΙ';
  const readFx = fn => XLSX.read(fs.readFileSync(path.join(DIR, fn)), { type: 'buffer' });
  const rows = [];
  for (const m of [1, 2, 3, 4, 5]) {
    const is = C.parseISAuditor(XLSX, readFx(IS_FILES[m]), IS_FILES[m]);
    const conso = CONSO_FILES[m] ? C.parseConso(XLSX, readFx(CONSO_FILES[m]), CONSO_FILES[m]) : null;
    rows.push(...C.computeMonthRows(m, { is: is.perProvider, over15: conso ? conso.over15 : {} }, assumptions));
  }
  const f54jan = rows.find(r => r.code === 'F1054' && r.month === 1);
  const grand = rows.reduce((s, r) => s + r.impact, 0);
  const grandExcess = rows.reduce((s, r) => s + r.excess, 0);

  // 4. Σύγκριση με ό,τι υπολόγισε το LibreOffice.
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(recalced);
  const syn = wb2.getWorksheet('Σύνοψη');
  const res = addr => {
    const v = syn.getCell(addr).value;
    return (v && typeof v === 'object' && 'result' in v) ? v.result : v;
  };
  close(res('C7'), f54jan.impact, 2, 'Σύνοψη C7 (F1054 Ιαν) άλλαξε στο νέο αποτέλεσμα');
  close(res('H15'), grand, 2, 'Σύνοψη H15 (γενικό σύνολο €) επανυπολογίστηκε');
  close(res('H28'), grandExcess, 0.05, 'Σύνοψη H28 (σύνολο μονάδων υπέρβασης) επανυπολογίστηκε');

  // Επιβεβαίωση ότι πράγματι μετακινηθήκαμε από τις αρχικές αποθηκευμένες τιμές.
  const origImpact = Math.max(0, 1260.42 - 734.31 + 223.85 - 5239 / 12) * 4852 * -0.4032;
  ok(Math.abs(f54jan.impact - origImpact) > 1000, 'οι νέες παραδοχές δίνουν αισθητά διαφορετική επίπτωση (' +
    Math.round(origImpact) + ' € → ' + Math.round(f54jan.impact) + ' €)');

  console.log('\n' + passed + ' πέρασαν, ' + failed + ' απέτυχαν');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
