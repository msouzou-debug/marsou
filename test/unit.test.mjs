/* Unit tests over the extracted modules.
   These pin the production-validated domain rules listed in the build brief, so
   a bad refactor fails here with a readable number rather than as an HTML diff. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePrerequisites, readWorkbook, XLSX } from './helpers.mjs';
import { FIXTURES } from './fixtures/make-fixtures.mjs';

requirePrerequisites();

const { parseStats } = await import('../src/parsers/stats.js');
const { parseIS } = await import('../src/parsers/is.js');
const { parseOS } = await import('../src/parsers/os.js');
const { parseALLAE } = await import('../src/parsers/allae.js');
const { classify } = await import('../src/parsers/classify.js');
const { computeHIO } = await import('../src/model/hio.js');
const { computeOS } = await import('../src/model/os.js');
const { hospOf } = await import('../src/domain.js');
const { state } = await import('../src/state.js');
const { U } = await import('../src/util.js');
const { buildStory, buildFlags } = await import('../src/model/story.js');
const { sumBlocksMonthly } = await import('../src/model/blocks.js');

const S = parseStats(readWorkbook(FIXTURES.stats));
const isRows = FIXTURES.is.flatMap(n => parseIS(readWorkbook(n), n));
/* the derived helpers read the shared state, exactly as the browser does */
state.stats = S;
state.isRows.push(...isRows);

test('classify αναγνωρίζει τους τέσσερις τύπους από το περιεχόμενο', () => {
  assert.equal(classify(readWorkbook(FIXTURES.stats)), 'stats');
  assert.equal(classify(readWorkbook(FIXTURES.is[0])), 'is');
  assert.equal(classify(readWorkbook(FIXTURES.allae[0])), 'allae');
  assert.equal(classify(readWorkbook(FIXTURES.os[0])), 'os');
  assert.equal(classify(readWorkbook(FIXTURES.junk)), 'unknown');
});

test('U — ελληνική μορφοποίηση και μήνες', () => {
  assert.equal(U.fmt(1234567), '1.234.567');
  assert.equal(U.fmt(12.5, 1), '12,5');
  assert.equal(U.pct(12.5), '+12,5%');
  assert.equal(U.pct(null), '—');
  assert.equal(U.fmt(null), '—');
  assert.equal(U.monthIdx('Ιαν.'), 0);
  assert.equal(U.monthIdx('Μάι'), 4);
  assert.equal(U.monthIdx('Μαΐου'), 4);
  assert.equal(U.monthIdx('Δεκ.'), 11);
  assert.equal(U.monthIdx('Μήνας'), -1);
  assert.equal(U.esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
});

test('parseStats — περίοδος, νοσοκομείο και ετήσιοι στόχοι', () => {
  assert.equal(S.hospital, 'Nicosia General');
  assert.equal(S.year, 2026);
  assert.equal(S.mN, 3, 'ΜΑΡΤΙΟΥ στον τίτλο σημαίνει τρίμηνο');
  assert.equal(S.kpi.adm.cur, 595);
  assert.equal(S.kpi.adm.prev, 619);
  assert.equal(S.kpi.adm.target, 2400, 'ο στόχος μένει ετήσιος· η αναγωγή γίνεται στην απεικόνιση');
  assert.equal(S.kpi.dc.cur, 299);
  assert.equal(S.kpi.opd.cur, 3828);
  assert.equal(S.kpi.taepA.cur, 1165);
  assert.equal(S.kpi.taepP.cur, 417);
  assert.equal(S.kpi.dial.cur, 813);
});

test('parseStats — οι μελλοντικοί μήνες του τρέχοντος έτους κόβονται', () => {
  const path = S.blocks.adm.find(b => b.name === 'Παθολογική');
  assert.deepEqual(Object.keys(path.years[2026]), ['0', '1', '2']);
  assert.equal(Object.keys(path.years[2025]).length, 12, 'τα προηγούμενα έτη μένουν ολόκληρα');
});

test('parseStats — άθροισμα κλινικών έναντι επίσημου συνόλου (ανοχή 5%)', () => {
  const monthly = sumBlocksMonthly('adm', 2026);
  assert.equal(Object.values(monthly).reduce((a, b) => a + b, 0), 595);
  assert.equal(S.annual.adm.total.vals[2026], 595);
});

test('parseStats — τα σκουπίδια δεδομένων επισημαίνονται, δεν ρίχνουν την εφαρμογή', () => {
  assert.equal(S.dq.length, 2);
  assert.match(S.dq[0], /κείμενο αντί για αριθμό/);
  assert.match(S.dq[1], /#REF!/);
  assert.equal(S.kpi.physio.target, null, 'ο στόχος με #REF! δεν γίνεται αριθμός');
});

test('hospOf — ΜΑΚΑΡΕΙΟ ελέγχεται πριν από ΛΕΥΚΩΣΙΑΣ', () => {
  assert.equal(hospOf('ΜΑΚΑΡΕΙΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ'), 'Makarios (Paed)');
  assert.equal(hospOf('ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ'), 'Nicosia General');
  assert.equal(hospOf('SOMETHING ELSE'), 'Other');
});

test('parseIS — στήλες, ημερομηνίες εξιτηρίου και τύποι νοσηλείας', () => {
  assert.equal(isRows.length, 886);
  assert.equal(parseIS(readWorkbook(FIXTURES.stats), 'x'), null, 'λάθος αρχείο → null, όχι εξαίρεση');
  const drg = isRows.filter(r => r.drg);
  assert.ok(drg.length > 0);
  assert.ok(isRows.every(r => r.dd === null || r.dd instanceof Date), 'dd/mm/yyyy και σειριακές ημερομηνίες Excel');
  assert.ok(isRows.some(r => r.ht.startsWith('3')), 'ημερήσια νοσηλεία');
  assert.ok(isRows.some(r => r.pid.includes('ZF-041')), 'αιμοκαθάρσεις');
  assert.ok(isRows.some(r => r.ff < 0), 'αναθεωρήσεις');
});

test('computeHIO — καταμέτρηση κατά ημερομηνία εξιτηρίου εντός περιόδου', () => {
  const H = computeHIO(isRows, S);
  assert.deepEqual(H.byMonth, [182, 183, 141]);
  assert.equal(H.inpTot, 506);
  assert.equal(H.nRows, 838, 'οι γραμμές του ΜΑΚΑΡΕΙΟΥ μένουν εκτός');
  assert.equal(H.dcCount, 198);
  assert.equal(H.dialSum, 748, 'όγκος = Σ Quantity, όχι πλήθος γραμμών');
  assert.ok(H.tailLag, 'ο τελευταίος μήνας υπολείπεται — αναμενόμενη υστέρηση υποβολών');
  assert.ok(Math.abs(H.cmi - 1.526) < 0.001);
  assert.ok(Math.abs(H.emergPct - 60.47) < 0.01);
});

test('computeHIO — ανακτήσεις αναθεωρήσεων ανά Case Nbr', () => {
  const H = computeHIO(isRows, S);
  assert.equal(H.revRows, 6);
  assert.equal(H.revAmt, -12450);
  assert.equal(H.revOpenCases, 3, 'μόνο τα περιστατικά που παραμένουν αρνητικά είναι ανοιχτά');
  assert.equal(H.revOpenAmt, -5250);
});

test('parseALLAE — € πληρωμές, ετικέτα νοσοκομείου, εξαιρέσεις κέντρων κόστους', () => {
  const rec = parseALLAE(readWorkbook(FIXTURES.allae[0]), FIXTURES.allae[0]);
  assert.equal(rec.month, 1);
  assert.equal(rec.year, 2026);
  assert.equal(rec.tag.F1054, 'NGH');
  assert.equal(rec.tag.F1106, 'NGH', 'ο F1106 γράφει την ετικέτα με κενό, όχι με παύλα');
  assert.equal(rec.aeClaims.F1054, 28562);
  assert.equal(rec.aeClaims.F1106, 10705);
  assert.equal(rec.opFFS.NGH, 41250 + 12800,
    'μόνο Fee-for-Service κλινικών — χωρίς φάρμακα, βασικές εξετάσεις, ενδονοσοκομειακά, capitation');
});

test('parseOS — αποδιπλασιασμός ανά CLAIM ID και μοναδικές επισκέψεις ανά μήνα τιμολόγησης', () => {
  for (const name of FIXTURES.os) {
    for (const r of parseOS(readWorkbook(name), name)) {
      if (!state.osClaims.has(r.claim)) state.osClaims.set(r.claim, r);
      if (r.code) state.osCodes.add(r.code);
    }
  }
  assert.deepEqual([...state.osCodes], ['F1054']);
  const O = computeOS(S);
  assert.deepEqual(O.ae, [322, 330, 150]);
  assert.deepEqual(O.op, [1015, 1050, 500], 'χωρίς εργαστηριακές/απεικονιστικές ειδικότητες');
  assert.equal(O.maxM, 3, 'το αρχείο Απριλίου ωριμάζει τον Ιανουάριο');
});

test('parseOS — κάλυψη ΓεΣΥ έναντι των επισκέψεων του νοσοκομείου', () => {
  const O = computeOS(S);
  const taepJan = S.blocks.taep.find(b => /Ενηλίκων/.test(b.name)).years[2026][0];
  const opdJan = sumBlocksMonthly('out', 2026)[0];
  assert.equal(Math.round(100 * O.ae[0] / taepJan), 81);
  assert.equal(Math.round(100 * O.op[0] / opdJan), 83);
});

test('buildStory / buildFlags — αφήγηση και σημεία προσοχής στα ελληνικά', () => {
  const story = buildStory();
  assert.match(story, /^Το τρίμηνο έκλεισε με 595 εισαγωγές/);
  assert.match(story, /ημερήσια νοσηλεία/);
  assert.match(story, /Θέλουν προσοχή/);

  const flags = buildFlags();
  const text = flags.map(f => f.m).join('\n');
  assert.match(text, /Πληρότητα πάνω από 100% στην κλινική Παθολογική/);
  assert.match(text, /Χαμηλή πληρότητα στην κλινική Γυναικολογική/);
  assert.match(text, /Μεγαλύτερη αύξηση εισαγωγών: Καρδιολογική/);
  assert.match(text, /Μεγαλύτερη πτώση εισαγωγών: Γυναικολογική/);
  assert.equal(flags.filter(f => f.t === 'info').length, 2, 'και τα δύο ευρήματα ποιότητας δεδομένων');
});

test('η SheetJS είναι καθολική, όπως και στο build', () => {
  assert.equal(XLSX.version, '0.18.5');
  assert.equal(globalThis.XLSX, XLSX);
});

/* ---------- ανάλυση ανά κλινική ---------- */
const { clinicKey } = await import('../src/domain.js');
const { buildClinics, clinicYoY, clinicTrend, computeClinicHIO, clinicEfficiency } = await import('../src/model/clinic.js');
const { parseReport, reportNotesFor } = await import('../src/parsers/report.js');
const { zipIndex } = await import('../src/zip.js');
const { readFileSync } = await import('node:fs');
const { fixturePath } = await import('./helpers.mjs');

test('clinicKey — η ίδια κλινική γράφεται αλλιώς σε κάθε φύλλο', () => {
  /* every group below is one clinic as the real ΓΝ Λευκωσίας workbook spells it
     across its sheets, plus the English name the ΟΑΥ files use */
  const groups = [
    ['Παθολογία', 'Παθολογίας', 'Παθολογική', 'Παθολογικό', 'Παθολογική Κλινική', 'INTERNAL MEDICINE'],
    ['Καρδιολογία', 'Καρδιολ.', 'CARDIOLOGY'],
    ['Γενική Χειρουργική', 'Γεν. Χειρουργική', 'GENERAL SURGERY'],
    ['Νευροχειρ.', 'Νευροχειρουργική', 'Νευροχειρουργικό', 'NEUROSURGERY'],
    ['Γναθοπροσωποχειρουργκή', 'Γναθοπροσωποχειρ.', 'Γναθοπροσωποχειρουργική'],   // typo in the source
    ['Νεφρολογία', 'Nεφρολογία', 'NEPHROLOGY'],                                   // Latin N
    ['Πυρινική ιατρική', 'Πυρηνική Ιατρική', 'NUCLEAR MEDICINE'],                  // misspelling
    ['Γαστρεντερολογικό', 'Γαστροεντερολογία', 'GASTROENTEROLOGY'],
    ['Ορθοπαιδική', 'Ορθοπεδική', 'ORTHOPAEDICS'],
    ['ΩΡΛ', 'Ωτορινολαρυγγολογική', 'ENT'],
    ['ΜΕΘ', 'Εντατικολογία', 'INTENSIVE CARE'],
    ['Ιατρεία πόνου', 'Κλινική Πόνου'],
  ];
  for (const g of groups) {
    assert.equal(new Set(g.map(clinicKey)).size, 1, g.join(' / ') + ' → ' + [...new Set(g.map(clinicKey))].join(' | '));
  }
  /* and the rule must not over-merge */
  const distinct = ['Παθολογία', 'Παθολογική Ανατομία', 'Κλινικά Εργαστήρια', 'Μικροβιολογικό Εργαστήριο',
    'Ογκολογία', 'Νευρολογική', 'Νεφρολογία', 'Καρδιοθωρακοχειρουργική', 'Γενική Χειρουργική'];
  assert.equal(new Set(distinct.map(clinicKey)).size, distinct.length);
  assert.equal(clinicKey(null), '');
});

test('buildClinics — οι δείκτες κάθε κλινικής ενώνονται από όλα τα φύλλα', () => {
  const M = buildClinics();
  /* the years span every sheet, and the workbook's column for next year is
     dropped — it carries no data yet */
  assert.deepEqual(M.years, [2021, 2022, 2023, 2024, 2025, 2026]);
  assert.ok(!M.years.includes(2027));

  const path = M.clinics.find(c => c.key === clinicKey('Παθολογία'));
  assert.equal(path.series.adm[2026], 187, 'εισαγωγές Ιαν–Μαρ');
  assert.equal(path.series.adm[2025], 179, 'ίδια περίοδος πέρσι, όχι ολόκληρο το έτος');
  assert.equal(path.series.out[2026], 1715, 'από το φύλλο εξωτερικών, με άλλη ονομασία («Παθολογικά»)');
  assert.ok(Math.abs(path.series.occ[2026] - 106.333) < 0.01, 'η πληρότητα είναι μέσος όρος, όχι άθροισμα');
  assert.ok(Math.abs(path.series.alos[2026] - 4.8) < 0.01);

  const surg = M.clinics.find(c => c.key === clinicKey('Γενική Χειρουργική'));
  assert.equal(surg.series.surg[2026], 141);
  assert.equal(surg.series.minor[2026], 48, 'από το φύλλο «Μικρά Χειρουργεία»');
  const onco = M.clinics.find(c => c.key === clinicKey('Ογκολογικό'));
  assert.equal(onco.series.dc[2026], 190, 'μονάδα ημερήσιας νοσηλείας χωρίς εισαγωγές');
});

test('μεταβολή έναντι πέρσι και διαχρονική πορεία', () => {
  const M = buildClinics();
  const path = M.clinics.find(c => c.key === clinicKey('Παθολογία'));
  assert.ok(Math.abs(clinicYoY(path, 'adm', 2026) - 4.469) < 0.01);
  const t = clinicTrend(path, 'adm', M.years);
  assert.deepEqual([t.from, t.to], [2024, 2026], 'μόνο τα έτη που έχουν τιμή');
  assert.ok(Math.abs(t.total - 8.092) < 0.01, '173 → 187 από το 2024');
  assert.ok(Math.abs(t.perYear - 3.968) < 0.01, 'μέση ετήσια μεταβολή');
  assert.equal(clinicTrend(path, 'dc', M.years), null, 'χωρίς σειρά ετών δεν βγαίνει τάση');
});

test('IS Auditor — κλινικά μεγέθη ανά Claim Speciality', () => {
  const byClinic = computeClinicHIO(isRows, S);
  const cardio = byClinic.get(clinicKey('Καρδιολογία'));
  assert.equal(cardio.cases, 81);
  assert.equal(cardio.revRows, 2, 'δύο αναθεωρήσεις χρεώθηκαν στην καρδιολογική');
  assert.equal(cardio.revAmt, -4800);
  assert.ok(cardio.cmi > 0 && cardio.alos > 0);

  /* the sum over specialties must equal the hospital's DRG cases — nothing
     lost, nothing double-counted */
  const H = computeHIO(isRows, S);
  assert.equal([...byClinic.values()].reduce((a, c) => a + c.cases, 0), H.inpTot);
  assert.equal([...byClinic.values()].reduce((a, c) => a + c.daycare, 0), H.dcCount);
  assert.ok(!byClinic.has(clinicKey('ΜΑΚΑΡΕΙΟ')), 'άλλα νοσοκομεία μένουν εκτός');
});

test('ειδικότητες ΟΑΥ χωρίς κλινική εμφανίζονται, δεν εξαφανίζονται', () => {
  const M = buildClinics();
  assert.deepEqual(M.unmatched.map(u => u.label), ['PALLIATIVE CARE']);
  assert.equal(M.unmatched[0].cases, 0, 'τιμολογείται χωρίς περιστατικά DRG');
  assert.ok(M.unmatched[0].billed > 0, 'και το ποσό δεν εξαφανίζεται');
});

/* ---------- οικονομικά φύλλα του ίδιου αρχείου ---------- */

test('parseFinancials — έσοδα ΟΑΥ ανά κλινική, σε τρεις ροές και δύο περιόδους', () => {
  const rev = S.fin.revenue;
  assert.equal(rev.rows.length, 9);
  const path = rev.rows.find(r => r.name === 'Παθολογία');
  assert.deepEqual(path.cur, { inpatient: 214600, outpatient: 18400, daycare: 9200, total: 242200 });
  assert.deepEqual(path.prev, { inpatient: 232700, outpatient: 17900, daycare: 8100, total: 258700 });
  /* the clinic list stops at ΣΥΝΟΛΟ — the pharmacy lines and the accounting
     adjustment underneath belong to no clinic */
  assert.ok(!rev.rows.some(r => /Αναλώσιμα|Προσαρμογή/.test(r.name)));
  assert.equal(rev.totals.cur.total, 957700);
});

test('parseFinancials — P&L με ενότητες, χωρίς ψεύτικα μηδενικά', () => {
  const pl = S.fin.pl;
  const headings = pl.filter(l => l.heading).map(l => l.label);
  assert.deepEqual(headings, ['ΕΣΟΔΑ', 'ΕΞΟΔΑ', 'Έξοδα Μισθοδοσίας', 'Λειτουργικές Δαπάνες']);
  /* a line with a footnote marker and no figure is a line item, not a heading */
  const ypas = pl.find(l => l.label.startsWith('ΥΠΑΣ'));
  assert.equal(ypas.heading, false);
  assert.equal(ypas.cur, null, 'κενό κελί δεν γίνεται 0 €');
  const surplus = pl.find(l => l.label.startsWith('ΠΛΕΟΝΑΣΜΑ'));
  assert.deepEqual([surplus.cur, surplus.prev], [142500, -9400]);
  assert.ok(pl.every(l => !/ΛΟΓΑΡΙΑΣΜΟΣ ΑΠΟΤΕΛΕΣΜΑΤΩΝ/.test(l.label)), 'ο τίτλος του φύλλου δεν είναι γραμμή');
});

test('parseFinancials — ΥΓΟΣ μόνο ο πρώτος πίνακας, ως το ΣΥΝΟΛΟ', () => {
  const svc = S.fin.services;
  assert.deepEqual(svc.years, [2026, 2025, 2024]);
  assert.deepEqual(svc.rows.map(r => r.name), ['Μεταμοσχευτική Κλινική', 'Κέντρο Τραύματος', 'ΣΥΝΟΛΟ']);
  assert.equal(svc.rows.at(-1).total, true);
});

test('κλίνες και μικρά χειρουργεία ανά κλινική', () => {
  assert.deepEqual(S.beds.map(b => b.name),
    ['Γενική Χειρουργική', 'Ορθοπαιδική', 'Γυναικολογική', 'Παθολογική', 'Καρδιολογική', 'Ογκολογικό'],
    'τα υποσύνολα των ομάδων δεν είναι κλινικές και δεν τερματίζουν τον πίνακα');
  assert.equal(S.beds.find(b => b.name === 'Ογκολογικό').dayCareBeds, 8);
  assert.equal(S.annual.minor.rows.length, 2);
});

test('buildClinics — τα έσοδα προσαρτώνται στην κλινική, χωρίς επιμερισμό', () => {
  const M = buildClinics();
  assert.ok(M.hasRevenue);
  const path = M.clinics.find(c => c.key === clinicKey('Παθολογία'));
  assert.equal(path.label, 'Παθολογία', 'το οικονομικό φύλλο δίνει τη σωστή ονομασία');
  assert.equal(path.revenue.cur.total, 242200);
  assert.equal(path.beds.beds, 52);
  assert.equal(path.series.adm[2026], 187, 'οι δείκτες και τα έσοδα κάθονται στην ίδια γραμμή');

  /* every euro of the sheet lands on exactly one clinic */
  const sum = M.clinics.reduce((a, c) => a + (c.revenue?.cur.total ?? 0), 0);
  assert.equal(Math.round(sum), Math.round(M.totals.cur.total));

  /* the ΟΑΥ bills oncology on two lines; the clinic is one */
  const onco = M.clinics.find(c => c.key === clinicKey('Ογκολογία'));
  assert.equal(onco.revenueSources.length, 2);
  assert.equal(onco.revenue.cur.total, 34200 + 3100);
  assert.equal(onco.label, 'Ογκολογία');

  /* a unit that is billed inside another clinic keeps its indicators and says
     so, rather than being given someone else's money */
  const rheum = M.clinics.find(c => c.key === clinicKey('Ρευματολογικό'));
  assert.equal(rheum.revenue, null);
  assert.ok(rheum.series.dc[2026] > 0);
});

test('clinicEfficiency — τι αξίζει μια κλίνη και μια επίσκεψη', () => {
  const M = buildClinics();
  const path = M.clinics.find(c => c.key === clinicKey('Παθολογία'));
  const e = clinicEfficiency(path, S);
  assert.equal(Math.round(e.perAdmission), Math.round(214600 / 187));
  assert.equal(Math.round(e.perVisit), Math.round(18400 / 1715));
  assert.equal(Math.round(e.perBed), Math.round(242200 / 52));
  assert.ok(Math.abs(e.admissionsPerBed - 187 / 52) < 1e-9);
});

/* ---------- η «Έκθεση Στατιστικών» (.docx) ---------- */

test('η έκθεση διαβάζεται χωρίς βιβλιοθήκη συμπίεσης', async () => {
  const bytes = new Uint8Array(readFileSync(fixturePath(FIXTURES.report)));
  assert.ok(zipIndex(bytes).has('word/document.xml'), 'ο τύπος αναγνωρίζεται από το περιεχόμενο');
  assert.equal(zipIndex(new Uint8Array(readFileSync(fixturePath(FIXTURES.stats)))).has('word/document.xml'), false);

  const report = await parseReport(bytes, FIXTURES.report);
  assert.equal(report.paraCount, 12);
  assert.deepEqual(report.sections.map(s => s.title), [
    'ΣΤΑΤΙΣΤΙΚΑ ΣΤΟΙΧΕΙΑ 2019-2026',
    'Επισκέψεις Εξωτερικών Ιατρείων (Διαφάνεια 6)',
    'Εισαγωγές Ασθενών (Διαφάνεια 8)',
  ], 'μόνο οι πραγματικοί τίτλοι· τα ονόματα κλινικών μέσα στο κείμενο δεν είναι τίτλοι');
});

test('τα σχόλια της έκθεσης προσαρτώνται στη σωστή κλινική', async () => {
  const report = await parseReport(new Uint8Array(readFileSync(fixturePath(FIXTURES.report))), FIXTURES.report);
  const notes = reportNotesFor(report, ['Παθολογική', 'Παθολογία']);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].section, 'Επισκέψεις Εξωτερικών Ιατρείων (Διαφάνεια 6)');
  assert.deepEqual(notes[0].figures, ['2026 → 1.715', '2025 → 1.602'], 'τα νούμερα που ακολουθούν το όνομα');
  assert.equal(reportNotesFor(null, ['Παθολογική']).length, 0);
  assert.equal(reportNotesFor(report, ['Οφθαλμολογία']).length, 0);
});
