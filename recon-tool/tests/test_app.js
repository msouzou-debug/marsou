const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'dist', 'OKYpY_Reconciliation_Tool.html');
const S = f => path.join(ROOT, 'samples', f);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
  await page.goto(APP);

  // pick SAP vs HIO preset (4th)
  await page.locator('.preset').nth(3).click();

  await page.setInputFiles('#fileA', S('sample_A_SAP.xlsx'));
  await page.setInputFiles('#fileB', S('sample_B_HIO.xlsx'));
  await page.waitForSelector('#stepMap:not(.hidden)');

  // report auto-guessed mapping
  const map = await page.evaluate(() => ({
    keysA: [...document.querySelectorAll('#keysA input:checked')].map(x => x.value),
    amtA: document.getElementById('amtA').value, dateA: document.getElementById('dateA').value,
    keysB: [...document.querySelectorAll('#keysB input:checked')].map(x => x.value),
    amtB: document.getElementById('amtB').value, dateB: document.getElementById('dateB').value,
  }));
  console.log('AUTO-MAP:', JSON.stringify(map));

  await page.fill('#preparer', 'Marios Souzou');
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');

  const kpis = await page.evaluate(() =>
    [...document.querySelectorAll('.kpi')].map(k => k.querySelector('.l').textContent + '=' + k.querySelector('.v').textContent));
  console.log('KPIS:', JSON.stringify(kpis));

  const counts = await page.evaluate(() => ({
    matched: RESULT.matched.length, diffs: RESULT.diffs.length,
    onlyA: RESULT.onlyA.length, onlyB: RESULT.onlyB.length,
    totA: RESULT.totA.toFixed(3), totB: RESULT.totB.toFixed(3),
    diffKey: RESULT.diffs[0] && RESULT.diffs[0].key,
    diffVal: RESULT.diffs[0] && RESULT.diffs[0].diff.toFixed(2),
    onlyAage: RESULT.onlyA[0] && RESULT.onlyA[0].age,
  }));
  console.log('COUNTS:', JSON.stringify(counts));

  // set a category on the difference row, then export
  await page.selectOption('#pane-diffs .catsel', 'catI');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => exportExcel()),
  ]);
  const outPath = path.join(__dirname, 'export_test.xlsx');
  await download.saveAs(outPath);
  console.log('EXPORTED:', await download.suggestedFilename());

  // quick EN toggle sanity
  await page.click('#btn-en');
  const title = await page.textContent('header h1');
  console.log('EN-TITLE:', title);

  await browser.close();
})();
