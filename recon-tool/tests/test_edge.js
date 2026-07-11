const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'dist', 'OKYpY_Reconciliation_Tool.html');
const S = f => path.join(ROOT, 'samples', f);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto(APP);
  await page.setInputFiles('#fileA', S('edge_A.xlsx'));
  await page.setInputFiles('#fileB', S('edge_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  const map = await page.evaluate(() => ({
    keysB: [...document.querySelectorAll('#keysB input:checked')].map(x=>x.value),
    amtB: document.getElementById('amtB').value,
    colsB: SIDES.B.cols, row0: SIDES.B.rows[0]
  }));
  console.log('MAP-B:', JSON.stringify(map));
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  const r = await page.evaluate(() => ({
    matched: RESULT.matched.map(x=>[x.key,x.amtA,x.amtB]),
    diffs: RESULT.diffs.map(x=>[x.key,x.amtA,x.amtB,x.diff]),
    onlyB: RESULT.onlyB.map(x=>[x.key,x.amtB]),
  }));
  console.log('RESULT:', JSON.stringify(r));
  await browser.close();
})();
