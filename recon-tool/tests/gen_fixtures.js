// Regenerates the V2 sample fixtures. Run once: node gen_fixtures.js
const XLSX = require('../vendor/xlsx.full.min.js');
const fs = require('fs');
const path = require('path');
const S = f => path.join(__dirname, '..', 'samples', f);

/* ---- split-match fixtures ----
   Key-based pass matches nothing (no shared keys). Expected proposals (tol 0.01,
   greedy largest first, members >= 2):
   - INV-500  500.00  = PAY-01 200.00 + PAY-02 180.00 + PAY-03 120.00  (exact, 1-to-3)
   - INV-250  250.01  = PAY-04 150.00 + PAY-05 100.00                  (diff 0.01, in tolerance)
   - INV-300  300.00  = decoy: its only combos need members consumed above -> stays open
   Remaining open B: PAY-06 90.00, PAY-07 75.00, PAY-08 40.00 (no subset hits 300 +/- 0.01)
*/
const A = [
  ['Τιμολόγιο', 'Ημερομηνία', 'Περιγραφή', 'Ποσό'],
  ['INV-500', '01/03/2026', 'Προμηθευτής ΑΛΦΑ', 500.00],
  ['INV-300', '05/03/2026', 'Προμηθευτής ΒΗΤΑ', 300.00],
  ['INV-250', '10/03/2026', 'Προμηθευτής ΓΑΜΑ', 250.01],
];
const B = [
  ['Αναφορά Πληρωμής', 'Ημερομηνία', 'Περιγραφή', 'Ποσό'],
  ['PAY-01', '03/03/2026', 'Μερική εξόφληση ΑΛΦΑ', 200.00],
  ['PAY-02', '08/03/2026', 'Μερική εξόφληση ΑΛΦΑ', 180.00],
  ['PAY-03', '12/03/2026', 'Μερική εξόφληση ΑΛΦΑ', 120.00],
  ['PAY-04', '11/03/2026', 'Εξόφληση ΓΑΜΑ 1/2', 150.00],
  ['PAY-05', '14/03/2026', 'Εξόφληση ΓΑΜΑ 2/2', 100.00],
  ['PAY-06', '02/03/2026', 'Λοιπές πληρωμές', 90.00],
  ['PAY-07', '04/03/2026', 'Λοιπές πληρωμές', 75.00],
  ['PAY-08', '06/03/2026', 'Λοιπές πληρωμές', 40.00],
];
// the vendored browser build has no fs binding: write via buffer
const writeWb = (wb, file) => fs.writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
const wbA = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbA, XLSX.utils.aoa_to_sheet(A), 'SAP');
writeWb(wbA, S('split_A.xlsx'));
const wbB = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbB, XLSX.utils.aoa_to_sheet(B), 'Bank');
writeWb(wbB, S('split_B.xlsx'));

/* ---- tier (cascading pass) fixtures ----
   No shared keys. With pass 2 on (±7 days): REF-A1 <-> ZZZ-9 (120.00, 2 days apart).
   With pass 3 on: REF-A2 <-> YYY-8 (same amount 55.5, near-identical descriptions).
   REF-A3 stays open (amount matches nothing).
*/
fs.writeFileSync(S('tier_A.csv'),
  'Ref,Date,Description,Amount\n' +
  'REF-A1,01/03/2026,Bank transfer March,120.00\n' +
  'REF-A2,02/03/2026,ΠΡΟΜΗΘΕΙΑ ΦΑΡΜΑΚΩΝ ΛΕΥΚΩΣΙΑ,55.50\n' +
  'REF-A3,03/03/2026,Other item,999.00\n');
fs.writeFileSync(S('tier_B.csv'),
  'Ref,Date,Description,Amount\n' +
  'ZZZ-9,03/03/2026,Incoming transfer,120.00\n' +
  'YYY-8,20/04/2026,ΠΡΟΜΗΘΕΙΑ ΦΑΡΜΑΚΩΝ ΛΕΥΚΩΣΙΑΣ,55.50\n' +
  'XXX-7,04/03/2026,Unrelated,111.11\n');

/* ---- performance fixture: >= 2000 open items, no shared keys ----
   Deterministic LCG so the fixture is reproducible.
*/
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let a = 'Key,Date,Description,Amount\n';
for (let i = 0; i < 1000; i++)
  a += `PA-${String(i).padStart(4, '0')},${String(1 + (i % 28)).padStart(2, '0')}/03/2026,Item A${i},${(Math.round(rnd() * 900000) + 100) / 100}\n`;
let b = 'Key,Date,Description,Amount\n';
for (let i = 0; i < 1200; i++)
  b += `PB-${String(i).padStart(4, '0')},${String(1 + (i % 28)).padStart(2, '0')}/03/2026,Item B${i},${(Math.round(rnd() * 900000) + 100) / 100}\n`;
fs.writeFileSync(S('perf_A.csv'), a);
fs.writeFileSync(S('perf_B.csv'), b);

console.log('fixtures written: split_A.xlsx split_B.xlsx tier_A.csv tier_B.csv perf_A.csv perf_B.csv');
