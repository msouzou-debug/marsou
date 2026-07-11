// V2 feature tests: split-match proposals, accept/export, cascading tiers,
// progress save/load, performance. Prints JSON lines; exits 1 on failure.
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

async function newAppPage(browser) {
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGEERROR:', e.message); failures++; });
  await page.goto(APP);
  return page;
}
async function loadPair(page, fa, fb) {
  await page.setInputFiles('#fileA', S(fa));
  await page.setInputFiles('#fileB', S(fb));
  await page.waitForSelector('#stepMap:not(.hidden)');
}
// tick exactly one key column and set the amount/date/desc selects
async function setMapping(page, side, keys, amt, date, desc) {
  await page.evaluate(([side, keys, amt, date, desc]) => {
    document.querySelectorAll('#keys' + side + ' input').forEach(x => {
      x.checked = keys.includes(x.value);
      x.closest('.keychip').classList.toggle('on', x.checked);
    });
    document.getElementById('amt' + side).value = amt;
    document.getElementById('date' + side).value = date || '';
    document.getElementById('desc' + side).value = desc || '';
  }, [side, keys, amt, date, desc]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });

  /* ============ 1. split-match proposals ============ */
  let page = await newAppPage(browser);
  await loadPair(page, 'split_A.xlsx', 'split_B.xlsx');
  await setMapping(page, 'A', ['Τιμολόγιο'], 'Ποσό', 'Ημερομηνία', 'Περιγραφή');
  await setMapping(page, 'B', ['Αναφορά Πληρωμής'], 'Ποσό', 'Ημερομηνία', 'Περιγραφή');
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  let r = await page.evaluate(() => ({
    props: RESULT.props.map(p => [p.side, p.target.key, p.members.map(m => m.key).sort(), +p.diff.toFixed(2)]),
    onlyA: RESULT.onlyA.map(x => x.key), onlyB: RESULT.onlyB.map(x => x.key),
    truncated: RESULT.splitTruncated,
  }));
  console.log('SPLIT:', JSON.stringify(r));
  check('two groups proposed', r.props.length === 2, r.props.length);
  const g500 = r.props.find(p => p[1] === 'INV-500');
  const g250 = r.props.find(p => p[1] === 'INV-250');
  check('exact 1-to-3 group (INV-500)', !!g500 && g500[3] === 0 && JSON.stringify(g500[2]) === JSON.stringify(['PAY-01', 'PAY-02', 'PAY-03']), g500);
  check('within-tolerance group (INV-250, diff 0.01)', !!g250 && g250[3] === 0.01 && JSON.stringify(g250[2]) === JSON.stringify(['PAY-04', 'PAY-05']), g250);
  check('decoy INV-300 not explained', r.onlyA.includes('INV-300'), r.onlyA);
  check('search not truncated', r.truncated === false);

  /* accept all groups -> open counts shrink in the UI */
  await page.evaluate(() => acceptAllGroups(true));
  r = await page.evaluate(() => ({
    openA: [...document.querySelectorAll('#pane-onlyA tbody tr')].length,
    kpiGroups: [...document.querySelectorAll('.kpi')].map(k => k.querySelector('.l').textContent + '=' + k.querySelector('.v').textContent).pop(),
  }));
  console.log('ACCEPTED:', JSON.stringify(r));
  check('onlyA shows 1 open row after accepting', r.openA === 1, r.openA);

  /* categorise the remaining open item (via its tab), then export + verify workbook */
  await page.locator('.tab').nth(2).click(); // onlyA tab
  await page.selectOption('#pane-onlyA .catsel', 'catI');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => exportExcel()),
  ]);
  const xlsxPath = path.join(__dirname, 'export_v2.xlsx');
  await download.saveAs(xlsxPath);
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer', cellFormula: true });
  console.log('SHEETS:', JSON.stringify(wb.SheetNames));
  const el = n => wb.Sheets[n];
  check('groups sheet exists', wb.SheetNames.includes('Ομάδες'));
  const wsG = el('Ομάδες');
  check('group diff is live block formula', wsG && wsG.G2 && /^SUM\(E2:E5\)-SUM\(F2:F5\)$/.test(wsG.G2.f || ''), wsG && wsG.G2 && wsG.G2.f);
  const wsS = el('Σύνοψη');
  check('summary counts groups via COUNTA', wsS && /COUNTA\('Ομάδες'!A2:A100000\)/.test(wsS.B8 && wsS.B8.f || ''), wsS.B8 && wsS.B8.f);
  check('summary self-check includes groups', wsS && /ROUND\(B12-\(C5\+C6\+C7\+C8\),2\)/.test(wsS.B14 && wsS.B14.f || ''), wsS.B14 && wsS.B14.f);
  check('summary totals include groups sheet', /Ομάδες/.test(wsS.B10 && wsS.B10.f || ''), wsS.B10 && wsS.B10.f);
  check('summary self-check evaluates to 0', wsS.B14 && wsS.B14.v === 0, wsS.B14 && wsS.B14.v);
  const wsOA = el('Μόνο στο A');
  check('detail diff is live N(E)-N(F) formula', wsOA && wsOA.G2 && /^N\(E2\)-N\(F2\)$/.test(wsOA.G2.f || ''), wsOA.G2 && wsOA.G2.f);
  check('only-A sheet excludes grouped items (1 data row)', wsOA && XLSX.utils.sheet_to_json(wsOA).length === 1);
  check('category exported on open item', JSON.stringify(XLSX.utils.sheet_to_json(wsOA)).includes('Προς διερεύνηση'));

  /* ============ 2. progress save / load round-trip ============ */
  const [progDl] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => saveProgress()),
  ]);
  const progPath = path.join(__dirname, 'progress_v2.json');
  await progDl.saveAs(progPath);
  const prog = JSON.parse(fs.readFileSync(progPath, 'utf8'));
  console.log('PROGRESS-KEYS:', JSON.stringify(Object.keys(prog)));
  check('progress JSON valid', prog.app === 'okypy-recon' && prog.version === 2);
  check('progress stores accepted groups', Object.values(prog.groups).filter(Boolean).length === 2, prog.groups);
  check('progress stores category', prog.cats.onlyA['INV-300'] === 'catI', prog.cats.onlyA);
  await page.close();

  // fresh page: load progress BEFORE running -> applies after run
  page = await newAppPage(browser);
  await loadPair(page, 'split_A.xlsx', 'split_B.xlsx');
  await setMapping(page, 'A', ['Τιμολόγιο'], 'Ποσό', 'Ημερομηνία', 'Περιγραφή');
  await setMapping(page, 'B', ['Αναφορά Πληρωμής'], 'Ποσό', 'Ημερομηνία', 'Περιγραφή');
  await page.setInputFiles('#progFile', progPath);
  await page.waitForFunction(() => document.getElementById('progStatus').textContent !== '');
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    accepted: RESULT.props.filter(p => p.accepted).length,
    cat: (RESULT.onlyA.find(x => x.key === 'INV-300') || {}).cat,
  }));
  console.log('RESTORED:', JSON.stringify(r));
  check('accepted groups restored from progress', r.accepted === 2, r.accepted);
  check('category restored from progress', r.cat === 'catI', r.cat);
  await page.close();

  /* ============ 3. cascading tiers ============ */
  page = await newAppPage(browser);
  await loadPair(page, 'tier_A.csv', 'tier_B.csv');
  await setMapping(page, 'A', ['Ref'], 'Amount', 'Date', 'Description');
  await setMapping(page, 'B', ['Ref'], 'Amount', 'Date', 'Description');
  await page.evaluate(() => {
    document.getElementById('tier2on').checked = true;
    document.getElementById('tier2days').value = 7;
    document.getElementById('tier3on').checked = true;
    document.getElementById('spliton').checked = false;
  });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    matched: RESULT.matched.map(x => [x.key, x.rule, +(x.diff).toFixed(2)]),
    onlyA: RESULT.onlyA.map(x => x.key), onlyB: RESULT.onlyB.map(x => x.key),
  }));
  console.log('TIERS:', JSON.stringify(r));
  check('rule-2 match (amount+date)', r.matched.some(m => m[0] === 'REF-A1 ⇄ ZZZ-9' && m[1] === 2), r.matched);
  check('rule-3 match (fuzzy text)', r.matched.some(m => m[0] === 'REF-A2 ⇄ YYY-8' && m[1] === 3), r.matched);
  check('unexplained stays open', r.onlyA.includes('REF-A3') && r.onlyB.includes('XXX-7'));
  await page.close();

  /* ============ 4. performance: >=2000 open items under ~5s (or graceful truncation) ============ */
  page = await newAppPage(browser);
  await loadPair(page, 'perf_A.csv', 'perf_B.csv');
  await setMapping(page, 'A', ['Key'], 'Amount', 'Date', 'Description');
  await setMapping(page, 'B', ['Key'], 'Amount', 'Date', 'Description');
  const t0 = Date.now();
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  const elapsed = Date.now() - t0;
  r = await page.evaluate(() => ({
    open: RESULT.onlyA.length + RESULT.onlyB.length,
    props: RESULT.props.length, truncated: RESULT.splitTruncated,
  }));
  console.log('PERF:', JSON.stringify({ ...r, ms: elapsed }));
  check('>=2000 open items', r.open >= 2000 - r.props * 5, r.open);
  check('finishes <5s or degrades gracefully', elapsed < 5000 || r.truncated === true, { ms: elapsed, truncated: r.truncated });
  check('UI responsive after perf run', await page.evaluate(() => document.querySelectorAll('.kpi').length > 0));
  await page.close();

  await browser.close();
  console.log(failures ? 'V2 TESTS FAILED: ' + failures : 'V2 TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
