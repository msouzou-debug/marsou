// v2.1 feature tests: Debit/Credit netting, key suggestion + guardrails,
// no-shared-key line mode, adjusted-balance sheet on every preset.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('../vendor/xlsx.full.min.js');
const ROOT = path.join(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'dist', 'OKYpY_Reconciliation_Tool.html');
const S = f => path.join(ROOT, 'samples', f);

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : ''));
  if (!cond) failures++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGEERROR:', e.message); failures++; });
  await page.goto(APP);
  await page.setInputFiles('#fileA', S('ic_A.xlsx'));
  await page.setInputFiles('#fileB', S('ic_B.xlsx'));
  await page.waitForSelector('#stepMap:not(.hidden)');

  /* ---- auto-mapping: D/C netting detected, Reference auto-suggested as key ---- */
  const map = await page.evaluate(() => ({
    amtA: document.getElementById('amtA').value, crA: document.getElementById('crA').value,
    amtB: document.getElementById('amtB').value, crB: document.getElementById('crB').value,
    keysA: [...document.querySelectorAll('#keysA input:checked')].map(x => x.value),
    keysB: [...document.querySelectorAll('#keysB input:checked')].map(x => x.value),
    hint: document.getElementById('keyHint').textContent,
    suggested: SUGGESTED_KEY && [SUGGESTED_KEY.ca, SUGGESTED_KEY.cb],
  }));
  console.log('AUTO:', JSON.stringify(map));
  check('debit/credit netting auto-detected', map.amtA === 'Debit Amount' && map.crA === 'Credit Amount' && map.crB === 'Credit Amount');
  check('Reference suggested as key pair', JSON.stringify(map.suggested) === JSON.stringify(['Reference', 'Reference']), map.suggested);
  check('hopeless guess (Document Number) auto-switched to Reference',
    JSON.stringify(map.keysA) === JSON.stringify(['Reference']) && JSON.stringify(map.keysB) === JSON.stringify(['Reference']), [map.keysA, map.keysB]);
  check('suggestion hint shown', map.hint.includes('Reference'), map.hint);

  /* ---- keyed run with netting + flip: intercompany reconciles ---- */
  await page.evaluate(() => { document.getElementById('flipB').checked = true; });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  let r = await page.evaluate(() => ({
    keyed: RESULT.matched.filter(x => x.rule === 1).map(x => [x.key, +x.amtA.toFixed(2)]).sort(),
    keyless: RESULT.matched.filter(x => x.rule === 2).map(x => [x.key, +x.amtA.toFixed(2)]),
    diffs: RESULT.diffs.length,
    onlyA: RESULT.onlyA.map(x => [x.key, +x.diff.toFixed(2)]),
    onlyB: RESULT.onlyB.map(x => [x.key, +x.diff.toFixed(2)]),
    totA: +RESULT.totA.toFixed(2), totB: +RESULT.totB.toFixed(2),
    totalRows: [RESULT.totalRowA.n, RESULT.totalRowB.n],
    warns: RESULT.warns,
  }));
  console.log('KEYED:', JSON.stringify(r));
  check('4 references matched (incl. netted R-103 and credit-side T-9)',
    JSON.stringify(r.keyed) === JSON.stringify([['R-101', 175], ['R-102', 200], ['R-103', 400], ['T-9', -1000]]), r.keyed);
  check('keyless 40.00 pair line-matched automatically (rule 2)',
    JSON.stringify(r.keyless) === JSON.stringify([['#10 ⇄ #10', 40]]), r.keyless);
  check('no differences', r.diffs === 0);
  check('open items: true reconciling items plus unexplained keyless lines',
    JSON.stringify(r.onlyA) === JSON.stringify([['H-77', 75], ['#11', 15.5]]) &&
    JSON.stringify(r.onlyB) === JSON.stringify([['L-88', -60], ['#11', -7.77]]), [r.onlyA, r.onlyB]);
  check('totals cover every row except the detected footer', r.totA === -94.5 && r.totB === -117.23, [r.totA, r.totB]);
  check('one grand-total footer row excluded per side', JSON.stringify(r.totalRows) === JSON.stringify([1, 1]), r.totalRows);
  check('no warnings on a healthy run', r.warns.length === 0, r.warns);

  /* ---- export: adjusted-balance sheet present on the generic preset ---- */
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => exportExcel()),
  ]);
  const xlsxPath = path.join(__dirname, 'export_v3.xlsx');
  await download.saveAs(xlsxPath);
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer', cellFormula: true });
  console.log('SHEETS:', JSON.stringify(wb.SheetNames));
  check('adjusted-balance sheet exported (non-bank preset)', wb.SheetNames.includes('Προσαρμοσμένα υπόλοιπα'));
  const wsAdj = wb.Sheets['Προσαρμοσμένα υπόλοιπα'];
  check('adjusted balances carry live formulas', wsAdj.B5 && /B3\+B4/.test(wsAdj.B5.f || ''), wsAdj.B5 && wsAdj.B5.f);
  const wsDoc = wb.Sheets['Τεκμηρίωση'];
  const docTxt = JSON.stringify(XLSX.utils.sheet_to_json(wsDoc, { header: 1 }));
  check('doc sheet records credit columns', docTxt.includes('Credit Amount'), '');

  /* ---- no-shared-key mode: line-by-line amount+date ---- */
  await page.evaluate(() => {
    document.getElementById('nokeyon').checked = true;
    document.getElementById('nokeydays').value = 7;
  });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    matched: RESULT.matched.length,
    rules: [...new Set(RESULT.matched.map(x => x.rule))],
    onlyA: RESULT.onlyA.map(x => +x.amtA.toFixed(2)),
    onlyB: RESULT.onlyB.map(x => +x.amtB.toFixed(2)),
    totalRows: [RESULT.totalRowA.n, RESULT.totalRowB.n],
  }));
  console.log('NOKEY:', JSON.stringify(r));
  check('8 line pairs matched by amount+date', r.matched === 8, r.matched);
  check('all labelled rule 2', JSON.stringify(r.rules) === JSON.stringify([2]), r.rules);
  check('open lines incl. unexplained keyless',
    JSON.stringify(r.onlyA) === JSON.stringify([75, 15.5]) && JSON.stringify(r.onlyB) === JSON.stringify([60, 7.77]), [r.onlyA, r.onlyB]);
  check('footer rows excluded in no-key mode too', JSON.stringify(r.totalRows) === JSON.stringify([1, 1]), r.totalRows);

  /* ---- guardrails: hopeless keys produce a visible warning banner ---- */
  await page.evaluate(() => {
    document.getElementById('nokeyon').checked = false;
    ['A', 'B'].forEach(s => document.querySelectorAll('#keys' + s + ' input').forEach(x => {
      x.checked = x.value === 'Document Number';
      x.closest('.keychip').classList.toggle('on', x.checked);
    }));
  });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    matched: RESULT.matched.length,
    warns: RESULT.warns,
    bannerVisible: !document.getElementById('resWarn').classList.contains('hidden'),
    bannerText: document.getElementById('resWarn').textContent,
  }));
  console.log('GUARD:', JSON.stringify(r));
  check('zero matches with disjoint keys', r.matched === 0);
  check('warning banner shown', r.bannerVisible && r.bannerText.length > 0);
  check('banner suggests the Reference key', r.bannerText.includes('Reference'), r.bannerText);

  await browser.close();
  console.log(failures ? 'V3 TESTS FAILED: ' + failures : 'V3 TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
