#!/usr/bin/env node
/* Δημιουργία συνθετικών αρχείων ελέγχου στο test/fixtures/. */
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { MONTH_INPUTS, CONSO, DISCOUNTS, CONSO_B1 } = require('./fixture-data');

const DIR = path.join(__dirname, 'fixtures');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const HEADERS = ['Invoice No', 'Billing Provider Id', 'Invoice Category', 'AE Referral',
  'Adjusted Cost Weight', 'DRG/FF Total Amount(Hospital + Total Doctor)', 'Other Col'];

// Σπάει ένα σύνολο σε n «γραμμές απαιτήσεων» που αθροίζουν (σε float) στο σύνολο.
function split(total, n) {
  if (total === 0 || n <= 0) return [];
  const base = Math.round((total / n) * 10000) / 10000;
  const parts = new Array(n - 1).fill(base);
  const partial = base * (n - 1);
  parts.push(total - partial);
  return parts;
}

function isRows(month, opts) {
  opts = opts || {};
  const rows = [HEADERS];
  let inv = 1;
  const push = (code, cat, ae, acw, amt) =>
    rows.push(['INV' + month + '-' + (inv++), code, cat, ae, acw, amt]);

  const inputs = MONTH_INPUTS[month];
  for (const code of Object.keys(inputs)) {
    const t = inputs[code];
    for (const v of split(t.posAe, 22)) push(code, 'Specialised', 'Y', v, Math.abs(v) * 4000 + 10);
    for (const v of split(t.pos - t.posAe, 23)) push(code, 'Specialised', 'N', v, Math.abs(v) * 4000 + 10);
    for (const v of split(t.negAe, 2)) push(code, 'Specialised', 'Y', v, -(Math.abs(v) * 4000 + 10));
    for (const v of split(t.neg - t.negAe, 3)) push(code, 'Specialised', 'N', v, -(Math.abs(v) * 4000 + 10));
  }

  // Θόρυβος που πρέπει να αγνοηθεί: άλλος πάροχος, 'nan' ACW, μηδενικό ποσό, Birth.
  push('F1111', 'Specialised', 'N', 5.5, 22000);
  push('F1111', 'Specialised', 'Y', 2.2, 8800);
  push('F1054', 'Specialised', 'N', 'nan', 1234);   // ACW nan → αγνοείται
  push('F1054', 'Specialised', 'N', 1.7, 0);        // ποσό 0 → ούτε θετικό ούτε αρνητικό
  for (let i = 0; i < 5; i++) push('F1054', 'Birth', 'N', 0.8, 3000);

  const filler = opts.filler !== undefined ? opts.filler : 7200;
  for (let i = 0; i < filler; i++) {
    push('F10' + (40 + (i % 20)), 'Normal', i % 7 === 0 ? 'Y' : 'N', 0.9, 1500);
  }
  rows.splice(200, 0, [null, null, null, null, null, null]); // κενή γραμμή στη μέση

  return rows;
}

function writeIs(month, filename, opts) {
  const wb = XLSX.utils.book_new();
  // Φύλλο 'Lists' πρώτο — ο parser πρέπει να το προσπεράσει.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['lookup'], ['a'], ['b']]), 'Lists');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(isRows(month, opts)), 'Φύλλο1');
  XLSX.writeFile(wb, path.join(DIR, filename));
}

const IS_FILES = {
  1: 'IS_Auditor_Report_JAN_2026.xlsx',
  2: 'IS Auditor Report Φεβρουαρίου 2026.xlsx',
  3: 'IS_Auditor_March_26.xlsx',
  4: 'is_auditor_2026-04.xlsx',
  5: 'IS_Auditor_ΜΑΪΟΥ_2026.xlsx'
};
for (const m of Object.keys(IS_FILES)) writeIs(+m, IS_FILES[m]);

// Ελλιπές (κομμένο) αρχείο — πρέπει να σηκώσει προειδοποίηση.
writeIs(1, 'IS_Auditor_TRUNCATED_JAN_2026.xlsx', { filler: 300 });

// Αρχείο με ελλιπείς στήλες — πρέπει να γυρίσει σφάλμα.
{
  const wb = XLSX.utils.book_new();
  const rows = [['Billing Provider Id', 'Invoice Category', 'Adjusted Cost Weight'],
    ['F1054', 'Specialised', 1.1]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Φύλλο1');
  XLSX.writeFile(wb, path.join(DIR, 'IS_Auditor_BAD_COLUMNS.xlsx'));
}

// Αρχεία Conso >15%.
const CONSO_FILES = {};
for (const m of Object.keys(CONSO)) {
  const wb = XLSX.utils.book_new();
  const codes = Object.keys(CONSO[m]);
  codes.forEach((code, i) => {
    const aoa = [
      ['', i === 0 ? CONSO_B1[m] : '', ''],                    // B1: μήνας στο πρώτο φύλλο
      ['', '', ''],
      ['', 'Κανονικά', 999.9],
      ['', 'Εξειδικευμένα', CONSO[m][code]]
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), code);
  });
  // Φύλλο TOTAL — πρέπει να αγνοηθεί, ακόμη κι αν έχει γραμμή «Εξειδικευμένα».
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['', 'Κανονικά', 5555], ['', 'Εξειδικευμένα', 9999]
  ]), 'TOTAL');
  const fn = 'Conso_over15_month' + m + '.xlsx'; // χωρίς όνομα μήνα: ανίχνευση μόνο από B1
  CONSO_FILES[m] = fn;
  XLSX.writeFile(wb, path.join(DIR, fn));
}

// «Βρόμικο» αρχείο Conso όπως τα πραγματικά: ετικέτα εκτός στήλης B (συγχωνευμένα
// κελιά), κεφαλαία, κενά στο τέλος, ονόματα φύλλων με κωδικό μέσα σε μεγαλύτερο
// κείμενο, τιμές ως κείμενο, φύλλο ΣΥΝΟΛΟ στα ελληνικά.
{
  const wb = XLSX.utils.book_new();
  // Κωδικός μέσα σε μεγαλύτερο όνομα, πεζά· ετικέτα ΚΕΦΑΛΑΙΑ στη στήλη A
  // (σαν συγχωνευμένο A:B), κενή B, τιμή στη C.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['', 'ΙΑΝΟΥΑΡΙΟΣ 2026'],
    [],
    ['ΚΑΝΟΝΙΚΑ', null, 500],
    ['ΕΞΕΙΔΙΚΕΥΜΕΝΑ', null, 45]
  ]), 'f1047 - ΓΝ Λεμεσού');
  // Ετικέτα με κενό στο τέλος στη στήλη B, τιμή-κείμενο στη C.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [],
    ['', 'Κανονικά', '100'],
    ['', 'Εξειδικευμένα ', '223.85']
  ]), 'F1054');
  // Φύλλο χωρίς γραμμή «Εξειδικευμένα» → προειδοποίηση, όχι σφάλμα.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['', 'Κανονικά', 77]
  ]), 'F1050');
  // Ελληνικό φύλλο συνόλων → αγνοείται.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['', 'Εξειδικευμένα', 9999]
  ]), 'ΣΥΝΟΛΟ');
  XLSX.writeFile(wb, path.join(DIR, 'Conso_MESSY_LAYOUT.xlsx'));
}

// Αρχείο εκπτώσεων ΟΑΥ: πίνακας από τη γραμμή 6, A=έτος, B=μήνας, M=τελικό %.
{
  const rows = [
    ['Ενημέρωση Νοσηλευτηρίων για αποζημίωση μονάδων υπέρβασης'],
    [], [],
    ['πίνακας αποτελεσμάτων'],
    ['Έτος', 'Μήνας', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'Τελικό % Έκπτωσης'],
  ];
  const MONTH_EL = { 1: 'Ιανουάριος', 2: 'Φεβρουάριος', 3: 'Μάρτιος', 4: 'Απρίλιος', 5: 'Μάιος' };
  for (const m of Object.keys(DISCOUNTS)) {
    rows.push([2026, MONTH_EL[m], 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, DISCOUNTS[m]]);
  }
  rows.push([2025, 'Δεκεμβρίου', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.5]); // άλλο έτος
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(wb, path.join(DIR, 'ΟΑΥ_Εκπτώσεις_2026.xlsx'));
}

fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify({ IS_FILES, CONSO_FILES }, null, 2));
console.log('Fixtures OK →', DIR);
