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
   - INV-13M 13,000,000 = thirteen equal PAY-M lines of 1,000,000 (batch transfer,
     exceeds the DFS cap of 6 -> must be found by the instalment/denomination path)
*/
const A = [
  ['Τιμολόγιο', 'Ημερομηνία', 'Περιγραφή', 'Ποσό'],
  ['INV-13M', '15/03/2026', 'Μεταφορά σε λογαριασμό εξόδων', 13000000.00],
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
  ...Array.from({ length: 13 }, (_, i) =>
    [`PAY-M${String(i + 1).padStart(2, '0')}`, `${String(10 + i).padStart(2, '0')}/03/2026`, 'Δόση μεταφοράς', 1000000.00]),
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

/* ---- intercompany fixtures (SAP-style Debit/Credit columns, shared Reference) ----
   Expected with auto D/C netting + auto key suggestion (Reference) + flip B:
   matched refs R-101 (3 lines vs 3), R-102, R-103 (netted 500-100), T-9 (credit-side
   transfer -> the amount lives in the credit column: the v2.0 "invisible" trap);
   open: H-77 (75, A only) and L-88 (60, B only).
   Keyless rows (blank Reference) are line-matched automatically: the 40.00 pair
   matches, A's 15.50 and B's 7.77 stay open. Each file ends with a grand-total
   footer row (blank ref, no date, amount = net of all other rows) that must be
   detected and excluded.
   No-shared-key mode: 8 line pairs matched by amount+date, same open lines. */
const icA = [
  ['Document Number', 'Reference', 'Text', 'Document Date', 'Debit Amount', 'Credit Amount'],
  ['4900000001', 'R-101', 'HO invoice 1a', '10/01/2026', 100.00, 0],
  ['4900000001', 'R-101', 'HO invoice 1b', '10/01/2026', 50.00, 0],
  ['4900000001', 'R-101', 'HO invoice 1c', '10/01/2026', 25.00, 0],
  ['4900000002', 'R-102', 'HO invoice 2', '05/02/2026', 200.00, 0],
  ['4900000003', 'R-103', 'HO invoice 3', '12/02/2026', 500.00, 0],
  ['4900000003', 'R-103', 'HO credit note', '13/02/2026', 0, 100.00],
  ['4900000004', 'T-9', 'transfer to lim', '01/03/2026', 0, 1000.00],
  ['4900000005', 'H-77', 'ho only item', '15/03/2026', 75.00, 0],
  ['4900000006', '', 'misc without ref', '20/03/2026', 40.00, 0],
  ['4900000007', '', 'ho stray line', '21/03/2026', 15.50, 0],
  ['', '', 'TOTAL', '', 1005.50, 1100.00],
];
const icB = [
  ['Document Number', 'Reference', 'Text', 'Document Date', 'Debit Amount', 'Credit Amount'],
  ['3400000001', 'R-101', 'LIM booking 1a', '11/01/2026', 0, 100.00],
  ['3400000001', 'R-101', 'LIM booking 1b', '11/01/2026', 0, 50.00],
  ['3400000001', 'R-101', 'LIM booking 1c', '11/01/2026', 0, 25.00],
  ['3400000002', 'R-102', 'LIM booking 2', '06/02/2026', 0, 200.00],
  ['3400000003', 'R-103', 'LIM booking 3', '12/02/2026', 0, 500.00],
  ['3400000003', 'R-103', 'LIM debit adj', '14/02/2026', 100.00, 0],
  ['3400000004', 'T-9', 'transfer from ho', '01/03/2026', 1000.00, 0],
  ['3400000006', 'L-88', 'lim only item', '20/03/2026', 0, 60.00],
  ['3400000007', '', 'misc without ref', '21/03/2026', 0, 40.00],
  ['3400000008', '', 'lim stray', '22/03/2026', 0, 7.77],
  ['', '', 'TOTAL', '', 1100.00, 982.77],
];
const wbIA = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbIA, XLSX.utils.aoa_to_sheet(icA), 'Sheet1');
writeWb(wbIA, S('ic_A.xlsx'));
const wbIB = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbIB, XLSX.utils.aoa_to_sheet(icB), 'Sheet1');
writeWb(wbIB, S('ic_B.xlsx'));

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

console.log('fixtures written: split_A.xlsx split_B.xlsx ic_A.xlsx ic_B.xlsx tier_A.csv tier_B.csv perf_A.csv perf_B.csv');
