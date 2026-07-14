#!/usr/bin/env node
/*
 * E2E στο πραγματικό specialized-ceiling-app.html μέσα σε Chromium:
 * μεταφόρτωση fixtures → έλεγχος ανίχνευσης μήνα, επισκόπησης, μπλοκαρισμάτων
 * → λήψη Excel → δομικός έλεγχος του ληφθέντος αρχείου.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const C = require('../src/core');
const { MONTH_INPUTS, CONSO, DISCOUNTS } = require('./fixture-data');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const { IS_FILES, CONSO_FILES } = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓', label); }
  else { failed++; console.error('  ✗ FAIL:', label); }
}

(async () => {
  const browser = await chromium.launch(
    fs.existsSync('/opt/pw-browsers/chromium')
      ? { executablePath: '/opt/pw-browsers/chromium' } : {}
  );
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());

  await page.goto('file://' + path.join(ROOT, 'specialized-ceiling-app.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  ok(await page.title() === 'Επίπτωση Υπέρβασης Εξειδικευμένων Μονάδων — ΟΚΥπΥ', 'τίτλος σελίδας');
  ok((await page.locator('#btn-export').isDisabled()), 'εξαγωγή αρχικά απενεργοποιημένη');

  // Μεταφόρτωση 5 IS Auditor Reports.
  // Το ζεύγος Playwright/Chromium αυτού του περιβάλλοντος δεν παραδίδει αρχεία
  // με μη-ASCII ονόματα στο setInputFiles, οπότε τα ελληνικά ονόματα δοκιμάζονται
  // στα unit tests· εδώ αντιγράφουμε σε ASCII ονόματα. Το αρχείο Φεβρουαρίου
  // παίρνει επίτηδες όνομα χωρίς ανιχνεύσιμο μήνα για να ελεγχθεί η χειροκίνητη
  // αντιστοίχιση.
  const stage = path.join(OUT, 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const ASCII_IS = {
    1: 'IS_Auditor_Report_JAN_2026.xlsx',
    2: 'is_report_without_detectable_period.xlsx',
    3: 'IS_Auditor_March_26.xlsx',
    4: 'is_auditor_2026-04.xlsx',
    5: 'IS_Auditor_MAY_2026.xlsx'
  };
  const isPaths = [1, 2, 3, 4, 5].map(m => {
    const p = path.join(stage, ASCII_IS[m]);
    fs.copyFileSync(path.join(DIR, IS_FILES[m]), p);
    return p;
  });
  await page.setInputFiles('#fi-is', isPaths);
  await page.waitForFunction(() => document.querySelectorAll('#list-is .filecard').length === 5);
  const detectedMonths = await page.$$eval('#list-is .filecard select', els => els.map(e => e.value).sort());
  ok(JSON.stringify(detectedMonths) === JSON.stringify(['', '1', '3', '4', '5']),
    'αυτόματη ανίχνευση μηνών IS (Φεβ σκόπιμα άγνωστος): ' + detectedMonths.join(','));

  // Χωρίς μήνα στον Φεβρουάριο η εξαγωγή μπλοκάρει με σαφές μήνυμα.
  await page.waitForFunction(() => document.getElementById('btn-export').disabled);
  ok(/δεν έχει αντιστοιχιστεί/.test(await page.locator('#export-errors').innerText()),
    'αναντιστοίχιστο αρχείο μπλοκάρει την εξαγωγή');
  ok((await page.locator('#list-is select.unset').count()) === 1, 'κόκκινο πλαίσιο στο αναντιστοίχιστο dropdown');
  // Χειροκίνητη επιλογή: Φεβρουάριος.
  await page.locator('#list-is .filecard', { hasText: 'without_detectable' }).locator('select').selectOption('2');

  // Μεταφόρτωση Conso (μήνες από το B1).
  const consoPaths = Object.values(CONSO_FILES).map(f => path.join(DIR, f));
  await page.setInputFiles('#fi-conso', consoPaths);
  await page.waitForFunction(n => document.querySelectorAll('#list-conso .filecard').length === n, consoPaths.length);
  const consoMonths = await page.$$eval('#list-conso .filecard select', els => els.map(e => e.value).sort());
  ok(JSON.stringify(consoMonths) === JSON.stringify(['1', '3', '5']), 'μήνες Conso από B1: ' + consoMonths.join(','));

  // Πριν το αρχείο εκπτώσεων: οι προεπιλογές 2026 πρέπει ήδη να επιτρέπουν εξαγωγή.
  await page.waitForFunction(() => !document.getElementById('btn-export').disabled);
  ok(true, 'εξαγωγή ενεργή με προεπιλεγμένες εκπτώσεις 2026');

  // Σβήνουμε την έκπτωση Μαρτίου → μπλοκάρισμα με μήνυμα.
  await page.evaluate(() => {
    const inputs = document.querySelectorAll('#tr-disc-body input');
    inputs[2].value = '';
    inputs[2].dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => document.getElementById('btn-export').disabled);
  const errText = await page.locator('#export-errors').innerText();
  ok(/Μάρτιος/.test(errText) && /έκπτωσης/.test(errText), 'κενή έκπτωση Μαρτίου μπλοκάρει με μήνυμα');

  // Μεταφόρτωση αρχείου εκπτώσεων ΟΑΥ → προσυμπλήρωση ξανά.
  const discStaged = path.join(stage, 'OAY_discounts_2026.xlsx');
  fs.copyFileSync(path.join(DIR, 'ΟΑΥ_Εκπτώσεις_2026.xlsx'), discStaged);
  await page.setInputFiles('#fi-disc', discStaged);
  await page.waitForFunction(() => !document.getElementById('btn-export').disabled);
  const discVals = await page.$$eval('#tr-disc-body input', els => els.slice(0, 5).map(e => e.value));
  ok(JSON.stringify(discVals) === JSON.stringify(['-40.32', '-45.09', '-60.31', '-48.77', '0']),
    'πίνακας εκπτώσεων προσυμπληρώθηκε από το αρχείο ΟΑΥ: ' + discVals.join(', '));

  // Επισκόπηση: 5 μήνες, πορτοκαλί σήμανση, γενικό σύνολο.
  const monthHeads = await page.$$eval('#review .month-h b', els => els.map(e => e.textContent));
  ok(monthHeads.filter(t => /2026/.test(t)).length === 5, '5 μηνιαίοι πίνακες στην επισκόπηση');
  ok((await page.locator('#review tr.amber').count()) >= 1, 'πορτοκαλί σήμανση εμφανίζεται (F1025 Ιαν κ.ά.)');

  // Αναμενόμενο γενικό σύνολο από ανεξάρτητο υπολογισμό.
  let grand = 0;
  for (const m of [1, 2, 3, 4, 5]) {
    for (const h of C.HOSPITALS) {
      const t = MONTH_INPUTS[m][h.code];
      const o15 = (CONSO[m] && CONSO[m][h.code]) || 0;
      grand += Math.max(0, t.pos - t.posAe + o15 - h.agreed / 12) * h.brH1 * DISCOUNTS[m];
    }
  }
  const grandStr = '(€' + new Intl.NumberFormat('el-GR').format(Math.abs(Math.round(grand))) + ')';
  const reviewText = await page.locator('#review').innerText();
  ok(reviewText.includes(grandStr), 'γενικό σύνολο επίπτωσης στην επισκόπηση: ' + grandStr);

  // Ελλιπές αρχείο: προειδοποίηση + μπλοκάρισμα μέχρι το checkbox, μετά διπλός μήνας.
  await page.setInputFiles('#fi-is', path.join(DIR, 'IS_Auditor_TRUNCATED_JAN_2026.xlsx'));
  await page.waitForFunction(() => document.querySelectorAll('#list-is .filecard').length === 6);
  ok(/πιθανώς ελλιπές/i.test(await page.locator('#list-is').innerText()) ||
     /Πιθανώς ελλιπές/.test(await page.locator('#list-is').innerText()), 'κόκκινη προειδοποίηση ελλιπούς αρχείου');
  await page.waitForFunction(() => document.getElementById('btn-export').disabled);
  ok(true, 'ελλιπές αρχείο μπλοκάρει την εξαγωγή');
  await page.locator('#list-is .warnbox input[type=checkbox]').check();
  await page.waitForFunction(() => document.getElementById('btn-export').disabled);
  ok(/Δύο IS Auditor/.test(await page.locator('#export-errors').innerText()),
    'μετά το checkbox: μπλοκάρει ως διπλός Ιανουάριος');
  // Αφαίρεση του ελλιπούς → ξανά έτοιμο.
  await page.locator('#list-is .filecard', { hasText: 'TRUNCATED' }).locator('.removebtn').click();
  await page.waitForFunction(() => !document.getElementById('btn-export').disabled);
  ok(true, 'μετά την αφαίρεση: εξαγωγή ξανά ενεργή');

  const expName = 'Επίπτωση_Υπέρβασης_Εξειδικευμένων_2026_05.xlsx';
  ok((await page.locator('#export-name').innerText()).trim() === expName, 'προεπισκόπηση ονόματος αρχείου');

  // Λήψη.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-export').click()
  ]);
  // Το headless Chromium σε σελίδα file:// αναφέρει γενικό όνομα «download» για
  // blob λήψεις — το πραγματικό όνομα (attribute a.download) ελέγχθηκε ήδη μέσω
  // της προεπισκόπησης #export-name. Δεκτά και τα δύο.
  ok([expName, 'download'].includes(download.suggestedFilename()),
    'όνομα ληφθέντος αρχείου: ' + download.suggestedFilename());
  const dlPath = path.join(OUT, 'browser-download.xlsx');
  await download.saveAs(dlPath);
  await browser.close();

  // Δομικός έλεγχος του αρχείου που κατέβηκε από τον browser.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(dlPath);
  ok(JSON.stringify(wb.worksheets.map(w => w.name)) ===
     JSON.stringify(['Σύνοψη', 'Υπολογισμός', 'Δεδομένα', 'Εισαγωγές']), 'φύλλα ληφθέντος αρχείου');
  const calc = wb.getWorksheet('Υπολογισμός');
  const fI5 = calc.getCell('I5').formula || (calc.getCell('I5').value || {}).formula;
  ok(fI5 === 'E5-F5+G5+H5', 'ζωντανή φόρμουλα I5 στο ληφθέν αρχείο');
  const q5 = calc.getCell('Q5').value;
  const f54janImpact = Math.max(0, 1260.42 - 734.31 + 223.85 - 5239 / 12) * 4852 * DISCOUNTS[1];
  ok(q5 && typeof q5 === 'object' && Math.abs(q5.result - f54janImpact) < 1,
    'Q5 (F1054 Ιαν) = ' + Math.round(q5.result) + ' € ≈ αναμενόμενο ' + Math.round(f54janImpact) + ' €');

  console.log('\n' + passed + ' πέρασαν, ' + failed + ' απέτυχαν');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
