// Rebuilds a month from a previous output of this tool (its ALL and SRA_PD tabs), then runs it again.
// usage: node test/replay.js <month_output.xlsx> <previous_month.xlsx> <outDir>
const path = require('path'), fs = require('fs');
const NM = process.env.NODE_MODULES || path.join(__dirname, '../node_modules');
const ExcelJS = require(NM + '/exceljs');
const core = require('../src/core.js');
const [src, prevFile, outDir] = process.argv.slice(2);
const val = c => core.cellVal(c);
const dmy = d => d instanceof Date ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : String(d || '');
(async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(src);
  const all = wb.getWorksheet('ALL'), month = Number(val(all.getCell('B1'))), year = Number(val(all.getCell('B2')));
  const byFile = new Map(); let inv = null, doc = null;
  all.eachRow((row, r) => {
    if (r < 4) return; const g = i => val(row.getCell(i)), kind = g(10);
    if (kind === 'ΠΑΡΟΧΟΣ') {
      const file = g(9); if (!byFile.has(file)) byFile.set(file, { file, month, year, invoices: [] });
      inv = { id: g(1), provider: g(2), type: g(3), date: dmy(g(5)), amount: g(8), doctors: [] }; byFile.get(file).invoices.push(inv);
    } else if (kind === 'ΙΑΤΡΟΣ') { doc = { code: String(g(2)).split(/\s+/)[0], name: g(2), amount: g(8), rows: [] }; inv.doctors.push(doc); }
    else if (kind === 'ΗΛΙΚΙΑ') doc.rows.push({ age: g(3), comment: g(4), rate: String(g(5)), count: g(6), days: g(7), amount: g(8) });
  });
  const ra = new Map();
  wb.getWorksheet('SRA_PD').eachRow((row, r) => {
    if (r === 1) return; const g = i => val(row.getCell(i));
    const file = g(1); if (!ra.has(file)) ra.set(file, { file, supplier: g(2), payNo: g(3), payDate: dmy(g(4)), lines: [] });
    ra.get(file).lines.push({ invDate: dmy(g(5)), invNo: String(g(6)), desc: g(11), invTotal: g(10), paid: g(10) });
  });
  const roster = core.readRoster(wb);
  const pw = new ExcelJS.Workbook(); await pw.xlsx.readFile(prevFile);
  const previous = core.readPrevious(pw), history = core.readHistory(wb);
  const M = core.prepare({ capFiles: [...byFile.values()], raFiles: [...ra.values()], roster, history, previous });
  const { wb: out, summary } = await core.buildWorkbook(ExcelJS, M);
  const fn = path.join(outDir, `REPLAY_${String(month).padStart(2, '0')}_${year}.xlsx`); await out.xlsx.writeFile(fn);
  // compare per doctor with the source month's ΟΝΟΜΑΣΤΙΚΑ
  const ono = new Map(); wb.getWorksheet('ΟΝΟΜΑΣΤΙΚΑ').eachRow((row, r) => { const c = String(val(row.getCell(4)) || ''); if (/^D\d/.test(c)) ono.set(c, Number(val(row.getCell(2)))); });
  let bad = 0; for (const [k, x] of ono) { const y = (M.docs.get(k) || { total: 0 }).total; if (Math.abs(x - y) > 0.005) { bad++; console.log('DIFF', k, x, y); } }
  console.log('doctors', ono.size, 'diff vs source', bad, '| previous', previous.month + '/' + previous.year, previous.docs.size, 'doctors');
  for (const b of M.blocks.filter(b => b.d.code === 'D1493')) console.log('D1493 list', b.list, '-> sheet', b.key, b.S);
  for (const c of summary.checks) console.log(c.ok ? 'OK ' : 'BAD', c.name, +c.expected.toFixed(2), +c.actual.toFixed(2));
  console.log('flagged', summary.compare.flagged.length, summary.compare.flagged.slice(0, 8).map(x => `${x.code} ${x.status} ${x.delta.toFixed(2)}`));
  console.log(fn);
})().catch(e => { console.error(e); process.exit(1); });
