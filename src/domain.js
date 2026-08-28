/* ---------- domain constants ----------
   Validated in production against the real files — do not re-derive.
   HOSP_KEYS is order-sensitive: ΜΑΚΑΡΕΙΟ must be tested before ΛΕΥΚΩΣΙΑΣ,
   because the Makarios provider name also contains «ΛΕΥΚΩΣΙΑΣ». */

export const KPI_DEFS=[
  {key:'adm',   re:/Εισαγωγές/i,                              label:'Εισαγωγές ασθενών'},
  {key:'dc',    re:/Ημερήσια Νοσηλεία/i,                      label:'Ημερήσια νοσηλεία (ασθενείς)'},
  {key:'opd',   re:/Εξωτερικά Ιατρεία/i,                      label:'Επισκέψεις εξωτερικών ιατρείων'},
  {key:'surg',  re:/Χειρουργικών Επεμβάσεων(?!.*Μικρά)/i,     label:'Χειρουργικές επεμβάσεις'},
  {key:'minor', re:/Μικρά Χειρουργ/i,                         label:'Μικρά χειρουργεία'},
  {key:'xray',  re:/Ακτινολογικών/i,                          label:'Ακτινολογικές εξετάσεις'},
  {key:'lab',   re:/Βιοπαθολογικών/i,                         label:'Βιοπαθολογικές εξετάσεις'},
  {key:'cath',  re:/Επεμβατικό Καρδιολογικό/i,                label:'Επεμβατικό καρδιολογικό εργαστήριο'},
  {key:'taepA', re:/ΤΑΕΠ Ενηλίκων/i,                          label:'Επισκέψεις ΤΑΕΠ ενηλίκων'},
  {key:'taepP', re:/ΤΑΕΠ Παίδων/i,                            label:'Επισκέψεις ΤΑΕΠ παίδων'},
  {key:'dial',  re:/Αριθμός Αιμοδιαλύσεων/i,                  label:'Αιμοκαθάρσεις (συνεδρίες)'},
  {key:'physio',re:/Φυσιοθεραπει/i,                           label:'Φυσιοθεραπείες'},
];

export const HOSP_KEYS=[['ΜΑΚΑΡΕΙΟ','Makarios (Paed)'],['ΛΕΥΚΩΣΙΑΣ','Nicosia General'],['ΛΕΜΕΣΟΥ','Limassol General'],
 ['ΛΑΡΝΑΚΑΣ','Larnaca General'],['ΠΑΦΟΥ','Paphos General'],['ΑΜΜΟΧΩΣΤΟΥ','Famagusta General'],
 ['ΚΥΠΕΡΟΥΝΤΑΣ','Kyperunta'],['ΠΟΛΗΣ','Polis Chrysochous'],['ΑΠΟΚΑΤΑΣΤΑΣΗΣ','Rehab Centre']];

export function hospOf(name){ const s=String(name); for(const [k,v] of HOSP_KEYS) if(s.includes(k)) return v; return 'Other'; }

/* ALL and AE: vendor names carry the hospital tag («-NGH-», or « NGH-» for F1106/F1111) */
export const TAG2HOSP={'NGH':'Nicosia General','LIM':'Limassol General','LARN':'Larnaca General','PAR':'Famagusta General',
 'PAF':'Paphos General','POL':'Polis Chrysochous','KYP':'Kyperunta','NAM':'Makarios (Paed)'};

/* cost centres that are not outpatient clinical fee-for-service */
export const OP_EXCLUDE=['PHARMA','MED EQ','BASIC TESTS','Inpatient','DRUGS','DRGS','ACCIDENT','REHABILITATION','None'];

/* lab/imaging specialties: excluded from OS outpatient visits so the count is
   comparable with the hospital's clinic visits */
export const OS_LAB=['DIAGNOSTIC RADIOLOGY','PATHOLOGICAL ANATOMY','CYTOLOGY','MEDICAL MICROBIOLOGY','BIOPATHOLOGY'];

/* ---------- clinic identity ----------
   The same clinic is written differently on every sheet — «Παθολογική» on the
   admissions sheet, «Παθολογικά» (ιατρεία) on the outpatient one, «Παθολογικό»
   on a day-care unit — and the ΟΑΥ files name it in English under
   `Claim Speciality`. Everything is reduced to one key so the indicators of a
   clinic land in the same row.

   The rule is deliberately narrow: strip the wrapper words, then cut the
   adjective ending back to its -ΙΚ- stem. It merges declensions of the same
   word and nothing else. */
/* \b is ASCII-only in JavaScript, so Greek words need explicit letter boundaries */
const CLINIC_WRAPPERS=/(?<![Α-ΩA-Z])(ΚΛΙΝΙΚΗ|ΚΛΙΝΙΚΕΣ|ΚΛΙΝΙΚΩΝ|ΙΑΤΡΕΙΟ|ΙΑΤΡΕΙΑ|ΙΑΤΡΕΙΩΝ|ΜΟΝΑΔΑ|ΜΟΝΑΔΕΣ|ΤΜΗΜΑ|ΤΜΗΜΑΤΑ|ΘΑΛΑΜΟΣ|ΤΟΜΕΑΣ)(?![Α-ΩA-Z])/g;

/* `Claim Speciality` arrives in English. Only the mappings below are trusted;
   anything else is stemmed as Greek and, if it still matches no clinic, listed
   in the UI as unmatched rather than silently dropped. */
export const SPECIALITY_SYNONYMS={
  'INTERNAL MEDICINE':'ΠΑΘΟΛΟΓΙΚ', 'GENERAL MEDICINE':'ΠΑΘΟΛΟΓΙΚ',
  'GENERAL SURGERY':'ΧΕΙΡΟΥΡΓΙΚ', 'SURGERY':'ΧΕΙΡΟΥΡΓΙΚ',
  'CARDIOLOGY':'ΚΑΡΔΙΟΛΟΓΙΚ', 'CARDIAC SURGERY':'ΚΑΡΔΙΟΧΕΙΡΟΥΡΓΙΚ',
  'ORTHOPAEDICS':'ΟΡΘΟΠΕΔΙΚ', 'ORTHOPEDICS':'ΟΡΘΟΠΕΔΙΚ',
  'PAEDIATRICS':'ΠΑΙΔΙΑΤΡΙΚ', 'PEDIATRICS':'ΠΑΙΔΙΑΤΡΙΚ',
  'OBSTETRICS AND GYNAECOLOGY':'ΓΥΝΑΙΚΟΛΟΓΙΚ', 'OBSTETRICS GYNAECOLOGY':'ΓΥΝΑΙΚΟΛΟΓΙΚ',
  'GYNAECOLOGY':'ΓΥΝΑΙΚΟΛΟΓΙΚ', 'GYNECOLOGY':'ΓΥΝΑΙΚΟΛΟΓΙΚ', 'OBSTETRICS':'ΓΥΝΑΙΚΟΛΟΓΙΚ',
  'ONCOLOGY':'ΟΓΚΟΛΟΓΙΚ', 'MEDICAL ONCOLOGY':'ΟΓΚΟΛΟΓΙΚ', 'RADIATION ONCOLOGY':'ΑΚΤΙΝΟΘΕΡΑΠΕΥΤΙΚ',
  'RHEUMATOLOGY':'ΡΕΥΜΑΤΟΛΟΓΙΚ', 'NEPHROLOGY':'ΝΕΦΡΟΛΟΓΙΚ', 'NEUROLOGY':'ΝΕΥΡΟΛΟΓΙΚ',
  'NEUROSURGERY':'ΝΕΥΡΟΧΕΙΡΟΥΡΓΙΚ', 'UROLOGY':'ΟΥΡΟΛΟΓΙΚ',
  'OTORHINOLARYNGOLOGY':'ΩΤΟΡΙΝΟΛΑΡΥΓΓΟΛΟΓΙΚ', 'ENT':'ΩΤΟΡΙΝΟΛΑΡΥΓΓΟΛΟΓΙΚ',
  'OPHTHALMOLOGY':'ΟΦΘΑΛΜΟΛΟΓΙΚ', 'GASTROENTEROLOGY':'ΓΑΣΤΡΕΝΤΕΡΟΛΟΓΙΚ',
  'PULMONOLOGY':'ΠΝΕΥΜΟΝΟΛΟΓΙΚ', 'RESPIRATORY MEDICINE':'ΠΝΕΥΜΟΝΟΛΟΓΙΚ',
  'HAEMATOLOGY':'ΑΙΜΑΤΟΛΟΓΙΚ', 'HEMATOLOGY':'ΑΙΜΑΤΟΛΟΓΙΚ',
  'ENDOCRINOLOGY':'ΕΝΔΟΚΡΙΝΟΛΟΓΙΚ', 'DERMATOLOGY':'ΔΕΡΜΑΤΟΛΟΓΙΚ',
  'PSYCHIATRY':'ΨΥΧΙΑΤΡΙΚ', 'PLASTIC SURGERY':'ΠΛΑΣΤΙΚ ΧΕΙΡΟΥΡΓΙΚ',
  'VASCULAR SURGERY':'ΑΓΓΕΙΟΧΕΙΡΟΥΡΓΙΚ', 'THORACIC SURGERY':'ΘΩΡΑΚΟΧΕΙΡΟΥΡΓΙΚ',
  'INTENSIVE CARE UNIT':'ΜΕΘ', 'INTENSIVE CARE':'ΜΕΘ',
};

export function clinicKey(name){
  let s=String(name??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();
  s=s.replace(/[^Α-ΩA-Z ]+/g,' ').replace(CLINIC_WRAPPERS,' ').replace(/\s+/g,' ').trim();
  if(!s) return '';
  if(SPECIALITY_SYNONYMS[s]) return SPECIALITY_SYNONYMS[s];
  return s.split(' ').map(w=>w.replace(/ΙΚ(Η|Ο|Α|ΟΣ|ΟΙ|ΕΣ|ΩΝ|ΟΥ|ΗΣ|Ε)$/,'ΙΚ')).join(' ');
}

