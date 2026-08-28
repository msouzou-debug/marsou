/* The two exports, produced by the built page from the fixture files and then
   opened the way a recipient would: the HTML with JavaScript switched off on a
   phone-sized screen, the PowerPoint by unzipping the package. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { requirePrerequisites, DIST_FILE, fixturePayloads, unzip } from './helpers.mjs';

requirePrerequisites();

const FILES = fixturePayloads();
let browser, page, htmlExport, pptxExport;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(DIST_FILE).href);
  await page.setInputFiles('#fileInput', FILES);
  await page.waitForFunction(
    n => document.querySelectorAll('#chips .chip').length === n && document.getElementById('method').innerHTML.length > 0,
    FILES.length, { timeout: 120_000 });

  const grab = async (selector) => {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click(selector)]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return { name: download.suggestedFilename(), body: Buffer.concat(chunks) };
  };
  htmlExport = await grab('#btnHtml');
  pptxExport = await grab('#btnPptx');
});
after(async () => { await browser?.close(); });

test('η εξαγωγή HTML είναι αυτόνομη και χωρίς κώδικα', () => {
  const html = htmlExport.body.toString('utf8');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.doesNotMatch(html, /<script/i, 'κανένας κώδικας μέσα στο στιγμιότυπο');
  assert.doesNotMatch(html, /id="drop"|type="file"/, 'η ζώνη μεταφόρτωσης δεν έχει νόημα σε αρχείο');
  /* self-contained: the logos travel with it and nothing is fetched */
  assert.equal((html.match(/src="data:image\/png;base64,/g) || []).length, 2);
  assert.deepEqual([...new Set([...html.matchAll(/https?:\/\/[^"')\s]+/g)].map(m => m[0]))],
    ['https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap']);
  /* and it says where the numbers came from */
  assert.match(html, /Προέλευση δεδομένων/);
  assert.match(html, /Ημερομηνία εξαγωγής/);
});

test('η εξαγωγή HTML ανοίγει σε κινητό, χωρίς JavaScript', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const p = await ctx.newPage();
  const problems = [];
  p.on('pageerror', e => problems.push(e.message));
  await p.setContent(htmlExport.body.toString('utf8'), { waitUntil: 'load' });

  assert.deepEqual(problems, []);
  /* nothing may push the page sideways on a narrow screen */
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);

  /* every clinic is in the file, and exactly one panel shows at a time */
  const labels = await p.$$eval('.exp-clinics label.cbtn', els => els.map(e => e.textContent));
  assert.equal(labels.length, 9);
  const visible = () => p.$$eval('.exp-panels .exp-panel',
    els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.querySelector('.clinic-head h3')?.textContent));
  assert.deepEqual(await visible(), ['Παθολογία']);

  /* the picker works with the radio alone — no script involved */
  await p.click(`.exp-clinics label.cbtn:nth-of-type(4)`);
  assert.deepEqual(await visible(), [labels[3]]);
  await ctx.close();
});

test('η εξαγωγή PowerPoint είναι έγκυρο πακέτο OOXML', () => {
  const parts = unzip(pptxExport.body);
  const names = [...parts.keys()];
  const slides = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));

  /* the parts a presentation cannot open without */
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels', 'ppt/theme/theme1.xml',
    'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml']) {
    assert.ok(parts.has(required), `λείπει το ${required}`);
  }
  /* 14 hospital slides, then one per clinic */
  assert.equal(slides.length, 14 + 9);
  assert.match(parts.get('ppt/presentation.xml').toString('utf8'), /<p:sldSz cx="12192000" cy="6858000"\/>/);

  /* every slide is declared, related and typed */
  const presRels = parts.get('ppt/_rels/presentation.xml.rels').toString('utf8');
  const types = parts.get('[Content_Types].xml').toString('utf8');
  for (let i = 1; i <= slides.length; i++) {
    assert.ok(presRels.includes(`Target="slides/slide${i}.xml"`), `slide${i} χωρίς σχέση`);
    assert.ok(types.includes(`/ppt/slides/slide${i}.xml`), `slide${i} χωρίς content type`);
    assert.ok(parts.has(`ppt/slides/_rels/slide${i}.xml.rels`));
  }

  /* no relationship may point at a part that is not in the package, and no
     shape may reference a relationship that does not exist */
  for (const [name, body] of parts) {
    const text = body.toString('utf8');
    if (name.endsWith('.rels')) {
      const base = name.replace(/_rels\/[^/]+$/, '');
      for (const [, target] of text.matchAll(/Target="([^"]+)"/g)) {
        if (target.startsWith('http')) continue;
        const full = new URL(target, `file:///${base}`).pathname.replace(/^\//, '');
        assert.ok(parts.has(full), `${name} → ${target} δεν υπάρχει`);
      }
    } else if (name.endsWith('.xml')) {
      const used = new Set([...text.matchAll(/r:(?:id|embed)="([^"]+)"/g)].map(m => m[1]));
      if (!used.size) continue;
      const rels = parts.get(name.replace(/([^/]+)$/, '_rels/$1.rels'));
      const have = new Set([...(rels?.toString('utf8') ?? '').matchAll(/Id="([^"]+)"/g)].map(m => m[1]));
      for (const id of used) assert.ok(have.has(id), `${name}: το ${id} δεν αντιστοιχεί σε σχέση`);
    }
  }
});

test('οι διαφάνειες λένε τα ίδια νούμερα με την οθόνη', () => {
  const parts = unzip(pptxExport.body);
  const slideText = (i) => parts.get(`ppt/slides/slide${i}.xml`).toString('utf8')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8364;/g, '€');

  assert.match(slideText(1), /ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ/);
  assert.match(slideText(1), /Ιανουάριος – Μάρτιος 2026/, 'ολόκληρο το όνομα του μήνα, όχι συντομογραφία');
  assert.match(slideText(2), /Σύνοψη περιόδου/);
  assert.match(slideText(2), /595/, 'οι εισαγωγές της περιόδου');

  const all = Array.from({ length: 23 }, (_, i) => slideText(i + 1)).join('\n');
  /* the hospital's own total, straight from the workbook */
  assert.match(all, /957\.700 €/);
  /* the per-clinic revenue, unchanged from the screen */
  assert.match(all, /242\.200 €/);
  /* and the submission caveat travels with the deck */
  assert.match(all, /παράθυρο τριών μηνών/);
  assert.match(all, /εκκρεμείς υποβολές/);

  /* one slide per clinic, titled with the clinic */
  const clinicSlides = Array.from({ length: 9 }, (_, i) => slideText(15 + i));
  assert.match(clinicSlides[0], /Παθολογία/);
  assert.ok(clinicSlides.every(t => /Δραστηριότητα|Έσοδα ΟΑΥ/.test(t)));
});

test('τα γραφήματα ταξιδεύουν ως εικόνες μέσα στο αρχείο', () => {
  const parts = unzip(pptxExport.body);
  const media = [...parts.keys()].filter(n => n.startsWith('ppt/media/'));
  assert.ok(media.length >= 3, 'λογότυπα και γραφήματα');
  for (const m of media) {
    const bytes = parts.get(m);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4E, 0x47], `${m} δεν είναι PNG`);
    assert.ok(bytes.length > 200);
  }
});
