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
  assert.equal(isRows.length, 870);
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
  assert.equal(H.nRows, 822, 'οι γραμμές του ΜΑΚΑΡΕΙΟΥ μένουν εκτός');
  assert.equal(H.dcCount, 198);
  assert.equal(H.dialSum, 748, 'όγκος = Σ Quantity, όχι πλήθος γραμμών');
  assert.ok(H.tailLag, 'ο τελευταίος μήνας υπολείπεται — αναμενόμενη υστέρηση υποβολών');
  assert.ok(Math.abs(H.cmi - 1.494) < 0.001);
  assert.ok(Math.abs(H.emergPct - 63.24) < 0.01);
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
