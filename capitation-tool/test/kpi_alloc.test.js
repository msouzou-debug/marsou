// KPI allocation: each KPI goes to the doctor's list at the provider that paid it; otherwise to the first list.
const assert = require('assert');
const core = require('../src/core.js');
const row = (age, days, amount) => ({ age, comment: '-', rate: '0.220', count: 1, days, amount });
const inv = (id, prov, code, amount) => ({ id, provider: prov + ' TEST', type: 'STANDARD', date: '30/09/2026', amount,
  doctors: [{ code, name: code + ' TEST / TEST', amount, rows: [row('8 - 14 years', 3000, amount)] }] });
const capFiles = [{ file: 'a.pdf', month: 9, year: 2026, invoices: [inv(1, 'F1025', 'D1', 100), inv(2, 'F1050', 'D1', 50), inv(3, 'F1025', 'D2', 80)] }];
const kpi = (sup, doc, paid) => ({ invDate: '30/09/2026', invNo: 'KPIs', desc: `PD-KPIs-09-2026-CHILD-${doc}`, invTotal: paid, paid });
const raFiles = [
  { file: 'F1025.pdf', supplier: 'F1025', payNo: '1', payDate: '15/10/2026', lines: [kpi('F1025', 'D1', 3), kpi('F1025', 'D2', 4)] },
  { file: 'F1050.pdf', supplier: 'F1050', payNo: '2', payDate: '15/10/2026', lines: [kpi('F1050', 'D1', 2), kpi('F1050', 'D2', 5), kpi('F1050', 'D9', 7)] },
];
const roster = [{ code: 'D1', name: 'D1', cat: 'ΟΚΥΠΥ', pepp: 'ΠΠ' }, { code: 'D2', name: 'D2', cat: 'ΟΚΥΠΥ', pepp: 'ΠΠ' }];
const M = core.prepare({ capFiles, raFiles, roster });
const J = (code, prov) => M.blocks.find(b => b.d.code === code && b.inv.providerCode === prov).J;
assert.strictEqual(J('D1', 'F1025'), 3, 'Paphos KPI stays on the Paphos list');
assert.strictEqual(J('D1', 'F1050'), 2, 'Makarios KPI goes to the Makarios list');
assert.strictEqual(J('D2', 'F1025'), 9, 'no D2 list at F1050, so its KPI falls back to the F1025 list');
assert.deepStrictEqual(M.kpiNoList.map(l => l.doctor), ['D9'], 'a KPI with no list at all is reported');
assert.strictEqual(M.blocks.find(b => b.d.code === 'D1' && b.inv.providerCode === 'F1050').key, 'NAM');
console.log('kpi allocation tests passed');
