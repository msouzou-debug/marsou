/* Shared vocabulary + amount handling — JS port of recon/models.py and
 * recon/numbers.py.  Keep the two in sync: same report types, hospitals,
 * buckets, parsing rules. */
'use strict';

const RT = {
  SRA: 'sra',
  INPATIENT_SUMMARY: 'inpatient_summary',
  CLAIMS_ALL: 'claims_all',
  PHARMA_CLAIMS: 'pharma_claims',
  PHARMACIST_FEE: 'pharmacist_fee',
  CAPITATION: 'capitation',
  QUALITY_CRITERIA: 'quality_criteria',
  HEMODIALYSIS: 'hemodialysis',
  XML_ACTIVITY: 'xml_activity',
  GL_EXTRACT: 'gl_extract',
  IS_AUDITOR: 'is_auditor',
};

const REQUIRED_TYPES = [RT.SRA, RT.INPATIENT_SUMMARY, RT.CLAIMS_ALL,
                        RT.PHARMA_CLAIMS, RT.PHARMACIST_FEE];
const ORG_WIDE_TYPES = new Set([RT.GL_EXTRACT, RT.IS_AUDITOR]);

const REPORT_LABELS = {
  [RT.SRA]: 'Κατάσταση Πληρωμής / SRA (Remittance Advice)',
  [RT.INPATIENT_SUMMARY]: 'Ενδ. Πληρωμένες Απαιτήσεις (Inpatient summary)',
  [RT.CLAIMS_ALL]: 'Πληρωμένες Απαιτήσεις «all» (Paid HCP claims)',
  [RT.PHARMA_CLAIMS]: 'Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ (Pharma claims)',
  [RT.PHARMACIST_FEE]: 'Αμοιβή Φαρμακοποιού (Pharmacist fee)',
  [RT.CAPITATION]: 'Capitation Report (Κατά κεφαλήν αμοιβή)',
  [RT.QUALITY_CRITERIA]: 'Ποιοτικά Κριτήρια (Quality criteria)',
  [RT.HEMODIALYSIS]: 'Αιμοκάθαρση (Hemodialysis monthly report)',
  [RT.XML_ACTIVITY]: 'XML activity export (Outpatient activity)',
  [RT.GL_EXTRACT]: 'OKYPY ALL GL extract',
  [RT.IS_AUDITOR]: 'IS Auditor Report (Inpatient detail)',
};

/* F-code -> [Greek name, English name].  «ΛΕΥΚΩΣΙΑΣ» alone must never be
 * used as a filter — match the full provider name or the F-code. */
const HOSPITALS = {
  F1054: ['ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ', 'Nicosia'],
  F1050: ['ΜΑΚΑΡΕΙΟ ΝΟΣΟΚΟΜΕΙΟ', 'Makarios'],
  F1047: ['ΓΝ ΛΕΜΕΣΟΥ', 'Limassol'],
  F1048: ['ΓΝ ΛΑΡΝΑΚΑΣ', 'Larnaca'],
  F1049: ['ΓΝ ΑΜΜΟΧΩΣΤΟΥ', 'Famagusta'],
  F1025: ['ΓΝ ΠΑΦΟΥ', 'Paphos'],
  F1055: ['ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ', 'Kyperounta'],
  F1026: ['ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΗΣ ΧΡΥΣΟΧΟΥΣ', 'Polis'],
};

const BUCKETS = ['Inpatient', 'A&E', 'Outpatient', 'Pharma'];
const BUCKET_LABELS = {
  Inpatient: 'Ενδονοσοκομειακή περίθαλψη (Inpatient)',
  'A&E': 'ΤΑΕΠ (A&E)',
  Outpatient: 'Εξωνοσοκομειακή περίθαλψη (Outpatient)',
  Pharma: 'Φάρμακα (Pharma)',
};

const GREEK_MONTHS = {
  'ΙΑΝΟΥΑΡΙΟΣ': 1, 'ΙΑΝΟΥΑΡΙΟΥ': 1, 'ΦΕΒΡΟΥΑΡΙΟΣ': 2, 'ΦΕΒΡΟΥΑΡΙΟΥ': 2,
  'ΜΑΡΤΙΟΣ': 3, 'ΜΑΡΤΙΟΥ': 3, 'ΑΠΡΙΛΙΟΣ': 4, 'ΑΠΡΙΛΙΟΥ': 4,
  'ΜΑΙΟΣ': 5, 'ΜΑΙΟΥ': 5, 'ΙΟΥΝΙΟΣ': 6, 'ΙΟΥΝΙΟΥ': 6,
  'ΙΟΥΛΙΟΣ': 7, 'ΙΟΥΛΙΟΥ': 7, 'ΑΥΓΟΥΣΤΟΣ': 8, 'ΑΥΓΟΥΣΤΟΥ': 8,
  'ΣΕΠΤΕΜΒΡΙΟΣ': 9, 'ΣΕΠΤΕΜΒΡΙΟΥ': 9, 'ΟΚΤΩΒΡΙΟΣ': 10, 'ΟΚΤΩΒΡΙΟΥ': 10,
  'ΝΟΕΜΒΡΙΟΣ': 11, 'ΝΟΕΜΒΡΙΟΥ': 11, 'ΔΕΚΕΜΒΡΙΟΣ': 12, 'ΔΕΚΕΜΒΡΙΟΥ': 12,
};

const MONTH_NAMES_EL = ['', 'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος',
  'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος',
  'Νοέμβριος', 'Δεκέμβριος'];

/* Latin abbreviations for output filenames (OKYPY_HIO_F1049_MAR2026_...) */
const MONTH_ABBR = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL',
  'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const PHARMACIST_FEE_UNIT_PRICE = 1.60;
const CENT = 0.011; // "to the cent"

function stripAccents(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

function normLabel(s) {
  /* Header/label comparison form: accent-stripped, uppercased, separator
   * runs (space _ - . /) collapsed to single spaces — 'DR_SEGMENT',
   * 'Dr Segment' and 'DR-SEGMENT' all compare equal. */
  return stripAccents(s).replace(/[\s_\-./]+/g, ' ').trim();
}

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

/* ---- amount parsing: '1.234.567,89' / '1,234,567.89' / floats / '€ ...' */
function parseAmount(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isNaN(v) ? 0 : v;
  if (v instanceof Date) return 0;
  let s = String(v).replace(/[€\s ]/g, '').trim();
  if (!s || ['nan', 'none', '-'].includes(s.toLowerCase())) return 0;
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.split('.').join('').replace(',', '.');
    else s = s.split(',').join('');
  } else if (hasComma) {
    const i = s.lastIndexOf(','), head = s.slice(0, i), tail = s.slice(i + 1);
    if (tail.length <= 2 && !head.includes(',')) s = head + '.' + tail;
    else s = s.split(',').join('');
  } else if (hasDot) {
    const i = s.lastIndexOf('.'), head = s.slice(0, i), tail = s.slice(i + 1);
    // ΟΑΥ thousands-groups are 3 digits, decimals 1-2: '1.234' is thousands
    if (tail.length === 3 && head && !head.includes('.') && head.length <= 3) s = head + tail;
    else if (tail.length === 3 && head.includes('.')) s = s.split('.').join('');
    else if (tail.length > 2) s = s.split('.').join('');
  }
  const f = parseFloat(s);
  if (Number.isNaN(f)) return 0;
  return neg ? -f : f;
}

function formatEur(v) {
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (neg ? '-' : '') + s + ' €';
}

const AMOUNT_RE_SRC = String.raw`(?<![\d.,])(?:-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+[.,]\d{2})(?!\d)`;

function findAmounts(text) {
  const out = [];
  for (const m of String(text).matchAll(new RegExp(AMOUNT_RE_SRC, 'g'))) out.push(parseAmount(m[0]));
  return out;
}

function isNumberLike(v) {
  if (v == null || typeof v === 'boolean' || v instanceof Date) return false;
  if (typeof v === 'number') return !Number.isNaN(v);
  const s = String(v).trim();
  if (!s) return false;
  return new RegExp(`^(?:${AMOUNT_RE_SRC})$`).test(s) || /^-?\d+([.,]\d+)?$/.test(s);
}
