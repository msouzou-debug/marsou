/* Output workbook (ExcelJS) + gate-5 verification — JS port of
 * recon/build_xlsx.py.  Same tabs, same live formulas, same colour rules:
 * blue font = input, black = formula, green = cross-sheet link, yellow
 * fill = zero-check.  verifyWorkbook() recomputes every zero-check with a
 * small formula evaluator before the file is offered for download. */
'use strict';

const NAVY = 'FF062E5C', BLUE = 'FF0072BC', SKY = 'FF00AEEF', GREEN_LINK = 'FF1F7A1F', GRAY = 'FF595959';
const F_INPUT = { color: { argb: BLUE } };
const F_FORMULA = { color: { argb: 'FF000000' } };
const F_LINK = { color: { argb: GREEN_LINK } };
const F_RED = { color: { argb: 'FFC00000' }, bold: true };
const F_AMBER = { color: { argb: 'FFB45F06' }, bold: true };
const FILL_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
const FILL_SECTION = { type: 'pattern', pattern: 'solid', fgColor: { argb: SKY } };
const FILL_CHECK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const FILL_AMBER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE599' } };
const EUR_FMT = '#,##0.00';

function colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function writeHeader(ws, row, labels) {
  labels.forEach((label, j) => {
    const c = ws.getCell(row, j + 1);
    c.value = label;
    c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    c.fill = FILL_HEADER;
  });
}

function writeAmount(ws, row, col, value, font) {
  const c = ws.getCell(row, col);
  c.value = typeof value === 'string' ? { formula: value } : value;
  c.font = font;
  c.numFmt = EUR_FMT;
  return c;
}

function autosize(ws) {
  ws.columns.forEach((col) => {
    let len = 8;
    col.eachCell({ includeEmpty: false }, (c) => {
      const v = c.value;
      const t = v == null ? '' : (typeof v === 'object' && v.formula ? v.formula : String(v));
      len = Math.max(len, t.length);
    });
    col.width = Math.min(len + 2, 70);
  });
}

/* zero-check cells recorded during build for verifyWorkbook */
function buildWorkbook(result) {
  const wb = new ExcelJS.Workbook();
  const zeroChecks = [];
  const bundle = result.bundle;

  let sraTab = null, statedCell = null, nLines = 0;
  if (!result.crosscheckMode && bundle.sra) {
    const built = tabSra(wb, result, zeroChecks);
    sraTab = built.name;
    nLines = built.nLines;
    statedCell = `'${sraTab}'!F${built.statedRow}`;
    tabReconciliation(wb, result, sraTab, built.nLines, statedCell, zeroChecks);
  } else {
    tabMatrix(wb, result);
  }
  const sections = [{ label: '', result, sraTab, nLines }];
  const ccRows = tabCrosscheck(wb, sections);
  tabAudit(wb, sections, ccRows, zeroChecks);
  const splitTotalRow = tabSplit(wb, result, statedCell, zeroChecks);
  tabByDoctor(wb, result, sraTab, nLines, splitTotalRow);
  tabTruthMap(wb);
  tabLegend(wb);
  return { wb, zeroChecks };
}

/* ------------------------------- multi-provider (mental-health) workbook */

function buildProviderWorkbook(entries) {
  /* Workbook for a NON-hospital month: several ΟΑΥ providers (the mental
   * health units), each with its own cheque, reconciled in one run.
   * entries: [{code, label, result}] in cheque order. */
  const wb = new ExcelJS.Workbook();
  const zeroChecks = [];
  const summary = wb.addWorksheet('Σύνοψη_παρόχων');   // filled last
  const sections = [];
  for (const { code, label, result } of entries) {
    const built = tabSra(wb, result, zeroChecks);
    sections.push({ label: `${label} (${code})`, result, sraTab: built.name,
                    nLines: built.nLines, code, statedRow: built.statedRow });
  }
  const ccRows = tabCrosscheck(wb, sections);
  tabAudit(wb, sections, ccRows, zeroChecks);
  tabProviderByDoctor(wb, sections, zeroChecks);
  tabLegend(wb);
  tabProviderSummary(summary, sections, zeroChecks);
  return { wb, zeroChecks };
}

/* streams a non-hospital provider bills; everything else stays visible in an
 * «adjustments» column rather than being dropped */
const PROVIDER_STREAMS = [['OS', 'Εξωτερικά ιατρεία (OS)'],
                          ['NM', 'Νοσηλευτές/Μαίες (NM)'],
                          ['AP', 'Επαγγελματίες υγείας (AP)']];

function tabProviderSummary(ws, sections, zeroChecks) {
  /* One row per provider: the cheque split by stream as live SUMIFS into that
   * provider's own SRA tab, its claims and activity figures, and the
   * differences — plus a grand total that must equal the sum of the cheques. */
  ws.getCell(1, 1).value = 'Σύνοψη παρόχων ΟΑΥ — μία γραμμή ανά πάροχο '
    + '(one row per provider, live off each SRA tab)';
  ws.getCell(1, 1).font = { bold: true, size: 12, color: { argb: NAVY } };
  const heads = ['Πάροχος (Provider)', 'Κωδικός', 'Επιταγή (Cheque)']
    .concat(PROVIDER_STREAMS.map(([, lbl]) => lbl))
    .concat(['Προσαρμογές (Adjustments)', 'Σύνολο επιταγής (Cheque total)',
             'Claims «all»', 'Διαφορά (Diff)', 'Activity export', 'Διαφορά (Diff)']);
  writeHeader(ws, 3, heads);
  let r = 4;
  const first = r;
  for (const section of sections) {
    const { result, sraTab: tab, nLines: n } = section;
    const b = result.bundle;
    ws.getCell(r, 1).value = section.label.replace(/\s\([^()]*\)$/, '');
    ws.getCell(r, 1).font = F_INPUT;
    ws.getCell(r, 2).value = section.code;
    ws.getCell(r, 2).font = F_INPUT;
    ws.getCell(r, 3).value = b.sra ? b.sra.chequeNo : '';
    ws.getCell(r, 3).font = F_INPUT;
    let col = 4;
    const streamCols = [];
    for (const [code] of PROVIDER_STREAMS) {
      const letter = colLetter(col);
      ws.getCell(2, col).value = code;      // criteria helper cell
      ws.getCell(2, col).font = F_INPUT;
      writeAmount(ws, r, col,
        `SUMIFS('${tab}'!$F$2:$F$${n},'${tab}'!$A$2:$A$${n},${letter}$2)`, F_LINK);
      streamCols.push(letter);
      col += 1;
    }
    const adjCol = col, totalCol = col + 1;
    writeAmount(ws, r, totalCol, `'${tab}'!F${section.statedRow}`, F_LINK);
    writeAmount(ws, r, adjCol,
      `${colLetter(totalCol)}${r}-` + streamCols.map((c) => `${c}${r}`).join('-'),
      F_FORMULA);
    const claimsCol = totalCol + 1, cdiffCol = totalCol + 2;
    const actCol = totalCol + 3, adiffCol = totalCol + 4;
    const streamSum = streamCols.map((c) => `${c}${r}`).join('+');
    if (b.claims) {
      writeAmount(ws, r, claimsCol, claimsTotal(b.claims), F_INPUT);
      writeAmount(ws, r, cdiffCol, `${colLetter(claimsCol)}${r}-(${streamSum})`, F_FORMULA);
    }
    if (b.xmlActivity) {
      // the export may span other cheques — use the cheque-gated figure the
      // cross-check already computed, so this Δ means the same thing
      const gated = (result.crosschecks.find((c) => c.name.includes('XML activity'))
                     || {}).sourceTotal;
      writeAmount(ws, r, actCol, gated != null ? gated : b.xmlActivity.total, F_INPUT);
      writeAmount(ws, r, adiffCol, `${colLetter(actCol)}${r}-(${streamSum})`, F_FORMULA);
    }
    r += 1;
  }
  const totalRow = r;
  ws.getCell(totalRow, 1).value = 'ΣΥΝΟΛΟ (all providers)';
  ws.getCell(totalRow, 1).font = { bold: true };
  for (let c = 4; c < 4 + PROVIDER_STREAMS.length + 6; c++) {
    const letter = colLetter(c);
    writeAmount(ws, totalRow, c, `SUM(${letter}${first}:${letter}${totalRow - 1})`,
                F_FORMULA).font = { bold: true };
  }
  const checkRow = totalRow + 1;
  ws.getCell(checkRow, 1).value =
    'Zero-check = σύνολο ροών + προσαρμογές − επιταγές (must be 0)';
  const streamLetters = PROVIDER_STREAMS.map((_s, i) => colLetter(4 + i));
  const adjLetter = colLetter(4 + PROVIDER_STREAMS.length);
  const totalLetter = colLetter(5 + PROVIDER_STREAMS.length);
  const checkCol = 5 + PROVIDER_STREAMS.length;
  writeAmount(ws, checkRow, checkCol,
    streamLetters.map((c) => `${c}${totalRow}`).join('+')
    + `+${adjLetter}${totalRow}-${totalLetter}${totalRow}`, F_FORMULA)
    .fill = FILL_CHECK;
  zeroChecks.push({ sheet: 'Σύνοψη_παρόχων', addr: `${colLetter(checkCol)}${checkRow}` });
  autosize(ws);
}

function tabProviderByDoctor(wb, sections, zeroChecks) {
  /* The posting sheet for a mental-health month: each unit's cheque split by
   * speciality and by professional, off the paid-claims file's ASSOCIATED
   * DOCTOR / DR SPECIALITY columns.  Every unit block bridges from the
   * per-doctor total to its cheque in live formulas: the claims-vs-SRA
   * difference and the SRA lines outside the service streams are their OWN
   * rows, so nothing is spread across professionals to force a tie. */
  const ws = wb.addWorksheet('Ανά_μονάδα_ιατρό');
  ws.getCell(1, 1).value = 'Κατανομή πληρωμών ανά μονάδα και ιατρό/επαγγελματία '
    + '(by unit and professional)';
  ws.getCell(1, 1).font = { bold: true, size: 12, color: { argb: NAVY } };
  writeHeader(ws, 3, ['Μονάδα (Unit)', 'Ροή (Stream)', 'Ειδικότητα (Speciality)',
                      'Ιατρός / Επαγγελματίας (Professional)', 'Ποσό (Amount €)']);
  let r = 4;
  const unitClaimCells = [];
  const unitChequeCells = [];
  for (const section of sections) {
    const b = section.result.bundle;
    const tab = section.sraTab, n = section.nLines;
    const head = ws.getCell(r, 1);
    head.value = section.label;
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (let col = 1; col <= 5; col++) ws.getCell(r, col).fill = FILL_SECTION;
    const chq = ws.getCell(r, 5);
    chq.value = b.sra ? `Επιταγή #${b.sra.chequeNo}` : '';
    chq.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r += 1;
    const rows = (b.claims && b.claims.byDoctor) ? b.claims.byDoctor : [];
    const subtotalCells = [];
    if (rows.length) {
      const groups = new Map();
      for (const [seg, spec, doc, amt] of rows) {
        const key = `${seg || '—'}\u0001${spec || '—'}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push([doc || '—', amt]);
      }
      const ordered = [...groups.entries()].sort((a, bb) =>
        bb[1].reduce((x, d) => x + d[1], 0) - a[1].reduce((x, d) => x + d[1], 0));
      for (const [key, docs] of ordered) {
        const [seg, spec] = key.split('\u0001');
        const first = r;
        for (const [doc, amt] of docs.slice().sort((a, bb) => bb[1] - a[1])) {
          ws.getCell(r, 2).value = seg; ws.getCell(r, 2).font = F_INPUT;
          ws.getCell(r, 3).value = spec; ws.getCell(r, 3).font = F_INPUT;
          ws.getCell(r, 4).value = doc; ws.getCell(r, 4).font = F_INPUT;
          writeAmount(ws, r, 5, amt, F_INPUT);
          r += 1;
        }
        ws.getCell(r, 3).value = `Υποσύνολο — ${spec}`;
        ws.getCell(r, 3).font = { bold: true };
        writeAmount(ws, r, 5, `SUM(E${first}:E${r - 1})`, F_FORMULA).font = { bold: true };
        subtotalCells.push(`E${r}`);
        r += 1;
      }
    } else {
      ws.getCell(r, 2).value = 'Το αρχείο claims δεν έχει στήλη ιατρού '
        + '(no ASSOCIATED DOCTOR column)';
      ws.getCell(r, 2).font = { italic: true, color: { argb: GRAY } };
      r += 1;
    }
    const claimsRow = r;
    ws.getCell(claimsRow, 1).value = 'Σύνολο ανά ιατρό (claims file)';
    ws.getCell(claimsRow, 1).font = { bold: true };
    if (subtotalCells.length) writeAmount(ws, claimsRow, 5, subtotalCells.join('+'), F_FORMULA);
    else writeAmount(ws, claimsRow, 5, 0, F_INPUT);
    r += 1;
    const codes = PROVIDER_STREAMS.map(([c]) => c);
    const codeCells = codes.map((code, i) => {
      ws.getCell(2, 6 + i).value = code;
      ws.getCell(2, 6 + i).font = F_INPUT;
      return `${colLetter(6 + i)}$2`;
    });
    const svc = codeCells
      .map((c) => `SUMIFS('${tab}'!$F$2:$F$${n},'${tab}'!$A$2:$A$${n},${c})`).join('+');
    const diffRow = r;
    ws.getCell(diffRow, 1).value =
      'Διαφορά claims έναντι γραμμών υπηρεσιών SRA (μη κατανεμημένη)';
    const diffCell = writeAmount(ws, diffRow, 5, `${svc}-E${claimsRow}`, F_FORMULA);
    /* a real gap between the claims file and the cheque's service lines:
     * shown on its own line, never spread across the professionals */
    const claimsSum = b.claims ? claimsTotal(b.claims) : 0;
    const services = b.sra
      ? round2(b.sra.lines.filter((l) => codes.includes(l.code))
        .reduce((a, l) => a + l.amount, 0)) : 0;
    if (Math.abs(services - claimsSum) > CENT) diffCell.font = F_AMBER;
    r += 1;
    const adjRow = r;
    ws.getCell(adjRow, 1).value = 'Λοιπές γραμμές SRA εκτός OS/NM/AP (προσαρμογές)';
    const chequeRef = `'${tab}'!F${section.statedRow}`;
    writeAmount(ws, adjRow, 5, `${chequeRef}-(${svc})`, F_FORMULA);
    r += 1;
    const chequeRow = r;
    ws.getCell(chequeRow, 1).value = 'Επιταγή ΟΑΥ (HIO cheque)';
    ws.getCell(chequeRow, 1).font = { bold: true };
    writeAmount(ws, chequeRow, 5, chequeRef, F_LINK).font =
      { bold: true, color: { argb: GREEN_LINK } };
    r += 1;
    const checkRow = r;
    ws.getCell(checkRow, 1).value = 'Zero-check = κατανομή + γέφυρα − επιταγή (must be 0)';
    writeAmount(ws, checkRow, 5,
      `E${claimsRow}+E${diffRow}+E${adjRow}-E${chequeRow}`, F_FORMULA).fill = FILL_CHECK;
    zeroChecks.push({ sheet: 'Ανά_μονάδα_ιατρό', addr: `E${checkRow}` });
    unitClaimCells.push(`E${claimsRow}`);
    unitChequeCells.push(`E${chequeRow}`);
    r += 2;
  }
  if (unitChequeCells.length) {
    ws.getCell(r, 1).value = 'ΓΕΝΙΚΟ ΣΥΝΟΛΟ — κατανεμημένο ανά ιατρό';
    ws.getCell(r, 1).font = { bold: true };
    writeAmount(ws, r, 5, unitClaimCells.join('+'), F_FORMULA);
    r += 1;
    ws.getCell(r, 1).value = 'ΓΕΝΙΚΟ ΣΥΝΟΛΟ — επιταγές';
    ws.getCell(r, 1).font = { bold: true };
    writeAmount(ws, r, 5, unitChequeCells.join('+'), F_FORMULA);
  }
  autosize(ws);
}

/* ------------------------------------------------------------- tab 1: SRA */

function tabSra(wb, result, zeroChecks) {
  const sra = result.bundle.sra;
  const name = `SRA_${sra.chequeNo}`.slice(0, 31);
  const ws = wb.addWorksheet(name);
  writeHeader(ws, 1, ['Κωδικός (Code)', 'Περιγραφή (Description)', 'Κανάλι (Channel)',
                      'Κατηγορία (Bucket)', 'Πηγή ΟΑΥ (Source report)', 'Ποσό (Amount €)',
                      'Επιταγή (Cheque)']);
  let r = 2;
  for (const line of sra.lines) {
    ws.getCell(r, 1).value = line.code; ws.getCell(r, 1).font = F_INPUT;
    ws.getCell(r, 2).value = line.description; ws.getCell(r, 2).font = F_INPUT;
    ws.getCell(r, 3).value = line.channel; ws.getCell(r, 3).font = F_INPUT;
    ws.getCell(r, 4).value = line.bucket; ws.getCell(r, 4).font = F_INPUT;
    ws.getCell(r, 5).value = line.sourceReport; ws.getCell(r, 5).font = F_INPUT;
    writeAmount(ws, r, 6, line.amount, F_INPUT);
    // the paying cheque, so a check can be restricted to the same cheques a
    // source file covers (SUMIFS second criteria pair)
    ws.getCell(r, 7).value = line.cheque || sra.chequeNo;
    ws.getCell(r, 7).font = F_INPUT;
    r += 1;
  }
  const lastLine = r - 1, totalRow = r;
  ws.getCell(totalRow, 1).value = 'TOTAL (ΣΥΝΟΛΟ)';
  ws.getCell(totalRow, 1).font = { bold: true };
  writeAmount(ws, totalRow, 6, `SUM(F2:F${lastLine})`, { bold: true });
  r += 1;
  // one stated row per cheque; several cheques get a live stated TOTAL
  const parts = (sra.parts && sra.parts.length > 1)
    ? sra.parts : [[sra.chequeNo, sra.linesTotal, sra.statedTotal]];
  const firstPartRow = r;
  for (const [cheque, , stated] of parts) {
    ws.getCell(r, 1).value = `Δηλωμένο σύνολο επιταγής (stated cheque total) #${cheque}`;
    ws.getCell(r, 1).font = F_INPUT;
    writeAmount(ws, r, 6, stated, F_INPUT);
    r += 1;
  }
  let statedRow;
  if (parts.length > 1) {
    statedRow = r;
    ws.getCell(statedRow, 1).value = 'Δηλωμένο σύνολο όλων των επιταγών (all cheques)';
    ws.getCell(statedRow, 1).font = { bold: true };
    writeAmount(ws, statedRow, 6, `SUM(F${firstPartRow}:F${r - 1})`, { bold: true });
    r += 1;
  } else {
    statedRow = firstPartRow;
  }
  const checkRow = r;
  ws.getCell(checkRow, 1).value = 'Check = TOTAL − stated (must be 0)';
  writeAmount(ws, checkRow, 6, `F${totalRow}-F${statedRow}`, F_FORMULA).fill = FILL_CHECK;
  zeroChecks.push({ sheet: name, addr: `F${checkRow}` });
  autosize(ws);
  return { name, statedRow, nLines: lastLine };
}

/* ----------------------------------------------------- tab 2: Reconciliation */

function tabReconciliation(wb, result, sraTab, nLines, statedCell, zeroChecks) {
  const ws = wb.addWorksheet('Reconciliation');
  const b = result.bundle;
  const [gr, en] = HOSPITALS[b.hospitalCode];
  ws.getCell(1, 1).value = `${gr} (${en}) — ${MONTH_NAMES_EL[b.month]} ${b.year} — Επιταγή #${b.sra.chequeNo}`;
  ws.getCell(1, 1).font = { bold: true, color: { argb: NAVY } };
  writeHeader(ws, 3, ['Κατηγορία (Bucket)', 'Bucket key', 'Ποσό (Amount €)']);
  let r = 4;
  for (const bucket of BUCKETS) {
    ws.getCell(r, 1).value = BUCKET_LABELS[bucket]; ws.getCell(r, 1).font = F_INPUT;
    ws.getCell(r, 2).value = bucket; ws.getCell(r, 2).font = F_INPUT;
    // live SUMIFS on the SRA tab's Bucket column, criteria = the label cell
    writeAmount(ws, r, 3,
      `SUMIFS('${sraTab}'!$F$2:$F$${nLines},'${sraTab}'!$D$2:$D$${nLines},$B${r})`, F_FORMULA);
    r += 1;
  }
  const totalRow = r, chequeRow = r + 1, checkRow = r + 2;
  ws.getCell(totalRow, 1).value = 'TOTAL (ΣΥΝΟΛΟ)';
  ws.getCell(totalRow, 1).font = { bold: true };
  writeAmount(ws, totalRow, 3, `SUM(C4:C${r - 1})`, { bold: true });
  ws.getCell(chequeRow, 1).value = 'Επιταγή ΟΑΥ (HIO cheque)';
  writeAmount(ws, chequeRow, 3, statedCell, F_LINK);
  ws.getCell(checkRow, 1).value = 'Zero-check = TOTAL − cheque (must be 0)';
  writeAmount(ws, checkRow, 3, `C${totalRow}-C${chequeRow}`, F_FORMULA).fill = FILL_CHECK;
  zeroChecks.push({ sheet: 'Reconciliation', addr: `C${checkRow}` });
  autosize(ws);
}

/* -------------------------------------- tab 2 (cross-check mode): matrix */

function tabMatrix(wb, result) {
  const ws = wb.addWorksheet('Crosscheck_Matrix');
  const b = result.bundle;
  const [gr, en] = HOSPITALS[b.hospitalCode];
  ws.getCell(1, 1).value = `${gr} (${en}) — ${MONTH_NAMES_EL[b.month]} ${b.year} — Cross-check mode (χωρίς SRA / no SRA)`;
  ws.getCell(1, 1).font = { bold: true, color: { argb: NAVY } };
  const cols = result.matrixColumns;
  writeHeader(ws, 3, ['Ροή (Stream)', ...cols, 'Range (max−min)']);
  let r = 4;
  for (const row of result.matrix) {
    ws.getCell(r, 1).value = row.stream; ws.getCell(r, 1).font = F_INPUT;
    let populated = 0;
    cols.forEach((col, j) => {
      const v = row.values[col];
      if (v != null) { writeAmount(ws, r, j + 2, v, F_INPUT); populated += 1; }
    });
    if (populated > 1) {
      const first = colLetter(2), last = colLetter(cols.length + 1);
      const c = writeAmount(ws, r, cols.length + 2,
        `MAX(${first}${r}:${last}${r})-MIN(${first}${r}:${last}${r})`, F_FORMULA);
      if (row.range != null && Math.abs(row.range) > 0.5) c.font = F_AMBER;
    }
    r += 1;
  }
  autosize(ws);
}

/* ------------------------------------------------ tab 3: Source_crosscheck */

function tabCrosscheck(wb, sections) {
  /* Returns a map «sectionIndex:checkIndex» -> row, so the audit tab can tie
   * each of its blocks back to the exact row printed here. */
  const ws = wb.addWorksheet('Source_crosscheck');
  // column names follow the CHECK NAME order: A = the first thing named,
  // B = the second.  (A is not always "the source report" — on GL rows A is
  // the ΟΑΥ ledger and B the report it is compared with.)
  writeHeader(ws, 1, ['Έλεγχος: Α = Β (Check)', 'Α — ποσό πρώτης πηγής (Amount A €)',
                      'Β — ποσό δεύτερης πηγής / SRA (Amount B €)',
                      'Διαφορά Α−Β (Diff €)', 'Σημείωση (Note)',
                      'Συσκευασίες (Packages)', 'Τιμή μονάδας (Unit €)',
                      'Κωδικοί SRA (codes)']);
  let r = 2;
  const ccRows = new Map();
  sections.forEach((section, si) => {
  const { result, sraTab, nLines } = section;
  const b = result.bundle;
  if (section.label) {
    const sec = ws.getCell(r, 1);
    sec.value = section.label;
    sec.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (let col = 1; col <= 5; col++) ws.getCell(r, col).fill = FILL_SECTION;
    r += 1;
  }
  const firstCheckRow = r;
  // row numbers of the netted pharma/fee pair (they reference each other)
  const feeNetRow = result.crosschecks.findIndex((c) => c.sideKind === 'fee_net');
  const pharmaRowIdx = result.crosschecks.findIndex((c) => c.sideKind === 'ph_minus_fee');
  const feeRow = feeNetRow >= 0 ? firstCheckRow + feeNetRow : null;
  const pharmaRow = pharmaRowIdx >= 0 ? firstCheckRow + pharmaRowIdx : null;
  result.crosschecks.forEach((chk, ci) => {
    ccRows.set(`${si}:${ci}`, r);
    ws.getCell(r, 1).value = chk.name; ws.getCell(r, 1).font = F_INPUT;
    const isPhfee = chk.name.includes('Φαρμακοποιού (packages') || chk.sideKind === 'fee_net';
    if (isPhfee && b.phfee) {
      // packages × unit price (READ from the report — 1.60/1.62 €)
      // as a LIVE formula off two blue inputs
      ws.getCell(r, 6).value = b.phfee.packages; ws.getCell(r, 6).font = F_INPUT;
      writeAmount(ws, r, 7, b.phfee.unitPrice, F_INPUT);
    }
    const row = r;
    let nextHelperCol = 8;
    const sumifs = (codes, cheques = []) => {
      /* SUMIFS terms over the SRA Code column, criteria referencing helper
       * cells (never quoted strings).  With `cheques`, one term per
       * (code, cheque) pair adds a second criteria pair on the Cheque
       * column — that is how a source file covering ONE cheque is compared
       * with that cheque only. */
      let j = 8;
      const codeCells = codes.map((code) => {
        ws.getCell(row, j).value = code;
        ws.getCell(row, j).font = F_INPUT;
        return `${colLetter(j++)}${row}`;
      });
      const chequeCells = cheques.map((q) => {
        ws.getCell(row, j).value = q;
        ws.getCell(row, j).font = F_INPUT;
        return `${colLetter(j++)}${row}`;
      });
      nextHelperCol = j;
      const base = `SUMIFS('${sraTab}'!$F$2:$F$${nLines},'${sraTab}'!$A$2:$A$${nLines},`;
      const terms = [];
      for (const cc of codeCells) {
        if (chequeCells.length) {
          for (const qc of chequeCells) {
            terms.push(`${base}${cc},'${sraTab}'!$G$2:$G$${nLines},${qc})`);
          }
        } else terms.push(`${base}${cc})`);
      }
      return terms;
    };
    if (chk.sideKind === 'fee_net' && sraTab && b.sra) {
      // source = packages × unit (live); side = SRA PH − claims gross
      const [phTerm] = sumifs(['PH']);
      writeAmount(ws, r, 2, `F${r}*G${r}`, F_FORMULA);
      let side = phTerm;
      if (pharmaRow != null) side += `-B${pharmaRow}`;
      writeAmount(ws, r, 3, side, F_LINK);
    } else if (chk.sideKind === 'ph_minus_fee' && sraTab && b.sra) {
      writeAmount(ws, r, 2, chk.sourceTotal, F_INPUT);
      const [phTerm] = sumifs(['PH']);
      let side = phTerm;
      if (feeRow != null) side += `-F${feeRow}*G${feeRow}`;
      writeAmount(ws, r, 3, side, F_LINK);
    } else if (chk.sideKind === 'codes_minus' && sraTab && b.sra) {
      writeAmount(ws, r, 2, chk.sourceTotal, F_INPUT);
      let side = sumifs(chk.sraCodes, chk.cheques || []).join('+');
      if (Math.abs(chk.minus || 0) > 0.005) {
        const j = nextHelperCol;
        ws.getCell(1, j).value = chk.minusLabel;
        ws.getCell(1, j).font = { color: { argb: 'FFFFFFFF' }, bold: true };
        ws.getCell(1, j).fill = FILL_HEADER;
        writeAmount(ws, r, j, chk.minus, F_INPUT);
        side += `-${colLetter(j)}${r}`;
      }
      writeAmount(ws, r, 3, side, F_LINK);
    } else {
      if (isPhfee && b.phfee) writeAmount(ws, r, 2, `F${r}*G${r}`, F_FORMULA);
      else writeAmount(ws, r, 2, chk.sourceTotal, F_INPUT);
      if (sraTab && chk.sraCodes.length && b.sra) {
        // SUMIFS over the SRA Code column, criteria referencing the code
        // helper cells (never quoted strings; scales to hundreds of lines)
        writeAmount(ws, r, 3, sumifs(chk.sraCodes).join('+'), F_LINK);
      } else if (chk.sraSide != null) {
        writeAmount(ws, r, 3, chk.sraSide, F_INPUT);
      }
    }
    if (chk.sraSide != null) {
      const c = writeAmount(ws, r, 4, `B${r}-C${r}`, F_FORMULA);
      if (chk.flag === 'red') c.font = F_RED;
      else if (chk.flag === 'amber') c.font = F_AMBER;
    }
    ws.getCell(r, 5).value = chk.note;
    if (chk.flag === 'amber') ws.getCell(r, 5).fill = FILL_AMBER;
    r += 1;
  });
  });
  autosize(ws);
  return ccRows;
}


/* ------------------------------- tab: Ανάλυση_ελέγχων (audit trail) */

/* The A or B half of a check name («X = Y», «X vs Y», «X ≈ Y») — used as the
 * row label when a side has no itemised components. */
function nameSide(name, first) {
  const bits = String(name).split(/\s+(?:=|≈|vs)\s+/);
  return bits.length > 1 ? (first ? bits[0] : bits[bits.length - 1]).trim() : String(name).trim();
}

function tabAudit(wb, sections, ccRows, zeroChecks) {
  /* Every Source_crosscheck row written out as a full reconciliation: each
   * side broken into its components, live subtotals, the difference, and a
   * tie-back cell proving this sheet agrees with Source_crosscheck.  An
   * auditor reads one block top to bottom and sees exactly which report
   * figure, which SRA lines and which reconciling items make up each side. */
  const ws = wb.addWorksheet('Ανάλυση_ελέγχων');
  ws.getCell(1, 1).value = 'Ανάλυση ελέγχων — κάθε συμφωνία βήμα προς βήμα '
    + '(audit trail: every check, both sides, live)';
  ws.getCell(1, 1).font = { bold: true, color: { argb: NAVY } };
  writeHeader(ws, 3, ['Στοιχείο (Item)', 'Ποσό (Amount €)', 'Πηγή (Source)',
                      'Κωδικός SRA (code)', 'Επιταγή (cheque)']);
  let r = 5;
  let n = 0;
  sections.forEach((section, si) => {
  const { result, sraTab, nLines } = section;
  result.crosschecks.forEach((chk, i) => {
    if (chk.sraSide == null) return;
    const ccRow = ccRows.get(`${si}:${i}`);    // its row on Source_crosscheck
    n += 1;
    const prefix = section.label ? `${section.label} — ` : '';
    const title = ws.getCell(r, 1);
    title.value = `${n}. ${prefix}${chk.name}`;
    title.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (let col = 1; col <= 5; col++) ws.getCell(r, col).fill = FILL_SECTION;
    r += 1;

    const side = (parts, label, fallbackAmount, fallbackLabel, useCodes) => {
      ws.getCell(r, 1).value = label;
      ws.getCell(r, 1).font = { bold: true };
      r += 1;
      const first = r;
      let rows = (parts || []).slice();
      if (!rows.length && useCodes && chk.sraCodes && chk.sraCodes.length && sraTab) {
        rows = chk.sraCodes.map((code) => ({ label: `SRA γραμμές ${code}`, amount: 0,
                                             code, cheques: chk.cheques || [] }));
      }
      if (!rows.length) {
        rows = [{ label: fallbackLabel, amount: fallbackAmount, code: '', cheques: [] }];
      } else if (!(useCodes && rows.some((p) => p.code))) {
        // never let an itemisation silently miss part of its side
        const itemised = round2(rows.reduce((a, p) => a + p.amount, 0));
        const gap = round2(fallbackAmount - itemised);
        if (Math.abs(gap) > CENT) {
          rows = rows.concat([{ label: 'Λοιπά μη αναλυμένα (not itemised)',
                                amount: gap, code: '', cheques: [] }]);
        }
      }
      for (const part of rows) {
        ws.getCell(r, 1).value = '   ' + part.label;
        ws.getCell(r, 1).font = F_INPUT;
        if (part.code && sraTab) {
          ws.getCell(r, 4).value = part.code;
          ws.getCell(r, 4).font = F_INPUT;
          const crit = `'${sraTab}'!$A$2:$A$${nLines},D${r}`;
          if (part.cheques && part.cheques.length) {
            // criteria always reference helper CELLS, never quoted strings
            const terms = part.cheques.map((q, k) => {
              ws.getCell(r, 5 + k).value = q;
              ws.getCell(r, 5 + k).font = F_INPUT;
              return `SUMIFS('${sraTab}'!$F$2:$F$${nLines},${crit},`
                + `'${sraTab}'!$G$2:$G$${nLines},${colLetter(5 + k)}${r})`;
            });
            writeAmount(ws, r, 2, terms.join('+'), F_LINK);
          } else {
            writeAmount(ws, r, 2, `SUMIFS('${sraTab}'!$F$2:$F$${nLines},${crit})`, F_LINK);
          }
          ws.getCell(r, 3).value = sraTab;
          ws.getCell(r, 3).font = F_INPUT;
        } else {
          writeAmount(ws, r, 2, part.amount, F_INPUT);
          ws.getCell(r, 3).value = 'Αναφορά ΟΑΥ';
          ws.getCell(r, 3).font = F_INPUT;
        }
        r += 1;
      }
      const last = r - 1;
      ws.getCell(r, 1).value = `   Σύνολο — ${label}`;
      ws.getCell(r, 1).font = { bold: true };
      writeAmount(ws, r, 2, `SUM(B${first}:B${last})`, F_FORMULA).font = { bold: true };
      const totalRow = r;
      r += 1;
      return totalRow;
    };

    const aTotal = side(chk.partsA, `Α — ${chk.labelA || 'Πηγή (source report)'}`,
                        chk.sourceTotal, nameSide(chk.name, true), false);
    const defaultB = sraTab ? 'SRA' : 'σύγκριση αναφοράς με αναφορά (report vs report)';
    const bTotal = side(chk.partsB, `Β — ${chk.labelB || defaultB}`,
                        chk.sraSide, nameSide(chk.name, false), true);

    ws.getCell(r, 1).value = 'Διαφορά Α − Β (difference)';
    ws.getCell(r, 1).font = { bold: true };
    const diffCell = writeAmount(ws, r, 2, `B${aTotal}-B${bTotal}`, F_FORMULA);
    diffCell.font = { bold: true };
    if (chk.flag === 'red') diffCell.font = F_RED;
    else if (chk.flag === 'amber') diffCell.font = F_AMBER;
    else if (Math.abs(chk.diff || 0) <= CENT) {
      /* a REAL zero: the verifier recomputes it.  A check that is "ok" within
       * a documented tolerance (e.g. IS Auditor per-row rounding) keeps its
       * live difference visible and is NOT claimed to be zero. */
      diffCell.fill = FILL_CHECK;
      zeroChecks.push({ sheet: 'Ανάλυση_ελέγχων', addr: `B${r}` });
    }
    r += 1;
    /* provable consistency with Source_crosscheck: both sides must equal the
     * figures printed there */
    for (const [label, thisRow, ccCol] of [
      ['Έλεγχος: Σύνολο Α = Source_crosscheck (must be 0)', aTotal, 'B'],
      ['Έλεγχος: Σύνολο Β = Source_crosscheck (must be 0)', bTotal, 'C']]) {
      ws.getCell(r, 1).value = label;
      writeAmount(ws, r, 2, `B${thisRow}-'Source_crosscheck'!${ccCol}${ccRow}`,
                  F_FORMULA).fill = FILL_CHECK;
      zeroChecks.push({ sheet: 'Ανάλυση_ελέγχων', addr: `B${r}` });
      r += 1;
    }
    if (chk.note) {
      const note = ws.getCell(r, 1);
      note.value = 'Σημείωση (note): ' + chk.note;
      note.font = { italic: true, color: { argb: GRAY } };
      note.alignment = { wrapText: true, vertical: 'top' };
      r += 1;
    }
    r += 1;
  });
  });
  autosize(ws);
}

/* --------------------------------------------------- tab 4: By_Clinic_Split */

function tabSplit(wb, result, statedCell, zeroChecks) {
  const ws = wb.addWorksheet('By_Clinic_Split');
  const b = result.bundle;
  const [gr] = HOSPITALS[b.hospitalCode];
  ws.getCell(1, 1).value = `Κατανομή ανά κλινική για SAP (By-clinic split) — ${gr} — ${MONTH_NAMES_EL[b.month]} ${b.year}`;
  ws.getCell(1, 1).font = { bold: true, color: { argb: NAVY } };
  writeHeader(ws, 3, ['Κλινική / Γραμμή (Clinic / Line)', 'Fixed Fee €', 'DRG €', 'Ποσό (Amount €)']);
  let r = 4;
  const subtotalCells = [];
  for (const section of result.split) {
    const sec = ws.getCell(r, 1);
    sec.value = section.title;
    sec.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sec.fill = FILL_SECTION;
    r += 1;
    const first = r;
    for (const row of section.rows) {
      ws.getCell(r, 1).value = row.label; ws.getCell(r, 1).font = F_INPUT;
      if (row.fixedFee != null) writeAmount(ws, r, 2, row.fixedFee, F_INPUT);
      if (row.drg != null) writeAmount(ws, r, 3, row.drg, F_INPUT);
      writeAmount(ws, r, 4, row.amount, F_INPUT);
      r += 1;
    }
    ws.getCell(r, 1).value = `Υποσύνολο (Subtotal) — ${section.title}`;
    ws.getCell(r, 1).font = { bold: true };
    if (r > first) writeAmount(ws, r, 4, `SUM(D${first}:D${r - 1})`, { bold: true });
    else writeAmount(ws, r, 4, 0, { bold: true });
    subtotalCells.push(`D${r}`);
    r += 2;
  }
  const totalRow = r;
  ws.getCell(totalRow, 1).value = 'ΓΕΝΙΚΟ ΣΥΝΟΛΟ (GRAND TOTAL)';
  ws.getCell(totalRow, 1).font = { bold: true, color: { argb: NAVY } };
  writeAmount(ws, totalRow, 4, subtotalCells.join('+'), { bold: true });
  if (statedCell) {
    const chequeRow = totalRow + 1, checkRow = totalRow + 2;
    ws.getCell(chequeRow, 1).value = 'Επιταγή ΟΑΥ (HIO cheque)';
    writeAmount(ws, chequeRow, 4, statedCell, F_LINK);
    ws.getCell(checkRow, 1).value = 'Zero-check = ΓΕΝΙΚΟ ΣΥΝΟΛΟ − επιταγή (must be 0)';
    writeAmount(ws, checkRow, 4, `D${totalRow}-D${chequeRow}`, F_FORMULA).fill = FILL_CHECK;
    zeroChecks.push({ sheet: 'By_Clinic_Split', addr: `D${checkRow}` });
  } else {
    ws.getCell(totalRow + 1, 1).value = 'Cross-check mode: χωρίς επιταγή — no cash tie-out (δεν υπάρχει SRA).';
  }
  autosize(ws);
  return totalRow;
}

/* ------------------------------------------ tab 5: by doctor & speciality */

function tabByDoctor(wb, result, sraTab, nLines, splitTotalRow) {
  /* The SRA payment split by clinic/speciality AND doctor, summed from the
   * ROW-LEVEL claims detail (never from ΟΑΥ-printed totals), plus the
   * capitation per-doctor breakdown.  Live SUM subtotals per stream; bottom
   * block re-ties the tab against the source-report column sums. */
  const b = result.bundle;
  const docs = b.claims && b.claims.byDoctor ? b.claims.byDoctor : [];
  const capDocs = b.capitation && b.capitation.byDoctor ? b.capitation.byDoctor : [];
  if (!docs.length && !capDocs.length) return;
  const ws = wb.addWorksheet('Ανά_ιατρό');
  ws.getCell(1, 1).value = 'Ανάλυση πληρωμής ΟΑΥ ανά ειδικότητα/κλινική και ιατρό '
    + '(SRA payment by speciality & doctor) — αθροισμένη από τις αναλυτικές γραμμές των αρχείων ΟΑΥ';
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
  writeHeader(ws, 3, ['Ροή (Stream)', 'Ειδικότητα (Speciality)', 'Ιατρός (Doctor)', 'Ποσό (Amount €)']);
  let r = 4;
  const subtotalCells = [];
  const segments = [];
  for (const [seg] of docs) if (!segments.includes(seg)) segments.push(seg);
  for (const seg of segments) {
    const head = ws.getCell(r, 1);
    head.value = `${seg} — Claims «all»`;
    head.font = { bold: true };
    head.fill = FILL_SECTION;
    r += 1;
    // BY CLINIC FIRST, THEN BY DOCTOR: specialities ordered by size,
    // each with a live subtotal over its doctor rows beneath
    const segRows = docs.filter(([s]) => s === seg).map(([, sp, d, v]) => [sp, d, v]);
    const specTotals = new Map();
    for (const [sp, , v] of segRows) specTotals.set(sp, round2((specTotals.get(sp) || 0) + v));
    const specCells = [];
    const specs = [...specTotals.keys()].sort((a, b) => specTotals.get(b) - specTotals.get(a));
    for (const sp of specs) {
      const drs = segRows.filter(([s2]) => s2 === sp);
      ws.getCell(r, 2).value = sp;
      ws.getCell(r, 2).font = { bold: true };
      writeAmount(ws, r, 4, `SUM(D${r + 1}:D${r + drs.length})`, F_FORMULA);
      specCells.push(`D${r}`);
      r += 1;
      for (const [, d, v] of drs) {
        ws.getCell(r, 3).value = d; ws.getCell(r, 3).font = F_INPUT;
        writeAmount(ws, r, 4, v, F_INPUT);
        r += 1;
      }
    }
    ws.getCell(r, 1).value = `Υποσύνολο ${seg}`;
    ws.getCell(r, 1).font = { bold: true };
    writeAmount(ws, r, 4, specCells.join('+'), F_FORMULA);
    subtotalCells.push(`D${r}`);
    r += 1;
  }
  if (capDocs.length) {
    const head = ws.getCell(r, 1);
    head.value = 'Personal Doctors — Capitation report (κατά κεφαλήν)';
    head.font = { bold: true };
    head.fill = FILL_SECTION;
    r += 1;
    const first = r;
    for (const [label, v] of capDocs) {
      ws.getCell(r, 2).value = 'Capitation'; ws.getCell(r, 2).font = F_INPUT;
      ws.getCell(r, 3).value = label; ws.getCell(r, 3).font = F_INPUT;
      writeAmount(ws, r, 4, v, F_INPUT);
      r += 1;
    }
    ws.getCell(r, 1).value = 'Υποσύνολο Capitation';
    ws.getCell(r, 1).font = { bold: true };
    writeAmount(ws, r, 4, `SUM(D${first}:D${r - 1})`, F_FORMULA);
    subtotalCells.push(`D${r}`);
    r += 1;
  }
  const totalRow = r;
  ws.getCell(totalRow, 1).value = 'ΣΥΝΟΛΟ καρτέλας (tab total)';
  ws.getCell(totalRow, 1).font = { bold: true };
  writeAmount(ws, totalRow, 4, subtotalCells.join('+'), F_FORMULA);
  r += 2;
  // verification block: the tab re-ties against the source-report column
  // sums — a gap here means incomplete row-level detail, shown, never hidden
  const srcRows = [];
  if (b.claims) {
    ws.getCell(r, 1).value = 'Claims «all» — άθροιση στήλης HIO REIMB. (column sum)';
    ws.getCell(r, 1).font = F_INPUT;
    writeAmount(ws, r, 4, claimsTotal(b.claims), F_INPUT);
    srcRows.push(r);
    r += 1;
  }
  if (b.capitation) {
    ws.getCell(r, 1).value = 'Capitation report — άθροιση τιμολογίων EBS (invoice sum)';
    ws.getCell(r, 1).font = F_INPUT;
    writeAmount(ws, r, 4, b.capitation.total, F_INPUT);
    srcRows.push(r);
    r += 1;
  }
  const diffRow = r;
  ws.getCell(diffRow, 1).value = 'Διαφορά καρτέλας − πηγών (πληρότητα αναλυτικών γραμμών / detail completeness)';
  const diffCell = writeAmount(ws, diffRow, 4,
    `D${totalRow}-` + srcRows.map((x) => `D${x}`).join('-'), F_FORMULA);
  const tabTotal = round2(docs.reduce((a, x) => a + x[3], 0)
    + capDocs.reduce((a, [, v]) => a + v, 0));
  const srcTotal = round2((b.claims ? claimsTotal(b.claims) : 0)
    + (b.capitation ? b.capitation.total : 0));
  if (Math.abs(tabTotal - srcTotal) > 0.005) {
    diffCell.font = F_AMBER;
    ws.getCell(diffRow + 1, 1).value = 'Μερική ανάλυση ανά ιατρό στην πηγή (η αναφορά ΟΑΥ δεν '
      + 'αναλύει όλο το ποσό ανά ιατρό) — η διαφορά φαίνεται, δεν κρύβεται.';
    ws.getCell(diffRow + 1, 1).font = F_AMBER;
  }
  r = diffRow + 2;

  // ------- bridge: from the by-doctor universe to By_Clinic_Split / cheque
  // (only when an SRA exists — cross-check mode has no cash side)
  if (sraTab && srcRows.length) {
    const head = ws.getCell(r, 1);
    head.value = 'ΓΕΦΥΡΑ ΠΡΟΣ ΤΟ BY_CLINIC_SPLIT / ΤΗΝ ΕΠΙΤΑΓΗ (bridge: doctors → cheque)';
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = FILL_SECTION;
    r += 1;
    const bridgeRows = [];
    ws.getCell(r, 1).value = 'Αποδιδόμενα σε ιατρούς: Claims «all» + Capitation (οι πηγές της καρτέλας)';
    ws.getCell(r, 1).font = F_FORMULA;
    writeAmount(ws, r, 4, srcRows.map((x) => `D${x}`).join('+'), F_FORMULA);
    bridgeRows.push(r);
    r += 1;
    const sumifsCodes = (row, codes, colRef) => {
      const terms = codes.map((code, k) => {
        const col = colLetter(6 + k);
        ws.getCell(row, 6 + k).value = code;
        ws.getCell(row, 6 + k).font = F_INPUT;
        return `SUMIFS('${sraTab}'!$F$2:$F$${nLines},'${sraTab}'!$${colRef}$2:$${colRef}$${nLines},${col}${row})`;
      });
      return terms.join('+');
    };
    for (const [label, codes, byBucket] of [
      ['+ Φάρμακα — μη αποδιδόμενα σε ιατρούς (SRA bucket Pharma)', ['Pharma'], true],
      ['+ Αιμοκάθαρση (HEMO)', ['HEMO'], false],
      ['+ Προσαρμογές & τακτοποιήσεις (OS-ADJ, IS-ADJ, AE-ADJ, IS-PRIOR)', ['OS-ADJ', 'IS-ADJ', 'AE-ADJ', 'IS-PRIOR'], false],
      ['+ Σταθερές χρεώσεις ΠΙ & Ποιοτικά (PD-FP, KPI, MRI/CT)', ['PD-FP', 'PD-KPI', 'KPI', 'MRI', 'CT', 'MRI/CT'], false],
      ['+ Επιταγές δορυφορικών παροχέων (SAT — π.χ. κέντρα υγείας F1085)', ['SAT'], false],
    ]) {
      ws.getCell(r, 1).value = label;
      ws.getCell(r, 1).font = F_LINK;
      writeAmount(ws, r, 4, sumifsCodes(r, codes, byBucket ? 'D' : 'A'), F_LINK);
      bridgeRows.push(r);
      r += 1;
    }
    const bridgeTotalRow = r;
    ws.getCell(r, 1).value = 'Σύνολο γέφυρας (bridge total)';
    ws.getCell(r, 1).font = { bold: true };
    writeAmount(ws, r, 4, bridgeRows.map((x) => `D${x}`).join('+'), F_FORMULA);
    r += 1;
    const splitRow = r;
    ws.getCell(r, 1).value = 'ΓΕΝΙΚΟ ΣΥΝΟΛΟ By_Clinic_Split (= επιταγή ΟΑΥ)';
    writeAmount(ws, r, 4, `'By_Clinic_Split'!D${splitTotalRow}`, F_LINK);
    r += 1;
    ws.getCell(r, 1).value = 'Διαφορά γέφυρας — γραμμές SRA χωρίς αναλυτικό ανά ιατρό '
      + '(προσαρμογές OS/NM/AP/PD, επιταγές δορυφορικών παροχέων, υπόλοιπο ανάλυσης)';
    writeAmount(ws, r, 4, `D${bridgeTotalRow}-D${splitRow}`, F_FORMULA).font = F_AMBER;
  }
  autosize(ws);
}

/* ---------------------------------------------- tab 6: how the reports tie */

// One universe, many projections: every document in the batch is issued by
// the ΟΑΥ (HIO) about the SAME paid population.  The rows below are the
// identities verified to the cent on real months (Feb/Apr/May 2026); the
// join keys are PAYMENT NO. (the cheque) and the EBS invoice IDs.
const TRUTH_MAP_ROWS = [
  ['Επιταγή (cheque)',
   'Άθροισμα γραμμών SRA = δηλωμένο σύνολο επιταγής',
   'Το SRA είναι η σπονδυλική στήλη του χρήματος — κάθε γραμμή του είναι τιμολόγιο EBS της ΟΑΥ.'],
  ['Ενδονοσοκομειακή (IS)',
   'SRA IS (ημερήσιες) = Claims «all»·Inpatient = Ενδ. Σύνολο = IS Auditor DRG+Z (± στρογγυλοποίηση)',
   'Τετραπλό δέσιμο σε έναν αριθμό. Απαιτήσεις παλαιών περιόδων που πληρώνονται τώρα λείπουν από την Ενδ. — κατονομάζονται.'],
  ['ΤΑΕΠ (AE)',
   'SRA AE (ημερήσιες) = Claims «all»·A&E = GL ΟΑΥ 25801 (51101099 − 43010001 co-pays)',
   'Οι προσαρμογές παραπομπών (AE-ADJ/IS-ADJ) μένουν εκτός των ημερησίων.'],
  ['Εξωνοσοκομειακή (OS/NM/AP)',
   'SRA ημερήσιες = Claims «all» segments = XML activities',
   'Το XML δένει σε επίπεδο πράξης μέσω ClaimPaymentNumber (PAYMENT NO.).'],
  ['Προσωπικοί Ιατροί (PD)',
   'SRA PD (ημερήσιες) = Capitation report + Claims «Personal Doctors»',
   'Επαληθευμένο στο σεντ Απρ+Μάι 2026. Σταθερές χρεώσεις (OOH, εμβολιασμοί) χωριστά ως PD-FP.'],
  ['Ποιοτικά κριτήρια (KPI/MRI)',
   'SRA γραμμές KPI/MRI-CT = εξαγωγή Ποιοτικών Κριτηρίων',
   'Κενή εξαγωγή = εύρημα, όχι μηδενισμός.'],
  ['Φάρμακα (PH)',
   'SRA PH (ημερήσιες) = Πληρωμένες ΦΑΡΜΑΚΑ (Drugs+Consumables) + Αμοιβή Φαρμακοποιού (packages × τιμή μονάδας)',
   'Επαληθευμένο στο σεντ Φεβ+Απρ+Μάι 2026. CRN/OTC/ISSUANCES χωριστά ως PH-ADJ· CRN-Packages ως PHF.'],
  ['Αιμοκάθαρση (HEMO)',
   'SRA HEMO = μηνιαία αναφορά αιμοκάθαρσης',
   'Ενδονοσοκομειακή ή εξωνοσοκομειακή ανά ασθενή — μπλε κελί Bucket.'],
  ['GL ΟΑΥ (καθολικό)',
   '26xxx = SRA IS + HEMO + IS-ADJ · 25801 = AE · 51001001 = capitation · 255xx ≈ φάρμακα · λοιπά 25xxx + capitation = εξωνοσοκομειακά',
   'Η λογιστική όψη της ΟΑΥ για τα ίδια ποσά. Γνωστές ταξινομήσεις: Z-tail σε κλινικούς λογαριασμούς, αμοιβή φαρμακοποιού flat.'],
  ['Προσαρμογές (ADJ/CRN)',
   'PH-ADJ / AE-ADJ / IS-ADJ — το στρώμα διορθώσεων',
   'Δένουν με contra λογαριασμούς GL (π.χ. ISSUANCES ↔ 11202192 Unearned Revenue EOAF).'],
  ['Τακτοποιήσεις (PRIOR)',
   'Μονογραμμικές επιταγές παλαιών περιόδων (year-end DRG, innovative antibiotics)',
   'Pass-through: εκτός όλων των μηνιαίων ελέγχων, δικές τους γραμμές στο By_Clinic_Split.'],
  ['Δορυφορικοί παροχείς',
   'Δικός τους κωδικός F στην κεφαλίδα SRA (π.χ. F1085) και δικός τους GL vendor',
   'Οι επιταγές τους μετρούν στο ταμείο του μήνα αλλά όχι στα αρχεία claims/GL του νοσοκομείου.'],
];

function tabTruthMap(wb) {
  const ws = wb.addWorksheet('Πώς_δένουν');
  ws.getCell(1, 1).value = 'Πώς δένουν οι αναφορές ΟΑΥ μεταξύ τους (how the HIO reports tie together)';
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.getCell(2, 1).value = 'Όλα τα έγγραφα είναι εκδόσεις της ΟΑΥ για τον ίδιο πληρωμένο πληθυσμό — κάθε '
    + 'αναφορά είναι διαφορετική προβολή του. Κλειδιά σύνδεσης: PAYMENT NO. (αρ. επιταγής) και EBS invoice '
    + 'IDs. Οι ταυτότητες επαληθεύτηκαν στο σεντ σε πραγματικούς μήνες (Φεβ/Απρ/Μάι 2026).';
  ws.getCell(2, 1).font = { italic: true, color: { argb: GRAY } };
  writeHeader(ws, 4, ['Ροή (stream)', 'Ταυτότητα (identity)', 'Κλειδί / σημείωση (key / note)']);
  let r = 5;
  for (const [stream, identity, note] of TRUTH_MAP_ROWS) {
    ws.getCell(r, 1).value = stream;
    ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } };
    ws.getCell(r, 2).value = identity;
    ws.getCell(r, 3).value = note;
    ws.getCell(r, 3).font = { color: { argb: GRAY } };
    r += 1;
  }
  autosize(ws);
}

/* ------------------------------------------------------------ tab 6: Legend */

function tabLegend(wb) {
  const ws = wb.addWorksheet('Legend');
  ws.getCell(1, 1).value = 'Υπόμνημα (Legend)';
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
  const rows = [
    ['Μπλε γραμματοσειρά (blue font)', 'Hardcoded input από αναφορά ΟΑΥ (off a source report)', F_INPUT, null],
    ['Μαύρη γραμματοσειρά (black font)', 'Ζωντανός τύπος (live formula)', F_FORMULA, null],
    ['Πράσινη γραμματοσειρά (green font)', 'Σύνδεσμος μεταξύ φύλλων (cross-sheet link)', F_LINK, null],
    ['Κίτρινο γέμισμα (yellow fill)', 'Zero-check — πρέπει να είναι 0 (must read 0)', null, FILL_CHECK],
    ['Πορτοκαλί (amber)', 'Γνωστή απόκλιση με σημείωση (known variance, noted)', F_AMBER, FILL_AMBER],
    ['Κόκκινο (red)', 'Ανεξήγητη διαφορά — εύρημα (unexplained diff, a finding)', F_RED, null],
  ];
  let r = 3;
  for (const [label, meaning, font, fill] of rows) {
    const c = ws.getCell(r, 1);
    c.value = label;
    if (font) c.font = font;
    if (fill) c.fill = fill;
    ws.getCell(r, 2).value = meaning;
    r += 1;
  }
  r += 1;
  const notes = [
    'Ανάλυση_ελέγχων: κάθε έλεγχος του Source_crosscheck γραμμένος αναλυτικά — τα συστατικά κάθε '
      + 'πλευράς, ζωντανά υποσύνολα, η διαφορά, και δύο κελιά που αποδεικνύουν ότι το φύλλο συμφωνεί '
      + 'με το Source_crosscheck (audit trail: every check, both sides, component by component).',
    'Κάθε υποσύνολο/σύνολο/διαφορά είναι ζωντανός τύπος — αλλάζοντας ένα μπλε κελί, το βιβλίο ξανα-δένει ή δείχνει το σπάσιμο.',
    'Never plug a difference: κάθε ανεξήγητη διαφορά εμφανίζεται με τις δύο πλευρές και το άνοιγμα.',
    'Stateless: όλα τρέχουν στον browser — κανένα αρχείο δεν φεύγει από τον υπολογιστή σας.',
  ];
  for (const n of notes) { ws.getCell(r, 1).value = n; r += 1; }
  autosize(ws);
}

/* ==================================================== gate 5: verification */

const TOKEN_RE = /(SUMIFS|SUM|MAX|MIN|ROUND)\(|((?:'[^']+'!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|(\d+(?:\.\d+)?)|([+\-*/(),])/g;

function tokenize(formula) {
  const toks = [];
  for (const m of formula.replace(/^=/, '').matchAll(TOKEN_RE)) {
    toks.push({ func: m[1] || null, ref: m[2] || null, num: m[3] || null, op: m[4] || null });
  }
  return toks;
}

function rangeCells(defaultSheet, ref) {
  let sheet = defaultSheet;
  if (ref.includes('!')) {
    const [sheetPart, rest] = ref.split('!');
    sheet = sheetPart.replace(/^'|'$/g, '');
    ref = rest;
  }
  ref = ref.replace(/\$/g, '');
  const cells = [];
  if (ref.includes(':')) {
    const [a, b] = ref.split(':');
    const pa = a.match(/([A-Z]+)(\d+)/), pb = b.match(/([A-Z]+)(\d+)/);
    const colA = colNumber(pa[1]), colB = colNumber(pb[1]);
    for (let row = +pa[2]; row <= +pb[2]; row++) {
      for (let col = colA; col <= colB; col++) cells.push([sheet, `${colLetter(col)}${row}`]);
    }
  } else cells.push([sheet, ref]);
  return cells;
}

function colNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function cellRaw(wb, sheet, addr) {
  const ws = wb.getWorksheet(sheet);
  const v = ws ? ws.getCell(addr).value : null;
  return v == null ? null : v;
}

function cellNumeric(wb, sheet, addr) {
  const v = cellRaw(wb, sheet, addr);
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v.formula) return evaluateFormula(wb, v.formula, sheet);
  return 0;
}

/* just enough of a formula engine for the formulas THIS app writes */
function evaluateFormula(wb, formula, sheetName) {
  const tokens = tokenize(formula);
  let pos = 0;
  const peek = () => (pos < tokens.length ? tokens[pos] : null);
  const next = () => tokens[pos++];

  function expr() {
    let v = term();
    for (let t = peek(); t && (t.op === '+' || t.op === '-'); t = peek()) {
      const op = next().op;
      const rhs = term();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }
  function term() {
    let v = factor();
    for (let t = peek(); t && (t.op === '*' || t.op === '/'); t = peek()) {
      const op = next().op;
      const rhs = factor();
      v = op === '*' ? v * rhs : v / rhs;
    }
    return v;
  }
  function factor() {
    const t = next();
    if (!t) return 0;
    if (t.num != null) return parseFloat(t.num);
    if (t.op === '-') return -factor();
    if (t.op === '(') { const v = expr(); next(); return v; }
    if (t.ref) {
      const cells = rangeCells(sheetName, t.ref);
      if (cells.length === 1) return cellNumeric(wb, cells[0][0], cells[0][1]);
      return cells.reduce((a, [s, c]) => a + cellNumeric(wb, s, c), 0);
    }
    if (t.func) return call(t.func);
    return 0;
  }
  function args() {
    const out = [];
    let depth = 1, start = pos;
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.op === '(') depth += 1;
      else if (t.op === ')') {
        depth -= 1;
        if (depth === 0) { if (pos > start) out.push(argSlice(start, pos)); pos += 1; return out; }
      } else if (t.op === ',' && depth === 1) { out.push(argSlice(start, pos)); start = pos + 1; }
      pos += 1;
    }
    return out;
  }
  function argSlice(start, end) {
    const toks = tokens.slice(start, end);
    if (toks.length === 1 && toks[0].ref) return { range: toks[0].ref };
    // sub-expression: evaluate with a fresh mini-parser over the slice
    const save = { tokensRef: tokens, posRef: pos };
    const sub = evaluateTokens(wb, toks, sheetName);
    void save;
    return sub;
  }
  function call(name) {
    const a = args();
    const cellsOf = (arg) => rangeCells(sheetName, arg.range);
    const vals = (arg) => (arg && typeof arg === 'object' && arg.range
      ? cellsOf(arg).map(([s, c]) => cellNumeric(wb, s, c)) : [arg]);
    if (name === 'SUM') return a.flatMap(vals).reduce((x, y) => x + y, 0);
    if (name === 'MAX' || name === 'MIN') {
      const pool = [];
      for (const arg of a) {
        if (arg && typeof arg === 'object' && arg.range) {
          for (const [s, c] of cellsOf(arg)) {
            if (cellRaw(wb, s, c) != null) pool.push(cellNumeric(wb, s, c));
          }
        } else pool.push(arg);
      }
      if (!pool.length) return 0;
      return name === 'MAX' ? Math.max(...pool) : Math.min(...pool);
    }
    if (name === 'ROUND') return round2(a[0]);
    if (name === 'SUMIFS') {
      const sumCells = cellsOf(a[0]);
      const critCells = cellsOf(a[1]);
      let critVal = a[2];
      if (critVal && typeof critVal === 'object' && critVal.range) {
        const [s, c] = cellsOf(critVal)[0];
        critVal = cellRaw(wb, s, c);
      }
      let total = 0;
      for (let i = 0; i < sumCells.length; i++) {
        const [cs, cc] = critCells[i];
        if (cellRaw(wb, cs, cc) === critVal) total += cellNumeric(wb, sumCells[i][0], sumCells[i][1]);
      }
      return total;
    }
    throw new Error(`unsupported function ${name}`);
  }
  return expr();
}

function evaluateTokens(wb, toks, sheetName) {
  // helper for sub-expressions inside function arguments
  const pseudo = toks.map((t) => t.func ? t.func + '(' : (t.ref || t.num || t.op)).join('');
  return evaluateFormula(wb, pseudo, sheetName);
}

function verifyWorkbook(wb, zeroChecks, documentedResidual = 0) {
  /* a known SRA parsing difference (lines − stated), documented as a red
   * Source_crosscheck row, is tolerated — never silently absorbed */
  const failures = [];
  for (const { sheet, addr } of zeroChecks) {
    const v = cellRaw(wb, sheet, addr);
    let val;
    if (v && typeof v === 'object' && v.formula) val = evaluateFormula(wb, v.formula, sheet);
    else if (typeof v === 'number') val = v;
    else continue;
    if (Math.abs(val) > CENT && Math.abs(val - documentedResidual) > CENT) {
      failures.push({ sheet, addr, value: round2(val) });
    }
  }
  return failures;
}
