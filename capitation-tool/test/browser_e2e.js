// Drives dist/capitation_tool.html in Chromium with the real July files.
// CDN scripts are served from local node_modules (same pinned versions).
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'), fs = require('fs');
const NM = process.env.NODE_MODULES;
const LIBS = {
  'pdf.js/3.11.174/pdf.min.js': 'pdfjs-dist/build/pdf.min.js',
  'pdf.js/3.11.174/pdf.worker.min.js': 'pdfjs-dist/build/pdf.worker.min.js',
  'jszip/3.10.1/jszip.min.js': 'jszip/dist/jszip.min.js',
  'exceljs/4.4.0/exceljs.min.js': 'exceljs/dist/exceljs.min.js',
};
const [capZip, raZip, roster, prev, outDir] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    const hit = Object.keys(LIBS).find(k => u.includes('cdnjs.cloudflare.com/ajax/libs/' + k));
    if (hit) return route.fulfill({ path: path.join(NM, LIBS[hit]), contentType: 'application/javascript' });
    if (u.startsWith('file:')) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve(process.env.PAGE || 'dist/capitation_tool.html'));
  await page.screenshot({ path: path.join(outDir, 'shot_example.png'), fullPage: true });
  await page.setInputFiles('#f-cap', capZip);
  await page.setInputFiles('#f-ra', raZip);
  await page.setInputFiles('#f-roster', roster);
  if (prev) await page.setInputFiles('#f-prev', prev);
  const t = Date.now();
  await page.click('#run');
  await page.waitForFunction(() => /Έτοιμο|σφάλ/i.test(document.querySelector('#status').textContent) || document.querySelector('#status').classList.contains('err'), null, { timeout: 300000 });
  console.log('status:', await page.textContent('#status'), (Date.now() - t) / 1000 + 's');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
  const out = path.join(outDir, dl.suggestedFilename()); await dl.saveAs(out); console.log('saved', out);
  await page.screenshot({ path: path.join(outDir, 'shot_result.png'), fullPage: true });
  await page.setViewportSize({ width: 400, height: 900 }); await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(outDir, 'shot_mobile_dark.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('mobile horizontal overflow:', overflow, 'page errors:', errs);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
