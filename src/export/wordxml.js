/* ---------- the OOXML parts of a .docx ----------
   The Word report is described as paragraphs, tables and pictures and turned
   into WordprocessingML here, the same way ooxml.js does it for the deck. No
   document library: the browser writes the package itself, so nothing has to be
   downloaded and nothing leaves the machine.

   Units: a half-point for font sizes (w:sz), a twip for everything on the page
   (1440 per inch), and an EMU for pictures (914400 per inch, so 9525 per CSS
   pixel). A4 with 2 cm margins leaves 9638 twips of text width. */
export const PAGE_W = 9638;

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W_NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ');

export const BRAND = {
  green: '8BC53F', blue: '069FEC', blueDeep: '1B75BB',
  text: '58595B', grey: 'EAEAEA', neg: 'C0392B', white: 'FFFFFF', muted: '8A8B8D',
  good: '5A8A1F', warn: 'B98400',
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  /* control characters are not valid XML and would make the file unopenable */
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/* ---------- runs and paragraphs ---------- */

/* A run is a string or {text, bold, italic, size, color}. w:space="preserve"
   keeps the spaces that separate two runs of a sentence. */
function runXml(r, base = {}) {
  const o = typeof r === 'string' ? { text: r } : (r || {});
  const size = o.size ?? base.size;
  const color = o.color ?? base.color;
  const props = [
    (o.bold ?? base.bold) ? '<w:b/>' : '',
    (o.italic ?? base.italic) ? '<w:i/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    size ? `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>` : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(o.text)}</w:t></w:r>`;
}

export function para(runs, {
  style, align, before, after, size, bold, italic, color, bullet, pageBreak, keepNext, shd,
} = {}) {
  /* the children of w:pPr have a fixed schema order — out of order, Word offers
     to repair the file instead of opening it */
  const props = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    keepNext ? '<w:keepNext/>' : '',
    pageBreak ? '<w:pageBreakBefore/>' : '',
    bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '',
    shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${shd}"/>` : '',
    (before != null || after != null) ? `<w:spacing${before != null ? ` w:before="${before}"` : ''}${after != null ? ` w:after="${after}"` : ''}/>` : '',
    align ? `<w:jc w:val="${align}"/>` : '',
  ].join('');
  const body = (Array.isArray(runs) ? runs : [runs]).filter(r => r != null)
    .map(r => runXml(r, { size, bold, italic, color })).join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${body}</w:p>`;
}

export const heading = (text, level = 1, opts = {}) =>
  para(text, { style: `Heading${level}`, keepNext: true, ...opts });
export const note = (text) => para(text, { style: 'Note' });
export const spacer = (after = 0) => para('', { after });

/* ---------- tables ---------- */

/* A cell is a string or {text, bold, align, color, fill}. The first row is the
   header: deep blue, white, and repeated when the table breaks across pages. */
export function table(rows, { widths, header = true, size = 9 } = {}) {
  const cols = widths || Array.from({ length: rows[0].length }, () => Math.floor(PAGE_W / rows[0].length));
  const cell = (c, w, isHead) => {
    const o = typeof c === 'object' && c !== null ? c : { text: c };
    const fill = o.fill ?? (isHead ? BRAND.blueDeep : null);
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>` +
      (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '') +
      `<w:vAlign w:val="center"/></w:tcPr>` +
      para(o.text, {
        align: o.align, before: 20, after: 20, size,
        bold: o.bold ?? isHead, color: o.color ?? (isHead ? BRAND.white : null),
      }) + '</w:tc>';
  };
  const tr = (cells, i) => {
    const isHead = header && i === 0;
    return `<w:tr>${isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}` +
      cells.map((c, k) => cell(c, cols[k], isHead)).join('') + '</w:tr>';
  };
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${BRAND.grey}"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${cols.reduce((a, b) => a + b, 0)}" w:type="dxa"/>
      <w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>
      <w:tblLayout w:type="fixed"/></w:tblPr>
    <w:tblGrid>${cols.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>
    ${rows.map(tr).join('')}</w:tbl>` +
    /* Word needs a paragraph after a table, or two tables in a row merge */
    spacer(120);
}

/* ---------- pictures ---------- */

const EMU_PER_PX = 9525;
let picId = 100;

export function picture(rId, wPx, hPx, { align = 'center' } = {}) {
  const id = ++picId;
  const cx = Math.round(wPx * EMU_PER_PX), cy = Math.round(hPx * EMU_PER_PX);
  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:docPr id="${id}" name="Εικόνα ${id}"/>
      <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
        </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/* ---------- the package ---------- */

export const document = (body, { headerRid, footerRid }) => XML +
  `<w:document ${W_NS}><w:body>${body}
    <w:sectPr>
      ${headerRid ? `<w:headerReference w:type="default" r:id="${headerRid}"/>` : ''}
      ${footerRid ? `<w:footerReference w:type="default" r:id="${footerRid}"/>` : ''}
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>
      <w:cols w:space="708"/><w:docGrid w:linePitch="360"/>
    </w:sectPr></w:body></w:document>`;

/* The brief's type rule: Lato where it is installed, Arial everywhere else.
   w:altName is how a .docx says that — Word substitutes without asking. */
export const fontTable = XML + `<w:fonts ${W_NS}>
  <w:font w:name="Lato"><w:altName w:val="Arial"/><w:charset w:val="A1"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="Arial"><w:charset w:val="A1"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>
</w:fonts>`;

const style = (id, name, { size, bold, color, before, after, basedOn = 'Normal', outline }) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="${after}"/>${outline != null ? `<w:outlineLvl w:val="${outline}"/>` : ''}</w:pPr>
    <w:rPr>${bold ? '<w:b/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/></w:rPr></w:style>`;

export const styles = XML + `<w:styles ${W_NS}>
  <w:docDefaults><w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Lato" w:hAnsi="Lato" w:cs="Lato"/>
      <w:color w:val="${BRAND.text}"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="el-GR"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  ${style('Title', 'Title', { size: 26, bold: true, color: BRAND.blueDeep, before: 0, after: 120 })}
  ${style('Subtitle', 'Subtitle', { size: 12, color: BRAND.muted, before: 0, after: 240 })}
  ${style('Heading1', 'heading 1', { size: 16, bold: true, color: BRAND.blueDeep, before: 320, after: 140, outline: 0 })}
  ${style('Heading2', 'heading 2', { size: 12.5, bold: true, color: BRAND.blueDeep, before: 240, after: 100, outline: 1 })}
  ${style('Heading3', 'heading 3', { size: 10.5, bold: true, color: BRAND.blue, before: 180, after: 80, outline: 2 })}
  ${style('Note', 'Note', { size: 8.5, color: BRAND.muted, before: 40, after: 140 })}
</w:styles>`;

/* one level of round bullets — enough for the action points and the flags */
export const numbering = XML + `<w:numbering ${W_NS}>
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="360" w:hanging="220"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

export const header = (text) => XML + `<w:hdr ${W_NS}>${para(text, {
  size: 8, color: BRAND.muted, after: 0,
})}</w:hdr>`;

/* «σελίδα N από M» as fields, so the count is right however Word repaginates */
export const footer = (text) => XML + `<w:ftr ${W_NS}><w:p>
    <w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr>
    ${runXml({ text: text + ' · σελίδα ', size: 8, color: BRAND.muted })}
    <w:fldSimple w:instr=" PAGE ">${runXml({ text: '1', size: 8, color: BRAND.muted })}</w:fldSimple>
    ${runXml({ text: ' από ', size: 8, color: BRAND.muted })}
    <w:fldSimple w:instr=" NUMPAGES ">${runXml({ text: '1', size: 8, color: BRAND.muted })}</w:fldSimple>
  </w:p></w:ftr>`;

export const rootRels = XML + `<Relationships ${REL_NS}>
  <Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="${REL}/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

export const documentRels = (images) => XML + `<Relationships ${REL_NS}>
  <Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>
  <Relationship Id="rIdNum" Type="${REL}/numbering" Target="numbering.xml"/>
  <Relationship Id="rIdFonts" Type="${REL}/fontTable" Target="fontTable.xml"/>
  <Relationship Id="rIdHdr" Type="${REL}/header" Target="header1.xml"/>
  <Relationship Id="rIdFtr" Type="${REL}/footer" Target="footer1.xml"/>
  ${images.map(im => `<Relationship Id="${im.rId}" Type="${REL}/image" Target="media/${im.name}"/>`).join('')}
</Relationships>`;

const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
export const contentTypes = (mediaExts) => XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${[...mediaExts].map(e => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('')}
  <Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="${CT}.numbering+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="${CT}.fontTable+xml"/>
  <Override PartName="/word/header1.xml" ContentType="${CT}.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="${CT}.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

export const coreProps = (title) => XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${esc(title)}</dc:title>
  <dc:creator>ΟΚΥπΥ — Πίνακας Δεικτών Νοσοκομείου</dc:creator>
  <cp:lastModifiedBy>ΟΚΥπΥ</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`;

export const appProps = XML + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>ΟΚΥπΥ Πίνακας Δεικτών</Application><Company>Οργανισμός Κρατικών Υπηρεσιών Υγείας</Company>
</Properties>`;
