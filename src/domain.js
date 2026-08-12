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
