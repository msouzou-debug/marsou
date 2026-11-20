// Builds the UAT plan (Word) in Greek and English.
// Usage: node scripts/manuals/make-uat-plan.js [--out DIR]
// The text is in scripts/manuals/uat/plan-el.json and plan-en.json. Role names come from ehire/i18n/<lang>.json, the
// number of cases from scripts/manuals/uat/cases-common.json, the number of test accounts from ehire/seed_data.json.
// House style as in scripts/make-admin-doc.js.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, ImageRun,
  AlignmentType, HeadingLevel, WidthType, ShadingType, BorderStyle, LevelFormat, PageNumber, TabStopType,
} = require('docx');

const ROOT = path.resolve(__dirname, '..', '..');
const UAT = path.join(__dirname, 'uat');
const LOGO = path.join(ROOT, 'ehire', 'static', 'img', 'okypy_logo_full.png');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : path.join(ROOT, 'docs', 'manuals');

const FONT = 'Lato';
const DEEP = '1B75BB', BLUE = '069FEC', TEXT = '3F4042', GREY = '58595B', LINE = 'DCDFE3', TINT = 'EEF5FB';
const W = 9026; // A4 text width in DXA with 1-inch margins

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function counts() {
  const common = readJson(path.join(UAT, 'cases-common.json')).cases;
  const seed = readJson(path.join(ROOT, 'ehire', 'seed_data.json'));
  return {
    cases: common.length,
    high: common.filter((c) => c.priority === 'High').length,
    areas: new Set(common.map((c) => c.area)).size,
    accounts: seed.users.length,
  };
}

function build(lang) {
  const plan = readJson(path.join(UAT, `plan-${lang}.json`));
  const strings = readJson(path.join(ROOT, 'ehire', 'i18n', `${lang}.json`));
  const seed = readJson(path.join(ROOT, 'ehire', 'seed_data.json'));
  const n = counts();
  const sub = (t) => t.replace(/\{(\w+)\}/g, (m, k) => (k in n ? String(n[k]) : m));

  const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: 21, color: TEXT, ...o });
  const p = (t, o = {}) => new Paragraph({ spacing: { after: 110, line: 290 }, ...o, children: [run(sub(t))] });
  const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, font: FONT })] });
  const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, font: FONT })] });
  const bullet = (t) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 70, line: 280 }, children: [run(sub(t))] });
  const step = (t, ref) => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 80, line: 280 }, children: [run(sub(t))] });

  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const borders = { top: border, bottom: border, left: border, right: border };
  function table(widths, head, rows, height) {
    const cell = (t, i, isHead) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA }, borders,
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      shading: isHead ? { type: ShadingType.CLEAR, fill: TINT, color: 'auto' } : undefined,
      children: [new Paragraph({ spacing: { after: 0, line: 270 }, children: [
        isHead ? run(t, { bold: true, color: DEEP, size: 20 }) : run(t, { size: 20 })] })],
    });
    return new Table({
      width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths,
      rows: [new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, true)) }),
        ...rows.map((r) => new TableRow({
          cantSplit: true, height: height ? { value: height, rule: 'atLeast' } : undefined,
          children: r.map((t, i) => cell(t, i, false)),
        }))],
    });
  }
  const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

  // roles table: the ten approver roles from the app strings, then the extra roles of the plan
  function rolesRows(spec) {
    const holders = {};
    for (const a of seed.role_assignments) (holders[a.role] = holders[a.role] || new Set()).add('test.' + a.user);
    const order = ['requester', 'dir_accountant', 'sci_director', 'dir_hr_officer', 'dir_exec', 'fin_mgmt_head',
      'central_hr_officer', 'medical_director', 'nursing_director', 'ceo', 'viewer', 'admin'];
    const rows = order.map((r) => {
      const label = r === 'viewer' ? spec.viewer : r === 'admin' ? spec.admin : strings['role.' + r];
      return [label, '', Array.from(holders[r] || []).join(', ')];
    });
    for (const x of spec.extra) rows.push([x.label, '', x.accounts]);
    return rows;
  }

  const c = [];
  c.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: plan.title, font: FONT, size: 44, bold: true, color: DEEP })] }));
  c.push(new Paragraph({ spacing: { after: 240 }, children: [run(plan.subtitle, { color: GREY })] }));

  let numRefs = 0;
  const numberedRefs = [];
  for (const b of plan.blocks) {
    if (b.h1) c.push(h1(b.h1));
    else if (b.h2) c.push(h2(b.h2));
    else if (b.p) c.push(p(b.p));
    else if (b.bullets) b.bullets.forEach((t) => c.push(bullet(t)));
    else if (b.numbered) {
      const ref = 'num' + (numRefs++);
      numberedRefs.push(ref);
      b.numbered.forEach((t) => c.push(step(t, ref)));
    } else if (b.table) {
      c.push(table(b.table.widths, b.table.head, b.table.rows, b.table.height));
      c.push(gap());
    } else if (b.roles_table) {
      const s = b.roles_table;
      c.push(table(s.widths, s.cols, rolesRows(s), 420));
      c.push(gap());
    } else if (b.pagebreak) {
      c.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, children: [] }));
    }
  }

  const numLevel = { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 340 } } } };
  return new Document({
    creator: 'eHire build', title: plan.title,
    styles: {
      default: {
        document: { run: { font: FONT, size: 21, color: TEXT } },
        heading1: { run: { font: FONT, size: 28, bold: true, color: DEEP }, paragraph: { spacing: { before: 300, after: 120 }, keepNext: true } },
        heading2: { run: { font: FONT, size: 23, bold: true, color: TEXT }, paragraph: { spacing: { before: 180, after: 90 }, keepNext: true } },
      },
    },
    numbering: { config: [
      { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] },
      ...numberedRefs.map((r) => ({ reference: r, levels: [numLevel] })),
    ] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1750, bottom: 1300, left: 1440, right: 1440, header: 500, footer: 500 } } },
      headers: { default: new Header({ children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 6 } },
        tabStops: [{ type: TabStopType.RIGHT, position: W }],
        children: [new ImageRun({ type: 'png', data: fs.readFileSync(LOGO), transformation: { width: 96, height: 60 } }),
          new TextRun({ text: '\t' + plan.header_right, font: FONT, size: 18, color: GREY })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: W }],
        children: [new TextRun({ text: plan.footer, font: FONT, size: 16, color: GREY }),
          new TextRun({ children: ['\t' + plan.page + ' ', PageNumber.CURRENT, ' ' + plan.of + ' ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GREY })] })] }) },
      children: c,
    }],
  });
}

fs.mkdirSync(OUT, { recursive: true });
(async () => {
  for (const lang of ['el', 'en']) {
    const file = path.join(OUT, `eHire-UAT-plan-${lang}.docx`);
    fs.writeFileSync(file, await Packer.toBuffer(build(lang)));
    console.log('written', file);
  }
})();
