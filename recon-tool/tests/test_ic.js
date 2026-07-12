// IC Matrix tool v1.0: multi-file load, auto-pairing, per-pair matching,
// matrix cells, drill-down categories, styled export with live formulas,
// progress round trip (registry + file setup + categories).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('../vendor/xlsx-style.full.min.js');

const S = f => path.join(__dirname, '..', 'samples', f);
const APP = 'file://' + path.join(__dirname, '..', 'dist', 'OKYpY_IC_Matrix_Tool.html');
let failures = 0;
const check = (name, cond, info) => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' ' + JSON.stringify(info)));
  if (!cond) failures++;
};

const FIXTURES = ['mx_ho_lim.csv', 'mx_lim_ho.csv', 'mx_ho_lar.csv', 'mx_lar_ho.csv', 'mx_ho_paf.csv'];

async function loadAll(page) {
  await page.setInputFiles('#fileAdd', FIXTURES.map(S));
  await page.waitForFunction(n => FILES.length === n && FILES.every(f => f.rows), FIXTURES.length);
}

// assign entities by filename token: ho→ENTITIES[0], lim→[2], lar→[3], paf→[4]
const ASSIGN = `
  const ent = { ho: ENTITIES[0], lim: ENTITIES[2], lar: ENTITIES[3], paf: ENTITIES[4] };
  FILES.forEach(f => {
    const m = f.name.match(/mx_(\\w+)_(\\w+)\\.csv/);
    f.entity = ent[m[1]]; f.cp = ent[m[2]];
  });
  renderCards();
`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });

  /* ============ 1. build the matrix ============ */
  let page = await browser.newPage();
  await page.goto(APP);
  await loadAll(page);
  let r = await page.evaluate(() => ({
    balances: FILES.map(f => [f.name, f.balance]),
    ready: FILES.every(f => f.map.amt === 'Amount' && f.map.date === 'Date' && f.map.desc === 'Description'),
  }));
  console.log('FILES:', JSON.stringify(r));
  check('five files load with auto-guessed columns and balances', r.ready &&
    JSON.stringify(r.balances.map(x => x[1])) === JSON.stringify([350, -320, 400, -400, 75]), r);

  await page.evaluate(ASSIGN);
  await page.evaluate(() => runMatrix());
  await page.waitForSelector('#stepMx:not(.hidden)');
  r = await page.evaluate(() => ({
    pairs: MATRIX.pairs.map(p => [entLabel(p.entX), entLabel(p.entY), +p.raw.toFixed(2), +p.residual.toFixed(2), p.matchedN, p.openX.length, p.openY.length, !!p.key]),
    singles: MATRIX.singles.map(f => f.name),
    cells: { ok: document.querySelectorAll('table.mx td.ok').length, bad: document.querySelectorAll('table.mx td.bad').length,
             missTxt: document.querySelectorAll('table.mx td.miss .mtxt').length },
    kpis: [...document.querySelectorAll('.kpi .v')].map(x => x.textContent),
  }));
  console.log('MATRIX:', JSON.stringify(r));
  check('HO⇄LIM pair: keyed match, residual 30 explained by R3 (50) vs R4 (20)',
    r.pairs.length === 2 && r.pairs[0][2] === 30 && r.pairs[0][3] === 30 && r.pairs[0][4] === 2 &&
    r.pairs[0][5] === 1 && r.pairs[0][6] === 1 && r.pairs[0][7] === true, r.pairs);
  /* the reconciliation itself is retained and visible */
  let rm = await page.evaluate(() => {
    SELPAIR = 0; renderMatrix(); renderDrill();
    return {
      matched: MATRIX.pairs[0].matched.map(x => [x.key, x.ax, x.ay]),
      detailsShown: !!document.querySelector('#drill details'),
      matchedRows: document.querySelectorAll('#drill details tbody tr').length,
    };
  });
  console.log('MATCHED:', JSON.stringify(rm));
  check('matched entries retained with both sides of the amounts',
    rm.matched.length === 2 && rm.matched.every(x => /R[12]/.test(x[0]) && x[1] === x[2]), rm.matched);
  check('drill shows the matched-entries section', rm.detailsShown && rm.matchedRows === 2, rm);
  check('HO⇄LAR pair: line-matched with zero residual (no shared key volume)',
    r.pairs[1][3] === 0 && r.pairs[1][4] === 2 && r.pairs[1][5] === 0 && r.pairs[1][6] === 0 && r.pairs[1][7] === false, r.pairs);
  check('one-sided PAF file reported as missing counterparty', r.singles.length === 1 && /paf/.test(r.singles[0]), r.singles);
  // green = fully categorised: LAR pair has no open items (trivially done),
  // LIM pair has 2 uncategorised items -> red until they are categorised
  check('matrix cells: 2 green (symmetric), 2 red-with-uncategorised, one-sided balance shown',
    r.cells.ok === 2 && r.cells.bad === 2 && r.cells.missTxt === 2, r.cells);

  /* ============ 2. drill-down + category (cell state follows live) ============ */
  r = await page.evaluate(() => {
    SELPAIR = 0; renderMatrix(); renderDrill();
    setCat(0, 'X', 0, 'catT'); // R3 categorised; R4 still open
    renderDrill();
    return {
      drillShown: !document.getElementById('drill').classList.contains('hidden'),
      openXKeys: MATRIX.pairs[0].openX.map(x => x.key),
      catSel: document.querySelector('#drill .paneh .catsel').value,
      stillBad: document.querySelectorAll('table.mx td.bad').length,
      uncatShown: document.querySelector('#drill .drillhead').textContent,
    };
  });
  check('drill-down opens with the open items and keeps the category', r.drillShown && JSON.stringify(r.openXKeys) === JSON.stringify(['R3']) && r.catSel === 'catT', r);
  check('cell stays red while one item is uncategorised', r.stillBad === 2 && /1/.test(r.uncatShown), r.stillBad);

  /* ============ 3. styled export with live formulas ============ */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportExcel())]);
  const xPath = path.join(__dirname, 'export_ic.xlsx');
  await dl.saveAs(xPath);
  const wb = XLSX.read(fs.readFileSync(xPath), { type: 'buffer', cellStyles: true });
  console.log('SHEETS:', JSON.stringify(wb.SheetNames));
  check('matrix sheet first, one detail sheet per pair, documentation last',
    wb.SheetNames[0] === 'Πίνακας' && wb.SheetNames.length === 4 && wb.SheetNames[3] === 'Τεκμηρίωση', wb.SheetNames);
  const wsM = wb.Sheets['Πίνακας'];
  check('gross difference is a live formula', wsM.D4 && wsM.D4.f === 'B4-C4' && Math.abs(wsM.D4.v - 30) < 0.005, wsM.D4);
  check('open sums pull live from the pair sheet (bounded to the open block)',
    /^SUM\('P1 [^']*'!E2:E3\)$/.test(wsM.F4 && wsM.F4.f || ''), wsM.F4 && wsM.F4.f);
  check('matched-net is a live formula over the matched block',
    /^SUM\('P1 [^']*'!E7:E8\)-SUM\('P1 [^']*'!F7:F8\)$/.test(wsM.E4 && wsM.E4.f || '') && Math.abs(wsM.E4.v) < 0.005, wsM.E4);
  check('residual and check row are live', wsM.H4 && wsM.H4.f === 'F4-G4' && wsM.I4 && wsM.I4.f === 'ROUND(D4-(E4+H4),2)' && wsM.I4.v === 0, { H: wsM.H4, I: wsM.I4 });
  check('uncategorised count is live (R4 still blank)', wsM.J4 && wsM.J4.v === 1 && /^COUNTBLANK\('P1 [^']*'!G2:G3\)$/.test(wsM.J4.f || ''), wsM.J4);
  check('open-items cell filled red while uncategorised remain', wsM.H4.s && wsM.H4.s.fgColor && wsM.H4.s.fgColor.rgb === 'F8DEDA', wsM.H4.s);
  check('header carries the brand fill', wsM.A3 && wsM.A3.s && wsM.A3.s.fgColor && wsM.A3.s.fgColor.rgb === '069FEC', wsM.A3 && wsM.A3.s);
  const pairSheet = wb.Sheets[wb.SheetNames[1]];
  check('pair sheet lists R3 open on X with its category label',
    pairSheet.B2 && pairSheet.B2.v === 'R3' && pairSheet.E2 && pairSheet.E2.v === 50 && pairSheet.G2 && /Χρονική/.test(pairSheet.G2.v), { B: pairSheet.B2, E: pairSheet.E2, G: pairSheet.G2 });
  check('pair sheet carries the matched block with live per-row differences',
    pairSheet.A5 && /ΣΥΜΦΩΝΗΜΕΝΕΣ/.test(pairSheet.A5.v) && pairSheet.E7 && pairSheet.F7 && pairSheet.E7.v === pairSheet.F7.v &&
    pairSheet.G7 && pairSheet.G7.f === 'E7-F7' && pairSheet.G7.v === 0, { A5: pairSheet.A5, E7: pairSheet.E7, G7: pairSheet.G7 });

  /* ============ 3b. bulk categorise turns the pair green ============ */
  r = await page.evaluate(() => {
    bulkCat(0, 'Y', 'catT'); // the remaining R4
    return {
      ok: document.querySelectorAll('table.mx td.ok').length,
      bad: document.querySelectorAll('table.mx td.bad').length,
      kpiOk: document.querySelectorAll('.kpi .v')[1].textContent,
      catY: MATRIX.pairs[0].openY[0].cat,
    };
  });
  check('bulk categorise clears the pair to green', r.ok === 4 && r.bad === 0 && r.kpiOk === '2' && r.catY === 'catT', r);

  /* ============ 4. progress round trip ============ */
  const [dlP] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => saveProgress())]);
  const pPath = path.join(__dirname, 'progress_ic.json');
  await dlP.saveAs(pPath);
  const prog = JSON.parse(fs.readFileSync(pPath, 'utf8'));
  check('progress stores registry, file setup and categories',
    prog.app === 'okypy-ic' && Array.isArray(prog.registry) && Object.keys(prog.files).length === 5 &&
    Object.values(prog.cats).includes('catT'), Object.keys(prog));
  await page.close();

  /* fresh page: progress first, then files — everything self-assembles */
  page = await browser.newPage();
  await page.goto(APP);
  await page.setInputFiles('#progFile', pPath);
  await page.waitForFunction(() => document.getElementById('progStatus').textContent !== '');
  await loadAll(page);
  await page.evaluate(() => runMatrix());
  await page.waitForSelector('#stepMx:not(.hidden)');
  r = await page.evaluate(() => ({
    entities: FILES.map(f => !!(f.entity && f.cp)),
    cat: MATRIX.pairs[0].openX[0].cat,
    pairs: MATRIX.pairs.length,
  }));
  console.log('ROUNDTRIP:', JSON.stringify(r));
  check('progress re-applies entities to files loaded AFTER it', r.entities.every(Boolean) && r.pairs === 2, r);
  check('category carried back to the reopened matrix', r.cat === 'catT', r);
  await page.close();

  await browser.close();
  console.log(failures ? 'IC TESTS FAILED: ' + failures : 'IC TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
