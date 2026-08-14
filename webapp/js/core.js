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
  STAFF_MAPPING: 'staff_mapping',
  COST_CENTRE_MAP: 'cost_centre_map',
  SAP_MASTER: 'sap_master',
};

const REQUIRED_TYPES = [RT.SRA, RT.INPATIENT_SUMMARY, RT.CLAIMS_ALL,
                        RT.PHARMA_CLAIMS, RT.PHARMACIST_FEE];
const ORG_WIDE_TYPES = new Set([RT.GL_EXTRACT, RT.IS_AUDITOR,
                                RT.STAFF_MAPPING, RT.COST_CENTRE_MAP,
                                RT.SAP_MASTER]);
/* report types a batch may legitimately carry more than once */
const MULTI_FILE_TYPES = new Set([RT.SRA, RT.STAFF_MAPPING]);
// a non-hospital provider bills service streams only
const REQUIRED_TYPES_PROVIDER = [RT.SRA, RT.CLAIMS_ALL];

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
  [RT.STAFF_MAPPING]: 'Μητρώο προσωπικού ανά κλινική (staff roster)',
  [RT.COST_CENTRE_MAP]: 'Αντιστοίχιση κέντρων κόστους SAP (cost centres)',
  [RT.SAP_MASTER]: 'Βασικά δεδομένα SAP (chart of accounts, cost centres)',
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

/* ΟΑΥ also pays OKYπY units that are NOT one of the 8 hospitals — the mental
 * health services, each with its own F-code and its own cheque.  They bill
 * service streams only (OS / NM / AP): no DRG summary, no pharmacy, no
 * pharmacist fee, so they need their own required set.  Display names only:
 * the real name is read from the file content when the activity export is
 * present, and a provider is NEVER decided from a filename. */
const OTHER_PROVIDERS = {
  F1070: 'ΕΣΩΤΕΡΙΚΗ ΝΟΣΗΛΕΙΑ ΨΥΧΙΚΗΣ ΥΓΕΙΑΣ',
  F1088: 'ΙΑΤΡΕΙΑ ΔΙΠΛΗΣ ΔΙΑΓΝΩΣΗΣ',
  F1089: 'ΚΟΙΝΟΤΙΚΑ ΚΕΝΤΡΑ ΓΙΑ ΕΝΗΛΙΚΕΣ ΨΥΧΙΚΗΣ ΥΓΕΙΑΣ',
  F1090: 'ΚΟΙΝΟΤΙΚΑ ΚΕΝΤΡΑ ΓΙΑ ΠΑΙΔΙΑ ΚΑΙ ΕΦΗΒΟΥΣ',
  F1097: 'ΚΕΝΤΡΟ ΕΞΕΙΔΙΚΕΥΜΕΝΩΝ ΑΞΙΟΛΟΓΗΣΕΩΝ ΨΥΧΙΚΗΣ ΥΓΕΙΑΣ',
};

function isHospital(code) {
  return !!code && Object.prototype.hasOwnProperty.call(HOSPITALS, code);
}

function providerName(code, learned) {
  /* A name read from the file content always wins over the built-in
   * registry, so a provider the app has never seen still shows its name. */
  if (!code) return '—';
  if (isHospital(code)) return HOSPITALS[code][0];
  if (learned) return String(learned).trim();
  return OTHER_PROVIDERS[code] || code;
}

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
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }  // credit: '12.25-'
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

const AMOUNT_RE_SRC = String.raw`(?<![\d.,])(?:-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+[.,]\d{2})-?(?!\d)`;

function findAmounts(text) {
  const out = [];
  for (const m of String(text).matchAll(new RegExp(AMOUNT_RE_SRC, 'g'))) out.push(parseAmount(m[0]));
  return out;
}

function isNumberLike(v) {
  if (v == null || typeof v === 'boolean' || v instanceof Date) return false;
  if (typeof v === 'number') return !Number.isNaN(v);
  const s = String(v).replace(/€/g, '').trim();   // cells like '€ 0.00'
  if (!s) return false;
  return new RegExp(`^(?:${AMOUNT_RE_SRC})$`).test(s) || /^-?\d+([.,]\d+)?$/.test(s);
}
