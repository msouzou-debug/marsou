/* ---------- the OOXML parts of a .pptx ----------
   Slides are described declaratively — text boxes, rectangles, lines, tables
   and pictures positioned in points — and turned into DrawingML here. Writing
   the package directly keeps the build free of a presentation library and gives
   the ΟΚΥπΥ layout exactly the geometry the brand asks for.

   Coordinates are in points (a 16:9 slide is 960 × 540 pt); EMU is 12700 per
   point. */
export const SLIDE_W = 960, SLIDE_H = 540;
const EMU = 12700;
const emu = (pt) => Math.round(pt * EMU);

export const BRAND = {
  green: '8BC53F', blue: '069FEC', blueDeep: '1B75BB',
  text: '58595B', grey: 'EAEAEA', neg: 'C0392B', white: 'FFFFFF', muted: '8A8B8D',
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  /* control characters are not valid XML and would make the file unopenable */
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const xfrm = (x, y, w, h) =>
  `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;

/* one paragraph of a text box */
function para(run, { size = 12, bold = false, color = BRAND.text, align = 'l', italic = false } = {}) {
  const runs = (Array.isArray(run) ? run : [{ text: run }]).map(r => {
    const props = `sz="${Math.round((r.size ?? size) * 100)}" b="${(r.bold ?? bold) ? 1 : 0}" i="${(r.italic ?? italic) ? 1 : 0}" dirty="0"`;
    return `<a:r><a:rPr lang="el-GR" ${props}><a:solidFill><a:srgbClr val="${r.color ?? color}"/></a:solidFill>`
      + `<a:latin typeface="Lato"/><a:cs typeface="Lato"/></a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
  }).join('');
  return `<a:p><a:pPr algn="${align}"/>${runs}</a:p>`;
}

let shapeId = 1;
const nextId = () => ++shapeId;

export function textBox({ x, y, w, h, lines, size, bold, color, align, anchor = 't', spacing = 0 }) {
  /* a line is either plain text, or {runs:[…]} with per-run overrides */
  const body = (Array.isArray(lines) ? lines : [lines]).map(l =>
    (l && typeof l === 'object' && 'runs' in l)
      ? para(l.runs, { size, bold, color, align, ...l })
      : para(l, { size, bold, color, align })).join('');
  const id = nextId();
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
    <p:txBody><a:bodyPr wrap="square" anchor="${anchor}" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr>
      <a:lstStyle/>${body || para('')}</p:txBody></p:sp>`;
}

export function rect({ x, y, w, h, fill, line }) {
  const id = nextId();
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="r${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    ${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : '<a:noFill/>'}
    ${line ? `<a:ln w="${emu(line.w || 1)}"><a:solidFill><a:srgbClr val="${line.color}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>'}
    </p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

export function picture({ x, y, w, h, rId }) {
  const id = nextId();
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="p${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
    <p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/* rows: [[cell, …], …]; a cell is a string or {text, bold, align, color, fill} */
export function table({ x, y, w, colWidths, rows, rowHeight = 20, headerFill = BRAND.blueDeep, size = 10 }) {
  const id = nextId();
  const widths = colWidths.map(c => `<a:gridCol w="${emu(c)}"/>`).join('');
  const body = rows.map((row, ri) => {
    const cells = row.map((cell, ci) => {
      const c = typeof cell === 'object' && cell !== null ? cell : { text: cell };
      const isHead = ri === 0;
      const fill = c.fill ?? (isHead ? headerFill : null);
      const color = c.color ?? (isHead ? BRAND.white : BRAND.text);
      const align = c.align ?? (ci === 0 ? 'l' : 'r');
      return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(c.text, {
        size: c.size ?? size, bold: c.bold ?? isHead, color, align,
      })}</a:txBody><a:tcPr marL="45720" marR="45720" marT="22860" marB="22860" anchor="ctr">
        ${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : '<a:noFill/>'}</a:tcPr></a:tc>`;
    }).join('');
    return `<a:tr h="${emu(rowHeight)}">${cells}</a:tr>`;
  }).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="tbl${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(rows.length * rowHeight)}"/></p:xfrm>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
    <a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${widths}</a:tblGrid>${body}</a:tbl>
    </a:graphicData></a:graphic></p:graphicFrame>`;
}

export function slideXml(shapes) {
  /* Shape ids only have to be unique inside one slide, but the builders draw
     from a single counter and the chrome is added later — so the ids are
     renumbered here, at the one place that knows the whole slide. A repeated id
     is a file PowerPoint refuses to read. */
  let n = 1;
  const tree = shapes.join('\n').replace(/<p:cNvPr id="\d+"/g, () => `<p:cNvPr id="${++n}"`);
  shapeId = 1;
  return XML + `<p:sld ${NS_P}><p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${tree}
    </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export const slideRels = (images) => XML + `<Relationships ${REL_NS}>
  <Relationship Id="rIdLayout" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  ${images.map(im => `<Relationship Id="${im.rId}" Type="${REL}/image" Target="../media/${im.name}"/>`).join('')}
</Relationships>`;

/* ---- the fixed parts of the package ---- */

const CLR = (name, val) => `<a:${name}><a:srgbClr val="${val}"/></a:${name}>`;

/* Every one of the four style lists below takes at least THREE entries. With
   two in a:bgFillStyleLst the theme is schema-invalid, and PowerPoint rejects
   the whole package rather than the part: «PowerPoint can't read …». */
export const theme = XML + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="ΟΚΥπΥ">
<a:themeElements>
<a:clrScheme name="ΟΚΥπΥ"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${CLR('dk2', BRAND.text)}${CLR('lt2', BRAND.grey)}
${CLR('accent1', BRAND.blueDeep)}${CLR('accent2', BRAND.blue)}${CLR('accent3', BRAND.green)}
${CLR('accent4', BRAND.muted)}${CLR('accent5', BRAND.neg)}${CLR('accent6', BRAND.blueDeep)}
${CLR('hlink', BRAND.blue)}${CLR('folHlink', BRAND.muted)}</a:clrScheme>
<a:fontScheme name="Lato"><a:majorFont><a:latin typeface="Lato"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Lato"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="ΟΚΥπΥ">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const EMPTY_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
  <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;

export const slideMaster = XML + `<p:sldMaster ${NS_P}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${EMPTY_TREE}</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout1"/></p:sldLayoutIdLst></p:sldMaster>`;

export const slideMasterRels = XML + `<Relationships ${REL_NS}>
  <Relationship Id="rIdLayout1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rIdTheme" Type="${REL}/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

export const slideLayout = XML + `<p:sldLayout ${NS_P} type="blank" preserve="1">
<p:cSld name="Κενή">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

export const slideLayoutRels = XML + `<Relationships ${REL_NS}>
  <Relationship Id="rIdMaster" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

export const presentation = (n) => XML + `<p:presentation ${NS_P} saveSubsetFonts="1">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>
<p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rIdSlide${i + 1}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${emu(SLIDE_W)}" cy="${emu(SLIDE_H)}"/><p:notesSz cx="${emu(SLIDE_H)}" cy="${emu(SLIDE_W)}"/>
</p:presentation>`;

/* A PresentationML package carries exactly one presentation-properties, one
   view-properties and one table-styles part. They hold nothing we care about,
   but a package without them is not a presentation. */
export const presProps = XML + `<p:presentationPr ${NS_P}/>`;
export const viewProps = XML + `<p:viewPr ${NS_P}/>`;
export const tableStyles = XML + `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;

export const presentationRels = (n) => XML + `<Relationships ${REL_NS}>
  <Relationship Id="rIdMaster" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${Array.from({ length: n }, (_, i) => `<Relationship Id="rIdSlide${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}
  <Relationship Id="rIdTheme" Type="${REL}/theme" Target="theme/theme1.xml"/>
  <Relationship Id="rIdPresProps" Type="${REL}/presProps" Target="presProps.xml"/>
  <Relationship Id="rIdViewProps" Type="${REL}/viewProps" Target="viewProps.xml"/>
  <Relationship Id="rIdTableStyles" Type="${REL}/tableStyles" Target="tableStyles.xml"/>
</Relationships>`;

export const rootRels = XML + `<Relationships ${REL_NS}>
  <Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

export const contentTypes = (n, mediaExts) => XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${[...mediaExts].map(e => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>
<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
${Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

export const coreProps = (title) => XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title><dc:creator>ΟΚΥπΥ — Πίνακας Δεικτών Νοσοκομείου</dc:creator>
<cp:lastModifiedBy>ΟΚΥπΥ</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:modified>
</cp:coreProperties>`;

export const appProps = (n) => XML + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>ΟΚΥπΥ — Πίνακας Δεικτών</Application><Slides>${n}</Slides><ScaleCrop>false</ScaleCrop></Properties>`;
