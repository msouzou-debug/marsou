// End-to-end test against the July 2026 hand-built workbook.
// usage: node test/run_july.js <capDir> <raDir> <julyXlsx> <outDir>
const path = require('path'), fs = require('fs');
const NM = process.env.NODE_MODULES || path.join(__dirname, '../node_modules');
const ExcelJS = require(NM + '/exceljs');
const pdfjs = require(NM + '/pdfjs-dist/legacy/build/pdf.js');
const { parseCapItems } = require('../src/parsecap.js');
const { parseRaItems } = require('../src/parsera.js');
const core = require('../src/core.js');
const [capDir, raDir, july, outDir] = process.argv.slice(2);
async function items(file) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise; const pages = [];
  for (let p = 1; p <= d.numPages; p++) { const tc = await (await d.getPage(p)).getTextContent(); pages.push(tc.items.map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str }))); }
  return pages;
}
const val = c => core.cellVal(c);
(async () => {
  const jw = new ExcelJS.Workbook(); await jw.xlsx.readFile(july);
  // seed roster from July staff tabs
  const roster = [];
  for (const cat of core.CATS) {
    const ws = jw.getWorksheet(cat); const full = cat === 'ΔΥ' || cat === 'ΟΚΥΠΥ';
    ws.eachRow((row, r) => {
      if (r === 1) return; const g = i => val(row.getCell(i));
      const name = String(g(full ? 4 : 1) || '').trim(); if (!/^D\d/.test(name)) return;
      roster.push(full ? { code: name.split(/\s+/)[0], name, cat, aka: g(1), adt: g(2), pepp: g(3), centre: g(5), remote: g(7) || 0, head: g(8) || 0, quality: g(9) || 0, overtime: cat === 'ΔΥ' ? g(12) : null }
        : { code: name.split(/\s+/)[0], name, cat, remote: 0, head: 0, quality: 0 });
    });
  }
  const tpl = core.rosterTemplate(ExcelJS, roster); await tpl.xlsx.writeFile(path.join(outDir, 'ROSTER_capitation.xlsx'));
  // re-read roster through the same path the page uses
  const rw = new ExcelJS.Workbook(); await rw.xlsx.readFile(path.join(outDir, 'ROSTER_capitation.xlsx'));
  const ros = core.readRoster(rw);
  const capFiles = [], raFiles = [];
  for (const f of fs.readdirSync(capDir).filter(f => /\.pdf$/i.test(f))) capFiles.push({ file: f, ...parseCapItems(await items(path.join(capDir, f))) });
  for (const f of fs.readdirSync(raDir).filter(f => /\.pdf$/i.test(f))) raFiles.push({ file: f, ...parseRaItems(await items(path.join(raDir, f))) });
  const history = core.readHistory(jw);
  // pretend July is "previous month" only for history rows before July (filter happens in writer)
  const M = core.prepare({ capFiles, raFiles, roster: ros, history });
  const { wb, summary } = await core.buildWorkbook(ExcelJS, M);
  const out = path.join(outDir, `CAPITATION_FEES_${String(M.month).padStart(2, '0')}_${M.year}_TEST.xlsx`);
  await wb.xlsx.writeFile(out);
  // compare
  const ono = new Map(); jw.getWorksheet('ΟΝΟΜΑΣΤΙΚΑ').eachRow((row, r) => { const a = String(val(row.getCell(1)) || ''); if (/^D\d/.test(a)) ono.set(a.split(/\s+/)[0], val(row.getCell(2))); });
  let bad = 0; for (const [k, x] of ono) { const y = (M.docs.get(k) || {}).total; if (Math.abs(x - y) > 0.005) { bad++; console.log('DIFF', k, x, y); } }
  console.log('doctors compared', ono.size, 'mismatches', bad);
  for (const c of summary.byCat) console.log(c.name, c.n, c.total.toFixed(2));
  console.log('total', summary.total.toFixed(2), 'oay', summary.oay.toFixed(2), 'kpi', summary.kpi.toFixed(2), 'history rows', history.length, history[0]);
  for (const c of summary.checks) console.log(c.ok ? 'OK ' : 'BAD', c.name, c.expected.toFixed(2), c.actual.toFixed(2));
  console.log('outOfRoster', summary.outOfRoster.map(d => d.code), 'rosterNoCap', summary.rosterNoCap.map(d => d.code), 'kpiNoList', summary.kpiNoList.length, 'empty', summary.empty.length);
  const ex = { ...summary, outOfRoster: summary.outOfRoster.map(d => ({ code: d.code, total: d.total })), rosterNoCap: summary.rosterNoCap.map(d => ({ code: d.code, cat: d.cat })),
    kpiNoList: summary.kpiNoList.map(l => ({ desc: l.desc, supplier: l.supplier, paid: l.paid })), duplicates: summary.duplicates.length };
  fs.writeFileSync(path.join(outDir, 'example_summary.json'), JSON.stringify(ex));
  console.log(out);
})().catch(e => { console.error(e); process.exit(1); });
