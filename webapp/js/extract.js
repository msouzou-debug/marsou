/* Format-agnostic normalizers — JS port of recon/extract.py.
 * Extraction rules follow the brief exactly; see CLAUDE.md. */
'use strict';

class ExtractionError extends Error {}

/* ------------------------------------------------------------- helpers */

function tableAt(rows, headerRow) {
  const cols = rows[headerRow].map((v, j) =>
    (v != null && cellText(v) !== 'nan' ? cellText(v).trim() : `_c${j}`));
  return { cols, body: rows.slice(headerRow + 1) };
}

function colIndex(cols, ...needles) {
  // normLabel comparison: 'HIO_REIMB' matches the 'HIO REIMB' needle
  for (const needle of needles) {
    const w = normLabel(needle);
    for (let j = 0; j < cols.length; j++) {
      if (normLabel(cols[j]).includes(w)) return j;
    }
  }
  return null;
}

/* ------------------------------------------------- inpatient summary */

function classifyCategory(label) {
  /* label is accent-stripped + Greek Ζ->Z.  null = unknown category, kept in
   * .other so the Σύνολο assert still holds when ΟΑΥ adds new lines. */
  if (label.includes('ΣΥΝΟΛ')) return 'synolo';
  const parap = label.includes('ΠΑΡΑΠΕΜΠΤΙΚ');
  if (label.includes('ΚΑΝΟΝΙΚ')) return parap ? 'kanonikaParap' : 'kanonika';
  if (label.includes('ΕΞΕΙΔΙΚ')) return parap ? 'exeidParap' : 'exeidikevmena';
  if (label.includes('ΓΕΝΝ')) return 'gennes';   // Γέννες (births)
  if (label.includes('ΚΑΤΑΛΟΓ') || /(?:^|[\s-])Z(?:$|[\s-])/.test(label)) return 'zCatalogue';
  return null;
}

function summaryDerived(s) {
  const otherSum = Object.values(s.other).reduce((a, b) => a + b, 0);
  s.regular = round2(s.kanonika + s.kanonikaParap);
  s.specialized = round2(s.exeidikevmena + s.exeidParap);
  s.computedTotal = round2(s.kanonika + s.kanonikaParap + s.exeidikevmena
    + s.exeidParap + s.gennes + s.zCatalogue + otherSum);
  return s;
}

function extractInpatientSummary(bytes) {
  const sheets = loadSheets(bytes);
  for (const { rows } of sheets) {
    const anchor = findHeaderRow(rows, ['ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ'], 60);
    if (anchor === null) continue;
    let amountCol = null;
    for (let i = anchor; i < Math.min(anchor + 6, rows.length); i++) {
      for (let j = 0; j < rows[i].length; j++) {
        if (rows[i][j] != null && stripAccents(cellText(rows[i][j])).includes('ΣΥΝΟΛΙΚΗ ΑΜΟΙΒΗ')) {
          amountCol = j; break;
        }
      }
      if (amountCol !== null) break;
    }
    const out = { kanonika: 0, kanonikaParap: 0, exeidikevmena: 0, exeidParap: 0,
                  gennes: 0, zCatalogue: 0, other: {}, synolo: 0, byClinic: [] };
    for (let i = anchor + 1; i < Math.min(anchor + 30, rows.length); i++) {
      const row = rows[i];
      let label = '', rawLabel = '';
      for (const v of row) {
        if (v != null && cellText(v) !== 'nan' && !isNumberLike(v)) {
          rawLabel = cellText(v).trim();
          // Greek capital zeta looks like Latin Z — accept either alphabet
          label = stripAccents(rawLabel).split('Ζ').join('Z');
          break;
        }
      }
      if (!label) continue;
      let val;
      if (amountCol !== null && isNumberLike(row[amountCol])) val = parseAmount(row[amountCol]);
      else {
        const nums = row.filter(isNumberLike).map(parseAmount);
        if (!nums.length) continue;   // header row of the block, no amounts
        val = nums[nums.length - 1];
      }
      const cls = classifyCategory(label);
      if (cls === 'synolo') { out.synolo = val; break; }
      if (cls) out[cls] = round2(out[cls] + val);
      else out.other[rawLabel] = round2((out.other[rawLabel] || 0) + val);
    }
    summaryDerived(out);
    if (Math.abs(out.synolo - out.computedTotal) > 0.005) {
      throw new ExtractionError('Ενδ. summary: το Σύνολο δεν ισούται με το άθροισμα των γραμμών '
        + `(Σύνολο ${formatEur(out.synolo)} vs άθροισμα ${formatEur(out.computedTotal)})`);
    }
    out.byClinic = perClinicDetailSheet(sheets);
    return out;
  }
  throw new ExtractionError('Δεν βρέθηκε ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ στο αρχείο Ενδ. summary');
}

function perClinicDetailSheet(sheets) {
  /* Real Ενδ. workbooks carry a «per clinic» pivot: Row Labels | Sum of
   * FIXED FEE | Sum of INPATIENTS | Sum of Grand Total. */
  for (const { rows } of sheets) {
    const hr = findHeaderRow(rows, ['ROW LABELS', 'FIXED FEE', 'GRAND TOTAL']);
    if (hr === null) continue;
    const hdr = rows[hr].map((v) => (v == null ? '' : normLabel(cellText(v))));
    const first = (needle) => {
      for (let j = 0; j < hdr.length; j++) if (hdr[j].includes(needle)) return j;
      return null;
    };
    const lab = first('ROW LABELS');
    const ff = first('FIXED FEE'), ip = first('INPATIENTS'), gt = first('GRAND TOTAL');
    const out = [];
    for (let i = hr + 1; i < rows.length; i++) {
      const v = rows[i][lab];
      if (v == null || cellText(v) === 'nan') continue;
      const clinic = cellText(v).trim();
      const nl = normLabel(clinic);
      if (nl.includes('GRAND TOTAL') || nl.includes('ΣΥΝΟΛ')) continue;
      const ffv = ff != null ? parseAmount(rows[i][ff]) : 0;
      const ipv = ip != null ? parseAmount(rows[i][ip]) : 0;
      const gtv = gt != null ? parseAmount(rows[i][gt]) : 0;
      const total = gtv || round2(ffv + ipv);
      if (!total && !ffv && !ipv) continue;
      out.push({ clinic, fixedFee: round2(ffv), drg: round2(ipv), total: round2(total) });
    }
    out.sort((a, b) => b.total - a.total);
    return out;
  }
  return [];
}

/* ------------------------------------------------------- claims «all» */

const SEGMENT_ALIASES = {
  'INPATIENT': 'Inpatient',
  'IS': 'Inpatient',
  'IP': 'Inpatient',
  'INPATIENT SERVICES': 'Inpatient',
  'OUTPATIENT SPECIALISTS': 'Outpatient Specialists',
  'OUTPATIENT SPECIALIST': 'Outpatient Specialists',
  'OS': 'Outpatient Specialists',
  'A&E': 'A&E',
  'AE': 'A&E',
  'ACCIDENT & EMERGENCY': 'A&E',
  'ACCIDENT AND EMERGENCY': 'A&E',
  'NURSES-MIDWIVES': 'Nurses-Midwives',
  'NURSES MIDWIVES': 'Nurses-Midwives',
  'NURSES/MIDWIVES': 'Nurses-Midwives',
  'NM': 'Nurses-Midwives',
  'ALLIED HEALTH': 'Allied Health',
  'ALLIED HEALTH PROFESSIONALS': 'Allied Health',
  'AP': 'Allied Health',
  'AHP': 'Allied Health',
};

function canonSegment(raw) {
  const up = normLabel(cellText(raw));
  if (up in SEGMENT_ALIASES) return SEGMENT_ALIASES[up];
  // keyword fallback for longer / Greek variants
  if (up.includes('INPATIENT') || up.includes('ΕΝΔΟΝΟΣΟΚ')) return 'Inpatient';
  if (up.includes('SPECIALIST') || up.includes('ΕΙΔΙΚΟΙ')) return 'Outpatient Specialists';
  if (up.includes('EMERGENCY') || up.includes('ΕΠΕΙΓ') || up.includes('ΑΤΥΧΗΜ') || up.includes('ΤΑΕΠ')) return 'A&E';
  if (up.includes('NURSE') || up.includes('MIDWI') || up.includes('ΝΟΣΗΛΕΥΤ')) return 'Nurses-Midwives';
  if (up.includes('ALLIED') || up.includes('ΑΛΛΟΙ ΕΠΑΓΓΕΛΜ')) return 'Allied Health';
  return cellText(raw).trim();
}

function claimsTotal(c) {
  return round2(Object.values(c.bySegment).reduce((a, b) => a + b, 0));
}

function extractClaimsAll(bytes) {
  if (sniffFormat(bytes) === 'xml') return extractClaimsXml(bytes);
  for (const { rows } of loadSheets(bytes)) {
    const hr = findHeaderRow(rows, ['DR SEGMENT']);
    if (hr === null) continue;
    const { cols, body } = tableAt(rows, hr);
    const segCol = colIndex(cols, 'DR SEGMENT');
    const amtCol = colIndex(cols, 'HIO REIMB');
    if (segCol === null || amtCol === null) {
      throw new ExtractionError('Claims «all»: λείπει στήλη DR SEGMENT ή HIO REIMB');
    }
    const t = body.filter((r) => r[segCol] != null);
    const out = { bySegment: {}, inpatientByClinic: [], osBySpecialty: {}, inpatientRows: [] };
    const idCol = colIndex(cols, 'CLAIM ID');
    const dateCol = colIndex(cols, 'INVOICE DATE');
    for (const r of t) {
      const seg = canonSegment(r[segCol]);
      out.bySegment[seg] = (out.bySegment[seg] || 0) + parseAmount(r[amtCol]);
      if (seg === 'Inpatient' && idCol != null) {
        // kept to name candidate old-period claims when claims ≠ Ενδ.
        out.inpatientRows.push([cellText(r[idCol]),
                                dateCol != null ? cellText(r[dateCol]) : '',
                                round2(parseAmount(r[amtCol]))]);
      }
    }
    for (const k of Object.keys(out.bySegment)) out.bySegment[k] = round2(out.bySegment[k]);
    perClinicDetail(t, cols, segCol, amtCol, out);
    return out;
  }
  throw new ExtractionError('Claims «all»: δεν βρέθηκε στήλη DR SEGMENT');
}

function perClinicDetail(t, cols, segCol, amtCol, out) {
  const clinicCol = colIndex(cols, 'CLINIC', 'DEPARTMENT', 'ΚΛΙΝΙΚΗ');
  const specCol = colIndex(cols, 'SPECIALTY', 'SPECIALITY', 'ΕΙΔΙΚΟΤΗΤΑ');
  const ffCol = colIndex(cols, 'FIXED FEE', 'FF AMOUNT');
  let drgCol = colIndex(cols, 'DRG AMOUNT', 'DRG REIMB');
  if (drgCol === ffCol) drgCol = null;

  const groupCol = clinicCol != null ? clinicCol : specCol;
  if (groupCol != null) {
    const groups = new Map();
    for (const r of t) {
      if (canonSegment(r[segCol]) !== 'Inpatient') continue;
      const clinic = r[groupCol] != null ? cellText(r[groupCol]) : '—';
      if (!groups.has(clinic)) groups.set(clinic, { clinic, fixedFee: 0, drg: 0, total: 0 });
      const g = groups.get(clinic);
      g.total += parseAmount(r[amtCol]);
      if (ffCol != null) g.fixedFee += parseAmount(r[ffCol]);
      if (drgCol != null) g.drg += parseAmount(r[drgCol]);
    }
    out.inpatientByClinic = [...groups.values()].map((g) => ({
      clinic: g.clinic, fixedFee: round2(g.fixedFee), drg: round2(g.drg), total: round2(g.total),
    })).sort((a, b) => b.total - a.total);
  }
  if (specCol != null) {
    for (const r of t) {
      if (canonSegment(r[segCol]) !== 'Outpatient Specialists') continue;
      const spec = r[specCol] != null ? cellText(r[specCol]) : '—';
      out.osBySpecialty[spec] = round2((out.osBySpecialty[spec] || 0) + parseAmount(r[amtCol]));
    }
  }
}

function extractClaimsXml(bytes) {
  const doc = parseXml(bytes);
  const sums = {};
  for (const el of doc.getElementsByTagName('*')) {
    const tag = el.localName.toLowerCase();
    if (!['claim', 'record', 'row'].includes(tag)) continue;
    let seg = null, amt = null;
    for (const child of el.getElementsByTagName('*')) {
      const ctag = child.localName.toLowerCase();
      if (ctag === 'drsegment' || ctag === 'segment') seg = canonSegment(child.textContent || '');
      else if (ctag.includes('reimb')) amt = parseAmount(child.textContent);
    }
    if (seg && amt != null) sums[seg] = (sums[seg] || 0) + amt;
  }
  if (!Object.keys(sums).length) {
    throw new ExtractionError('Claims XML: δεν βρέθηκαν εγγραφές με segment/amount');
  }
  const out = { bySegment: {}, inpatientByClinic: [], osBySpecialty: {} };
  for (const [k, v] of Object.entries(sums)) out.bySegment[k] = round2(v);
  return out;
}

/* ------------------------------------------------------ pharma claims */

function extractPharmaClaims(bytes) {
  for (const { rows } of loadSheets(bytes)) {
    const hr = findHeaderRow(rows, ['TYPE']);
    if (hr === null) continue;
    const { cols, body } = tableAt(rows, hr);
    const typeCol = colIndex(cols, 'TYPE');
    const amtCol = colIndex(cols, 'HIO REIMB');
    if (typeCol === null || amtCol === null) continue;
    const byType = {};
    for (const r of body) {
      if (r[typeCol] == null) continue;
      const typ = cellText(r[typeCol]).trim();
      byType[typ] = (byType[typ] || 0) + parseAmount(r[amtCol]);
    }
    for (const k of Object.keys(byType)) byType[k] = round2(byType[k]);
    const ups = new Set(Object.keys(byType).map((k) => k.toUpperCase()));
    if (!ups.has('DRUGS') && !ups.has('CONSUMABLES')) continue;
    return { byType, total: round2(Object.values(byType).reduce((a, b) => a + b, 0)) };
  }
  throw new ExtractionError('Pharma claims: δεν βρέθηκε στήλη TYPE με Drugs/Consumables');
}

/* ----------------------------------------------- pharmacist fee (PDF) */

function parsePharmacistFeeText(text) {
  /* The unit price is READ from the document (1.60 € historically, 1.62 € in
   * newer months): find (unit, packages, amount) where packages × unit = amount. */
  let best = null;
  for (const line of String(text).split('\n')) {
    const amounts = findAmounts(line);
    if (amounts.length < 2) continue;
    const ints = [];
    for (const m of line.matchAll(/\b\d{1,3}(?:[.,]\d{3})+\b|\b\d+\b/g)) {
      const p = parseAmount(m[0]);
      if (p === Math.trunc(p)) ints.push(Math.trunc(p));
    }
    let invoice = '';
    const im = line.match(/\b(?=\w*\d)([A-Z]{0,4}\d[\w\-/]{3,})\b/);
    if (im && !/^[\d.,]+$/.test(im[1])) invoice = im[1];
    for (const pkg of [...new Set(ints)].sort((a, b) => b - a)) {
      if (pkg <= 1) continue;
      for (const unit of amounts) {
        if (unit < 0.05 || unit > 20) continue;    // plausible per-package fee
        const expected = round2(pkg * unit);
        for (const amt of amounts) {
          if (amt === unit) continue;
          if (Math.abs(amt - expected) < 0.005) {
            const cand = { packages: pkg, unitPrice: unit, amount: amt,
                           invoiceId: invoice, computed: expected };
            if (!best || cand.packages > best.packages) best = cand;
          }
        }
      }
    }
  }
  if (best) return best;
  let total = null;
  for (const line of String(text).split('\n')) {
    if (stripAccents(line).includes('ΣΥΝΟΛ')) {
      const amts = findAmounts(line);
      if (amts.length) total = amts[amts.length - 1];
    }
  }
  if (total != null) {
    const pkg = Math.round(total / PHARMACIST_FEE_UNIT_PRICE);
    if (Math.abs(pkg * PHARMACIST_FEE_UNIT_PRICE - total) < 0.005) {
      return { packages: pkg, unitPrice: PHARMACIST_FEE_UNIT_PRICE, amount: total,
               invoiceId: '', computed: round2(pkg * PHARMACIST_FEE_UNIT_PRICE) };
    }
  }
  throw new ExtractionError('Αμοιβή Φαρμακοποιού: δεν βρέθηκε γραμμή συσκευασίες × 1,60 € = ποσό');
}

/* --------------------------------------------------------- SRA (text) */

/* SRA code -> [bucket, channel, supporting HIO report].  Keyword fallback
 * below covers SRAs without explicit codes.  Same table as the Python app. */
const SRA_CODE_MAP = {
  IS: ['Inpatient', 'Claims', 'Ενδ. Πληρωμένες Απαιτήσεις'],
  AE: ['A&E', 'Claims', 'Πληρωμένες Απαιτήσεις «all»'],
  'A&E': ['A&E', 'Claims', 'Πληρωμένες Απαιτήσεις «all»'],
  OS: ['Outpatient', 'Claims', 'Πληρωμένες Απαιτήσεις «all»'],
  NM: ['Outpatient', 'Claims', 'Πληρωμένες Απαιτήσεις «all»'],
  AP: ['Outpatient', 'Claims', 'Πληρωμένες Απαιτήσεις «all»'],
  PD: ['Outpatient', 'Claims', 'Πληρωμένες Απαιτήσεις «all»'],
  'PD-CAP': ['Outpatient', 'Capitation', 'Capitation Report'],
  'PD-KPI': ['Outpatient', 'KPI', 'Ποιοτικά Κριτήρια'],
  KPI: ['Outpatient', 'KPI', 'Ποιοτικά Κριτήρια'],
  MRI: ['Outpatient', 'KPI', 'Ποιοτικά Κριτήρια'],
  CT: ['Outpatient', 'KPI', 'Ποιοτικά Κριτήρια'],
  'MRI/CT': ['Outpatient', 'KPI', 'Ποιοτικά Κριτήρια'],
  HEMO: ['Inpatient', 'Adjustment', 'Hemodialysis report'],
  PHD: ['Pharma', 'Claims', 'Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ'],
  PHC: ['Pharma', 'Claims', 'Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ'],
  PHF: ['Pharma', 'Fee', 'Pharmacist Fee Report'],
  // real SRAs pay pharmacy claims as daily «PH - HCP SERVICES» invoices
  PH: ['Pharma', 'Claims', 'Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ'],
  // pharmacy credit notes / deductions / manual adjustments — kept apart
  // from the daily PH lines so «claims gross = PH − fee» ties exactly
  'PH-ADJ': ['Pharma', 'Adjustment', 'Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ'],
  // A&E-referral and similar A&E adjustments, apart from the daily AE lines
  'AE-ADJ': ['A&E', 'Adjustment', 'Πληρωμένες Απαιτήσεις «all»'],
  // «ADJ-AE Referral IS» deductions: GL books them against inpatient
  // income (26xxx) — verified to the cent on Apr-2026
  'IS-ADJ': ['Inpatient', 'Adjustment', 'Πληρωμένες Απαιτήσεις «all»'],
  // one-off prior-period settlement cheques (year-end DRG true-up,
  // innovative-antibiotics reimbursement): pass-throughs that belong to
  // earlier periods — kept out of every monthly cross-check
  'IS-PRIOR': ['Inpatient', 'Prior-period', '—'],
  'PH-PRIOR': ['Pharma', 'Prior-period', '—'],
};

// adjustment markers that split a stream's ADJ/CRN lines from its daily lines
const ADJ_MARKER_RE = /ADJ|CRN|CREDIT|CORR|DEDUCTION|ISSUANCE|STOCK|MANUAL|OTC/;

const KEYWORD_CODES = [
  [['ΑΜΟΙΒΗ ΦΑΡΜΑΚΟΠΟΙΟΥ'], 'PHF'],
  [['PHARMACIST FEE'], 'PHF'],
  [['ANTIBIOTIC'], 'PH-PRIOR'],  // innovative-antibiotics settlement cheques
  [['NEW REIMB'], 'OS'],         // COR./REV corrections of the OS reimb method
  [['HPV'], 'PD'],               // vaccination corrections (PD fixed price)
  [['VAXPRO'], 'PD'],
  [['INFLUENZA'], 'PD'],
  [['ΕΜΒΟΛΙ'], 'PD'],
  [['ΑΝΑΛΩΣΙΜ'], 'PHC'],
  [['CONSUMABLE'], 'PHC'],
  [['ΦΑΡΜΑΚ'], 'PHD'],
  [['DRUG'], 'PHD'],
  [['ΣΥΝΤΑΓ'], 'PHD'],      // χειρόγραφες συνταγές (handwritten prescriptions)
  [['ISSUANCE'], 'PHD'],    // EOAF issuances deductions
  [['EOAF'], 'PHD'],
  [['PHARMACY'], 'PH'],     // PharmacyLine adjustments
  [['ΑΙΜΟΚΑΘΑΡΣ'], 'HEMO'],
  [['HEMODIALYSIS'], 'HEMO'],
  [['ΚΑΤΑ ΚΕΦΑΛΗΝ'], 'PD-CAP'],
  [['CAPITATION'], 'PD-CAP'],
  [['ΠΟΙΟΤΙΚΑ'], 'KPI'],
  [['MRI'], 'MRI'],
  [['ΕΝΔΟΝΟΣΟΚΟΜΕΙΑΚ'], 'IS'],
  [['INPATIENT'], 'IS'],
  [['ΑΤΥΧΗΜΑΤ'], 'AE'],
  [['ΕΠΕΙΓΟΝΤ'], 'AE'],
  [['EMERGENCY'], 'AE'],
  [['ΤΑΕΠ'], 'AE'],
  [['ΝΟΣΗΛΕΥΤ'], 'NM'],
  [['ΜΑΙΕΣ'], 'NM'],
  [['NURSE'], 'NM'],
  [['MIDWI'], 'NM'],
  [['ΑΛΛΟΙ ΕΠΑΓΓΕΛΜΑΤ'], 'AP'],
  [['ALLIED'], 'AP'],
  [['ΠΡΟΣΩΠΙΚΟΙ ΙΑΤΡΟΙ'], 'PD'],
  [['PERSONAL DOCTOR'], 'PD'],
  [['ΕΙΔΙΚΟΙ ΙΑΤΡΟΙ'], 'OS'],
  [['ΕΞΩΝΟΣΟΚΟΜΕΙΑΚ'], 'OS'],
  [['OUTPATIENT SPECIALIST'], 'OS'],
];

/* Invoice descriptions on real SRAs start with the stream code, e.g.
 * «AE - HCP SERVICES».  Longer alternatives first; IP is an alias of IS. */
const CODE_TOKEN_RE = /\b(A&E|PHD|PHC|PHF|PH|HEMO|MRI|CT|IP|IS|AE|OS|NM|AP|PD)\b/;
const CODE_ALIASES = { IP: 'IS' };

function classifySraLine(code, description) {
  const upDesc = stripAccents(description);
  code = (code || '').trim().toUpperCase();
  if (!(code in SRA_CODE_MAP)) {
    // semantic pre-pass BEFORE the code-token scan: «CRN-Packages PH - ...»
    // is a fee correction; «ADJ- IS - Adjustment for Hemodialysis» is the
    // hemo adjustment whose bucket depends on the patient
    if (upDesc.includes('PACKAG')) code = 'PHF';
    else if (upDesc.includes('HEMODIALY') || upDesc.includes('ΑΙΜΟΚΑΘΑΡΣ')) code = 'HEMO';
  }
  if (!(code in SRA_CODE_MAP)) {
    const m = CODE_TOKEN_RE.exec(upDesc);
    if (m) code = CODE_ALIASES[m[1]] || m[1];
  }
  if (!(code in SRA_CODE_MAP)) {
    for (const [keywords, kcode] of KEYWORD_CODES) {
      if (keywords.every((k) => upDesc.includes(k))) { code = kcode; break; }
    }
  }
  if (code in SRA_CODE_MAP) {
    if (code === 'PD' && (upDesc.includes('ΚΑΤΑ ΚΕΦΑΛΗΝ') || upDesc.includes('CAPITATION'))) code = 'PD-CAP';
    else if (code === 'PD' && (upDesc.includes('KPI') || upDesc.includes('ΠΟΙΟΤΙΚ'))) code = 'PD-KPI';
    // credit notes / corrections split away from the daily claim lines,
    // so «SRA PH = claims gross + fee» and «SRA AE = GL 25801» tie exactly
    else if (code === 'IS' && ADJ_MARKER_RE.test(upDesc) && upDesc.includes('YEAR END')) {
      // «ADJ-DRG- IS - Year End Adj.»: prior-year settlement, not part of
      // the month's inpatient claims
      code = 'IS-PRIOR';
    }
    else if ((code === 'PH' || code === 'PHD' || code === 'PHC') && ADJ_MARKER_RE.test(upDesc)) code = 'PH-ADJ';
    else if ((code === 'AE' || code === 'A&E' || code === 'IS') && ADJ_MARKER_RE.test(upDesc)
             && upDesc.includes('REFERRAL') && /\bIS\b/.test(upDesc)) {
      // «ADJ-AE Referral IS»: an inpatient-income deduction (GL 26xxx)
      code = 'IS-ADJ';
    }
    else if ((code === 'AE' || code === 'A&E') && ADJ_MARKER_RE.test(upDesc)) code = 'AE-ADJ';
    const [b, ch, src] = SRA_CODE_MAP[code];
    return [code, b, ch, src];
  }
  return [code || '??', 'Outpatient', 'Unmapped', '—'];
}

const CHEQUE_RE = /(?:ΑΡ\.?\s*ΕΠΙΤΑΓΗΣ|ΕΠΙΤΑΓΗ|CHEQUE(?:\s*NO\.?)?|ΑΡ\.?\s*ΠΛΗΡΩΜΗΣ|PAYMENT\s*(?:NO|REF)\.?)\s*[:.]?\s*#?(\d{4,})/i;
/* amounts may carry a trailing '-' (credit notes: '12.25-') */
const SRA_LINE_RE = /^\s*([A-Z][A-Z&/\-]{0,7})?\s*(.*?)\s+(-?(?:\d{1,3}(?:[.,]\d{3})*|\d+)?[.,]\d{2}-?)\s*€?\s*$/;
/* real SRA line: «01/03/2026 5636247 AE - HCP SERVICES 22,101.00 EUR 22,101.00» */
const INVOICE_LINE_RE = /^\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{4,})\s+(.+?)\s+(-?(?:\d{1,3}(?:[.,]\d{3})*|\d+)?[.,]\d{2}-?)\s+([A-Z]{3})\s+(-?(?:\d{1,3}(?:[.,]\d{3})*|\d+)?[.,]\d{2}-?)\s*$/;

function parseSraText(text) {
  let cheque = '';
  const cm = stripAccents(text).match(CHEQUE_RE);
  if (cm) cheque = cm[1];

  const lines = [];
  let statedTotal = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const up = stripAccents(line);
    // invoice-level line (the real SRA format) takes priority
    const inv = line.match(INVOICE_LINE_RE);
    if (inv) {
      const desc = inv[3].trim();
      const amount = parseAmount(inv[6]);   // Amount Paid column
      const [canon, bucket, channel, src] = classifySraLine('', desc);
      lines.push({ code: canon, description: `${desc} (${inv[1]} #${inv[2]})`,
                   amount, bucket, channel, sourceReport: src });
      continue;
    }
    const m = line.match(SRA_LINE_RE);
    if (!m) continue;
    const amount = parseAmount(m[3]);
    const desc = (m[2] || '').trim();
    const code = (m[1] || '').trim();
    if (/(ΓΕΝΙΚΟ\s+)?ΣΥΝΟΛΟ|(?:GRAND\s+)?TOTAL/.test(up) && !up.includes('ΥΠΟΣΥΝΟΛ') && !up.includes('SUBTOTAL')) {
      statedTotal = amount;  // keep the LAST total line (grand total)
      continue;
    }
    if (up.includes('ΥΠΟΣΥΝΟΛ') || up.includes('SUBTOTAL')) continue;
    // wrapped-row fragments: a continuation line like «se 12.25» carries a
    // spilled amount from the row above — counting it double-counts
    const letters = ((code || '') + desc).replace(/[^A-Za-zΑ-Ωα-ωΆ-Ώά-ώ]/g, '');
    if (letters.length < 3) continue;
    const [canon, bucket, channel, src] = classifySraLine(code, desc || code);
    lines.push({ code: canon, description: desc || canon, amount, bucket,
                 channel, sourceReport: src });
  }
  if (!lines.length) throw new ExtractionError('SRA: δεν αναγνωρίστηκαν γραμμές πληρωμής στο PDF');
  if (statedTotal == null) throw new ExtractionError('SRA: δεν βρέθηκε γραμμή Σύνολο (stated cheque total)');
  const [year, month] = findServicePeriod(text);
  const linesTotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  return {
    chequeNo: cheque || 'UNKNOWN', statedTotal, lines,
    hospitalCode: findHospital(text), year, month, linesTotal,
    parts: [[cheque || 'UNKNOWN', linesTotal, statedTotal]],
  };
}

function mergeSras(sras) {
  /* A month can be settled by several cheques: merge multiple SRAs into one
   * logical SRA; .parts keeps the per-cheque tie-out for gate 4. */
  if (sras.length === 1) return sras[0];
  const lines = [];
  const parts = [];
  for (const s of sras) {
    for (const l of s.lines) {
      lines.push({ ...l, description: `${l.description} [επ. ${s.chequeNo}]` });
    }
    parts.push([s.chequeNo, s.linesTotal, s.statedTotal]);
  }
  const cheques = sras.map((s) => s.chequeNo);
  const label = cheques.length <= 2 ? cheques.join('+')
    : cheques.slice(0, 2).join('+') + `+${cheques.length - 2}`;
  const first = sras.find((s) => s.year) || sras[0];
  return {
    chequeNo: label,
    statedTotal: round2(sras.reduce((a, s) => a + s.statedTotal, 0)),
    lines, parts,
    hospitalCode: (sras.find((s) => s.hospitalCode) || {}).hospitalCode || null,
    year: first.year || null, month: first.month || null,
    linesTotal: round2(lines.reduce((a, l) => a + l.amount, 0)),
  };
}

/* ------------------------------------------------------------------ GL */

function extractGl(bytes, hospitalCode) {
  const candidates = [];
  for (const { name, rows } of loadSheets(bytes)) {
    const hr = findHeaderRow(rows, ['VENDOR_CODE', 'EURO_AMOUNT']);
    if (hr !== null) candidates.push({ name, rows, hr });
  }
  // prefer the org-wide «ALL OKYPY MM.YY» sheet: real workbooks put
  // per-stream detail sheets (A&E clinic pivot, per-hospital copies)
  // FIRST, and reading one of those instead zeroes every other bucket
  candidates.sort((a, b) => (normLabel(a.name).includes('ALL OKYPY') ? 0 : 1)
    - (normLabel(b.name).includes('ALL OKYPY') ? 0 : 1));
  for (const { rows, hr } of candidates.slice(0, 1)) {
    const { cols, body } = tableAt(rows, hr);
    const vc = colIndex(cols, 'VENDOR_CODE');
    const cc = colIndex(cols, 'COST_CENTER', 'COST_CENTRE');
    const acc = colIndex(cols, 'ACCOUNT');
    const amt = colIndex(cols, 'EURO_AMOUNT');
    const out = { regularDrg: 0, specialized: 0, zCatalogue: 0, ae: 0,
                  pharmacistFee: 0, pharmaOther: 0, outpatient: 0, capitation: 0, other: 0 };
    for (const r of body) {
      if (r[vc] == null || cellText(r[vc]).trim().toUpperCase() !== hospitalCode.toUpperCase()) continue;
      const amount = parseAmount(r[amt]);
      const account = acc != null && r[acc] != null ? cellText(r[acc]).trim().split('.')[0] : '';
      const centre = cc != null && r[cc] != null ? cellText(r[cc]).trim().split('.')[0] : '';
      if (account === '51001001') out.capitation += amount;
      else if (centre === '26001') out.regularDrg += amount;
      else if (centre === '26002') out.specialized += amount;
      else if (centre === '26003' || centre === '26007') out.zCatalogue += amount;
      else if (centre === '25801') out.ae += amount;
      else if (centre === '25501') out.pharmacistFee += amount;
      else if (centre.startsWith('255')) out.pharmaOther += amount;
      else if (centre.startsWith('25')) out.outpatient += amount;
      else out.other += amount;
    }
    for (const k of Object.keys(out)) out[k] = round2(out[k]);
    out.inpatient = round2(out.regularDrg + out.specialized + out.zCatalogue);
    return out;
  }
  throw new ExtractionError('GL extract: δεν βρέθηκαν στήλες VENDOR_CODE / EURO_AMOUNT');
}

/* ------------------------------------------------------------ IS Auditor */

/* Provider-name matching for org-wide detail: real names are long forms like
 * «ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΑΜΜΟΧΩΣΤΟΥ (ΟΚΥπΥ)» — match distinctive tokens;
 * Nicosia explicitly excludes Makarios. */
const HOSPITAL_NAME_TOKENS = {
  F1054: [['ΛΕΥΚΩΣΙΑΣ'], ['ΜΑΚΑΡΕΙΟ']],
  F1050: [['ΜΑΚΑΡΕΙΟ'], []],
  F1047: [['ΛΕΜΕΣ'], []],
  F1048: [['ΛΑΡΝΑΚ'], []],
  F1049: [['ΑΜΜΟΧΩΣΤ'], []],
  F1025: [['ΠΑΦΟ'], []],
  F1055: [['ΚΥΠΕΡΟΥΝΤ'], []],
  F1026: [['ΧΡΥΣΟΧΟΥΣ'], []],
};

function hospitalNameMatches(code, name) {
  const up = stripAccents(name);
  const [anyTokens, notTokens] = HOSPITAL_NAME_TOKENS[code];
  return anyTokens.some((t) => up.includes(t)) && !notTokens.some((t) => up.includes(t));
}

function extractIsAuditor(bytes, hospitalCode) {
  for (const { rows } of loadSheets(bytes)) {
    const hr = findHeaderRow(rows, ['BILLING PROVIDER NAME', 'DRG ID']);
    if (hr === null) continue;
    const { cols, body } = tableAt(rows, hr);
    const prov = colIndex(cols, 'BILLING PROVIDER NAME');
    const drgId = colIndex(cols, 'DRG ID');
    const drgFf = colIndex(cols, 'DRG/FF TOTAL AMOUNT');
    const proc = colIndex(cols, 'PROCEDURES TOTAL AMOUNT');
    const cat = colIndex(cols, 'INVOICE CATEGORY');
    const t = body.filter((r) => r[prov] != null
      && hospitalNameMatches(hospitalCode, cellText(r[prov])));
    // DRG flag: present FIRST, then trimmed != '' and lower != 'nan'
    const isDrg = (v) => {
      if (v == null) return false;
      const s = cellText(v).trim();
      return s !== '' && s.toLowerCase() !== 'nan';
    };
    const out = { drgFees: 0, zCatalogue: 0, normal: 0, specialised: 0, inpatientTotal: 0 };
    for (const r of t) {
      const drg = isDrg(r[drgId]);
      if (drgFf != null && drg) out.drgFees += parseAmount(r[drgFf]);
      // Z-catalogue = ALL Procedures Total Amount (DRG rows + standalone ZD/ZF/ZC)
      if (proc != null) out.zCatalogue += parseAmount(r[proc]);
      if (cat != null && drg && drgFf != null) {
        const c = stripAccents(cellText(r[cat]));
        if (/ΚΑΝΟΝΙΚ|NORMAL/.test(c)) out.normal += parseAmount(r[drgFf]);
        else if (/ΕΞΕΙΔΙΚ|SPECIAL/.test(c)) out.specialised += parseAmount(r[drgFf]);
      }
    }
    for (const k of Object.keys(out)) out[k] = round2(out[k]);
    out.inpatientTotal = round2(out.drgFees + out.zCatalogue);
    return out;
  }
  throw new ExtractionError('IS Auditor: δεν βρέθηκαν στήλες Billing Provider Name / DRG Id');
}

/* ----------------------------------------------------------- XML activity */

function extractXmlActivity(bytes) {
  const doc = parseXml(bytes);
  let total = 0, found = false;
  const claims = new Set();
  const byPayment = {};
  // group per <Claim>: each carries ClaimPaymentNumber (the SRA cheque that
  // paid it) — the join key for the payment-number gate
  for (const claim of doc.getElementsByTagName('*')) {
    if (claim.localName.toLowerCase() !== 'claim') continue;
    let pay = '', amt = 0, hasAmount = false;
    for (const el of claim.getElementsByTagName('*')) {
      const tag = el.localName.toLowerCase();
      if (tag === 'activityreimbursementamount') { amt += parseAmount(el.textContent); hasAmount = true; }
      else if (tag === 'claimid' && el.textContent) claims.add(el.textContent.trim());
      else if (tag === 'claimpaymentnumber' && el.textContent) pay = el.textContent.trim();
    }
    total += amt;
    if (hasAmount) { found = true; byPayment[pay] = round2((byPayment[pay] || 0) + amt); }
  }
  if (!found) {
    // flat exports without a <Claim> wrapper: sum what's there
    for (const el of doc.getElementsByTagName('*')) {
      const tag = el.localName.toLowerCase();
      if (tag === 'activityreimbursementamount') { total += parseAmount(el.textContent); found = true; }
      else if (tag === 'claimid' && el.textContent) claims.add(el.textContent.trim());
    }
  }
  if (!found) throw new ExtractionError('XML activity: δεν βρέθηκαν πεδία ActivityReimbursementAmount');
  return { total: round2(total), nClaims: claims.size, byPayment };
}

/* ---------------------------------- capitation / quality / hemo (any fmt) */

function extractSimpleReport(bytes, rawText) {
  if (rawText != null) return simpleFromText(rawText);
  const fmt = sniffFormat(bytes);
  if (fmt === 'xml') {
    const doc = parseXml(bytes);
    return simpleFromText(doc.documentElement.textContent);
  }
  const lines = [];
  let total = null;
  for (const { rows } of loadSheets(bytes)) {
    for (const row of rows) {
      const cells = row.filter((v) => v != null && cellText(v) !== 'nan');
      const nums = cells.filter(isNumberLike).map(parseAmount);
      const labels = cells.filter((v) => !isNumberLike(v)).map(cellText);
      if (!nums.length) continue;
      const label = labels.length ? labels[0] : '';
      const upLabel = stripAccents(label);
      if (upLabel.includes('ΣΥΝΟΛ') || upLabel.includes('TOTAL')) total = nums[nums.length - 1];
      else if (label) lines.push([label, nums[nums.length - 1]]);
    }
  }
  if (total == null) total = round2(lines.reduce((a, [, v]) => a + v, 0));
  return { total: round2(total), lines };
}

function simpleFromText(text) {
  // invoice-level rows first (real capitation reports: «5729128 F1049 ...
  // STANDARD 31/03/2026 5,174.80 €» followed by per-doctor / per-age detail
  // that must NOT be double-counted)
  const invoiceRows = [];
  for (const raw of String(text).split('\n')) {
    if (/\b\d{6,}\b/.test(raw) && stripAccents(raw).includes('STANDARD')) {
      const amts = findAmounts(raw);
      if (amts.length) invoiceRows.push([raw.trim().slice(0, 60), amts[amts.length - 1]]);
    }
  }
  if (invoiceRows.length) {
    return { total: round2(invoiceRows.reduce((a, [, v]) => a + v, 0)), lines: invoiceRows };
  }
  const lines = [];
  let total = null;
  for (const raw of String(text).split('\n')) {
    const amts = findAmounts(raw);
    if (!amts.length) continue;
    const up = stripAccents(raw);
    if (up.includes('ΣΥΝΟΛ') || up.includes('TOTAL')) total = amts[amts.length - 1];
    else {
      const label = raw.replace(new RegExp(AMOUNT_RE_SRC, 'g'), '').trim().replace(/[ .:€]+$/, '');
      if (label) lines.push([label, amts[amts.length - 1]]);
    }
  }
  if (total == null) total = round2(lines.reduce((a, [, v]) => a + v, 0));
  return { total: round2(total), lines };
}

/* ------------------------------------------------------------ dispatcher */

async function extractReport(reportType, f, hospitalCode, sraTextOverride) {
  const rawText = sraTextOverride != null ? sraTextOverride : f.rawText;
  switch (reportType) {
    case RT.SRA: return parseSraText(rawText != null ? rawText : await extractPdfText(f.data));
    case RT.INPATIENT_SUMMARY: return extractInpatientSummary(f.data);
    case RT.CLAIMS_ALL: return extractClaimsAll(f.data);
    case RT.PHARMA_CLAIMS: return extractPharmaClaims(f.data);
    case RT.PHARMACIST_FEE:
      return parsePharmacistFeeText(rawText != null ? rawText : await extractPdfText(f.data));
    case RT.GL_EXTRACT: return extractGl(f.data, hospitalCode);
    case RT.IS_AUDITOR: return extractIsAuditor(f.data, hospitalCode);
    case RT.XML_ACTIVITY: return extractXmlActivity(f.data);
    default: return extractSimpleReport(f.data, rawText);
  }
}
