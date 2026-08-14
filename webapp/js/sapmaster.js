/* OKYπY's own SAP master data — JS port of recon/sapmaster.py.
 *
 * ΟΑΥ pays a hospital and names its clinics in English («RENAL DISEASES»);
 * SAP posts to a Greek cost centre inside one company code
 * («1064003402 ΝΕΦΡΟΛΟΓΙΚΗ-ΘΑΛΑΜΟΣ»), and each revenue stream has its own HIO
 * account.  Nothing here invents a code: a line that cannot be matched
 * uniquely comes out blank and is listed for a human. */
'use strict';

/* ΟΑΥ's F-code -> the SAP company code that posts it, off the master's own
 * «Company Codes» sheet — kept visible rather than name-matched at run time */
const COMPANY_CODES = {
  F1054: '1020',   // ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ -> ΓΝ Λευκωσίας
  F1050: '1021',   // ΜΑΚΑΡΕΙΟ                     -> ΝΑΜΙΙΙ
  F1047: '1030',   // ΓΝ ΛΕΜΕΣΟΥ                   -> ΓΝ Λεμεσού
  F1025: '1031',   // ΓΝ ΠΑΦΟΥ                     -> ΓΝ Πάφου
  F1055: '1032',   // ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ       -> Ν Τροόδους
  F1026: '1033',   // ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΗΣ ΧΡΥΣΟΧΟΥΣ   -> Ν Πόλης Χρυσοχούς
  F1048: '1040',   // ΓΝ ΛΑΡΝΑΚΑΣ                  -> ΓΝ Λάρνακας
  F1049: '1041',   // ΓΝ ΑΜΜΟΧΩΣΤΟΥ               -> ΓΝ Αμμοχώστου
};
const MENTAL_HEALTH_COMPANY = '1003';        // ΔΥΨΥ — every mental-health unit

/* the HIO revenue accounts, by what the line actually is — each checked
 * against the uploaded chart of accounts before it is written */
const REVENUE_ACCOUNTS = {
  inpatient_drg: '412001',      // HIO In-Patient Fees
  inpatient_daily: '412005',    // HIO Day Care Fees
  inpatient_z: '412007',        // HIO Catalogue Z Items
  ae: '412003',                 // HIO TAEP Fees
  outpatient: '412002',         // HIO Out-Patient Fees
  capitation: '412000',         // HIO - Capitation Fees
  quality: '412008',            // HIO Quality Criteria
  oncall: '412009',             // HIO On-call clinics
  vaccines: '412010',           // HIO Vaccines
  pharma: '412006',             // HIO Drugs Phase B
};

/* ΟΑΥ's English speciality -> the stem SAP uses in the cost-centre name.
 * Only unambiguous pairs; anything else stays unmatched on purpose. */
const SPECIALTY_GREEK = {
  CARDIOLOGY: 'ΚΑΡΔΙΟΛΟΓΙΚ',
  'GENERAL SURGERY': 'ΧΕΙΡΟΥΡΓΙΚΗ',
  GASTROENTEROLOGY: 'ΓΑΣΤΡΕΝΤΕΡΟΛΟΓΙΚ',
  HAEMATOLOGY: 'ΑΙΜΑΤΟΛΟΓΙΚ',
  HEMATOLOGY: 'ΑΙΜΑΤΟΛΟΓΙΚ',
  'RENAL DISEASES': 'ΝΕΦΡΟΛΟΓΙΚ',
  NEPHROLOGY: 'ΝΕΦΡΟΛΟΓΙΚ',
  'DERMATO-VENEREOLOGY': 'ΔΕΡΜΑΤΟΛΟΓΙΚ',
  DERMATOLOGY: 'ΔΕΡΜΑΤΟΛΟΓΙΚ',
  NEUROLOGY: 'ΝΕΥΡΟΛΟΓΙΚ',
  'NEUROLOGICAL SURGERY': 'ΝΕΥΡΟΧΕΙΡΟΥΡΓΙΚ',
  'OBSTETRICS - GYNAECOLOGY': 'ΓΥΝΑΙΚΟΛΟΓΙΚ',
  'OBSTETRICS-GYNAECOLOGY': 'ΓΥΝΑΙΚΟΛΟΓΙΚ',
  GYNAECOLOGY: 'ΓΥΝΑΙΚΟΛΟΓΙΚ',
  PAEDIATRICS: 'ΠΑΙΔΙΑΤΡΙΚ',
  PEDIATRICS: 'ΠΑΙΔΙΑΤΡΙΚ',
  OPHTHALMOLOGY: 'ΟΦΘΑΛΜΟΛΟΓΙΚ',
  'INTERNAL MEDICINE': 'ΠΑΘΟΛΟΓΙΚ',
  ORTHOPAEDICS: 'ΟΡΘΟΠΑΙΔΙΚ',
  ORTHOPEDICS: 'ΟΡΘΟΠΑΙΔΙΚ',
  UROLOGY: 'ΟΥΡΟΛΟΓΙΚ',
  'RESPIRATORY MEDICINE': 'ΠΝΕΥΜΟΝΟΛΟΓΙΚ',
  RHEUMATOLOGY: 'ΡΕΥΜΑΤΟΛΟΓΙΚ',
  OTORHINOLARYNGOLOGY: 'ΩΡΛ',
  'PLASTIC SURGERY': 'ΠΛΑΣΤΙΚΗ',
  'VASCULAR SURGERY': 'ΑΓΓΕΙΟΧΕΙΡΟΥΡΓΙΚ',
  'DIAGNOSTIC RADIOLOGY': 'ΑΚΤ',
  PHYSIOTHERAPY: 'ΦΥΣΙΟΘΕΡΑΠΕΥΤΗΡΙΟ',
  /* whole-stream lines, which are not a clinical speciality at all */
  'A&E': 'ΤΑΕΠ',
  'ACCIDENT & EMERGENCY': 'ΤΑΕΠ',
  'ΤΑΕΠ': 'ΤΑΕΠ',
  PHARMA: 'ΦΑΡΜΑΚΕΙΟ',
  'ΦΑΡΜΑΚΑ': 'ΦΑΡΜΑΚΕΙΟ',
  HEMODIALYSIS: 'ΝΕΦ-ΑΙΜΟΚΑΘΑΡΣΗ',
  'ΑΙΜΟΚΑΘΑΡΣΗ': 'ΝΕΦ-ΑΙΜΟΚΑΘΑΡΣΗ',
  'PERSONAL DOCTORS': 'ΠΙ ΕΝΗΛΙΚΩΝ',
  'ΠΡΟΣΩΠΙΚΟΙ ΙΑΤΡΟΙ': 'ΠΙ ΕΝΗΛΙΚΩΝ',
};

/* which flavour of a clinic's cost centre a stream posts to */
const CENTRE_VARIANTS = {
  ward: ['ΘΑΛ'],               // ΘΑΛΑΜΟΣ / ΘΑΛ Α / Θαλ. Α — inpatient
  daycare: ['ΗΦ', 'Η.Φ.'],     // ημερήσια φροντίδα — daily treatments
  clinic: ['ΕΙ'],              // εξωτερικά ιατρεία — outpatient specialists
  general: ['ΓΕΝΙΚΑ', 'ΓΕΝ'],
};

function sapFold(s) {
  return normLabel(String(s)).replace(/\./g, '').replace(/\s/g, '');
}

function sapStemFor(specialty) {
  const up = normLabel(specialty);
  if (SPECIALTY_GREEK[up]) return sapFold(SPECIALTY_GREEK[up]);
  for (const [name, stem] of Object.entries(SPECIALTY_GREEK)) {
    if (up.includes(name)) return sapFold(stem);
  }
  return '';
}

function hasVariant(name, marks) {
  const folded = sapFold(name);
  return marks.some((m) => folded.includes(sapFold(m)));
}

function companyFor(hospitalCode) {
  if (!hospitalCode) return '';
  return COMPANY_CODES[hospitalCode] || MENTAL_HEALTH_COMPANY;
}

function sapAccount(master, key) {
  /* the HIO revenue account for a kind of line, checked against the uploaded
   * chart of accounts — an account the chart does not carry is NOT written */
  const code = REVENUE_ACCOUNTS[key] || '';
  if (code && master && master.accounts[code]) return [code, master.accounts[code]];
  return ['', ''];
}

function findSapCentre(master, company, specialty, variant = 'general') {
  /* ΟΑΥ's English speciality + the stream's flavour -> one cost centre of this
   * company, or null.  Never a guess: the stem must match and, once the
   * flavour is applied, exactly one centre must remain. */
  const stem = sapStemFor(specialty);
  if (!master || !stem || !company) return null;
  const hits = master.costCentres.filter((c) => c.company === company
                                                && sapFold(c.name).includes(stem));
  if (!hits.length) return null;
  /* a centre NAMED exactly as the stem is that stream's own centre —
   * «ΤΑΕΠ» is not «ΚΩΔΙΚΟΠΟΙΗΣΗ ΤΑΕΠ» */
  const exact = hits.filter((c) => sapFold(c.name) === stem);
  if (exact.length === 1) return exact[0];
  for (const key of [variant, 'general']) {
    const marks = CENTRE_VARIANTS[key] || [];
    const picked = hits.filter((c) => hasVariant(c.name, marks));
    if (picked.length === 1) return picked[0];
    if (picked.length > 1) return null;   // ambiguous — a human decides
  }
  return hits.length === 1 ? hits[0] : null;
}

const MASTER_SHEETS = ['COMPANY CODES', 'COST CENTERS', 'COST CENTRES',
                       'CHART OF ACCOUNTS'];

function looksLikeSapMaster(names) {
  const seen = names.map((n) => normLabel(String(n)));
  const hits = MASTER_SHEETS.filter((want) => seen.some((s) => s.includes(want)));
  return hits.length >= 2;
}

function extractSapMaster(bytes) {
  /* the export as it comes out of SAP: one sheet of company codes, one of cost
   * centres, one chart of accounts.  Sheets are found by their headers, so a
   * renamed tab still works. */
  const out = { companies: {}, costCentres: [], accounts: {} };
  for (const { rows } of loadSheets(bytes)) {
    if (!rows.length) continue;
    let headerRow = null;
    let cols = [];
    for (let i = 0; i < Math.min(6, rows.length); i++) {
      const c = rows[i].map((v) => (v != null && cellText(v) !== 'nan'
        ? normLabel(cellText(v)) : ''));
      const joined = c.join(' | ');
      if (['COMP CODE', 'COMPANY CODE', 'G L ACCOUNT', 'GL ACCOUNT']
        .some((k) => joined.includes(k))) { headerRow = i; cols = c; break; }
    }
    if (headerRow === null) continue;
    const col = (...needles) => {
      for (const needle of needles) {
        for (let j = 0; j < cols.length; j++) if (cols[j].includes(needle)) return j;
      }
      return null;
    };
    const jComp = col('COMP CODE', 'COMPANY CODE');
    const jCentre = col('COST CENTER', 'COST CENTRE');
    const jAcct = col('G L ACCOUNT', 'GL ACCOUNT');
    const jName = col('NAME', 'ΠΕΡΙΓΡΑΦΗ', 'LONG TEXT');
    const txt = (row, j) => {
      if (j == null || row[j] == null) return '';
      const v = cellText(row[j]).trim();
      if (v === 'nan') return '';
      return /^\d+(\.0+)?$/.test(v) ? v.split('.')[0] : v;
    };
    for (const row of rows.slice(headerRow + 1)) {
      if (jCentre != null && jComp != null) {
        const company = txt(row, jComp), code = txt(row, jCentre);
        if (company && code) {
          out.costCentres.push({ company, code, name: txt(row, jName) });
        }
      } else if (jComp != null) {
        const company = txt(row, jComp);
        if (company) out.companies[company] = txt(row, jName);
      } else if (jAcct != null) {
        const acct = txt(row, jAcct);
        if (acct) out.accounts[acct] = txt(row, jName);
      }
    }
  }
  return out;
}
