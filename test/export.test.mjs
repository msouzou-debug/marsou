/* The three exports, produced by the built page from the fixture files and then
   opened the way a recipient would: the HTML with JavaScript switched off on a
   phone-sized screen, the PowerPoint and the Word report by unzipping the
   package and reading the parts Office would read. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { requirePrerequisites, DIST_FILE, fixturePayloads, unzip } from './helpers.mjs';

requirePrerequisites();

const FILES = fixturePayloads();
let browser, page, htmlExport, pptxExport, docxExport;

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
  docxExport = await grab('#btnDocx');
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

  /* the file opens the way the tool does: hospital first, clinics behind the
     «Ανά κλινική» button, and the picker only where it means something */
  const shows = (sel) => p.$eval(sel, e => getComputedStyle(e).display !== 'none');
  assert.equal(await shows('#secStory'), true);
  assert.equal(await shows('#secClinics'), false, 'το σύνολο νοσοκομείου ανοίγει πρώτο');
  assert.equal(await shows('.scopepick'), false, 'ο επιλογέας ανήκει στην προβολή κλινικής');

  await p.click('label[for="exp-scope-clinic"]');
  /* the pressed button has to read as pressed even with the cursor on it —
     .sbtn:hover outranks a bare label[for=…] selector */
  assert.equal(await p.$eval('label[for="exp-scope-clinic"]', e => getComputedStyle(e).fontWeight), '700');
  assert.equal(await shows('#secStory'), false, 'η προβολή κλινικής δείχνει μόνο την κλινική');
  assert.equal(await shows('#secClinics'), true);
  assert.equal(await shows('#secMethod'), true, 'η μεθοδολογία ισχύει και στις δύο προβολές');
  assert.equal(await shows('.scopepick'), true);

  /* every clinic is in the file, and exactly one panel shows at a time */
  const labels = await p.$$eval('.exp-pickbox label.cbtn', els => els.map(e => e.textContent));
  assert.equal(labels.length, 9);
  const visible = () => p.$$eval('.exp-panels .exp-panel',
    els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.querySelector('.clinic-head h3')?.textContent));
  assert.deepEqual(await visible(), ['Παθολογία']);
  /* the closed box names the chosen clinic, the way a <select> does */
  const shown = () => p.$eval('.exp-pickbox > summary', e => e.innerText.trim());
  assert.equal(await shown(), 'Παθολογία');

  /* and picking works with the radio alone — no script involved */
  assert.equal(await p.isVisible('.exp-pickbox label.cbtn'), false, 'η λίστα ξεκινά κλειστή');
  await p.click('.exp-pickbox > summary');
  assert.equal(await p.isVisible('.exp-pickbox label.cbtn'), true);
  await p.click('.exp-pickbox label.cbtn:nth-of-type(4)');
  assert.deepEqual(await visible(), [labels[3]]);
  assert.equal(await shown(), labels[3], 'το κλειστό κουτί δείχνει την επιλεγμένη κλινική');

  /* the summary table keeps the pinned name column and the tick boxes; the
     filter is a CSS rule, so it works here with no script at all */
  const scroller = p.locator('.clinicwrap .scrollx');
  await scroller.evaluate(e => { e.scrollLeft = 300; });
  const [pinned, frame] = await Promise.all([
    p.$eval('table.ok.clinics tbody tr:first-child td.pin', e => Math.round(e.getBoundingClientRect().left)),
    scroller.evaluate(e => Math.round(e.getBoundingClientRect().left)),
  ]);
  assert.equal(pinned, frame, 'το όνομα της κλινικής δεν μένει στη θέση του');

  const shownRows = () => p.$$eval('table.ok.clinics tbody tr',
    rs => rs.filter(row => getComputedStyle(row).display !== 'none').length);
  assert.equal(await shownRows(), 9);
  await p.check('table.ok.clinics tbody tr:nth-child(2) input.focus');
  await p.check('table.ok.clinics tbody tr:nth-child(5) input.focus');
  await p.check('.focus-only');
  assert.equal(await shownRows(), 2, 'το φιλτράρισμα με :has() δεν λειτούργησε');
  await ctx.close();
});

test('η εξαγωγή PowerPoint είναι έγκυρο πακέτο OOXML', () => {
  const parts = unzip(pptxExport.body);
  const names = [...parts.keys()];
  const slides = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));

  /* the parts a presentation cannot open without. presProps/viewProps/
     tableStyles look dispensable and are not: without them PowerPoint does not
     report a damaged slide, it refuses to read the file at all. */
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels', 'ppt/theme/theme1.xml',
    'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml',
    'ppt/presProps.xml', 'ppt/viewProps.xml', 'ppt/tableStyles.xml']) {
    assert.ok(parts.has(required), `λείπει το ${required}`);
  }

  /* Every style list of the theme takes at least three entries. Two in
     a:bgFillStyleLst cost a release: PowerPoint rejected the whole file. */
  const themeXml = parts.get('ppt/theme/theme1.xml').toString('utf8');
  for (const list of ['fillStyleLst', 'lnStyleLst', 'effectStyleLst', 'bgFillStyleLst']) {
    const body = themeXml.match(new RegExp(`<a:${list}>([\\s\\S]*?)</a:${list}>`))?.[1] ?? '';
    const depth = { fillStyleLst: 'solidFill|gradFill|blipFill|pattFill|noFill', lnStyleLst: 'ln',
      effectStyleLst: 'effectStyle', bgFillStyleLst: 'solidFill|gradFill|blipFill|pattFill|noFill' }[list];
    const n = [...body.matchAll(new RegExp(`<a:(?:${depth})[ />]`, 'g'))].length;
    assert.ok(n >= 3, `το a:${list} έχει ${n} στοιχεία, χρειάζεται τουλάχιστον 3`);
  }

  /* a repeated shape id inside one slide is another file PowerPoint will not read */
  for (const slide of slides) {
    const ids = [...parts.get(slide).toString('utf8').matchAll(/<p:cNvPr id="(\d+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${slide}: διπλό id σχήματος`);
  }

  /* and every part the package declares must exist, and every part be typed */
  const typesXml = parts.get('[Content_Types].xml').toString('utf8');
  const defaults = new Set([...typesXml.matchAll(/Extension="([^"]+)"/g)].map(m => m[1].toLowerCase()));
  const declared = new Set([...typesXml.matchAll(/PartName="\/([^"]+)"/g)].map(m => m[1]));
  for (const part of declared) assert.ok(parts.has(part), `το ${part} δηλώνεται αλλά λείπει`);
  for (const name of names) {
    if (declared.has(name) || defaults.has(name.split('.').pop().toLowerCase())) continue;
    assert.fail(`το ${name} δεν έχει content type`);
  }
  /* A ZIP entry left without a timestamp encodes day 0 of month 0, which is
     not a date — enough for a strict reader to give up on the package. */
  assert.notEqual(pptxExport.body.readUInt16LE(12), 0, 'το πρώτο μέρος δεν έχει ημερομηνία');

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

/* ---------- the Word report ---------- */

test('η εξαγωγή Word είναι έγκυρο πακέτο OOXML', () => {
  const parts = unzip(docxExport.body);
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml',
    'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml',
    'word/fontTable.xml', 'word/header1.xml', 'word/footer1.xml',
    'docProps/core.xml', 'docProps/app.xml']) {
    assert.ok(parts.has(required), `λείπει το ${required}`);
  }
  /* every part the package declares is typed, and every relationship resolves */
  const types = parts.get('[Content_Types].xml').toString('utf8');
  for (const p of ['/word/document.xml', '/word/styles.xml', '/word/header1.xml', '/word/footer1.xml']) {
    assert.ok(types.includes(`PartName="${p}"`), `${p} χωρίς content type`);
  }
  for (const [name, body] of parts) {
    if (!name.endsWith('.rels')) continue;
    const base = name.replace(/_rels\/[^/]+$/, '');
    for (const [, target] of body.toString('utf8').matchAll(/Target="([^"]+)"/g)) {
      const full = new URL(target, `file:///${base}`).pathname.replace(/^\//, '');
      assert.ok(parts.has(full), `${name} → ${target} δεν υπάρχει`);
    }
  }
  const doc = parts.get('word/document.xml').toString('utf8');
  const rels = parts.get('word/_rels/document.xml.rels').toString('utf8');
  const have = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map(m => m[1]));
  for (const [, id] of doc.matchAll(/r:(?:id|embed)="([^"]+)"/g)) {
    assert.ok(have.has(id), `το ${id} δεν αντιστοιχεί σε σχέση`);
  }
  /* A4 with 2 cm margins — the tables are laid out against exactly this width */
  assert.match(doc, /<w:pgSz w:w="11906" w:h="16838"\/>/);
  assert.match(doc, /<w:pgMar w:top="1134"/);
});

test('η έκθεση Word λέει τα ίδια νούμερα, ανά ενότητα και ανά κλινική', () => {
  const parts = unzip(docxExport.body);
  const text = parts.get('word/document.xml').toString('utf8')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8364;/g, '€');

  for (const section of ['Η εικόνα της περιόδου', 'Στόχοι έτους', 'Οικονομικά αποτελέσματα',
    'Διασταύρωση με τον ΟΑΥ', 'Σημεία προσοχής', 'Ανά κλινική', 'Μεθοδολογία και προέλευση δεδομένων']) {
    assert.ok(text.includes(section), `λείπει η ενότητα «${section}»`);
  }
  assert.match(text, /ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ/);
  assert.match(text, /Ιανουάριος – Μάρτιος 2026/);
  /* the hospital total and a clinic's revenue, unchanged from the screen */
  assert.match(text, /957\.700 €/);
  assert.match(text, /242\.200 €/);
  /* the submission caveat travels with the report */
  assert.match(text, /παράθυρο τριών μηνών/);
  /* one section per clinic, each starting on its own page */
  const headings = [...parts.get('word/document.xml').toString('utf8')
    .matchAll(/<w:pStyle w:val="Heading1"\/><w:keepNext\/><w:pageBreakBefore\/>/g)];
  /* Heading1 + keepNext + pageBreakBefore, in the schema's order */
  assert.ok(headings.length >= 9, 'κάθε κλινική ξεκινά σε νέα σελίδα');
  for (const clinic of ['Παθολογία', 'Γενική Χειρουργική', 'Ρευματολογικό']) {
    assert.ok(text.includes(clinic), `λείπει η κλινική ${clinic}`);
  }
  /* and the report keeps the type rule of the brief */
  assert.match(parts.get('word/fontTable.xml').toString('utf8'),
    /w:name="Lato"><w:altName w:val="Arial"/);
});
