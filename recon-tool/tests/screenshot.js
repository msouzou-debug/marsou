// Design review screenshots. Usage: node screenshot.js [outdir]
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'dist', 'OKYpY_Reconciliation_Tool.html');
const S = f => path.join(ROOT, 'samples', f);
const OUT = process.argv[2] || __dirname;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(APP);
  await page.screenshot({ path: path.join(OUT, 'shot_1_initial.png'), fullPage: true });

  await page.setInputFiles('#fileA', S('split_A.xlsx'));
  await page.setInputFiles('#fileB', S('split_B.xlsx'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.evaluate(() => document.getElementById('advPanel').open = true);
  await page.screenshot({ path: path.join(OUT, 'shot_2_mapping.png'), fullPage: true });

  await page.evaluate(() => {
    document.querySelectorAll('#keysA input').forEach(x => { x.checked = x.value === 'Τιμολόγιο'; x.closest('.keychip').classList.toggle('on', x.checked); });
    document.querySelectorAll('#keysB input').forEach(x => { x.checked = x.value === 'Αναφορά Πληρωμής'; x.closest('.keychip').classList.toggle('on', x.checked); });
    ['A', 'B'].forEach(s => { document.getElementById('amt' + s).value = 'Ποσό'; document.getElementById('date' + s).value = 'Ημερομηνία'; document.getElementById('desc' + s).value = 'Περιγραφή'; });
  });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  await page.evaluate(() => { RESULT.activeTab = 'groups'; renderResults(); });
  await page.waitForTimeout(900); // let the beam settle
  await page.locator('#stepRes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'shot_3_results_groups.png'), fullPage: true });

  await page.evaluate(() => acceptAllGroups(true));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'shot_4_accepted.png'), fullPage: true });

  await browser.close();
  console.log('screenshots written to ' + OUT);
})();
