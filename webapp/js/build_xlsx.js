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
  tabCrosscheck(wb, result, sraTab, nLines);
  tabSplit(wb, result, statedCell, zeroChecks);
  tabByDoctor(wb, result);
  tabTruthMap(wb);
  tabLegend(wb);
  return { wb, zeroChecks };
}

/* ------------------------------------------------------------- tab 1: SRA */

function tabSra(wb, result, zeroChecks) {
  const sra = result.bundle.sra;
  const name = `SRA_${sra.chequeNo}`.slice(0, 31);
  const ws = wb.addWorksheet(name);
  writeHeader(ws, 1, ['Κωδικός (Code)', 'Περιγραφή (Description)', 'Κανάλι (Channel)',
                      'Κατηγορία (Bucket)', 'Πηγή ΟΑΥ (Source report)', 'Ποσό (Amount €)']);
  let r = 2;
  for (const line of sra.lines) {
    ws.getCell(r, 1).value = line.code; ws.getCell(r, 1).font = F_INPUT;
    ws.getCell(r, 2).value = line.description; ws.getCell(r, 2).font = F_INPUT;
    ws.getCell(r, 3).value = line.channel; ws.getCell(r, 3).font = F_INPUT;
    ws.getCell(r, 4).value = line.bucket; ws.getCell(r, 4).font = F_INPUT;
    ws.getCell(r, 5).value = line.sourceReport; ws.getCell(r, 5).font = F_INPUT;
    writeAmount(ws, r, 6, line.amount, F_INPUT);
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

function tabCrosscheck(wb, result, sraTab, nLines) {
  const ws = wb.addWorksheet('Source_crosscheck');
  writeHeader(ws, 1, ['Έλεγχος (Check)', 'Σύνολο πηγής (Source total €)',
                      'Πλευρά SRA (SRA side €)', 'Διαφορά (Diff €)', 'Σημείωση (Note)',
                      'Συσκευασίες (Packages)', 'Τιμή μονάδας (Unit €)',
                      'Κωδικοί SRA (codes)']);
  let r = 2;
  const b = result.bundle;
  // row numbers of the netted pharma/fee pair (they reference each other)
  const feeNetRow = result.crosschecks.findIndex((c) => c.sideKind === 'fee_net');
  const pharmaRowIdx = result.crosschecks.findIndex((c) => c.sideKind === 'ph_minus_fee');
  const feeRow = feeNetRow >= 0 ? 2 + feeNetRow : null;
  const pharmaRow = pharmaRowIdx >= 0 ? 2 + pharmaRowIdx : null;
  for (const chk of result.crosschecks) {
    ws.getCell(r, 1).value = chk.name; ws.getCell(r, 1).font = F_INPUT;
    const isPhfee = chk.name.includes('Φαρμακοποιού (packages') || chk.sideKind === 'fee_net';
    if (isPhfee && b.phfee) {
      // packages × unit price (READ from the report — 1.60/1.62 €)
      // as a LIVE formula off two blue inputs
      ws.getCell(r, 6).value = b.phfee.packages; ws.getCell(r, 6).font = F_INPUT;
      writeAmount(ws, r, 7, b.phfee.unitPrice, F_INPUT);
    }
    const row = r;
    const sumifs = (codes) => codes.map((code, k) => {
      const col = colLetter(8 + k);
      ws.getCell(row, 8 + k).value = code;
      ws.getCell(row, 8 + k).font = F_INPUT;
      return `SUMIFS('${sraTab}'!$F$2:$F$${nLines},'${sraTab}'!$A$2:$A$${nLines},${col}${row})`;
    });
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
  }
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
}

/* ------------------------------------------ tab 5: by doctor & speciality */

function tabByDoctor(wb, result) {
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
