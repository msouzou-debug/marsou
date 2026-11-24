// Builds the eHire user and administrator guides (Greek and English) as Word files.
//
// Usage:
//   scripts/manuals/take-screenshots.sh          (once, or after the screens change)
//   node scripts/manuals/make-manuals.js [--shots instance/manual-shots] [--out docs/manuals] [--only user-el,admin-en]
//
// The shots folder (default instance/manual-shots, what take-screenshots.sh writes) holds el/ and en/ with the
// screenshots named in the data files, for example el/u01-login.png. The text lives in the four data files next to this script (user-el.js, user-en.js,
// admin-el.js, admin-en.js), so it can be corrected without touching the layout code.
//
// The table of contents is written as text with page numbers. To get the numbers the script renders each file
// once with LibreOffice (soffice) and pdftotext, reads the page of every heading, and builds the file again.
// Without LibreOffice the contents list is written without page numbers.
//
// Inline markup in the data files: **bold** and `code`. Block types: h1, h2, p, steps, bullets, img, table,
// code, note. See user-en.js for examples.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, ImageRun, Bookmark,
  InternalHyperlink, AlignmentType, HeadingLevel, WidthType, ShadingType, BorderStyle, LevelFormat, PageNumber,
  TabStopType, LeaderType, PageBreak,
} = require('docx');

const ROOT = path.resolve(__dirname, '..', '..');
const ARGS = parseArgs(process.argv.slice(2));
const SHOTS = path.resolve(ARGS.shots || path.join(ROOT, 'instance', 'manual-shots'));
const OUT = path.resolve(ARGS.out || path.join(ROOT, 'docs', 'manuals'));
const ONLY = ARGS.only ? ARGS.only.split(',') : ['user-el', 'user-en', 'admin-el', 'admin-en'];
const OKYPY_LOGO = path.join(ROOT, 'ehire', 'static', 'img', 'okypy_logo_full.png');
const EHIRE_SVG = path.join(ROOT, 'ehire', 'static', 'img', 'ehire_logo.svg');

// House style, as in scripts/make-admin-doc.js and the ΟΚΥπΥ brand.
const FONT = 'Lato', MONO = 'Consolas';
const DEEP = '1B75BB', BLUE = '069FEC', GREEN = '8BC53F', TEXT = '3F4042', GREY = '58595B', LINE = 'DCDFE3', TINT = 'EEF5FB';
const W = 9026; // A4 text width in DXA with 1-inch margins
const MAX_IMG_W = 600; // pixels at 96 dpi, the text width
const MAX_IMG_H = 720;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1], i++;
  }
  return out;
}

// ------------------------------------------------------------------ text helpers

function runs(text, o = {}) {
  // **bold** and `code`; everything else plain.
  const parts = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(new TextRun({ text: text.slice(last, m.index), font: FONT, size: 21, color: TEXT, ...o }));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(new TextRun({ text: tok.slice(2, -2), font: FONT, size: 21, color: TEXT, ...o, bold: true }));
    else parts.push(new TextRun({ text: tok.slice(1, -1), font: MONO, size: 18, color: '1F2328', ...o, bold: false }));
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(new TextRun({ text: text.slice(last), font: FONT, size: 21, color: TEXT, ...o }));
  return parts;
}

const para = (text, o = {}) => new Paragraph({ spacing: { after: 120, line: 290 }, ...o, children: runs(text, o.run || {}) });

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), data: b };
}

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };

function table(t) {
  const widths = t.widths;
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (txt, i, head) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    shading: head ? { type: ShadingType.CLEAR, fill: TINT, color: 'auto' } : undefined,
    children: String(txt).split('\n').map((line) => new Paragraph({
      spacing: { after: 40, line: 270 },
      children: head ? runs(line, { bold: true, color: DEEP, size: 20 }) : runs(line, { size: 20 }),
    })),
  });
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: t.head.map((h, i) => cell(h, i, true)) }),
      ...t.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) }))],
  });
}

function code(lines) {
  return (Array.isArray(lines) ? lines : [lines]).map((l, i, a) => new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: 'F4F5F7', color: 'auto' },
    spacing: { before: i === 0 ? 60 : 0, after: i === a.length - 1 ? 160 : 0, line: 260 },
    indent: { left: 120, right: 120 },
    keepLines: true, keepNext: i < a.length - 1,
    children: [new TextRun({ text: l, font: MONO, size: 15, color: '1F2328' })],
  }));
}

function note(text, label) {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: TINT, color: 'auto' },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: BLUE, space: 8 } },
    indent: { left: 160, right: 120 },
    spacing: { before: 80, after: 160, line: 280 },
    children: [new TextRun({ text: label + ' ', font: FONT, size: 21, bold: true, color: DEEP }), ...runs(text)],
  });
}

// ------------------------------------------------------------------ document

function build(data, lang, shotsDir, pages, ehireLogo) {
  const L = data.meta;
  const children = [];
  const headings = []; // {id, text, level}
  let figure = 0, h1n = 0, h2n = 0, listN = 0;

  // Title page
  const okypy = pngSize(OKYPY_LOGO);
  const ehire = pngSize(ehireLogo);
  children.push(new Paragraph({ spacing: { before: 600, after: 300 }, alignment: AlignmentType.CENTER, children: [
    new ImageRun({ type: 'png', data: okypy.data, transformation: { width: 190, height: Math.round(190 * okypy.h / okypy.w) } })] }));
  children.push(new Paragraph({ spacing: { after: 700 }, alignment: AlignmentType.CENTER, children: [
    new ImageRun({ type: 'png', data: ehire.data, transformation: { width: 230, height: Math.round(230 * ehire.h / ehire.w) } })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [
    new TextRun({ text: L.title, font: FONT, size: 52, bold: true, color: DEEP })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [
    new TextRun({ text: L.subtitle, font: FONT, size: 28, color: GREY, italics: true })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1400 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 12 } }, children: [
      new TextRun({ text: L.audience, font: FONT, size: 22, color: GREY })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [
    new TextRun({ text: L.versionLabel + ' 1.0.0-rc12', font: FONT, size: 22, color: TEXT })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [
    new TextRun({ text: '20/11/2026', font: FONT, size: 22, color: TEXT })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [
    new TextRun({ text: L.org, font: FONT, size: 20, color: GREY })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Contents (filled after headings are known; placeholder index)
  const tocAt = children.length;

  // Body
  for (const b of data.blocks) {
    if (b.h1) {
      h1n++; h2n = 0;
      const id = 'h_' + h1n;
      const text = h1n + '. ' + b.h1;
      headings.push({ id, text, level: 1 });
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: !!b.newPage,
        children: [new Bookmark({ id, children: [new TextRun({ text, font: FONT })] })] }));
    } else if (b.h2) {
      h2n++;
      const id = 'h_' + h1n + '_' + h2n;
      const text = h1n + '.' + h2n + ' ' + b.h2;
      headings.push({ id, text, level: 2 });
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2,
        children: [new Bookmark({ id, children: [new TextRun({ text, font: FONT })] })] }));
    } else if (b.p) {
      children.push(para(b.p, b.keepNext ? { keepNext: true } : {}));
    } else if (b.steps) {
      listN++;
      const ref = 'steps' + listN;
      b.steps.forEach((s) => children.push(new Paragraph({ numbering: { reference: ref, level: 0 },
        spacing: { after: 90, line: 280 }, children: runs(s) })));
      children.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
    } else if (b.bullets) {
      b.bullets.forEach((s) => children.push(new Paragraph({ numbering: { reference: 'bul', level: 0 },
        spacing: { after: 70, line: 280 }, children: runs(s) })));
      children.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
    } else if (b.img) {
      const file = path.join(shotsDir, b.img + '.png');
      const im = pngSize(file);
      let w = Math.min(b.w || MAX_IMG_W, MAX_IMG_W);
      let h = Math.round(w * im.h / im.w);
      if (h > (b.maxH || MAX_IMG_H)) { h = b.maxH || MAX_IMG_H; w = Math.round(h * im.w / im.h); }
      figure++;
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 },
        children: [new ImageRun({ type: 'png', data: im.data, transformation: { width: w, height: h },
          altText: { title: b.caption, description: b.caption, name: b.img } })] }));
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [
        new TextRun({ text: L.figure + ' ' + figure + '. ', font: FONT, size: 18, bold: true, color: GREY }),
        ...runs(b.caption, { size: 18, color: GREY, italics: true })] }));
    } else if (b.table) {
      children.push(table(b.table));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    } else if (b.code) {
      children.push(...code(b.code));
    } else if (b.note) {
      children.push(note(b.note, L.noteLabel));
    } else {
      throw new Error('unknown block ' + JSON.stringify(b).slice(0, 80));
    }
  }

  // Contents
  const toc = [new Paragraph({ spacing: { after: 240 }, children: [
    new TextRun({ text: L.contents, font: FONT, size: 32, bold: true, color: DEEP })] })];
  for (const h of headings) {
    const num = pages && pages[h.id] ? String(pages[h.id]) : '';
    toc.push(new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: W, leader: LeaderType.DOT }],
      indent: { left: h.level === 1 ? 0 : 360 },
      spacing: { before: h.level === 1 ? 120 : 0, after: 50 },
      children: [new InternalHyperlink({ anchor: h.id, children: [
        new TextRun({ text: h.text, font: FONT, size: h.level === 1 ? 21 : 20, bold: h.level === 1, color: TEXT }),
        new TextRun({ text: '\t' + num, font: FONT, size: 20, color: TEXT })] })],
    }));
  }
  toc.push(new Paragraph({ children: [new PageBreak()] }));
  children.splice(tocAt, 0, ...toc);

  const numLevel = { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 440, hanging: 440 } }, run: { font: FONT, bold: true, color: DEEP } } };
  const numbering = [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 400, hanging: 260 } }, run: { color: BLUE } } }] }];
  for (let i = 1; i <= listN; i++) numbering.push({ reference: 'steps' + i, levels: [numLevel] });

  const okypyHeader = new ImageRun({ type: 'png', data: okypy.data, transformation: { width: 80, height: Math.round(80 * okypy.h / okypy.w) } });
  return {
    doc: new Document({
      creator: 'eHire', title: L.title + ' · ' + L.subtitle, description: L.subtitle,
      styles: {
        default: {
          document: { run: { font: FONT, size: 21, color: TEXT } },
          heading1: { run: { font: FONT, size: 30, bold: true, color: DEEP }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true, keepLines: true } },
          heading2: { run: { font: FONT, size: 24, bold: true, color: TEXT }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true, keepLines: true } },
        },
      },
      numbering: { config: numbering },
      sections: [{
        properties: { titlePage: true, page: { size: { width: 11906, height: 16838 }, margin: { top: 1700, bottom: 1300, left: 1440, right: 1440, header: 500, footer: 500 } } },
        headers: {
          first: new Header({ children: [new Paragraph({ children: [] })] }),
          default: new Header({ children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 6 } },
            tabStops: [{ type: TabStopType.RIGHT, position: W }],
            children: [okypyHeader, new TextRun({ text: '\t' + L.headerRight, font: FONT, size: 18, color: GREY })] })] }),
        },
        footers: {
          first: new Footer({ children: [new Paragraph({ children: [] })] }),
          default: new Footer({ children: [new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: W }],
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: GREEN, space: 6 } },
            children: [new TextRun({ text: L.footerLeft + ' · 1.0.0-rc12', font: FONT, size: 16, color: GREY }),
              new TextRun({ children: ['\t' + L.page + ' ', PageNumber.CURRENT, ' ' + L.of + ' ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GREY })] })] }),
        },
        children,
      }],
    }),
    headings,
    contentsTitle: L.contents,
  };
}

// ------------------------------------------------------------------ page numbers for the contents

function soffice() {
  for (const bin of [process.env.EHIRE_SOFFICE_BIN, 'soffice', 'libreoffice']) {
    if (!bin) continue;
    try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return bin; } catch (e) { /* try next */ }
  }
  return null;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

function headingPages(docxFile, headings, contentsTitle) {
  const bin = soffice();
  if (!bin) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ehire-manual-'));
  execFileSync(bin, ['--headless', '-env:UserInstallation=file://' + path.join(tmp, 'profile'), '--convert-to', 'pdf', '--outdir', tmp, docxFile], { stdio: 'ignore' });
  const pdf = path.join(tmp, path.basename(docxFile).replace(/\.docx$/, '.pdf'));
  const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  fs.rmSync(tmp, { recursive: true, force: true });
  const pageTexts = text.split('\f').map(squash);
  let start = 0;
  pageTexts.forEach((t, i) => { if (t.includes(contentsTitle)) start = i + 1; });
  const out = {};
  let from = start;
  for (const h of headings) {
    const probe = squash(h.text).slice(0, 40);
    for (let i = from; i < pageTexts.length; i++) {
      if (pageTexts[i].includes(probe)) { out[h.id] = i + 1; from = i; break; }
    }
  }
  return out;
}

// ------------------------------------------------------------------ main

function rasteriseEhireLogo() {
  const file = path.join(os.tmpdir(), 'ehire-logo-' + process.pid + '.png');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { return null; }
  return (async () => {
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ deviceScaleFactor: 6, viewport: { width: 189, height: 64 } })).newPage();
    await page.setContent('<html><body style="margin:0">' + fs.readFileSync(EHIRE_SVG, 'utf8') + '</body></html>');
    await page.locator('svg').screenshot({ path: file, omitBackground: true });
    await browser.close();
    return file;
  })();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ehireLogo = ARGS['ehire-logo'] || await rasteriseEhireLogo();
  if (!ehireLogo) { console.error('Pass --ehire-logo <png>: playwright is not available to rasterise the SVG.'); process.exit(1); }
  for (const name of ONLY) {
    const lang = name.endsWith('-el') ? 'el' : 'en';
    const data = require('./' + name + '.js');
    const file = path.join(OUT, data.meta.file);
    // Pass 1 with placeholder numbers of the same width, pass 2 with the real ones.
    let built = build(data, lang, path.join(SHOTS, lang), Object.fromEntries(data.blocks.map((_, i) => ['x' + i, 0])), ehireLogo);
    const placeholders = Object.fromEntries(built.headings.map((h) => [h.id, 88]));
    built = build(data, lang, path.join(SHOTS, lang), placeholders, ehireLogo);
    fs.writeFileSync(file, await Packer.toBuffer(built.doc));
    const pages = headingPages(file, built.headings, built.contentsTitle);
    if (pages) {
      const missing = built.headings.filter((h) => !pages[h.id]).map((h) => h.text);
      if (missing.length) console.warn(name + ': no page found for ' + missing.join(' | '));
      built = build(data, lang, path.join(SHOTS, lang), pages, ehireLogo);
      fs.writeFileSync(file, await Packer.toBuffer(built.doc));
    } else {
      console.warn(name + ': LibreOffice not found, the contents list has no page numbers.');
    }
    console.log('written', path.relative(ROOT, file));
  }
})().catch((e) => { console.error(e); process.exit(1); });
