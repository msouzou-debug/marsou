/* ΟΚΥπΥ – Τιμολόγηση παραχωρήσεων και υπηρεσιών προς Υπουργεία.
   Όλη η επεξεργασία γίνεται τοπικά στον browser. */
(function () {
'use strict';

/* ---------------- βοηθητικά ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const MONTHS = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];

const fmtEUR = n => (Number(n) || 0).toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = n => (Number(n) || 0).toLocaleString('el-GR', { maximumFractionDigits: 3 });
const fmtPrice = n => (Number(n) || 0).toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const monthLabel = ym => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
const lastDayOfMonth = ym => { const [y, m] = ym.split('-').map(Number); return `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isoToSerial = iso => { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };

/* Αριθμοί: δέχεται 1.234,56 · 1,234.56 · 0,0365 · 2.000 */
function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).replace(/[€\s ]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/\d/.test(s)) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) {
    s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lc > -1) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (ld > -1 && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // 2.000 = δύο χιλιάδες (ελληνική μορφή)
  }
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/* Κελί Excel σε μορφή κειμένου: η τελεία είναι δεκαδική (π.χ. '0.347', '5.70') */
function parseNumX(v) {
  if (typeof v === 'string' && !v.includes(',')) {
    const t = v.replace(/[€\s\u00a0]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  }
  return parseNum(v);
}

/* Ημερομηνίες από Excel (σειριακός αριθμός) ή κείμενο */
function toISO(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  return '';
}

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/* ---------------- ρυθμίσεις ---------------- */
const DEFAULT_SETTINGS = {
  org: {
    address: 'Αγίου Αντωνίου 2\n2100 Αγλαντζιά, Λευκωσία\nΚύπρος\nΤηλ.: 22212800 , Φαξ: 22665100\nΑρ. Εγγρ. Φ.Π.Α : 18007761X\nΑρ. Φορολ. Ταυτ: 18007761X',
    bank1: '‘’ΟΚΥπΥ – Κεντρική Διοίκηση‘’',
    bank2: "STATE HEALTH SERVICES ORGANIZATION 'INCOME - HEAD OFFICE'",
    iban: 'CY04 0020 0195 0000 3570 3049 6766',
    swift: 'BCYPCY2N',
    signName: 'Μάριος Σούζου',
    signTitle: 'Προϊστάμενος Μονάδας Οικονομικής Διαχείρισης',
    signUnit: 'Κεντρική Διοίκηση',
    signOrg: 'Οργανισμός Κρατικών Υπηρεσιών Υγείας (ΟΚΥπΥ)',
    bankAmb1: '‘’ΟΚΥπΥ – Υπηρεσία Ασθενοφόρων‘’',
    bankAmb2: "STATE HEALTH SERVICES ORGANIZATION 'INCOME - AMBULATORY'",
    ibanAmb: 'CY30 0020 0195 0000 3570 3270 8868'
  },
  oay: {
    oayAccount: '901786',
    yaAnnual: 17500677.65,
    hospitals: [{ vendor: 'F1025', short: 'PAF', account: '122107' }, { vendor: 'F1026', short: 'POL', account: '122108' }, { vendor: 'F1047', short: 'LIM', account: '122105' }, { vendor: 'F1048', short: 'LAR', account: '122104' }, { vendor: 'F1049', short: 'PAR', account: '122103' }, { vendor: 'F1054', short: 'NGH', account: '122102' }, { vendor: 'F1055', short: 'KYP', account: '122106' }, { vendor: 'F1106', short: 'NGH', account: '122102' }],
    ygosLines: [
      { desc: 'Κέντρο Παιδιατρικής Ογκολογίας και Αιματολογίας', amount: 127669.83 },
      { desc: 'Κέντρο Θαλασσαιμίας σε κάθε πόλη', amount: 105352.51 },
      { desc: 'Μεταμοσχευτική Κλινική', amount: 95749.43 },
      { desc: 'Κέντρο Τραύματος', amount: 90428.05 },
      { desc: 'Μονάδα Εντατικής Νοσηλείας Παίδων - ΝΑΜΙΙΙ', amount: 63144.15 },
      { desc: 'Μονάδα παρεντερικής διατροφής', amount: 44053.64 },
      { desc: 'Κέντρο για Παιδιά και Εφήβους με Νευροαναπτυξιακή Διαταραχή', amount: 39160.93 },
      { desc: 'Παιδιατρικό ήπαρ, γαστρεντερικό και διατροφικό κέντρο στο NAM III', amount: 37867.03 },
      { desc: 'Μηχανική υποστήριξη κατοίκον ασθενών', amount: 159480.52 },
      { desc: 'Εργαστήριο Ιστοσυμβατότητας για να διατηρηθεί ενημερωμένη η λίστα παραληπτών οργάνων', amount: 17305.66 },
      { desc: 'Κλινική AIDS', amount: 167787.59 },
      { desc: 'ΤΑΕΠ Παίδων', amount: 293598.76 },
      { desc: 'Κέντρο Ανάκτησης Νευρολογικών Βλαβών (Παραπληγικό Κέντρο)', amount: 129085.39 },
      { desc: 'Κλινική Εγκαυμάτων', amount: 2408.51 },
      { desc: 'Παιδονευρολογικη Κλινικη - ΝΑΜΙΙΙ', amount: 23935.89 },
      { desc: 'Υπηρεσίες Ψυχικής Υγείας', amount: 508905.84 },
      { desc: 'Αγροτικό Νοσοκομείο Κυπερούντας', amount: 646095.83 },
      { desc: 'Υπηρεσίες που παρέχονται από το Νοσοκομείο Πολεως Χρυσοχούς', amount: 279623.38 },
      { desc: 'Κέντρα Πρωτοβάθμιας φροντίδας', amount: 401459.28 }
    ]
  },
  sap: { companyCode: '1000', docType: 'DR', currency: 'EUR', pkDebit: '01', pkCredit: '50', taxCode: '', glAdmin: '', glVat: '', taxCodeAdmin: '' },
  fees: { adminRate: 20, vatRate: 19 },
  types: {
    FA: { prefix: 'ΦΑ', title: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΑΧΩΡΗΣΗΣ ΦΑΡΜΑΚΩΝ', gl: '', label: 'Παραχώρηση φαρμάκων' },
    TPA: { prefix: 'ΤΠΑ', title: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΑΧΩΡΗΣΗΣ ΑΝΑΛΩΣΙΜΩΝ', gl: '', label: 'Παραχώρηση αναλωσίμων' },
    TA: { prefix: 'ΤΑ', title: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', gl: '', label: 'Υπηρεσίες Τράπεζας Αίματος' },
    INV: { prefix: 'INV', title: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', gl: '', label: 'Υπηρεσίες Κέντρου Αίματος' },
    TAEP: { prefix: 'ΤΑΕΠ', title: 'ΤΙΜΟΛΟΓΙΟ ΜΗΝΙΑΙΩΝ ΕΜΒΑΣΜΑΤΩΝ ΓΙΑ ΤΙΣ ΥΠΗΡΕΣΙΕΣ ΤΑΕΠ ΤΟΥ ΟΚΥΠΥ', gl: '', label: 'Εμβάσματα ΤΑΕΠ', numFmt: '{P} {MM}/{YYYY}' },
    YGOS: { prefix: 'ΥΓΟΣ', title: 'ΤΙΜΟΛΟΓΙΟ ΥΠΗΡΕΣΙΩΝ ΥΓΟΣ', gl: '', label: 'Υπηρεσίες ΥΓΟΣ', numFmt: '{P} {MM}-{YYYY}' },
    YA: { prefix: 'YA', title: 'ΤΙΜΟΛΟΓΙΟ ΜΗΝΙΑΙΩΝ ΕΜΒΑΣΜΑΤΩΝ ΓΙΑ ΤΙΣ ΥΠΗΡΕΣΙΕΣ ΑΣΘΕΝΟΦΟΡΩΝ ΤΟΥ ΟΚΥΠΥ', gl: '', label: 'Εμβάσματα Υπηρεσίας Ασθενοφόρων', numFmt: '{P} {MM}/{YYYY}', bank: 'amb' }
  },
  customers: [
    { id: 'c01', admin: true, name: 'ΙΝΣΤΙΤΟΥΤΟ ΝΕΥΡΟΛΟΓΙΑΣ ΚΑΙ ΓΕΝΕΤΙΚΗΣ', sub: '', types: ['FA'], sapCode: '', profit: '', kw: 'ΙΝΣΤΙΤΟΥΤ, ΓΕΝΕΤΙΚ, NEUROLOGY' },
    { id: 'c02', admin: true, name: 'ΥΠΟΥΡΓΕΙΟ ΑΜΥΝΑΣ', sub: '(ΕΘΝΙΚΗ ΦΡΟΥΡΑ)', types: ['FA'], sapCode: '', profit: '', kw: 'ΣΤΡΑΤΟΣ, ΕΘΝΙΚΗ ΦΡΟΥΡΑ' },
    { id: 'c03', admin: true, name: 'ΥΠΟΥΡΓΕΙΟ ΔΙΚΑΙΟΣΥΝΗΣ ΚΑΙ ΔΗΜΟΣΙΑΣ ΤΑΞΕΩΣ', sub: '(ΦΥΛΑΚΕΣ)', types: ['FA'], sapCode: '', profit: '', kw: 'ΦΥΛΑΚ, FYLAK, PRISON' },
    { id: 'c04', admin: false, name: 'ΥΠΟΥΡΓΕΙΟ ΥΓΕΙΑΣ', sub: '(ΟΔΟΝΤΙΑΤΡΙΚΕΣ ΥΠΗΡΕΣΙΕΣ)', types: ['FA', 'TPA'], sapCode: '', profit: '', kw: 'ΟΔΟΝΤ, ODONT' },
    { id: 'c05', admin: true, name: 'ΟΓΚΟΛΟΓΙΚΟ ΚΕΝΤΡΟ ΤΡΑΠΕΖΑΣ ΚΥΠΡΟΥ', sub: '', types: ['FA', 'TPA'], sapCode: '', profit: '', kw: 'ΟΓΚΟΛΟΓ, ONCOL' },
    { id: 'c06', admin: false, name: 'ΥΠΟΥΡΓΕΙΟ ΥΓΕΙΑΣ', sub: '(ΑΡΟΔΑΦΝΟΥΣΑ-ΚΕΝΤΡΟ ΑΝΑΚΟΥΦΙΣΤΙΚΗΣ ΦΡΟΝΤΙΔΑΣ)', types: ['FA', 'TPA'], sapCode: '', profit: '', kw: 'ΑΡΟΔΑΦΝ, ARODAFN' },
    { id: 'c07', admin: true, name: 'ΥΠΟΥΡΓΕΙΟ ΑΜΥΝΑΣ', sub: '(106 ΣΝΕ)', types: ['TPA'], sapCode: '', profit: '', kw: '106 ΣΝΕ, 106ΣΝΕ' },
    { id: 'c08', admin: true, name: 'ΥΠΟΥΡΓΕΙΟ ΑΜΥΝΑΣ', sub: '(ΑΠΟΘΗΚΗ ΒΑΣΕΩΝ)', types: ['TPA'], sapCode: '', profit: '', kw: 'ΑΠΟΘΗΚΗ ΒΑΣΕ, ΒΑΣΕΩΝ' },
    { id: 'c09', admin: false, name: 'ΥΠΟΥΡΓΕΙΟ ΥΓΕΙΑΣ', sub: '(ΚΕΝΤΡΟ ΑΙΜΑΤΟΣ)', types: ['TPA'], sapCode: '', profit: '', kw: 'ΚΕΝΤΡΟ ΑΙΜΑΤ' },
    { id: 'c10', admin: false, name: 'ΥΠΟΥΡΓΕΙΟ ΥΓΕΙΑΣ', sub: '', types: ['TPA'], sapCode: '', profit: '', kw: 'ΥΠΟΥΡΓΕΙΟ ΥΓΕΙΑΣ, ΥΠ.ΥΓΕΙΑΣ, ΥΠ. ΥΓΕΙΑΣ' },
    { id: 'c11', admin: false, name: 'ΙΑΤΡΙΚΕΣ ΥΠΗΡΕΣΙΕΣ', sub: '(για Τράπεζα Αίματος)', types: ['TA'], sapCode: '', profit: '', kw: 'ΤΡΑΠΕΖΑ ΑΙΜΑΤ, BLOOD BANK' },
    { id: 'c12', admin: false, name: 'ΥΠΟΥΡΓΕΙΟ ΥΓΕΙΑΣ', sub: '(για Κέντρο Αίματος)', types: ['INV'], sapCode: '', profit: '', kw: 'ΚΕΝΤΡΟ ΑΙΜΑΤ, BLOOD CENTRE, BLOOD CENTER' },
    { id: 'c13', admin: false, name: 'ΟΡΓΑΝΙΣΜΟ ΑΣΦΑΛΙΣΗΣ ΥΓΕΙΑΣ', sub: '', types: ['TAEP', 'YGOS', 'YA'], sapCode: '901786', profit: '', kw: 'ΟΡΓΑΝΙΣΜΟΣ ΑΣΦΑΛΙΣΗΣ ΥΓΕΙΑΣ, ΟΑΥ, HIO' }
  ]
};
const K_SET = 'okypy-inv-settings-v1', K_REG = 'okypy-inv-register-v1';

function loadSettings() {
  const s = LS.get(K_SET, null);
  if (!s) return clone(DEFAULT_SETTINGS);
  const d = clone(DEFAULT_SETTINGS);
  return {
    org: Object.assign(d.org, s.org || {}),
    sap: Object.assign(d.sap, s.sap || {}),
    types: Object.fromEntries(Object.keys(d.types).map(k => [k, Object.assign(d.types[k], (s.types || {})[k] || {})])),
    fees: Object.assign(d.fees, s.fees || {}),
    oay: Object.assign(d.oay, s.oay || {}),
    customers: (Array.isArray(s.customers) && s.customers.length ? s.customers : d.customers)
      .map(c => ('admin' in c) ? c : Object.assign(c, { admin: defaultAdmin(c) }))
      .concat((Array.isArray(s.customers) && s.customers.length && !s.customers.some(c => (c.types || []).includes('TAEP'))) ? d.customers.filter(c => c.id === 'c13') : [])
  };
}
/* Διοικητικά έξοδα: σε όλους εκτός από το Υπουργείο Υγείας (και όχι στις υπηρεσίες ΤΑ/INV) */
function defaultAdmin(c) {
  return !norm(c.name).startsWith('ΥΠΟΥΡΓΕΙΟ ΥΓΕΙΑΣ') && !(c.types || []).some(t => ['TA', 'INV', 'TAEP', 'YGOS', 'YA'].includes(t)) && norm(c.name) !== 'ΙΑΤΡΙΚΕΣ ΥΠΗΡΕΣΙΕΣ';
}
let SETTINGS = loadSettings();
let REGISTER = LS.get(K_REG, []);
const saveRegister = () => { if (!LS.set(K_REG, REGISTER)) alert('Δεν ήταν δυνατή η αποθήκευση του μητρώου στον browser. Κατεβάστε αντίγραφο ασφαλείας.'); updateRegCount(); };

const getCust = id => SETTINGS.customers.find(c => c.id === id);
const custLabel = c => c ? (c.name + (c.sub ? ' ' + c.sub : '')) : '';
const custFileLabel = c => c ? (c.name + (c.sub ? '-' + c.sub.replace(/^\(|\)$/g, '').replace(/^για\s+/i, '') : '')) : '';
const typeOf = t => SETTINGS.types[t];

function matchCustomer(text, type) {
  const T = norm(text);
  let best = null, bestLen = 0;
  for (const c of SETTINGS.customers) {
    if (type && !(c.types || []).includes(type)) continue;
    for (const k of String(c.kw || '').split(',').map(norm).filter(Boolean)) {
      if (k.length > bestLen && T.includes(k)) { best = c; bestLen = k.length; }
    }
  }
  return best ? best.id : '';
}

/* ---------------- πρόχειρα τιμολόγια ---------------- */
const DRAFTS = { FA: [], TPA: [], SRV: [], OAY: [] };
const groupOf = type => (type === 'TA' || type === 'INV') ? 'SRV' : ['TAEP', 'YGOS', 'YA'].includes(type) ? 'OAY' : type;
const isIssued = d => REGISTER.some(r => r.id === d.id);

function lineAmount(l, type) {
  if (type === 'TPA') {
    const q = Number(l.qty) || 0, p = Number(l.price) || 0;
    return round2(q * p);
  }
  return round2(Number(l.amount) || 0);
}
const custOf = d => d.customer || getCust(d.customerId);
const adminApplies = d => (d.adminOverride != null ? !!d.adminOverride : !!(custOf(d) || {}).admin);
function totals(d) {
  const net = round2(d.lines.reduce((s, l) => s + lineAmount(l, d.type), 0));
  const r = d.rates || SETTINGS.fees, on = adminApplies(d);
  const adminRate = Number(r.adminRate) || 0, vatRate = Number(r.vatRate) || 0;
  const admin = on ? round2(net * adminRate / 100) : 0;
  const vat = on ? round2(admin * vatRate / 100) : 0;
  return { net, admin, vat, total: round2(net + admin + vat), on, adminRate, vatRate };
}
const draftTotal = d => totals(d).total;
function applySlipDate(d, iso) {
  d.slipDate = iso;
  if (!iso) return;
  d.lines.forEach(l => { l.date = iso; });
  d.date = iso;
}
const remarkText = d => [d.type === 'TPA' && String(d.slipNo || '').trim() ? `Issue Slip ${String(d.slipNo).trim()} ημ. ${fmtDate(d.slipDate || d.date)}` : '', String(d.remarks || '').trim()].filter(Boolean).join('\n');

function validate(d) {
  const errors = [], warns = [];
  const T = typeOf(d.type), c = getCust(d.customerId);
  const num = String(d.number || '').trim();
  if (!c) errors.push('Δεν έχει επιλεγεί πελάτης.');
  if (!num) errors.push('Λείπει ο αριθμός τιμολογίου.');
  else {
    if (REGISTER.some(r => r.id !== d.id && norm(r.number) === norm(num))) errors.push(`Ο αριθμός «${num}» υπάρχει ήδη στο μητρώο.`);
    if (!norm(num).startsWith(norm(T.prefix))) warns.push(`Ο αριθμός δεν ξεκινά με «${T.prefix}».`);
  }
  if (!d.date) errors.push('Λείπει η ημερομηνία τιμολογίου.');
  if (!d.lines.length) errors.push('Το τιμολόγιο δεν έχει γραμμές.');
  const tot = draftTotal(d);
  if (d.lines.length && tot <= 0) errors.push('Το ολικό ποσό είναι μηδέν ή αρνητικό.');
  if (d.lines.some(l => !String(l.desc || '').trim())) warns.push('Υπάρχουν γραμμές χωρίς περιγραφή.');
  if (d.lines.some(l => lineAmount(l, d.type) === 0) && !isOay(d.type)) warns.push('Υπάρχουν γραμμές με μηδενικό ποσό.');
  if (d.sourceKey) {
    const prev = REGISTER.find(r => r.id !== d.id && r.sourceKey === d.sourceKey);
    if (prev) warns.push(`Η ίδια πηγή (${d.sourceLabel}) έχει ήδη τιμολογηθεί με το ${prev.number}. Ελέγξτε για διπλοχρέωση.`);
  }
  if (c && !c.sapCode) warns.push('Ο πελάτης δεν έχει κωδικό SAP (Ρυθμίσεις). Το αρχείο SAP θα βγει με κενό λογαριασμό.');
  if (!T.gl) warns.push(`Δεν έχει οριστεί λογαριασμός εσόδων για «${T.prefix}» (Ρυθμίσεις).`);
  if (d.type === 'TAEP' && !(d.alloc || []).length) warns.push('Δεν υπάρχει κατανομή στα νοσηλευτήρια (ανεβάστε το αρχείο του ΟΑΥ).');
  if (d.type === 'TPA' && !String(d.slipNo || '').trim()) warns.push('Δεν συμπληρώθηκε αριθμός Issue Slip για τις παρατηρήσεις.');
  return { errors, warns, total: tot };
}

function issueDraft(d) {
  const v = validate(d);
  if (v.errors.length) { alert('Δεν μπορεί να εκδοθεί:\n\n• ' + v.errors.join('\n• ')); return false; }
  if (v.warns.some(w => w.includes('διπλοχρέωση')) && !confirm(v.warns.find(w => w.includes('διπλοχρέωση')) + '\n\nΣυνέχεια;')) return false;
  const rec = clone(d);
  rec.number = String(d.number).trim();
  rec.customer = clone(getCust(d.customerId));
  rec.rates = { adminRate: Number(SETTINGS.fees.adminRate) || 0, vatRate: Number(SETTINGS.fees.vatRate) || 0 };
  rec.adminOverride = adminApplies(d);
  rec.total = totals(rec).total;
  rec.issuedAt = new Date().toISOString();
  rec.exported = false;
  REGISTER.push(rec);
  saveRegister();
  renderAllLists();
  return true;
}

/* ---------------- ανάγνωση αρχείων ---------------- */
function fixRange(ws) {
  let maxR = 0, maxC = 0, any = false;
  for (const k in ws) {
    if (k[0] === '!') continue;
    const c = XLSX.utils.decode_cell(k); any = true;
    if (c.r > maxR) maxR = c.r; if (c.c > maxC) maxC = c.c;
  }
  ws['!ref'] = any ? XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } }) : 'A1:A1';
}
async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const sheets = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name]; fixRange(ws);
    return { name, rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false }) };
  });
  return sheets;
}

/* Εξαγωγή SAP κινήσεων υλικού (MB51) */
function detectSap(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = (rows[i] || []).map(x => norm(x));
    const idx = name => h.findIndex(x => x === name);
    const find = re => h.findIndex(x => re.test(x));
    const c = {
      material: idx('MATERIAL'),
      desc: idx('MATERIAL DESCRIPTION'),
      mvt: idx('MOVEMENT TYPE'),
      doc: idx('MATERIAL DOCUMENT'),
      item: find(/^MATERIAL DOC\.?\s?ITEM$/),
      date: idx('POSTING DATE'),
      qty: find(/^(QTY|QUANTITY)/),
      unit: find(/^UNIT OF ENTRY$/),
      batch: idx('BATCH'),
      amount: find(/^(AMT|AMOUNT)/),
      header: idx('DOCUMENT HEADER TEXT'),
      text: idx('TEXT')
    };
    if (c.desc > -1 && c.date > -1 && c.amount > -1) return { headerRow: i, cols: c };
  }
  return null;
}
function parseSapLines(rows, det) {
  const c = det.cols, out = [];
  for (let i = det.headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const desc = r[c.desc];
    const date = toISO(r[c.date]);
    const amt = parseNumX(r[c.amount]);
    if (desc == null || String(desc).trim() === '' || !date || amt == null) continue;
    const qty = c.qty > -1 ? parseNumX(r[c.qty]) : null;
    out.push({
      material: c.material > -1 ? String(r[c.material] ?? '') : '',
      desc: String(desc).trim(),
      mvt: c.mvt > -1 ? String(r[c.mvt] ?? '') : '',
      doc: c.doc > -1 ? String(r[c.doc] ?? '') : '',
      item: c.item > -1 ? Number(r[c.item]) || 0 : 0,
      date,
      qty: qty == null ? 0 : -qty,           // οι εκδόσεις στο SAP είναι αρνητικές
      unit: c.unit > -1 ? String(r[c.unit] ?? '') : '',
      batch: c.batch > -1 ? String(r[c.batch] ?? '') : '',
      amount: round2(-amt),
      header: c.header > -1 ? String(r[c.header] ?? '') : '',
      text: c.text > -1 ? String(r[c.text] ?? '') : ''
    });
  }
  return out;
}
/* Συμψηφισμός αντιλογισμών με εκδόσεις του ίδιου υλικού/παρτίδας */
function netReversals(lines) {
  const issues = lines.filter(l => l.amount > 0).map(l => Object.assign({}, l));
  const revs = lines.filter(l => l.amount < 0);
  const zero = lines.filter(l => l.amount === 0);
  let netted = 0; const shown = [];
  for (const r of revs) {
    const rq = Math.abs(r.qty);
    const cand = issues.filter(i => i.material === r.material && i.batch === r.batch && i.qty >= rq && i.amount > 0);
    const m = cand.find(i => i.qty === rq) || cand[0];
    if (m) {
      m.qty = round2(m.qty - rq); m.amount = round2(m.amount + r.amount); netted++;
    } else shown.push(Object.assign({}, r));
  }
  const kept = issues.filter(i => !(Math.abs(i.qty) < 1e-9 && Math.abs(i.amount) < 0.005));
  const all = kept.concat(shown).concat(zero);
  all.sort((a, b) => a.date.localeCompare(b.date) || a.doc.localeCompare(b.doc) || a.item - b.item);
  return { lines: all, netted, unmatched: shown.length };
}

/* PDF → γραμμές κειμένου */
let pdfReady = null;
function pdfLib() {
  if (pdfReady) return pdfReady;
  const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  const src = $('#pdfworker').textContent;
  lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  pdfReady = lib; return lib;
}
async function readPdfLines(file) {
  const lib = pdfLib();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, s: it.str, w: it.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let s = '', end = null;
      for (const it of r.items) { s += (end != null && it.x - end > 1.5 ? '  ' : '') + it.s; end = it.x + it.w; }
      lines.push(s.replace(/\s{3,}/g, '  ').trim());
    }
  }
  return lines;
}

/* ---------------- 1. ΦΑ ---------------- */
async function handleFA(file) {
  const st = $('#FA-status');
  st.innerHTML = 'Ανάγνωση αρχείου…';
  try {
    const sheets = await readWorkbook(file);
    const drafts = []; let fileTotal = 0, skipped = [];
    for (const sh of sheets) {
      const det = detectSap(sh.rows);
      if (!det) { skipped.push(sh.name); continue; }
      const lines = parseSapLines(sh.rows, det);
      fileTotal += lines.reduce((s, l) => s + l.amount, 0);
      const byMonth = {};
      for (const l of lines) (byMonth[l.date.slice(0, 7)] ||= []).push(l);
      for (const ym of Object.keys(byMonth).sort()) {
        const net = netReversals(byMonth[ym]);
        const ctx = sh.name + ' ' + byMonth[ym].slice(0, 30).map(l => l.header + ' ' + l.text).join(' ');
        drafts.push({
          id: uid(), type: 'FA', customerId: matchCustomer(sh.name, 'FA') || matchCustomer(ctx, 'FA'),
          number: '', date: lastDayOfMonth(ym), remarks: '',
          lines: net.lines.map(l => ({ desc: l.desc, doc: l.doc, code: l.material, date: l.date, qty: l.qty, amount: l.amount })),
          sourceKey: `FA|${norm(sh.name)}|${ym}`, sourceLabel: `${sh.name} · ${monthLabel(ym)}`,
          sheet: sh.name, month: ym, netted: net.netted, unmatched: net.unmatched, fileName: file.name
        });
      }
    }
    DRAFTS.FA = drafts;
    const dTot = drafts.reduce((s, d) => s + totals(d).net, 0);
    const ok = Math.abs(round2(fileTotal) - round2(dTot)) < 0.01;
    st.innerHTML = drafts.length
      ? `<span class="ok">Διαβάστηκαν ${drafts.length} τιμολόγια από «${esc(file.name)}».</span><br>
         Σύνολο αρχείου: <b>${fmtEUR(fileTotal)} €</b> · Καθαρή αξία τιμολογίων: <b>${fmtEUR(dTot)} €</b>
         ${ok ? '<span class="ok">✓ συμφωνούν</span>' : '<span class="err">✗ διαφορά ' + fmtEUR(fileTotal - dTot) + ' €</span>'}
         ${skipped.length ? `<br><span class="warn">Καρτέλες χωρίς στήλες SAP (παραλείφθηκαν): ${esc(skipped.join(', '))}</span>` : ''}`
      : `<span class="err">Δεν βρέθηκαν στήλες SAP (Material Description, Posting Date, Amt.in loc.cur.) σε καμία καρτέλα.</span>`;
    renderList('FA');
  } catch (e) {
    console.error(e); st.innerHTML = `<span class="err">Σφάλμα ανάγνωσης: ${esc(e.message)}</span>`;
  }
}

/* ---------------- 2. ΤΠΑ ---------------- */
let TPA_PENDING = null;
const FIELD_RE = {
  desc: /(ΠΕΡΙΓΡΑΦ|DESCRIPTION|ΠΡΟΪΟΝ|ΠΡΟΙΟΝ|ΕΙΔΟΣ|ΥΛΙΚΟ|ITEM NAME|ΟΝΟΜΑΣΙΑ)/,
  qty: /(ΠΟΣΟΤ|QTY|QUANT|ΤΕΜΑΧ)/,
  price: /(ΤΙΜΗ|PRICE|UNIT COST|ΚΟΣΤΟΣ ΜΟΝ)/,
  amount: /(ΚΑΘΑΡΟ|ΠΟΣΟ|ΣΥΝΟΛΟ|AMOUNT|VALUE|TOTAL|ΑΞΙΑ|ΤΕΛΙΚΗ|[ΜM][ΕE] Φ\.?Π\.?Α)/,
  date: /(ΗΜΕΡ|DATE)/,
  doc: /(ISSUE|SLIP|ΕΓΓΡΑΦ|DOCUMENT|ΔΕΛΤΙΟ|ΑΡ\. ?ΠΑΡ)/
};
const FIELD_LABEL = { desc: 'Περιγραφή *', qty: 'Ποσότητα', price: 'Τιμή μονάδας', amount: 'Ποσό', date: 'Ημερομηνία παράδοσης', doc: 'Αρ. εγγράφου / Issue slip' };

function guessHeader(rows) {
  let best = { row: 0, score: 0, map: {} };
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = (rows[i] || []).map(x => typeof x === 'string' ? norm(x) : '');
    const map = {}; let score = 0; const used = new Set();
    for (const f of ['desc', 'qty', 'price', 'date', 'doc', 'amount']) {
      const j = h.findIndex((x, k) => x && !used.has(k) && FIELD_RE[f].test(x));
      if (j > -1) { map[f] = j; used.add(j); score++; }
    }
    if (score > best.score) best = { row: i, score, map };
  }
  return best;
}

/* Γραμμές από Excel με γνωστές στήλες. Αν υπάρχει στήλη συνόλου, αυτή κρατά το ποσό (τιμή = σύνολο / ποσότητα). */
function buildGenericLines(sh, hr, map) {
  const lines = []; let fileTotal = null;
  const top = sh.rows.slice(0, hr + 1).flat().filter(x => typeof x === 'string').join(' ');
  const mTop = top.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{4})/);
  const sheetDate = mTop ? toISO(mTop[1]) : '';
  for (let i = hr + 1; i < sh.rows.length; i++) {
    const r = sh.rows[i] || [];
    const rowTxt = norm(r.filter(x => typeof x === 'string').join(' '));
    const desc = String(r[map.desc] ?? '').trim();
    if (/^(ΣΥΝΟΛΟ|ΟΛΙΚΟ|TOTAL|ΓΕΝΙΚΟ)/.test(rowTxt) || /^(ΣΥΝΟΛΟ|ΟΛΙΚΟ|TOTAL|ΓΕΝΙΚΟ)/.test(norm(desc))) {
      if (map.amount > -1 && fileTotal == null) fileTotal = parseNumX(r[map.amount]);
      continue;
    }
    if (!desc) continue;
    let qty = map.qty > -1 ? parseNumX(r[map.qty]) : null;
    let price = map.price > -1 ? parseNumX(r[map.price]) : null;
    const amount = map.amount > -1 ? parseNumX(r[map.amount]) : null;
    if (qty == null && price == null && amount == null) continue;
    if (qty == null) qty = 1;
    if (amount != null && qty) price = amount / qty;
    else if (price == null) price = amount || 0;
    lines.push({ desc, qty, price: price || 0, date: (map.date > -1 ? toISO(r[map.date]) : '') || sheetDate, doc: map.doc > -1 ? String(r[map.doc] ?? '') : '', amountSrc: amount });
  }
  const sumSrc = lines.reduce((a, l) => a + (l.amountSrc != null ? l.amountSrc : l.qty * l.price), 0);
  return { lines, fileTotal, sumSrc, sheetDate };
}
function totalCheckMsg(name, res) {
  if (res.fileTotal == null) return '';
  return Math.abs(round2(res.fileTotal) - round2(res.sumSrc)) >= 0.01
    ? `<br><span class="err">«${esc(name)}»: το σύνολο του αρχείου (${fmtEUR(res.fileTotal)} €) δεν συμφωνεί με το άθροισμα των γραμμών (${fmtEUR(res.sumSrc)} €). Πιθανόν ο τύπος SUM στο αρχείο δεν πιάνει όλες τις γραμμές. Το τιμολόγιο περιλαμβάνει όλες τις γραμμές.</span>`
    : `<br><span class="ok">«${esc(name)}»: το σύνολο του αρχείου συμφωνεί με τις γραμμές (${fmtEUR(res.sumSrc)} €).</span>`;
}

async function handleTPA(file) {
  const st = $('#TPA-status'); $('#TPA-map').innerHTML = '';
  st.innerHTML = 'Ανάγνωση αρχείου…';
  try {
    if (/\.pdf$/i.test(file.name)) return handleTPAPdf(file);
    const sheets = await readWorkbook(file);
    let made = 0;
    for (const sh of sheets) {
      const det = detectSap(sh.rows);
      if (!det) continue;
      const lines = parseSapLines(sh.rows, det);
      if (!lines.length) continue;
      const net = netReversals(lines);
      DRAFTS.TPA.push(makeTPADraft(file.name, sh.name, net.lines.map(l => ({
        desc: l.desc, date: l.date, qty: l.qty, price: l.qty ? l.amount / l.qty : l.amount, doc: l.doc
      })), sh.name + ' ' + lines.slice(0, 20).map(l => l.header + ' ' + l.text).join(' ')));
      made++;
    }
    if (made) {
      st.innerHTML = `<span class="ok">Αναγνωρίστηκε εξαγωγή SAP. Δημιουργήθηκαν ${made} τιμολόγια.</span>`;
      renderList('TPA'); return;
    }
    // Μορφή αιτήματος αναλωσίμων (π.χ. 24.1029): τιμή χωρίς ΦΠΑ και τελική τιμή με ΦΠΑ
    let msgs = '';
    for (const sh of sheets) {
      const g = guessHeader(sh.rows), h = (sh.rows[g.row] || []).map(norm);
      if (g.map.desc == null || g.map.qty == null || g.map.amount == null) continue;
      if (!/ΧΩΡΙΣ/.test(h[g.map.price] || '') || !/[ΜM][ΕE] Φ/.test(h[g.map.amount] || '')) continue;
      const res = buildGenericLines(sh, g.row, Object.assign({ price: -1, date: -1, doc: -1 }, g.map));
      if (!res.lines.length) continue;
      const ctx = file.name + ' ' + sh.name + ' ' + sh.rows.slice(0, g.row).map(r => (r || []).join(' ')).join(' ');
      DRAFTS.TPA.push(makeTPADraft(file.name, sh.name, res.lines, ctx));
      made++; msgs += totalCheckMsg(sh.name, res);
    }
    if (made) {
      st.innerHTML = `<span class="ok">Αναγνωρίστηκε αίτημα αναλωσίμων. Δημιουργήθηκαν ${made} τιμολόγια (ένα ανά καρτέλα). Τιμή μονάδας = τελική τιμή με ΦΠΑ / ποσότητα.</span>${msgs}
        <br>Συμπληρώστε σε κάθε τιμολόγιο τον αριθμό Issue Slip και την ημερομηνία έκδοσης.`;
      renderList('TPA'); return;
    }
    // Γενικό Excel: επιλογή στηλών
    TPA_PENDING = { file, sheets };
    st.innerHTML = '<span class="warn">Το αρχείο δεν είναι εξαγωγή SAP. Επιλέξτε τις στήλες και πατήστε «Δημιουργία τιμολογίου».</span>';
    renderTPAMap(0);
  } catch (e) {
    console.error(e); st.innerHTML = `<span class="err">Σφάλμα ανάγνωσης: ${esc(e.message)}</span>`;
  }
}

function renderTPAMap(sheetIdx) {
  const P = TPA_PENDING; const sh = P.sheets[sheetIdx];
  const g = guessHeader(sh.rows);
  const hdr = sh.rows[g.row] || [];
  const ncol = Math.max(...sh.rows.slice(0, 60).map(r => (r || []).length), hdr.length);
  const colOpts = sel => '<option value="-1">—</option>' + Array.from({ length: ncol }, (_, j) =>
    `<option value="${j}" ${sel === j ? 'selected' : ''}>${XLSX.utils.encode_col(j)}: ${esc(String(hdr[j] ?? '').slice(0, 30))}</option>`).join('');
  $('#TPA-map').innerHTML = `
    <div class="mapgrid">
      <label>Καρτέλα<select id="map-sheet">${P.sheets.map((s, i) => `<option value="${i}" ${i === sheetIdx ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label>Γραμμή επικεφαλίδων<input id="map-row" type="number" min="1" value="${g.row + 1}" style="width:90px"></label>
      ${Object.keys(FIELD_LABEL).map(f => `<label>${FIELD_LABEL[f]}<select data-f="${f}">${colOpts(g.map[f] ?? -1)}</select></label>`).join('')}
    </div>
    <div class="row-actions"><button class="btn primary" id="map-go">Δημιουργία τιμολογίου</button></div>
    <details><summary>Πρώτες γραμμές αρχείου</summary><pre>${esc(sh.rows.slice(0, 25).map((r, i) => (i + 1) + ': ' + (r || []).map(x => x ?? '').join(' | ')).join('\n'))}</pre></details>`;
  $('#map-sheet').onchange = e => renderTPAMap(+e.target.value);
  $('#map-go').onclick = () => {
    const map = {}; $$('#TPA-map select[data-f]').forEach(s => map[s.dataset.f] = +s.value);
    if (map.desc < 0) { alert('Επιλέξτε τη στήλη περιγραφής.'); return; }
    const hr = Math.max(0, (+$('#map-row').value || 1) - 1);
    const res = buildGenericLines(sh, hr, map), lines = res.lines;
    if (!lines.length) { alert('Δεν βρέθηκαν γραμμές με αυτές τις στήλες.'); return; }
    const ctx = P.file.name + ' ' + sh.name + ' ' + sh.rows.slice(0, 15).map(r => (r || []).join(' ')).join(' ');
    DRAFTS.TPA.push(makeTPADraft(P.file.name, sh.name, lines, ctx));
    $('#TPA-status').innerHTML = `<span class="ok">Δημιουργήθηκε τιμολόγιο με ${lines.length} γραμμές. Ελέγξτε το στο «Άνοιγμα».</span>${totalCheckMsg(sh.name, res)}`;
    $('#TPA-map').innerHTML = ''; TPA_PENDING = null;
    renderList('TPA');
  };
}

function makeTPADraft(fileName, sheetName, lines, ctx) {
  const dates = lines.map(l => l.date).filter(Boolean).sort();
  const docs = [...new Set(lines.map(l => l.doc).filter(Boolean))];
  const lastDate = dates[dates.length - 1] || '';
  return {
    id: uid(), type: 'TPA', customerId: matchCustomer(ctx, 'TPA'),
    number: '', date: lastDate || todayISO(),
    remarks: '', slipNo: docs.join(', '), slipDate: lastDate,
    lines: lines.map(l => ({ desc: l.desc, date: l.date || lastDate, qty: l.qty, price: l.price, doc: l.doc || '' })),
    sourceKey: `TPA|${norm(fileName)}|${norm(sheetName)}`, sourceLabel: `${fileName} · ${sheetName}`, fileName
  };
}

async function handleTPAPdf(file) {
  const st = $('#TPA-status');
  const lines = await readPdfLines(file);
  if (!lines.length) {
    st.innerHTML = '<span class="err">Το PDF δεν έχει αναγνώσιμο κείμενο (πιθανόν σαρωμένο). Ξεκινήστε κενό τιμολόγιο και περάστε τις γραμμές χειροκίνητα.</span>';
    return;
  }
  const re = /^(.*?[A-Za-zΑ-Ωα-ωά-ώ].*?)\s+(?:(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s+)?(-?[\d.,]+)\s+(-?[\d.,]+)\s+(-?[\d.,]+)$/;
  const out = [];
  for (const ln of lines) {
    const m = ln.match(re);
    if (!m || /^(ΣΥΝΟΛΟ|ΟΛΙΚΟ|TOTAL)/.test(norm(m[1]))) continue;
    const qty = parseNum(m[3]), price = parseNum(m[4]), amt = parseNum(m[5]);
    if (qty == null || price == null) continue;
    out.push({ desc: m[1].trim(), date: toISO(m[2]), qty, price: (amt != null && qty) ? amt / qty : price });
  }
  const text = lines.join('\n');
  DRAFTS.TPA.push(makeTPADraft(file.name, 'PDF', out, file.name + ' ' + text.slice(0, 1500)));
  st.innerHTML = `<span class="${out.length ? 'ok' : 'warn'}">Από το PDF βρέθηκαν ${out.length} γραμμές (περιγραφή, ποσότητα, τιμή, ποσό). Η ανάγνωση PDF είναι προσεγγιστική: ελέγξτε κάθε γραμμή.</span>
    <details><summary>Κείμενο PDF</summary><pre>${esc(text)}</pre></details>`;
  renderList('TPA');
}

/* ---------------- 3. Υπηρεσίες ---------------- */
function makeSRVDraft(type, opts = {}) {
  const ref = opts.ref ? ` αρ. ${opts.ref}` : '';
  const desc = type === 'TA'
    ? `Ιατρικές υπηρεσίες για την Τράπεζα Αίματος, βάσει τιμολογίου One Point${ref}`
    : `Υπηρεσίες για το Κέντρο Αίματος, βάσει τιμολογίου One Point${ref}`;
  return {
    id: uid(), type, customerId: SETTINGS.customers.find(c => (c.types || []).includes(type))?.id || '',
    number: '', date: todayISO(),
    remarks: opts.ref ? `Τιμολόγιο One Point αρ. ${opts.ref}${opts.refDate ? ' ημ. ' + fmtDate(opts.refDate) : ''}` : '',
    lines: [{ desc, amount: opts.amount || 0 }],
    sourceKey: opts.ref ? `SRV|ONEPOINT|${norm(opts.ref)}` : '', sourceLabel: opts.ref ? `One Point ${opts.ref}` : 'Χειροκίνητο',
    fileName: opts.fileName || '', pdfUrl: opts.pdfUrl || ''
  };
}

async function handleSRV(file) {
  const st = $('#SRV-status');
  st.innerHTML = 'Ανάγνωση αρχείου…';
  try {
    let lines = [];
    let pdfUrl = '';
    if (/\.pdf$/i.test(file.name)) {
      pdfUrl = URL.createObjectURL(file);
      lines = await readPdfLines(file);
    } else {
      const sheets = await readWorkbook(file);
      lines = sheets.flatMap(s => s.rows.map(r => (r || []).filter(x => x != null).join('  ')));
    }
    const text = lines.join('\n'); const T = norm(text + ' ' + file.name);
    let type = /ΚΕΝΤΡ\w* ΑΙΜΑΤ|BLOOD (CENTRE|CENTER|ESTABLISHMENT)/.test(T) ? 'INV'
      : /ΤΡΑΠΕΖ\w* ΑΙΜΑΤ|BLOOD BANK/.test(T) ? 'TA' : (/^INV\b/.test(norm(file.name)) ? 'INV' : 'TA');
    const typeSure = /ΚΕΝΤΡ\w* ΑΙΜΑΤ|BLOOD (CENTRE|CENTER|ESTABLISHMENT)|ΤΡΑΠΕΖ\w* ΑΙΜΑΤ|BLOOD BANK/.test(T);
    // αριθμός τιμολογίου One Point
    let ref = '';
    const mRef = (text.match(/(?:INVOICE|ΤΙΜΟΛΟΓΙΟ)\s*(?:NO|NUMBER|#|ΑΡ\.?|ΑΡΙΘΜΟΣ)?\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{1,})/i)) || file.name.match(/INVOICE\s*NO\.?\s*([A-Z0-9\-\/]+)/i);
    if (mRef) ref = mRef[1];
    const mDate = text.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/);
    const refDate = mDate ? toISO(mDate[1]) : '';
    // υποψήφια ποσά
    const money = s => (s.match(/-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\b|-?\d+[.,]\d{2}\b/g) || []).map(parseNum).filter(n => n != null && n > 0);
    const totalLines = lines.filter(l => /(TOTAL|ΣΥΝΟΛΟ|ΟΛΙΚΟ|ΠΛΗΡΩΤΕΟ|AMOUNT DUE|BALANCE DUE|GRAND)/i.test(norm(l)));
    const totals = [...new Set(totalLines.flatMap(money))];
    const all = [...new Set(money(text))].sort((a, b) => b - a).slice(0, 10);
    const amount = totals.length ? Math.max(...totals) : (all[0] || 0);
    const d = makeSRVDraft(type, { ref, refDate, amount, fileName: file.name, pdfUrl });
    DRAFTS.SRV.push(d);
    const chips = arr => arr.map(n => `<button class="chip" data-amt="${n}" data-id="${d.id}">${fmtEUR(n)} €</button>`).join('');
    st.innerHTML = `
      ${lines.length ? '' : '<span class="err">Το PDF δεν έχει αναγνώσιμο κείμενο (πιθανόν σαρωμένο). Ανοίξτε το πρωτότυπο και περάστε το ποσό χειροκίνητα.</span><br>'}
      <span class="${typeSure ? 'ok' : 'warn'}">Τύπος: <b>${type === 'TA' ? 'ΤΑ – Τράπεζα Αίματος' : 'INV – Κέντρο Αίματος'}</b>${typeSure ? '' : ' (δεν βρέθηκε στο κείμενο, ελέγξτε)'}.</span>
      ${ref ? ` Αρ. One Point: <b>${esc(ref)}</b>.` : ''}
      Προτεινόμενο ποσό: <b>${fmtEUR(amount)} €</b>. Ελέγξτε αν το ποσό που χρεώνετε είναι πριν ή μετά τον ΦΠΑ.
      ${totals.length ? `<div>Ποσά σε γραμμές «σύνολο»:</div><div class="chips">${chips(totals)}</div>` : ''}
      ${all.length ? `<div>Άλλα ποσά στο έγγραφο:</div><div class="chips">${chips(all)}</div>` : ''}
      ${pdfUrl ? `<a class="btn ghost small" href="${pdfUrl}" target="_blank" rel="noopener">Άνοιγμα πρωτότυπου PDF</a>` : ''}
      ${lines.length ? `<details><summary>Κείμενο αρχείου</summary><pre>${esc(text)}</pre></details>` : ''}`;
    $$('#SRV-status .chip').forEach(b => b.onclick = () => {
      const dd = DRAFTS.SRV.find(x => x.id === b.dataset.id); if (!dd || isIssued(dd)) return;
      dd.lines[0].amount = +b.dataset.amt; renderList('SRV');
    });
    renderList('SRV');
  } catch (e) {
    console.error(e); st.innerHTML = `<span class="err">Σφάλμα ανάγνωσης: ${esc(e.message)}</span>`;
  }
}

/* ---------------- 4. ΟΑΥ (ΤΑΕΠ / ΥΓΟΣ / ΥΑ) ---------------- */
const OAY_TYPES = ['TAEP', 'YGOS', 'YA'];
const isOay = t => OAY_TYPES.includes(t);
const oayCust = () => SETTINGS.customers.find(c => (c.types || []).includes('TAEP')) || null;
function oayNumber(type, ym) {
  const T = typeOf(type), [y, m] = ym.split('-');
  return String(T.numFmt || '{P} {MM}/{YYYY}').replace('{P}', T.prefix).replace('{MM}', m).replace('{YYYY}', y);
}
const periodText = ym => `${fmtDate(ym + '-01')} - ${fmtDate(lastDayOfMonth(ym))}`;
const oayMonth = () => $('#OAY-month').value || (() => { const d = new Date(); d.setDate(0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })();

function syncOayDate(d, iso) {
  const oldYm = d.month, ym = (iso || '').slice(0, 7);
  d.date = iso;
  if (!isOay(d.type) || !ym || ym === oldYm) return;
  if (!d.number || d.number === oayNumber(d.type, oldYm)) d.number = oayNumber(d.type, ym);
  if ((d.type === 'YA' || d.type === 'TAEP') && d.lines[0]) d.lines[0].desc = periodText(ym);
  d.month = ym; d.sourceKey = `${d.type}|${ym}`;
  if (d.type !== 'TAEP') d.sourceLabel = monthLabel(ym);
}
function makeOayDraft(type, ym, lines, extra = {}) {
  const c = oayCust();
  return Object.assign({
    id: uid(), type, customerId: c ? c.id : '', number: oayNumber(type, ym), date: lastDayOfMonth(ym), month: ym,
    remarks: '', lines, sourceKey: `${type}|${ym}`, sourceLabel: monthLabel(ym)
  }, extra);
}

/* Αρχείο ΟΑΥ: φύλλο A&E με G4 (Net claims), G5 (Copayments), G6 (True-up) και γραμμές νοσηλευτηρίων */
function parseOayFile(sheets) {
  const cand = sheets.filter(s => s.rows.slice(0, 12).some(r => r && /TRUE-UP/.test(norm(r[3]))));
  const sh = cand.find(s => !/\s1$/.test(s.name.trim())) || cand[0];
  if (!sh) return null;
  const val = re => { const r = sh.rows.find(r => r && re.test(norm(r[3]))); return r ? parseNumX(r[6]) : null; };
  const netClaims = val(/^NET CLAIMS/), copay = val(/^COPAYMENTS/), trueUp = val(/^TRUE-UP/);
  const hr = sh.rows.findIndex(r => r && norm(r[3]) === 'CLAIMS');
  const hosp = [];
  for (let i = hr + 1; i < sh.rows.length; i++) {
    const r = sh.rows[i] || [];
    if (!/^F\d+$/.test(String(r[0] || '').trim())) { if (hosp.length) break; continue; }
    hosp.push({ vendor: String(r[0]).trim(), name: String(r[1] || '').trim(), claims: parseNumX(r[3]) || 0, copay: parseNumX(r[4]) || 0, net: parseNumX(r[6]) || 0 });
  }
  const mm = (sh.name.match(/(\d{2})\.(\d{4})/) || []);
  return { sheet: sh.name, netClaims, copay, trueUp, hosp, month: mm.length ? `${mm[2]}-${mm[1]}` : '' };
}

/* Κατανομή: ποσοστό = απαιτήσεις / σύνολο απαιτήσεων · ποσό = ROUND(τιμολόγιο × ποσοστό, 2) · τα λεπτά στρογγυλοποίησης στο μεγαλύτερο νοσηλευτήριο */
function allocate(total, hosp) {
  const map = SETTINGS.oay.hospitals || [];
  const sum = hosp.reduce((a, h) => a + h.claims, 0);
  const rows = hosp.map(h => {
    const m = map.find(x => x.vendor === h.vendor) || {};
    const short = m.short || ((h.name.match(/-\s?([A-Z]{3,4})-F\d+$/) || [])[1] || '');
    const share = sum ? h.claims / sum : 0;
    return Object.assign({}, h, { short, account: m.account || '', share, amount: round2(total * share), plug: 0 });
  });
  const diff = round2(total - rows.reduce((a, r) => a + r.amount, 0));
  if (rows.length && diff) {
    const big = rows.reduce((b, r) => (r.claims > b.claims ? r : b), rows[0]);
    big.plug = diff; big.amount = round2(big.amount + diff);
  }
  return { rows, sumClaims: sum, diff };
}

let OAY_FILE = null;
async function handleOay(file) {
  const st = $('#OAY-status'); st.innerHTML = 'Ανάγνωση αρχείου…'; $('#OAY-alloc').innerHTML = '';
  try {
    const p = parseOayFile(await readWorkbook(file));
    if (!p || p.trueUp == null || !p.hosp.length) {
      st.innerHTML = '<span class="err">Δεν βρέθηκε φύλλο A&amp;E με «True-up to be INVOICED by OKYPY» και γραμμές νοσηλευτηρίων.</span>'; return;
    }
    if (p.month) $('#OAY-month').value = p.month;
    const ym = oayMonth();
    const gross = round2(p.netClaims + p.copay + p.trueUp), prepay = round2(p.netClaims + p.copay), total = round2(gross - prepay);
    const al = allocate(total, p.hosp);
    OAY_FILE = { file: file.name, p, ym, gross, prepay, total, al };
    const claimsOk = Math.abs(al.sumClaims - prepay) < 0.01;
    st.innerHTML = `<span class="ok">Φύλλο «${esc(p.sheet)}» · ${monthLabel(ym)}.</span>
      Χρέωση περιόδου: <b>${fmtEUR(gross)} €</b> · Μείον προπληρωμές ΟΑΥ: <b>${fmtEUR(prepay)} €</b> · Ποσό τιμολογίου: <b>${fmtEUR(total)} €</b>
      ${claimsOk ? '' : `<br><span class="warn">Το σύνολο των απαιτήσεων νοσηλευτηρίων (${fmtEUR(al.sumClaims)} €) διαφέρει από τις προπληρωμές (${fmtEUR(prepay)} €). Ελέγξτε το αρχείο.</span>`}`;
    const miss = al.rows.filter(r => !r.account).map(r => r.vendor);
    $('#OAY-alloc').innerHTML = `<div class="scroll"><table class="t">
      <thead><tr><th>Κωδ.</th><th>Νοσηλευτήριο</th><th>Λογαριασμός</th><th class="num">Απαιτήσεις (Claims)</th><th class="num">Ποσοστό</th><th class="num">Ποσό κατανομής €</th></tr></thead>
      <tbody>${al.rows.map(r => `<tr><td>${esc(r.vendor)}</td><td>${esc(r.short)}</td><td>${esc(r.account) || '<span class="err">—</span>'}</td><td class="num">${fmtEUR(r.claims)}</td><td class="num">${(r.share * 100).toLocaleString('el-GR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%</td><td class="num">${fmtEUR(r.amount)}${r.plug ? ` <span class="tag" title="Λεπτά στρογγυλοποίησης">${r.plug > 0 ? '+' : ''}${fmtEUR(r.plug)}</span>` : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3"><b>Σύνολο</b></td><td class="num"><b>${fmtEUR(al.sumClaims)}</b></td><td class="num"><b>100%</b></td><td class="num"><b>${fmtEUR(al.rows.reduce((a, r) => a + r.amount, 0))}</b></td></tr></tfoot>
    </table></div>
    ${miss.length ? `<div class="status warn">Χωρίς λογαριασμό στις Ρυθμίσεις: ${esc(miss.join(', '))}</div>` : ''}
    <div class="row-actions">
      <button class="btn primary" id="OAY-taep">+ Τιμολόγιο ΤΑΕΠ ${esc(oayNumber('TAEP', ym))}</button>
      <button class="btn" id="OAY-allocx">Λήψη Excel κατανομής και εγγραφής</button>
    </div>`;
    $('#OAY-taep').onclick = () => {
      const d = makeOayDraft('TAEP', ym, [
        { desc: periodText(ym), amount: gross },
        { desc: 'ΜΕΙΟΝ ΠΡΟΠΛΗΡΩΜΕΣ ΑΠΟ ΟΑΥ (ΕΝΑΝΤΙ)', amount: -prepay }
      ], { alloc: al.rows.map(r => ({ vendor: r.vendor, short: r.short, account: r.account, claims: r.claims, amount: r.amount })), fileName: file.name, sourceLabel: `${file.name} · ${p.sheet}` });
      DRAFTS.OAY.push(d); renderList('OAY');
    };
    $('#OAY-allocx').onclick = () => exportAllocation(OAY_FILE);
  } catch (e) {
    console.error(e); st.innerHTML = `<span class="err">Σφάλμα ανάγνωσης: ${esc(e.message)}</span>`;
  }
}

/* Excel κατανομής και εγγραφής intercompany (ζωντανοί τύποι) */
function exportAllocation(F) {
  if (!F) return;
  const S = v => ({ t: 's', v: v == null ? '' : String(v) });
  const N = (v, f, z) => Object.assign({ t: 'n', v }, f ? { f } : {}, z ? { z } : {});
  const money = (v, f) => N(round2(v), f, '#,##0.00');
  const num = oayNumber('TAEP', F.ym), n = F.al.rows.length, r0 = 9, r1 = r0 + n - 1;
  const A = [
    [S(`Κατανομή ΤΑΕΠ ${monthLabel(F.ym)} · ${num}`)],
    [S(`Πηγή: ${F.file} · φύλλο ${F.p.sheet}`)],
    [S('Καθαρές απαιτήσεις που πλήρωσε ο ΟΑΥ (G4)'), money(F.p.netClaims)],
    [S('Συμμετοχές δικαιούχων (G5)'), money(F.p.copay)],
    [S('Ποσό τιμολογίου ΤΑΕΠ (G6, στρογγ.)'), money(F.total, `ROUND(${F.p.trueUp},2)`)],
    [S('Χρέωση περιόδου (G4+G5+G6)'), money(F.gross, 'B3+B4+B5')],
    [],
    ['Κωδ. προμηθευτή', 'Νοσηλευτήριο', 'Συντομογραφία', 'Λογαριασμός', 'Απαιτήσεις (Claims)', 'Ποσοστό', 'Ποσό (στρογγ.)', 'Λεπτά στρογγυλοποίησης', 'Ποσό εγγραφής'].map(S)
  ];
  F.al.rows.forEach((r, i) => {
    const row = r0 + i;
    A.push([S(r.vendor), S(r.name), S(r.short), S(r.account), money(r.claims),
      N(r.share, `E${row}/SUM($E$${r0}:$E$${r1})`, '0.0000%'),
      money(r.amount - r.plug, `ROUND($B$5*F${row},2)`),
      money(r.plug, `IF(ROW()-${r0 - 1}=MATCH(MAX($E$${r0}:$E$${r1}),$E$${r0}:$E$${r1},0),$B$5-SUM($G$${r0}:$G$${r1}),0)`),
      money(r.amount, `G${row}+H${row}`)]);
  });
  const tr = r1 + 1;
  A.push([S('Σύνολο'), S(''), S(''), S(''), money(F.al.sumClaims, `SUM(E${r0}:E${r1})`), N(1, `SUM(F${r0}:F${r1})`, '0.00%'),
    money(F.total - F.al.diff, `SUM(G${r0}:G${r1})`), money(F.al.diff, `SUM(H${r0}:H${r1})`), money(F.total, `SUM(I${r0}:I${r1})`)]);
  A.push([S('Διαφορά από το τιμολόγιο'), S(''), S(''), S(''), S(''), S(''), S(''), S(''), money(0, `I${tr}-B5`)]);
  const wsA = XLSX.utils.aoa_to_sheet(A);
  wsA['!cols'] = [{ wch: 16 }, { wch: 52 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 11 }, { wch: 15 }, { wch: 13 }, { wch: 15 }];

  // Εγγραφή intercompany
  const date = lastDayOfMonth(F.ym);
  const E = [['Αρ. τιμολογίου', 'Ημερομηνία', 'Λογαριασμός', 'Χ/Π', 'Περιγραφή', 'Χρέωση €', 'Πίστωση €'].map(S)];
  E.push([S(num), N(isoToSerial(date), null, 'dd/mm/yyyy'), S(SETTINGS.oay.oayAccount || ''), S('Dr'), S(`ΟΑΥ ${num}`), money(F.total, `'Κατανομή'!B5`), money(0)]);
  F.al.rows.forEach((r, i) => {
    E.push([S(num), N(isoToSerial(date), null, 'dd/mm/yyyy'), S(r.account), S('Cr'), S(`${r.short} ${num}`), money(0), money(r.amount, `'Κατανομή'!I${r0 + i}`)]);
  });
  const er = E.length;
  E.push([S('Σύνολο'), S(''), S(''), S(''), S(''), money(F.total, `SUM(F2:F${er})`), money(F.total, `SUM(G2:G${er})`)]);
  E.push([S('Έλεγχος'), S(''), S(''), S(''), S(''), { t: 's', v: 'ΟΚ', f: `IF(ABS(F${er + 1}-G${er + 1})<0.005,"ΟΚ","ΕΛΕΓΞΤΕ")` }, money(0, `F${er + 1}-G${er + 1}`)]);
  const wsE = XLSX.utils.aoa_to_sheet(E);
  wsE['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 5 }, { wch: 22 }, { wch: 15 }, { wch: 15 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsA, 'Κατανομή');
  XLSX.utils.book_append_sheet(wb, wsE, 'Εγγραφή');
  XLSX.writeFile(wb, `Κατανομή ΤΑΕΠ ${F.ym}.xlsx`, { compression: true });
}

/* ---------------- λίστες πρόχειρων ---------------- */
function custOptions(type, sel) {
  const list = SETTINGS.customers;
  const pri = list.filter(c => (c.types || []).includes(type)), oth = list.filter(c => !(c.types || []).includes(type));
  const o = c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(custLabel(c))}</option>`;
  return `<option value="">— επιλέξτε —</option>${pri.map(o).join('')}${oth.length ? `<optgroup label="Άλλοι πελάτες">${oth.map(o).join('')}</optgroup>` : ''}`;
}

function renderList(group) {
  const list = DRAFTS[group];
  $(`#${group}-list-card`).hidden = !list.length;
  const isFA = group === 'FA', isTPA = group === 'TPA';
  let tot = 0;
  const rows = list.map((d, i) => {
    const issued = isIssued(d), t = draftTotal(d); tot += t;
    const T = typeOf(d.type);
    return `<tr data-i="${i}">
      <td>${esc(isFA ? d.sheet : (d.type === 'TPA' ? d.sourceLabel : T.prefix + ' · ' + d.sourceLabel))}</td>
      ${isFA ? `<td>${monthLabel(d.month)}</td>` : ''}
      <td><select data-k="customerId" ${issued ? 'disabled' : ''}>${custOptions(d.type, d.customerId)}</select></td>
      <td class="num">${d.lines.length}</td>
      ${isFA ? `<td class="num">${d.netted ? d.netted : ''}${d.unmatched ? ` <span class="tag neg" title="Αντιλογισμοί χωρίς αντίστοιχη έκδοση">${d.unmatched} αρν.</span>` : ''}</td>` : ''}
      <td class="num"><b>${fmtEUR(t)}</b>${totals(d).on ? '<br><span class="tag" title="Περιλαμβάνει διοικητικά έξοδα και ΦΠΑ">+ διοικητικά</span>' : ''}</td>
      ${isTPA ? `<td><input data-k="slipNo" value="${esc(d.slipNo || '')}" placeholder="αρ. Issue Slip" ${issued ? 'disabled' : ''}></td><td><input type="date" data-k="slipDate" value="${esc(d.slipDate || '')}" ${issued ? 'disabled' : ''}></td>` : ''}
      <td><input data-k="number" value="${esc(d.number)}" placeholder="${esc(T.prefix)} __-${(d.date || todayISO()).slice(0, 4)}" ${issued ? 'disabled' : ''}></td>
      <td><input type="date" data-k="date" value="${esc(d.date)}" ${issued ? 'disabled' : ''}></td>
      <td>${issued ? '<span class="tag issued">Εκδόθηκε</span>' : '<span class="tag">Πρόχειρο</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn small" data-a="open">Άνοιγμα</button>
        <button class="btn small" data-a="pdf">PDF</button>
        ${issued ? '' : '<button class="btn small primary" data-a="issue">Έκδοση</button> <button class="btn small ghost danger" data-a="del" title="Αφαίρεση">✕</button>'}
      </td></tr>`;
  }).join('');
  $(`#${group}-list`).innerHTML = `<div class="scroll"><table class="t">
    <thead><tr><th>${isFA ? 'Καρτέλα' : 'Πηγή'}</th>${isFA ? '<th>Μήνας</th>' : ''}<th>Πελάτης</th><th class="num">Γραμμές</th>${isFA ? '<th class="num">Συμψηφισμοί</th>' : ''}<th class="num">Ποσό €</th>${isTPA ? '<th>Issue Slip</th><th>Ημ. έκδοσης</th>' : ''}<th>Αρ. τιμολογίου</th><th>Ημερομηνία</th><th>Κατάσταση</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="${isFA ? 5 : 3}"><b>Σύνολο</b></td><td class="num"><b>${fmtEUR(tot)}</b></td><td colspan="${isTPA ? 6 : 4}"></td></tr></tfoot>
    </table></div>`;
  $$(`#${group}-list tbody tr`).forEach(tr => {
    const d = list[+tr.dataset.i];
    $$('[data-k]', tr).forEach(inp => inp.onchange = () => {
      if (inp.dataset.k === 'slipDate') { applySlipDate(d, inp.value); renderList(group); return; }
      if (inp.dataset.k === 'date' && isOay(d.type)) { syncOayDate(d, inp.value); renderList(group); return; }
      d[inp.dataset.k] = inp.value;
      if (inp.dataset.k === 'customerId') { delete d.adminOverride; renderList(group); }
    });
    $$('[data-a]', tr).forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'open') openEditor(d);
      if (a === 'pdf') savePdf(d);
      if (a === 'issue' && issueDraft(d)) savePdf(d);
      if (a === 'del' && confirm('Αφαίρεση του πρόχειρου;')) { list.splice(+tr.dataset.i, 1); renderList(group); }
    });
  });
}
function renderAllLists() { ['FA', 'TPA', 'SRV', 'OAY'].forEach(g => DRAFTS[g].length && renderList(g)); renderRegister(); }

/* ---------------- επεξεργασία ---------------- */
let ED = null;
function openEditor(d) {
  ED = d;
  const issued = isIssued(d), dis = issued ? 'disabled' : '';
  const T = typeOf(d.type);
  $('#ed-title').textContent = `${T.title}${d.number ? ' · ' + d.number : ''}${issued ? ' (εκδόθηκε, μόνο ανάγνωση)' : ''}`;
  const srv = d.type === 'TA' || d.type === 'INV';
  $('#ed-fields').innerHTML = `
    ${srv ? `<label>Αφορά<select id="ed-type" ${dis}><option value="TA" ${d.type === 'TA' ? 'selected' : ''}>Τράπεζα Αίματος (ΤΑ)</option><option value="INV" ${d.type === 'INV' ? 'selected' : ''}>Κέντρο Αίματος (INV)</option></select></label>` : ''}
    <label>Πελάτης<select id="ed-cust" ${dis}>${custOptions(d.type, d.customerId)}</select></label>
    <label>Αρ. τιμολογίου<input id="ed-num" value="${esc(d.number)}" placeholder="${esc(T.prefix)} __-${d.date.slice(0, 4)}" ${dis}></label>
    <label>Ημερομηνία<input id="ed-date" type="date" value="${esc(d.date)}" ${dis}></label>
    <label>Πηγή<input value="${esc(d.sourceLabel || '')}" disabled></label>
    ${d.type === 'TPA' ? `<label>Αρ. Issue Slip<input id="ed-slip" value="${esc(d.slipNo || '')}" ${dis}></label>
    <label>Ημ. έκδοσης Issue Slip<input id="ed-slipdate" type="date" value="${esc(d.slipDate || d.date)}" ${dis}></label>` : ''}
    <label class="chk" style="align-self:end"><input type="checkbox" id="ed-admin" ${adminApplies(d) ? 'checked' : ''} ${dis}>
      Διοικητικά έξοδα ${esc((d.rates || SETTINGS.fees).adminRate)}% + ΦΠΑ ${esc((d.rates || SETTINGS.fees).vatRate)}%</label>`;
  $('#ed-remarks').value = d.remarks || ''; $('#ed-remarks').disabled = issued;
  if (srv) $('#ed-type').onchange = e => {
    d.type = e.target.value;
    d.customerId = SETTINGS.customers.find(c => (c.types || []).includes(d.type))?.id || d.customerId;
    openEditor(d);
  };
  $('#ed-cust').onchange = e => { d.customerId = e.target.value; delete d.adminOverride; $('#ed-admin').checked = adminApplies(d); updateEdTotal(); };
  $('#ed-admin').onchange = e => { d.adminOverride = e.target.checked; updateEdTotal(); };
  if ($('#ed-slip')) {
    $('#ed-slip').oninput = e => { d.slipNo = e.target.value; updateEdTotal(); };
    $('#ed-slipdate').onchange = e => { applySlipDate(d, e.target.value); $('#ed-date').value = d.date; renderLines(); };
  }
  $('#ed-num').oninput = e => { d.number = e.target.value; };
  $('#ed-date').onchange = e => {
    if (isOay(d.type)) { syncOayDate(d, e.target.value); openEditor(d); return; }
    d.date = e.target.value;
  };
  $('#ed-remarks').oninput = e => { d.remarks = e.target.value; };
  renderLines();
  $('#ed-issue').disabled = issued;
  const dlg = $('#editor'); if (!dlg.open) dlg.showModal();
  preview();
}

const LINE_COLS = {
  FA: [['desc', 'Περιγραφή', 'text'], ['doc', 'Έγγραφο', 'text'], ['code', 'Κωδικός', 'text'], ['date', 'Ημ. καταχώρησης', 'date'], ['qty', 'Ποσότητα', 'num'], ['amount', 'Σύνολο €', 'num']],
  TPA: [['desc', 'Περιγραφή', 'text'], ['date', 'Ημ. παράδοσης', 'date'], ['qty', 'Ποσότητα', 'num'], ['price', 'Τιμή μονάδας', 'num'], ['_amt', 'Σύνολο €', 'calc']],
  TA: [['desc', 'Περιγραφή υπηρεσιών', 'text'], ['amount', 'Ποσό €', 'num']],
  INV: [['desc', 'Περιγραφή υπηρεσιών', 'text'], ['amount', 'Ποσό €', 'num']],
  TAEP: [['desc', 'Περίοδος / περιγραφή', 'text'], ['amount', 'Ποσό €', 'num']],
  YGOS: [['desc', 'Υπηρεσία', 'text'], ['amount', 'Ποσό €', 'num']],
  YA: [['desc', 'Περίοδος', 'text'], ['amount', 'Ποσό €', 'num']]
};
function renderLines() {
  const d = ED, cols = LINE_COLS[d.type], dis = isIssued(d) ? 'disabled' : '';
  const cell = (l, i, [k, , t]) => {
    if (t === 'calc') return `<td class="num" data-calc="${i}">${fmtEUR(lineAmount(l, d.type))}</td>`;
    const v = l[k] ?? '';
    if (t === 'date') return `<td><input type="date" data-i="${i}" data-k="${k}" value="${esc(v)}" ${dis}></td>`;
    if (t === 'num') {
      const shown = v === '' ? '' : k === 'amount' ? fmtEUR(v) : (+v).toLocaleString('el-GR', { maximumFractionDigits: 6 });
      return `<td><input class="num" data-i="${i}" data-k="${k}" data-num="1" value="${esc(shown)}" ${dis}></td>`;
    }
    return `<td${k === 'desc' ? ' style="min-width:260px"' : ''}><input data-i="${i}" data-k="${k}" value="${esc(v)}" title="${esc(v)}" ${dis}></td>`;
  };
  $('#ed-lines').innerHTML = `<div class="scroll" style="max-height:48vh"><table class="t">
    <thead><tr><th>#</th>${cols.map(c => `<th class="${c[2] === 'num' || c[2] === 'calc' ? 'num' : ''}">${c[1]}</th>`).join('')}<th></th></tr></thead>
    <tbody>${d.lines.map((l, i) => `<tr><td>${i + 1}</td>${cols.map(c => cell(l, i, c)).join('')}<td>${dis ? '' : `<button class="btn small ghost danger" data-del="${i}">✕</button>`}</td></tr>`).join('')}</tbody>
  </table></div>${dis ? '' : '<div class="row-actions"><button class="btn small ghost" id="ed-add">+ Γραμμή</button></div>'}`;
  $$('#ed-lines input').forEach(inp => inp.oninput = () => {
    const l = d.lines[+inp.dataset.i];
    l[inp.dataset.k] = inp.dataset.num ? (parseNum(inp.value) ?? 0) : inp.value;
    const c = $(`#ed-lines [data-calc="${inp.dataset.i}"]`); if (c) c.textContent = fmtEUR(lineAmount(l, d.type));
    updateEdTotal();
  });
  $$('#ed-lines [data-del]').forEach(b => b.onclick = () => { d.lines.splice(+b.dataset.del, 1); renderLines(); });
  const add = $('#ed-add'); if (add) add.onclick = () => {
    d.lines.push(d.type === 'TPA' ? { desc: '', date: d.date, qty: 1, price: 0 } : d.type === 'FA' ? { desc: '', doc: '', code: '', date: d.date, qty: 0, amount: 0 } : { desc: '', amount: 0 });
    renderLines();
  };
  updateEdTotal();
}
function updateEdTotal() {
  const v = validate(ED), t = totals(ED);
  $('#ed-total').innerHTML = t.on
    ? `Καθαρή αξία ${fmtEUR(t.net)} € · Διοικητικά (${t.adminRate}%) ${fmtEUR(t.admin)} € · ΦΠΑ (${t.vatRate}%) ${fmtEUR(t.vat)} € · Ολικό ποσό: <b>${fmtEUR(t.total)} €</b>`
    : `Ολικό ποσό: <b>${fmtEUR(t.total)} €</b>`;
  $('#ed-warn').innerHTML = v.errors.map(e => `<div class="err">✗ ${esc(e)}</div>`).join('') + v.warns.map(w => `<div class="warn">! ${esc(w)}</div>`).join('');
}
function preview() {
  try {
    const doc = buildPdf(ED);
    const old = $('#ed-frame').dataset.url; if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(doc.output('blob'));
    $('#ed-frame').dataset.url = url; $('#ed-frame').src = url;
  } catch (e) { console.error(e); $('#ed-warn').innerHTML += `<div class="err">Σφάλμα PDF: ${esc(e.message)}</div>`; }
}

/* ---------------- PDF τιμολογίου ---------------- */
function buildPdf(d) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('LS-R.ttf', window.__FONT_REG); doc.addFont('LS-R.ttf', 'LS', 'normal');
  doc.addFileToVFS('LS-B.ttf', window.__FONT_BOLD); doc.addFont('LS-B.ttf', 'LS', 'bold');
  const O = SETTINGS.org, T = typeOf(d.type);
  const reg = REGISTER.find(r => r.id === d.id), src = reg || d;
  const c = custOf(src), TT = totals(src);
  const M = 15, W = 210, H = 297, total = TT.total;
  const ink = [40, 40, 40], blue = [6, 159, 236], deep = [27, 117, 187], grey = [88, 89, 91];
  doc.setTextColor(...ink);

  // λογότυπο και διεύθυνση
  const logo = $('#logo').src;
  doc.addImage(logo, 'PNG', M, 9, 42, 42 * 399 / 640);
  doc.setFont('LS', 'bold'); doc.setFontSize(9.5);
  let y = 20;
  for (const ln of O.address.split('\n')) { doc.text(ln, 125, y); y += 4.6; }

  // τίτλος
  doc.setFontSize(11); doc.text(T.title, M, 50);
  doc.setFont('LS', 'normal'); doc.setFontSize(10); doc.text('ΠΡΟΣ:', M, 58);

  // πελάτης
  doc.setFont('LS', 'bold');
  let ly = 68;
  const nameLines = doc.splitTextToSize(c ? c.name : '—', 100);
  doc.text(nameLines, M, ly); ly += nameLines.length * 5;
  if (c && c.sub) { const sl = doc.splitTextToSize(c.sub, 100); doc.text(sl, M, ly); ly += sl.length * 5; }

  // ημερομηνία και αριθμός
  doc.text('Ημερομηνία:', 132, 68); doc.text('Αρ. Τιμολογίου:', 132, 75);
  doc.setFont('LS', 'normal');
  doc.text(fmtDate(d.date), 166, 68); doc.text(String(d.number || '—'), 166, 75);

  y = Math.max(ly, 79);
  doc.setDrawColor(...blue); doc.setLineWidth(0.6); doc.line(M, y, W - M, y);

  const drawPay = y0 => {
    let y = y0; doc.setFontSize(9.5); doc.setFont('LS', 'normal');
  doc.text('Αναφορικά με την κατάσταση λογαριασμού σας στον Οργανισμό Κρατικών Υπηρεσιών Υγείας', M, y);
  y += 5;
  const p1 = 'παρακαλώ όπως καταβληθεί το ποσό των ';
  doc.text(p1, M, y);
  let x = M + doc.getTextWidth(p1) + 2;
  doc.setFont('LS', 'bold'); const amtTxt = `€ ${fmtEUR(total)}`; doc.text(amtTxt, x, y);
  doc.setLineWidth(0.2); doc.setDrawColor(...ink); doc.line(x, y + 0.9, x + doc.getTextWidth(amtTxt), y + 0.9);
  x += doc.getTextWidth(amtTxt) + 3; doc.setFont('LS', 'normal');
  doc.text('στον πιο κάτω τραπεζικό λογαριασμό:', x, y);

  y += 9; doc.setFont('LS', 'bold');
  const amb = T.bank === 'amb';
  doc.text(amb ? O.bankAmb1 : O.bank1, M, y); y += 4.6;
  doc.text(amb ? O.bankAmb2 : O.bank2, M, y); y += 4.6;
  doc.text(`IBAN: ${amb ? O.ibanAmb : O.iban} , SWIFT CODE: ${O.swift}`, M, y);
  return y + 6;
  };
  const sign = (y0, compact) => {
    let y = y0;
    const o = compact ? -6 : 0;
    const remarks = remarkText(src);
    const remLines = remarks ? remarks.split('\n').flatMap(t => doc.splitTextToSize(t, 85)) : [];
    const need = Math.max(compact ? 30 : 42, 10 + remLines.length * 4.4);
    if (y + need > H - 24) { doc.addPage(); y = 25; }
    doc.setFontSize(9.5);
    if (remarks) {
      doc.setFont('LS', 'bold'); doc.text('ΠΑΡΑΤΗΡΗΣΕΙΣ', M, y + 4);
      doc.setLineWidth(0.3); doc.setDrawColor(...ink); doc.line(M, y + 5.2, M + 85, y + 5.2);
      doc.setFont('LS', 'normal'); doc.text(remLines, M, y + 10);
    }
    const sx = 150;
    doc.setFont('LS', 'normal'); doc.setTextColor(...ink);
    doc.text('………………………………………………..', sx, y + 14 + o, { align: 'center' });
    doc.text(O.signName, sx, y + 19 + o, { align: 'center' });
    doc.text(O.signTitle, sx, y + 24 + o, { align: 'center' });
    doc.text(O.signUnit, sx, y + 29 + o, { align: 'center' });
    if (O.signOrg) doc.text(O.signOrg, sx, y + 34 + o, { align: 'center' });
  };
  const tblStyle = {
    theme: 'grid', margin: { left: M, right: M, top: 18, bottom: 22 },
    styles: { font: 'LS', fontSize: 8.5, cellPadding: 1.5, textColor: ink, lineColor: [175, 175, 175], lineWidth: 0.2, valign: 'middle' },
    headStyles: { font: 'LS', fontStyle: 'bold', fillColor: deep, textColor: 255, halign: 'center', fontSize: 8.5 },
    footStyles: { font: 'LS', fontStyle: 'bold', fillColor: [234, 234, 234], textColor: ink, fontSize: 10 }
  };

  if (isOay(d.type)) {
    // ΟΑΥ: χρέωση περιόδου πρώτα, μετά το κείμενο πληρωμής (όπως στα πρότυπα)
    y += 8; doc.setFont('LS', 'bold'); doc.setFontSize(9);
    doc.text('Χρέωση σύμφωνα με τις Συμβάσεις και Αποφάσεις μεταξύ Οργανισμού Ασφάλισης Υγείας', M, y);
    doc.text(`και Οργανισμού Κρατικών Υπηρεσιών Υγείας${d.type === 'YGOS' ? '' : ' περίοδος χρέωσης :'}`, M, y + 4.6);
    y += 9;
    const ym = (src.date || '').slice(0, 7) || src.month;
    if (d.type === 'YGOS') {
      doc.autoTable(Object.assign({}, tblStyle, {
        startY: y, head: [[{ content: `ΠΕΡΙΟΔΟΣ ΧΡΕΩΣΗΣ ${periodText(ym)}`, colSpan: 2 }]],
        body: src.lines.map(l => [l.desc, fmtEUR(lineAmount(l, d.type))]),
        foot: [[{ content: 'ΟΛΙΚΟ ΠΟΣΟ €', styles: { halign: 'right' } }, { content: fmtEUR(total), styles: { halign: 'right' } }]],
        showFoot: 'lastPage', columnStyles: { 0: { cellWidth: 145 }, 1: { halign: 'right' } },
        styles: Object.assign({}, tblStyle.styles, { fontSize: 8, cellPadding: { top: 0.8, bottom: 0.8, left: 1.5, right: 1.5 } })
      }));
    } else {
      const body = src.lines.map((l, i) => [i === 0 ? periodText(ym) : l.desc, fmtEUR(Math.abs(lineAmount(l, d.type)))]);
      doc.autoTable(Object.assign({}, tblStyle, {
        startY: y, head: [['ΠΕΡΙΟΔΟΣ ΧΡΕΩΣΗΣ', 'ΠΟΣΟ']], body,
        foot: [[{ content: 'ΟΛΙΚΟ ΠΟΣΟ', styles: { halign: 'center' } }, { content: fmtEUR(total), styles: { halign: 'right' } }]],
        showFoot: 'lastPage', margin: { left: 115, right: M, top: 18, bottom: 22 },
        columnStyles: { 0: { cellWidth: 45, halign: 'center', fontStyle: 'bold' }, 1: { halign: 'right' } }
      }));
    }
    y = drawPay(doc.lastAutoTable.finalY + (d.type === 'YGOS' ? 8 : 12));
    sign(y + (d.type === 'YGOS' ? 0 : 4), d.type === 'YGOS');
  } else {
  y = drawPay(y + 9);

  // πίνακας
  let head, body, colStyles;
  const R = { halign: 'right' }, C = { halign: 'center' };
  if (d.type === 'FA') {
    head = ['ΠΡΟΪΟΝΤΑ', 'ΕΓΓΡΑΦΟ ΠΡΟΪΟΝΤΩΝ', 'ΚΩΔΙΚΟΣ ΠΡΟΪΟΝΤΟΣ', 'ΗΜΕΡΟΜΗΝΙΑ ΚΑΤΑΧΩΡΗΣΗΣ', 'ΠΟΣΟΤΗΤΑ', 'ΣΥΝΟΛΟ €'];
    body = d.lines.map(l => [l.desc, l.doc, l.code || '', fmtDate(l.date), fmtQty(l.qty), fmtEUR(lineAmount(l, d.type))]);
    colStyles = { 0: { cellWidth: 55 }, 1: Object.assign({ cellWidth: 23 }, C), 2: Object.assign({ cellWidth: 21 }, C), 3: Object.assign({ cellWidth: 28 }, C), 4: Object.assign({ cellWidth: 21 }, C), 5: R };
  } else if (d.type === 'TPA') {
    head = ['ΠΡΟΪΟΝΤΑ', 'ΗΜΕΡΟΜΗΝΙΑ ΠΑΡΑΔΟΣΗΣ', 'ΠΟΣΟΤΗΤΑ', 'ΤΙΜΗ ΜΟΝΑΔΑΣ', 'ΣΥΝΟΛΟ €'];
    body = d.lines.map(l => [l.desc, fmtDate(l.date), fmtQty(l.qty), fmtPrice(l.price), fmtEUR(lineAmount(l, d.type))]);
    colStyles = { 0: { cellWidth: 72 }, 1: Object.assign({ cellWidth: 28 }, C), 2: Object.assign({ cellWidth: 22 }, C), 3: Object.assign({ cellWidth: 28 }, R), 4: R };
  } else {
    head = ['ΠΕΡΙΓΡΑΦΗ ΥΠΗΡΕΣΙΩΝ', 'ΠΟΣΟ €'];
    body = d.lines.map(l => [l.desc, fmtEUR(lineAmount(l, d.type))]);
    colStyles = { 0: { cellWidth: 140 }, 1: R };
  }
  const n = head.length;
  // κενές γραμμές στο τέλος των προϊόντων (όπως στα πρότυπα), ώστε να μη χωρά προσθήκη
  for (let k = 0; k < 3; k++) body.push(head.map(() => ' '));
  const footRow = (label, val, last, first) => [
    ...(n > 3 ? [{ content: '', colSpan: n - 3, styles: { fillColor: [255, 255, 255], lineColor: [0, 0, 0], lineWidth: first ? { top: 0.3, right: 0, bottom: 0, left: 0 } : 0 } }] : []),
    { content: label, colSpan: n > 2 ? 2 : 1, styles: { halign: 'right', fontSize: last ? 10 : 8.5, fillColor: last ? [234, 234, 234] : [255, 255, 255] } },
    { content: fmtEUR(val), styles: { halign: 'right', fontSize: last ? 10 : 8.5, fillColor: last ? [234, 234, 234] : [255, 255, 255] } }
  ];
  const foot = TT.on ? [
    footRow('ΚΑΘΑΡΗ ΑΞΙΑ', TT.net, false, true),
    footRow(`ΔΙΟΙΚΗΤΙΚΑ ΕΞΟΔΑ (${TT.adminRate}%)`, TT.admin),
    footRow(`ΦΠΑ (${TT.vatRate}%) ΣΤΑ ΔΙΟΙΚΗΤΙΚΑ ΕΞΟΔΑ`, TT.vat),
    footRow('ΟΛΙΚΟ ΠΟΣΟ €', TT.total, true)
  ] : [footRow('ΟΛΙΚΟ ΠΟΣΟ €', TT.total, true, true)];
  doc.autoTable({
    startY: y, head: [head], body, foot, showFoot: 'lastPage', theme: 'grid',
    margin: { left: M, right: M, top: 18, bottom: 22 },
    styles: { font: 'LS', fontSize: 8, cellPadding: 1.4, textColor: ink, lineColor: [175, 175, 175], lineWidth: 0.2, valign: 'middle' },
    headStyles: { font: 'LS', fontStyle: 'bold', fillColor: deep, textColor: 255, halign: 'center', fontSize: 8 },
    footStyles: { font: 'LS', fontStyle: 'bold', fillColor: [234, 234, 234], textColor: ink, fontSize: 10 },
    columnStyles: colStyles
  });

  sign(doc.lastAutoTable.finalY + 10);
  }

  // υποσέλιδο
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFillColor(...blue); doc.rect(0, H - 6, W, 6, 'F');
    doc.setFont('LS', 'normal'); doc.setFontSize(8); doc.setTextColor(...grey);
    doc.text(`${d.number || ''}`, M, H - 9);
    doc.text(`Σελίδα ${p} από ${pages}`, W - M, H - 9, { align: 'right' });
  }
  doc.setProperties({ title: `${d.number || T.prefix} ${custLabel(c)}`, author: 'ΟΚΥπΥ', subject: T.title });
  return doc;
}
function pdfName(d) {
  const c = d.customer || getCust(d.customerId);
  return safeName(`${d.number || typeOf(d.type).prefix + ' ΠΡΟΧΕΙΡΟ'} ${custFileLabel(c)}`) + '.pdf';
}
function savePdf(d) { download(buildPdf(d).output('blob'), pdfName(d)); }

/* ---------------- μητρώο ---------------- */
const TYPE_BY_PREFIX = () => Object.fromEntries(Object.entries(SETTINGS.types).map(([k, v]) => [v.prefix, k]));
function regFiltered() {
  const m = $('#REG-month').value, tp = $('#REG-type').value, un = $('#REG-unexported').checked;
  const tk = tp ? TYPE_BY_PREFIX()[tp] : '';
  return REGISTER.filter(r => (!m || r.date.slice(0, 7) === m) && (!tk || r.type === tk) && (!un || !r.exported));
}
function updateRegCount() { $('#regCount').textContent = REGISTER.length; }
function renderRegister() {
  updateRegCount();
  const rows = regFiltered().sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const tot = rows.reduce((s, r) => s + r.total, 0);
  $('#REG-table').innerHTML = rows.length ? `<div class="scroll"><table class="t">
    <thead><tr><th><input type="checkbox" id="reg-all" checked></th><th>Αρ. τιμολογίου</th><th>Τύπος</th><th>Ημερομηνία</th><th>Πελάτης</th><th>Πηγή</th><th class="num">Ποσό €</th><th>SAP</th><th></th></tr></thead>
    <tbody>${rows.map(r => `<tr data-id="${r.id}">
      <td><input type="checkbox" class="reg-sel" checked></td>
      <td><b>${esc(r.number)}</b></td><td>${esc(typeOf(r.type).prefix)}</td><td>${fmtDate(r.date)}</td>
      <td>${esc(custLabel(r.customer))}</td><td>${esc(r.sourceLabel || '')}</td>
      <td class="num">${fmtEUR(r.total)}</td>
      <td>${r.exported ? `<span class="tag issued" title="${esc(r.exportedAt || '')}">Ναι</span>` : '<span class="tag">Όχι</span>'}</td>
      <td style="white-space:nowrap"><button class="btn small" data-a="pdf">PDF</button> <button class="btn small ghost" data-a="sap">${r.exported ? 'Σήμανση: όχι SAP' : 'Σήμανση: SAP'}</button> <button class="btn small ghost danger" data-a="del">Ακύρωση</button></td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="6"><b>Σύνολο (${rows.length})</b></td><td class="num"><b>${fmtEUR(tot)}</b></td><td colspan="2"></td></tr></tfoot>
  </table></div>` : '<p class="hint">Δεν υπάρχουν εκδοθέντα τιμολόγια για αυτά τα φίλτρα.</p>';
  const all = $('#reg-all'); if (all) all.onchange = () => $$('.reg-sel').forEach(c => c.checked = all.checked);
  $$('#REG-table tbody tr').forEach(tr => {
    const r = REGISTER.find(x => x.id === tr.dataset.id);
    $$('[data-a]', tr).forEach(b => b.onclick = () => {
      if (b.dataset.a === 'pdf') download(buildPdf(r).output('blob'), pdfName(r));
      if (b.dataset.a === 'sap') { r.exported = !r.exported; r.exportedAt = r.exported ? new Date().toISOString() : ''; saveRegister(); renderRegister(); }
      if (b.dataset.a === 'del' && confirm(`Ακύρωση του ${r.number} και αφαίρεση από το μητρώο;\n\nΑν έχει ήδη σταλεί ή περαστεί στο SAP, χρειάζεται πιστωτικό σημείωμα, όχι διαγραφή.`)) {
        REGISTER = REGISTER.filter(x => x.id !== r.id); saveRegister(); renderAllLists();
      }
    });
  });
}
const regSelected = () => $$('#REG-table tbody tr').filter(tr => $('.reg-sel', tr).checked).map(tr => REGISTER.find(x => x.id === tr.dataset.id));

/* ---------------- Excel για SAP ---------------- */
function exportSap() {
  const sel = regSelected();
  if (!sel.length) { alert('Δεν επιλέχθηκε κανένα τιμολόγιο.'); return; }
  const S = SETTINGS.sap;
  const wb = XLSX.utils.book_new();
  const dateCell = iso => ({ t: 'n', v: isoToSerial(iso), z: 'dd/mm/yyyy' });
  const money = (v, f) => (f ? { t: 'n', v: round2(v), f, z: '#,##0.00' } : { t: 'n', v: round2(v), z: '#,##0.00' });
  const pct = v => ({ t: 'n', v: v / 100, z: '0%' });
  const s = v => ({ t: 's', v: v == null ? '' : String(v) });

  // Γραμμές
  const L = [['Αρ. τιμολογίου', 'Περιγραφή', 'Κωδικός προϊόντος', 'Έγγραφο', 'Ημερομηνία', 'Ποσότητα', 'Τιμή μονάδας', 'Πηγή ποσού', 'Ποσό €'].map(s)];
  for (const r of sel) for (const l of r.lines) {
    const row = L.length + 1;
    const tpa = r.type === 'TPA';
    L.push([s(r.number), s(l.desc), s(l.code || ''), s(l.doc || ''), l.date ? dateCell(l.date) : s(''),
      tpa || l.qty != null ? { t: 'n', v: Number(l.qty) || 0 } : s(''),
      tpa ? { t: 'n', v: Number(l.price) || 0, z: '#,##0.0000' } : s(''),
      s(tpa ? 'Ποσότητα × τιμή, στρογγ. 2 δεκ.' : r.type === 'FA' ? 'Αρχείο SAP (Amt.in loc.cur.)' : 'Τιμολόγιο One Point'),
      tpa ? money(lineAmount(l, r.type), `ROUND(F${row}*G${row},2)`) : money(lineAmount(l, r.type))]);
  }
  const nL = L.length;
  const wsL = XLSX.utils.aoa_to_sheet(L);
  wsL['!cols'] = [{ wch: 16 }, { wch: 46 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 13 }, { wch: 30 }, { wch: 14 }];

  // Τιμολόγια: καθαρή αξία από τις γραμμές, διοικητικά και ΦΠΑ με τύπους
  const I = [['Αρ. τιμολογίου', 'Τύπος', 'Ημερομηνία', 'Πελάτης', 'Κωδ. πελάτη SAP', 'Λογ. εσόδων (G/L)', 'Καθαρή αξία €',
    'Ποσοστό διοικητικών', 'Διοικητικά έξοδα €', 'Ποσοστό ΦΠΑ', 'ΦΠΑ στα διοικητικά €', 'Ολικό ποσό €', 'Αρ. γραμμών', 'Πηγή', 'Κέντρο κέρδους'].map(s)];
  sel.forEach((r, i) => {
    const row = i + 2, t = totals(r);
    I.push([s(r.number), s(typeOf(r.type).prefix), dateCell(r.date), s(custLabel(r.customer)), s(r.customer?.sapCode || ''), s(typeOf(r.type).gl || ''),
      money(t.net, `SUMIFS('Γραμμές'!$I$2:$I$${nL},'Γραμμές'!$A$2:$A$${nL},A${row})`),
      pct(t.on ? t.adminRate : 0),
      money(t.admin, `ROUND(G${row}*H${row},2)`),
      pct(t.on ? t.vatRate : 0),
      money(t.vat, `ROUND(I${row}*J${row},2)`),
      money(t.total, `G${row}+I${row}+K${row}`),
      { t: 'n', v: r.lines.length, f: `COUNTIF('Γραμμές'!$A$2:$A$${nL},A${row})` },
      s(r.sourceLabel || ''), s(r.customer?.profit || '')]);
  });
  const nI = I.length;
  const wsI = XLSX.utils.aoa_to_sheet(I);
  wsI['!cols'] = [{ wch: 16 }, { wch: 7 }, { wch: 12 }, { wch: 56 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 11 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 36 }, { wch: 14 }];

  // SAP_Upload: χρέωση πελάτη (ολικό) · πίστωση εσόδων (καθαρή αξία) · πίστωση διοικητικών · πίστωση ΦΠΑ
  const U = [['Seq', 'Company Code', 'Document Type', 'Document Date', 'Posting Date', 'Fiscal Year', 'Period', 'Reference', 'Header Text', 'Posting Key', 'Account', 'Amount', 'Currency', 'Tax Code', 'Profit Center', 'Item Text', 'Assignment'].map(s)];
  sel.forEach((r, i) => {
    const ir = i + 2, T = typeOf(r.type), c = r.customer || {}, t = totals(r);
    const hdr = `${T.prefix} ${r.date.slice(5, 7)}/${r.date.slice(0, 4)}`.slice(0, 25);
    const item = `${T.label} ${c.name || ''} ${c.sub || ''}`.replace(/\s+/g, ' ').trim().slice(0, 50);
    const legs = [[S.pkDebit, c.sapCode || '', `'Τιμολόγια'!L${ir}`, t.total, S.taxCode, item]];
    if (r.type === 'TAEP' && (r.alloc || []).length) {
      // intercompany: πίστωση κάθε νοσηλευτηρίου με το ποσό κατανομής
      r.alloc.forEach(a => legs.push([S.pkCredit, a.account || '', null, a.amount, S.taxCode, `ΤΑΕΠ ${a.short} ${r.number}`]));
    } else legs.push([S.pkCredit, T.gl || '', `'Τιμολόγια'!G${ir}`, t.net, S.taxCode, item]);
    if (t.on) {
      legs.push([S.pkCredit, S.glAdmin || '', `'Τιμολόγια'!I${ir}`, t.admin, S.taxCodeAdmin, `Διοικητικά έξοδα ${t.adminRate}% ${r.number}`]);
      legs.push([S.pkCredit, S.glVat || '', `'Τιμολόγια'!K${ir}`, t.vat, S.taxCodeAdmin, `ΦΠΑ ${t.vatRate}% στα διοικητικά ${r.number}`]);
    }
    for (const [pk, acct, f, v, tax, txt] of legs) {
      const row = U.length + 1;
      U.push([{ t: 'n', v: i + 1 }, s(S.companyCode), s(S.docType), dateCell(r.date), dateCell(r.date),
        { t: 'n', v: +r.date.slice(0, 4), f: `YEAR(E${row})` }, { t: 'n', v: +r.date.slice(5, 7), f: `MONTH(E${row})` },
        s(r.number), s(hdr), s(pk), s(acct), money(v, f), s(S.currency), s(tax || ''),
        s(c.profit || ''), s(txt.slice(0, 50)), s(r.number)]);
    }
  });
  const nU = U.length;
  const wsU = XLSX.utils.aoa_to_sheet(U);
  wsU['!cols'] = [{ wch: 5 }, { wch: 9 }, { wch: 9 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 7 }, { wch: 16 }, { wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 48 }, { wch: 16 }];

  // Έλεγχος
  const sumTot = sel.reduce((a, r) => a + totals(r).total, 0), sumNet = sel.reduce((a, r) => a + totals(r).net, 0);
  const missing = U.slice(1).filter(r => !r[10].v).length;
  const E = [
    [s('Έλεγχος αρχείου SAP'), s('')],
    [s('Ολικό ποσό τιμολογίων'), money(sumTot, `SUM('Τιμολόγια'!L2:L${nI})`)],
    [s('Καθαρή αξία τιμολογίων'), money(sumNet, `SUM('Τιμολόγια'!G2:G${nI})`)],
    [s('Σύνολο γραμμών τιμολογίων'), money(sumNet, `SUM('Γραμμές'!I2:I${nL})`)],
    [s(`Χρεώσεις SAP (posting key ${S.pkDebit})`), money(sumTot, `SUMPRODUCT(('SAP_Upload'!J2:J${nU}="${S.pkDebit}")*'SAP_Upload'!L2:L${nU})`)],
    [s(`Πιστώσεις SAP (posting key ${S.pkCredit})`), money(sumTot, `SUMPRODUCT(('SAP_Upload'!J2:J${nU}="${S.pkCredit}")*'SAP_Upload'!L2:L${nU})`)],
    [s('Διαφορά χρεώσεων και πιστώσεων'), money(0, 'B5-B6')],
    [s('Διαφορά χρεώσεων SAP και τιμολογίων'), money(0, 'B5-B2')],
    [s('Διαφορά καθαρής αξίας και γραμμών'), money(0, 'B3-B4')],
    [s('Γραμμές SAP χωρίς λογαριασμό'), { t: 'n', v: missing, f: `COUNTBLANK('SAP_Upload'!K2:K${nU})` }],
    [s('Αποτέλεσμα'), { t: 's', v: missing ? 'ΕΛΕΓΞΤΕ' : 'ΟΚ', f: 'IF(AND(ABS(B7)<0.005,ABS(B8)<0.005,ABS(B9)<0.005,B10=0),"ΟΚ","ΕΛΕΓΞΤΕ")' }]
  ];
  const wsE = XLSX.utils.aoa_to_sheet(E);
  wsE['!cols'] = [{ wch: 42 }, { wch: 16 }];

  // Σημειώσεις
  const N = [
    ['Σημειώσεις και παραδοχές'],
    ['1. Η διάταξη του SAP_Upload είναι γενική. Προσαρμόστε τη στο πρότυπο ανεβάσματος του SAP σας πριν την πρώτη χρήση.'],
    [`2. Ανά τιμολόγιο: χρέωση πελάτη με το ολικό ποσό (posting key ${S.pkDebit}) και πιστώσεις (posting key ${S.pkCredit}) για καθαρή αξία, διοικητικά έξοδα και ΦΠΑ στα διοικητικά.`],
    ['3. Διοικητικά έξοδα χρεώνονται σε όλους τους πελάτες εκτός από το Υπουργείο Υγείας: ROUND(καθαρή αξία × ποσοστό, 2). ΦΠΑ = ROUND(διοικητικά × ποσοστό ΦΠΑ, 2).'],
    ['4. Κωδικοί πελατών, λογαριασμοί και κέντρα κέρδους προέρχονται από τις Ρυθμίσεις του εργαλείου. Κενό κελί σημαίνει ότι δεν έχει οριστεί.'],
    ['5. Για ΤΠΑ το ποσό γραμμής είναι ROUND(ποσότητα × τιμή μονάδας, 2). Όταν το αρχείο έχει τελική τιμή με ΦΠΑ, τιμή μονάδας = τελική τιμή / ποσότητα.'],
    ['6. Αν το εργαλείο ανεβάσματος του SAP διαβάζει μόνο τιμές, ανοίξτε και αποθηκεύστε το αρχείο στο Excel πριν το ανεβάσετε.'],
    [`Δημιουργήθηκε: ${new Date().toLocaleString('el-GR')}`]
  ];
  const wsN = XLSX.utils.aoa_to_sheet(N); wsN['!cols'] = [{ wch: 150 }];

  XLSX.utils.book_append_sheet(wb, wsU, 'SAP_Upload');
  XLSX.utils.book_append_sheet(wb, wsI, 'Τιμολόγια');
  XLSX.utils.book_append_sheet(wb, wsL, 'Γραμμές');
  XLSX.utils.book_append_sheet(wb, wsE, 'Έλεγχος');
  XLSX.utils.book_append_sheet(wb, wsN, 'Σημειώσεις');
  const months = [...new Set(sel.map(r => r.date.slice(0, 7)))].sort();
  const fname = `SAP Έσοδα Τιμολόγια Υπουργείων ${months.length === 1 ? months[0] : months[0] + ' έως ' + months[months.length - 1]}.xlsx`;
  XLSX.writeFile(wb, fname, { compression: true });
  if (confirm(`Κατέβηκε το «${fname}».\n\nΝα σημειωθούν τα ${sel.length} τιμολόγια ως «πέρασαν στο SAP»;`)) {
    const now = new Date().toISOString();
    sel.forEach(r => { r.exported = true; r.exportedAt = now; });
    saveRegister(); renderRegister();
  }
}

/* ---------------- ρυθμίσεις UI ---------------- */
const ORG_FIELDS = [
  ['org', 'address', 'Διεύθυνση (μία γραμμή ανά σειρά)', 'area'], ['org', 'bank1', 'Δικαιούχος λογαριασμού'], ['org', 'bank2', 'Όνομα λογαριασμού (αγγλικά)'],
  ['org', 'iban', 'IBAN'], ['org', 'swift', 'SWIFT'], ['org', 'signName', 'Υπογράφων'], ['org', 'signTitle', 'Θέση υπογράφοντος'],
  ['org', 'signUnit', 'Υπηρεσία'], ['org', 'signOrg', 'Οργανισμός (κάτω από την υπογραφή)'],
  ['sap', 'companyCode', 'SAP Company Code'], ['sap', 'docType', 'SAP Document Type'], ['sap', 'currency', 'Νόμισμα'],
  ['sap', 'pkDebit', 'Posting key χρέωσης πελάτη'], ['sap', 'pkCredit', 'Posting key πίστωσης εσόδων'], ['sap', 'taxCode', 'Κωδικός ΦΠΑ (αν χρειάζεται)'],
  ['org', 'bankAmb1', 'ΥΑ: δικαιούχος λογαριασμού'], ['org', 'bankAmb2', 'ΥΑ: όνομα λογαριασμού (αγγλικά)'], ['org', 'ibanAmb', 'ΥΑ: IBAN'],
  ['oay', 'oayAccount', 'ΟΑΥ: λογαριασμός χρέωσης (Dr)'], ['oay', 'yaAnnual', 'ΥΑ: ετήσιο ποσό € (μηνιαίο = /12)'],
  ['fees', 'adminRate', 'Διοικητικά έξοδα (%)'], ['fees', 'vatRate', 'ΦΠΑ στα διοικητικά έξοδα (%)'],
  ['sap', 'glAdmin', 'Λογ. εσόδων διοικητικών (G/L)'], ['sap', 'glVat', 'Λογ. ΦΠΑ εκροών (G/L)'], ['sap', 'taxCodeAdmin', 'Κωδικός ΦΠΑ διοικητικών']
];
function renderSettings() {
  const tps = Object.keys(SETTINGS.types);
  $('#SET-customers').innerHTML = `<div class="scroll"><table class="t"><thead><tr><th>Επωνυμία</th><th>Δεύτερη γραμμή</th><th>Τύποι</th><th title="Χρέωση διοικητικών εξόδων και ΦΠΑ">Διοικητικά</th><th>Κωδ. πελάτη SAP</th><th>Κέντρο κέρδους</th><th>Λέξεις αναγνώρισης</th><th></th></tr></thead><tbody>
    ${SETTINGS.customers.map((c, i) => `<tr data-i="${i}">
      <td><input data-k="name" value="${esc(c.name)}"></td><td><input data-k="sub" value="${esc(c.sub)}"></td>
      <td style="white-space:nowrap">${tps.map(t => `<label class="chk" style="display:inline-flex;margin-right:6px"><input type="checkbox" data-t="${t}" ${(c.types || []).includes(t) ? 'checked' : ''}>${esc(SETTINGS.types[t].prefix)}</label>`).join('')}</td>
      <td style="text-align:center"><input type="checkbox" data-adm="1" ${c.admin ? 'checked' : ''}></td>
      <td><input data-k="sapCode" value="${esc(c.sapCode)}"></td><td><input data-k="profit" value="${esc(c.profit)}"></td>
      <td><input data-k="kw" value="${esc(c.kw)}"></td>
      <td><button class="btn small ghost danger" data-del="${i}">✕</button></td></tr>`).join('')}
  </tbody></table></div>`;
  $$('#SET-customers tbody tr').forEach(tr => {
    const c = SETTINGS.customers[+tr.dataset.i];
    $$('[data-k]', tr).forEach(inp => inp.oninput = () => c[inp.dataset.k] = inp.value);
    $('[data-adm]', tr).onchange = e => { c.admin = e.target.checked; };
    $$('[data-t]', tr).forEach(cb => cb.onchange = () => { c.types = $$('[data-t]', tr).filter(x => x.checked).map(x => x.dataset.t); });
    $('[data-del]', tr).onclick = () => {
      if (!confirm(`Διαγραφή πελάτη «${custLabel(c)}»;`)) return;
      SETTINGS.customers.splice(+tr.dataset.i, 1); renderSettings();
    };
  });
  $('#SET-types').innerHTML = `<table class="t"><thead><tr><th>Τύπος</th><th>Αρχικά</th><th>Τίτλος στο PDF</th><th>Περιγραφή (κείμενο SAP)</th><th>Λογ. εσόδων G/L</th></tr></thead><tbody>
    ${tps.map(t => { const T = SETTINGS.types[t]; return `<tr data-t="${t}"><td>${t}</td><td><input data-k="prefix" value="${esc(T.prefix)}"></td><td><input data-k="title" value="${esc(T.title)}"></td><td><input data-k="label" value="${esc(T.label)}"></td><td><input data-k="gl" value="${esc(T.gl)}"></td></tr>`; }).join('')}
  </tbody></table>`;
  $$('#SET-types tbody tr').forEach(tr => $$('[data-k]', tr).forEach(inp => inp.oninput = () => SETTINGS.types[tr.dataset.t][inp.dataset.k] = inp.value));
  $('#SET-org').innerHTML = ORG_FIELDS.map(([g, k, lbl, t]) => t === 'area'
    ? `<label style="grid-row:span 2">${lbl}<textarea data-g="${g}" data-k="${k}" rows="6">${esc(SETTINGS[g][k])}</textarea></label>`
    : `<label>${lbl}<input data-g="${g}" data-k="${k}" value="${esc(SETTINGS[g][k])}"></label>`).join('');
  $$('#SET-org [data-k]').forEach(inp => inp.oninput = () => {
    SETTINGS[inp.dataset.g][inp.dataset.k] = inp.dataset.k === 'yaAnnual' ? (parseNum(inp.value) ?? 0) : inp.value;
  });
  renderOaySettings();
}
function renderOaySettings() {
  const O = SETTINGS.oay;
  const ytot = O.ygosLines.reduce((a, l) => a + round2(Number(l.amount) || 0), 0);
  $('#SET-oay').innerHTML = `
    <h3>ΥΓΟΣ: γραμμές τιμολογίου (σύνολο ${fmtEUR(ytot)} €)</h3>
    <div class="scroll"><table class="t"><thead><tr><th>Υπηρεσία</th><th class="num">Ποσό €</th><th></th></tr></thead><tbody>
    ${O.ygosLines.map((l, i) => `<tr data-i="${i}"><td><input data-k="desc" value="${esc(l.desc)}"></td><td style="width:160px"><input class="num" data-k="amount" value="${esc(fmtEUR(l.amount))}"></td><td><button class="btn small ghost danger" data-del="${i}">✕</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row-actions"><button class="btn small ghost" id="SET-ygos-add">+ Γραμμή ΥΓΟΣ</button></div>
    <h3 style="margin-top:14px">ΤΑΕΠ: νοσηλευτήρια και λογαριασμοί κατανομής</h3>
    <div class="scroll"><table class="t"><thead><tr><th>Κωδ. προμηθευτή ΟΑΥ</th><th>Συντομογραφία</th><th>Λογαριασμός (Cr)</th><th></th></tr></thead><tbody>
    ${O.hospitals.map((h, i) => `<tr data-h="${i}"><td><input data-k="vendor" value="${esc(h.vendor)}"></td><td><input data-k="short" value="${esc(h.short)}"></td><td><input data-k="account" value="${esc(h.account)}"></td><td><button class="btn small ghost danger" data-hdel="${i}">✕</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row-actions"><button class="btn small ghost" id="SET-hosp-add">+ Νοσηλευτήριο</button></div>`;
  $$('#SET-oay tr[data-i]').forEach(tr => $$('[data-k]', tr).forEach(inp => inp.onchange = () => {
    const l = O.ygosLines[+tr.dataset.i]; l[inp.dataset.k] = inp.dataset.k === 'amount' ? (parseNum(inp.value) ?? 0) : inp.value; renderOaySettings();
  }));
  $$('#SET-oay [data-del]').forEach(b => b.onclick = () => { O.ygosLines.splice(+b.dataset.del, 1); renderOaySettings(); });
  $$('#SET-oay tr[data-h]').forEach(tr => $$('[data-k]', tr).forEach(inp => inp.oninput = () => { O.hospitals[+tr.dataset.h][inp.dataset.k] = inp.value.trim(); }));
  $$('#SET-oay [data-hdel]').forEach(b => b.onclick = () => { O.hospitals.splice(+b.dataset.hdel, 1); renderOaySettings(); });
  $('#SET-ygos-add').onclick = () => { O.ygosLines.push({ desc: '', amount: 0 }); renderOaySettings(); };
  $('#SET-hosp-add').onclick = () => { O.hospitals.push({ vendor: '', short: '', account: '' }); renderOaySettings(); };
}
function saveSettings(msg = 'Οι ρυθμίσεις αποθηκεύτηκαν.') {
  const ok = LS.set(K_SET, SETTINGS);
  $('#SET-status').innerHTML = ok ? `<span class="ok">${msg}</span>` : '<span class="err">Ο browser δεν επιτρέπει αποθήκευση. Κάντε «Εξαγωγή ρυθμίσεων» για να τις κρατήσετε.</span>';
  renderAllLists();
}

/* ---------------- σύνδεση UI ---------------- */
function bindDrop(label, handler) {
  const inp = $('input', label);
  inp.onchange = () => { [...inp.files].forEach(handler); inp.value = ''; };
  label.addEventListener('dragover', e => { e.preventDefault(); label.classList.add('over'); });
  label.addEventListener('dragleave', () => label.classList.remove('over'));
  label.addEventListener('drop', e => { e.preventDefault(); label.classList.remove('over'); [...e.dataTransfer.files].forEach(handler); });
}
function readJsonFile(file, cb) {
  file.text().then(t => { try { cb(JSON.parse(t)); } catch (e) { alert('Μη έγκυρο αρχείο JSON.'); } });
}

function init() {
  $$('.tab').forEach(b => b.onclick = () => {
    $$('.tab').forEach(x => x.classList.toggle('active', x === b));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'REG') renderRegister();
    if (b.dataset.tab === 'SET') renderSettings();
    try { localStorage.setItem('okypy-inv-tab', b.dataset.tab); } catch (e) { }
  });
  bindDrop($('.drop[data-target="FA"]'), handleFA);
  bindDrop($('.drop[data-target="TPA"]'), handleTPA);
  bindDrop($('.drop[data-target="SRV"]'), handleSRV);
  bindDrop($('.drop[data-target="OAY"]'), handleOay);
  $('#OAY-month').value = oayMonth();
  $('#OAY-ygos').onclick = () => {
    const ym = oayMonth();
    DRAFTS.OAY.push(makeOayDraft('YGOS', ym, SETTINGS.oay.ygosLines.map(l => ({ desc: l.desc, amount: round2(Number(l.amount) || 0) }))));
    renderList('OAY');
  };
  $('#OAY-ya').onclick = () => {
    const ym = oayMonth();
    DRAFTS.OAY.push(makeOayDraft('YA', ym, [{ desc: periodText(ym), amount: round2((Number(SETTINGS.oay.yaAnnual) || 0) / 12) }]));
    renderList('OAY');
  };
  $('#TPA-blank').onclick = () => {
    DRAFTS.TPA.push({ id: uid(), type: 'TPA', customerId: '', number: '', date: todayISO(), remarks: '', lines: [{ desc: '', date: todayISO(), qty: 1, price: 0 }], sourceKey: '', sourceLabel: 'Χειροκίνητο' });
    renderList('TPA'); openEditor(DRAFTS.TPA[DRAFTS.TPA.length - 1]);
  };
  $('#SRV-blank-TA').onclick = () => { DRAFTS.SRV.push(makeSRVDraft('TA')); renderList('SRV'); openEditor(DRAFTS.SRV[DRAFTS.SRV.length - 1]); };
  $('#SRV-blank-INV').onclick = () => { DRAFTS.SRV.push(makeSRVDraft('INV')); renderList('SRV'); openEditor(DRAFTS.SRV[DRAFTS.SRV.length - 1]); };

  $('#ed-preview').onclick = preview;
  $('#ed-pdf').onclick = () => savePdf(ED);
  $('#ed-issue').onclick = () => { if (issueDraft(ED)) { savePdf(ED); openEditor(ED); } };
  $('#editor').addEventListener('close', () => renderList(groupOf(ED.type)));

  ['#REG-month', '#REG-type', '#REG-unexported'].forEach(s => $(s).onchange = renderRegister);
  $('#REG-sap').onclick = exportSap;
  $('#REG-pdfs').onclick = () => {
    const sel = regSelected(); if (!sel.length) return;
    if (sel.length > 5 && !confirm(`Θα κατέβουν ${sel.length} αρχεία PDF. Ο browser μπορεί να ζητήσει άδεια για πολλαπλές λήψεις. Συνέχεια;`)) return;
    sel.forEach((r, i) => setTimeout(() => download(buildPdf(r).output('blob'), pdfName(r)), i * 400));
  };
  $('#REG-backup').onclick = () => download(new Blob([JSON.stringify({ register: REGISTER, settings: SETTINGS, savedAt: new Date().toISOString() }, null, 1)], { type: 'application/json' }), `Μητρώο τιμολογίων ΟΚΥπΥ ${todayISO()}.json`);
  $('#REG-restore').onchange = e => { const f = e.target.files[0]; if (!f) return; readJsonFile(f, j => {
    if (!Array.isArray(j.register)) { alert('Το αρχείο δεν περιέχει μητρώο.'); return; }
    const ids = new Set(REGISTER.map(r => r.id)); const add = j.register.filter(r => !ids.has(r.id));
    if (!confirm(`Θα προστεθούν ${add.length} τιμολόγια στο μητρώο${j.settings ? ' και θα φορτωθούν οι ρυθμίσεις του αντιγράφου' : ''}. Συνέχεια;`)) return;
    REGISTER = REGISTER.concat(add); saveRegister();
    if (j.settings) { SETTINGS = Object.assign(clone(DEFAULT_SETTINGS), j.settings); LS.set(K_SET, SETTINGS); }
    renderAllLists();
  }); e.target.value = ''; };

  $('#SET-addcust').onclick = () => { SETTINGS.customers.push({ id: 'c' + uid(), admin: true, name: '', sub: '', types: [], sapCode: '', profit: '', kw: '' }); renderSettings(); };
  $('#SET-save').onclick = () => saveSettings();
  $('#SET-export').onclick = () => download(new Blob([JSON.stringify(SETTINGS, null, 1)], { type: 'application/json' }), `Ρυθμίσεις τιμολόγησης ΟΚΥπΥ ${todayISO()}.json`);
  $('#SET-import').onchange = e => { const f = e.target.files[0]; if (!f) return; readJsonFile(f, j => {
    if (!j.customers || !j.types) { alert('Το αρχείο δεν είναι αρχείο ρυθμίσεων.'); return; }
    SETTINGS = Object.assign(clone(DEFAULT_SETTINGS), j); renderSettings(); saveSettings('Οι ρυθμίσεις εισήχθησαν και αποθηκεύτηκαν.');
  }); e.target.value = ''; };
  $('#SET-reset').onclick = () => { if (confirm('Επαναφορά όλων των ρυθμίσεων στις αρχικές; Οι κωδικοί SAP που περάσατε θα χαθούν.')) { SETTINGS = clone(DEFAULT_SETTINGS); renderSettings(); saveSettings('Έγινε επαναφορά στις αρχικές ρυθμίσεις.'); } };

  let last = null; try { last = localStorage.getItem('okypy-inv-tab'); } catch (e) { }
  const btn = last && $(`.tab[data-tab="${last}"]`); if (btn) btn.click();
  updateRegCount();
}

window.__OKYPY = { parseNum, toISO, netReversals, detectSap, parseSapLines, buildPdf, validate, draftTotal, DRAFTS, get REGISTER() { return REGISTER; } };
document.addEventListener('DOMContentLoaded', init);
})();
