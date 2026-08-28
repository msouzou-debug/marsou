/* ---------- Word export ----------
   The written report that used to be typed by hand next to the deck: the
   period in prose, the tables behind each claim, and then one page per clinic
   that a director can be handed on its own.

   Everything comes from the same computed model as the screen and the same
   Greek sentences the page already shows — a number can never disagree with
   itself, and the phrasing stays the reviewed one. */
import { U } from '../util.js';
import { state } from '../state.js';
import { computeHIO } from '../model/hio.js';
import { sumBlocksMonthly, yoy } from '../model/blocks.js';
import { buildStory, buildFlags } from '../model/story.js';
import {
  CLINIC_INDICATORS, CLINIC_ANNUAL, REVENUE_STREAMS,
  buildClinics, clinicYoY, clinicTrend, clinicEfficiency, pctChange,
} from '../model/clinic.js';
import { clinicStory } from '../render/clinics.js';
import { C, lineChart, barChartPaired } from '../render/charts.js';
import { zipWrite } from './zipwrite.js';
import { download, exportFileName } from './html.js';
import { svgToPng } from './pptx.js';
import {
  PAGE_W, BRAND, para, heading, note, spacer, table, picture,
  document as documentXml, styles, numbering, fontTable, header, footer,
  rootRels, documentRels, contentTypes, coreProps, appProps,
} from './wordxml.js';

const ALL_INDICATORS = [...CLINIC_INDICATORS, ...CLINIC_ANNUAL];

const money = (v) => (v == null ? '—' : U.fmt(v, 0) + ' €');
const val = (v, def) => (v == null ? '—' : U.fmt(v, def.dec) + def.unit);
const stamp = (d = new Date()) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

/* the same arrow the screen and the deck use, coloured the same way */
const move = (d) => (d == null ? { text: '—' }
  : { text: (d > 1 ? '▲ ' : d < -1 ? '▼ ' : '≈ ') + U.pct(d), bold: true,
      color: d > 1 ? BRAND.good : d < -1 ? BRAND.neg : BRAND.muted });

/* Against a zero or negative base a percentage says nothing; the euro move
   does. Same rule as the finance section on screen. */
const moveEur = (cur, prev) => {
  if (cur == null || prev == null) return { text: '—' };
  if (prev > 0) return move(pctChange(cur, prev));
  const d = cur - prev;
  return { text: `${d >= 0 ? '+' : ''}${U.fmt(d, 0)} €`, bold: true,
    color: d > 0 ? BRAND.good : d < 0 ? BRAND.neg : BRAND.muted };
};

const r = (text) => ({ text, align: 'right' });

/* ---------- the report ---------- */

export async function buildDocxParts() {
  const S = state.stats;
  if (!S) throw new Error('Δεν έχει φορτωθεί αρχείο στατιστικών.');
  const K = S.kpi, y = S.year;
  const model = buildClinics();
  const H = state.isRows.length ? computeHIO(state.isRows, S) : null;
  const periodEnd = U.MONTHS_FULL[S.mN - 1];
  const period = `Ιανουάριος – ${periodEnd} ${y}`;
  const hospital = (S.title.match(/ΓΕΝΙΚΟΥ ΝΟΣΟΚΟΜΕΙΟΥ\s+([Α-ΩΪΫ]+)/) || [null, 'ΝΟΣΟΚΟΜΕΙΟ'])[1];

  const media = [];                       // {name, bytes, rId}
  const addImage = (bytes) => {
    const rId = `rIdImg${media.length + 1}`;
    media.push({ name: `image${media.length + 1}.png`, bytes, rId });
    return rId;
  };
  const chart = async (svg, w, h) => (svg ? addImage(await svgToPng(svg, w, h)) : null);
  const logo = document.querySelector('header img')?.getAttribute('src');

  const body = [];
  const add = (...xs) => body.push(...xs.filter(Boolean));

  /* ---- title page ---- */
  if (logo?.startsWith('data:image/png')) {
    const bin = atob(logo.slice(logo.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    add(picture(addImage(bytes), 170, 66, { align: 'left' }));
  }
  add(
    spacer(1200),
    para(`ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ${hospital}`, { style: 'Title' }),
    para('Πίνακας Δεικτών Νοσοκομείου', { size: 16, bold: true, color: BRAND.blue, after: 240 }),
    para(period, { size: 12, bold: true, color: BRAND.text, after: 60 }),
    para(`Σύγκριση με την ίδια περίοδο του ${y - 1} και διαχρονική πορεία ανά κλινική`, { style: 'Subtitle' }),
    spacer(2400),
    note(`Οργανισμός Κρατικών Υπηρεσιών Υγείας · Ημερομηνία έκδοσης ${stamp()}`),
    note('Παράγεται αυτόματα από τα μηνιαία αρχεία του νοσοκομείου και του ΟΑΥ. Οι υπολογισμοί έγιναν τοπικά· κανένα δεδομένο δεν διαβιβάστηκε.'),
  );

  /* ---- 1. the period in prose ---- */
  add(heading('Η εικόνα της περιόδου', 1, { pageBreak: true }));
  add(para(buildStory(), { size: 11 }));

  const kpiRows = Object.values(K).filter(x => x.cur != null).map(x => {
    const key = Object.keys(K).find(k => K[k] === x);
    return [x.label, r(U.fmt(x.cur)), r(U.fmt(x.prev)), { ...move(yoy(key)), align: 'right' },
      r(x.target > 0 ? U.fmt(x.target * S.mN / 12) : '—')];
  });
  if (kpiRows.length) {
    add(heading('Βασικοί δείκτες', 2));
    add(table([['Δείκτης', r(String(y)), r(String(y - 1)), r('Δ%'), r('Αναλογικός στόχος')], ...kpiRows],
      { widths: [3800, 1400, 1400, 1338, 1700] }));
    add(note(`Περίοδος Ιανουαρίου–${periodEnd}. Οι ετήσιοι στόχοι του φύλλου «ΣΤΟΧΟΣ» ανάγονται αναλογικά σε ${S.mN}/12.`));
  }

  /* the two charts that carry the hospital's story */
  const admSeries = (yy) => { const m = sumBlocksMonthly('adm', yy); const v = []; for (let i = 0; i < 12; i++) v.push(m?.[i] ?? null); return v; };
  const admChart = await chart(lineChart([
    { name: String(y - 2), color: C.old, vals: admSeries(y - 2), w: 1.6 },
    { name: String(y - 1), color: C.y1, vals: admSeries(y - 1), dash: true, w: 1.8 },
    { name: String(y), color: C.y0, vals: admSeries(y), w: 2.6 },
  ], U.MONTHS_EL), 620, 310);
  if (admChart) {
    add(heading('Εισαγωγές ανά μήνα', 2));
    add(picture(admChart, 620, 310));
    add(note(`Γκρι: ${y - 2} · γαλάζιο διακεκομμένο: ${y - 1} · μπλε: ${y}.`));
  }

  /* ---- 2. targets ---- */
  const targets = Object.values(K).filter(x => x.target > 0 && x.cur != null)
    .map(x => ({ label: x.label, cur: x.cur, pro: x.target * S.mN / 12 }))
    .map(x => ({ ...x, pct: 100 * x.cur / x.pro })).sort((a, b) => a.pct - b.pct);
  if (targets.length) {
    add(heading('Στόχοι έτους — αναλογική πορεία', 1));
    add(para(`Οι στόχοι του φύλλου «ΣΤΟΧΟΣ» είναι ετήσιοι· εδώ ανάγονται σε ${S.mN}/12 ώστε να συγκρίνονται με την πραγματοποίηση της περιόδου.`, { size: 11 }));
    add(table([['Δείκτης', r('Επίτευξη'), r('Πραγματοποίηση'), r('Αναλογικός στόχος')],
      ...targets.map(t => [t.label,
        { text: U.fmt(t.pct, 0) + '%', bold: true, align: 'right',
          color: t.pct >= 100 ? BRAND.good : t.pct >= 90 ? BRAND.warn : BRAND.neg },
        r(U.fmt(t.cur)), r(U.fmt(t.pro))])],
      { widths: [4338, 1600, 1900, 1800] }));
  }

  /* ---- 3. financials ---- */
  const fin = S.fin;
  if (fin?.revenue?.totals || fin?.pl) {
    add(heading('Οικονομικά αποτελέσματα', 1));
    if (fin.revenue?.totals) {
      const t = fin.revenue.totals;
      const row = (label, k) => [label, r(money(t.cur[k])), r(money(t.prev[k])), { ...moveEur(t.cur[k], t.prev[k]), align: 'right' }];
      add(heading('Έσοδα ΟΑΥ ανά κλινική', 2));
      add(table([['Ροή εσόδων', r(String(y)), r(String(y - 1)), r('Μεταβολή')],
        row('Ενδονοσοκομειακή φροντίδα', 'inpatient'),
        row('Εξωτερικά ιατρεία', 'outpatient'),
        row('Ημερήσια νοσηλεία', 'daycare'),
        [{ text: 'Σύνολο', bold: true }, { ...r(money(t.cur.total)), bold: true },
          { ...r(money(t.prev.total)), bold: true }, { ...moveEur(t.cur.total, t.prev.total), align: 'right' }]],
        { widths: [3838, 1950, 1950, 1900] }));
      add(note('Άθροισμα των κλινικών του φύλλου «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ», πριν από τις λογιστικές προσαρμογές και χωρίς το ΤΑΕΠ. Τιμολογημένα, όχι εισπραγμένα.'));
      const revChart = await chart(barChartPaired([
        { name: 'Ενδονοσ.', cur: t.cur.inpatient, prev: t.prev.inpatient },
        { name: 'Εξωτερικά', cur: t.cur.outpatient, prev: t.prev.outpatient },
        { name: 'Ημερήσια', cur: t.cur.daycare, prev: t.prev.daycare },
      ], { curLabel: String(y), prevLabel: String(y - 1) }), 620, 260);
      if (revChart) add(picture(revChart, 620, 260));
    }
    if (fin.pl) {
      add(heading('Λογαριασμός αποτελεσμάτων', 2));
      add(table([['', r(String(y)), r(String(y - 1)), r('Μεταβολή')],
        ...fin.pl.map(l => l.heading
          ? [{ text: l.label, bold: true, fill: 'F0F8FD', color: BRAND.blueDeep }, { text: '', fill: 'F0F8FD' }, { text: '', fill: 'F0F8FD' }, { text: '', fill: 'F0F8FD' }]
          : [{ text: l.label, bold: !!l.strong }, { ...r(money(l.cur)), bold: !!l.strong },
            { ...r(money(l.prev)), bold: !!l.strong }, { ...moveEur(l.cur, l.prev), align: 'right' }])],
        { widths: [3838, 1950, 1950, 1900] }));
    }
    if (fin.services?.rows?.length) {
      const yrs = fin.services.years;
      add(heading('Υπηρεσίες ΥΓΟΣ', 2));
      add(table([['Υπηρεσία', ...yrs.map(yy => r(String(yy)))],
        ...fin.services.rows.map(row => [{ text: row.name, bold: !!row.total },
          ...yrs.map(yy => ({ ...r(money(row.vals[yy])), bold: !!row.total }))])],
        { widths: [PAGE_W - yrs.length * 1500, ...yrs.map(() => 1500)] }));
      add(note('Υπηρεσίες που χρηματοδοτούνται εκτός των ροών ανά περιστατικό.'));
    }
  }

  /* ---- 4. the ΟΑΥ cross-check ---- */
  if (H) {
    add(heading('Διασταύρωση με τον ΟΑΥ', 1));
    const M = H.maturity;
    const monthName = (m) => `${U.MONTHS_FULL[((m % 12) + 12) % 12]} ${Math.floor(m / 12)}`;
    add(para('Ο ΟΑΥ εξοφλεί σε παράθυρο τριών μηνών: τα εξιτήρια ενός μήνα υποβάλλονται στη δική του υποβολή και στις δύο επόμενες. '
      + 'Ένας μήνας συγκρίνεται με τα στατιστικά του νοσοκομείου μόνο αφού έχουν φτάσει και οι τρεις υποβολές του.', { size: 11 }));
    if (M?.missingRuns.length) {
      const immature = M.mature.map((m, i) => (m ? null : U.MONTHS_EL[i])).filter(Boolean).join(', ');
      add(para([{ text: 'Η περίοδος δεν έχει υποβληθεί ολόκληρη. ', bold: true, color: BRAND.neg },
        { text: `Με τελευταία υποβολή ${monthName(M.lastSubmission)}, οι μήνες ${immature} είναι ακόμη ελλιπείς και δεν προσμετρώνται στην κάλυψη. `
          + `Χρειάζονται τα IS Auditor ${M.missingRuns.map(monthName).join(' και ')}.` }], { size: 11 }));
    }
    const covRows = [];
    const adm = K.adm?.cur, dc = K.dc?.cur, dial = K.dial?.cur;
    const share = M ? M.mature.filter(Boolean).length / Math.max(1, S.mN) : 1;
    const cov = (label, stat, hio, hint) => {
      if (stat == null || hio == null) return;
      /* the hospital side has to be scaled to the same months the ΟΑΥ side covers */
      const pro = stat * share;
      covRows.push([label, r(U.fmt(pro)), r(U.fmt(hio)), r(pro ? U.fmt(100 * hio / pro, 0) + '%' : '—'), hint]);
    };
    cov('Ενδονοσοκομειακή νοσηλεία', adm, H.matureTot, 'εξιτήρια DRG έναντι εισαγωγών');
    cov('Ημερήσια νοσηλεία', dc, H.matureDc, 'περιστατικά ημερήσιας φροντίδας');
    cov('Αιμοκαθάρσεις', dial, H.matureDial, 'συνεδρίες ZF-041, άθροισμα Quantity');
    if (covRows.length) {
      add(heading('Κάλυψη στους πλήρεις μήνες', 2));
      add(table([['Κατηγορία', r('Νοσοκομείο'), r('ΟΑΥ'), r('Κάλυψη'), 'Σημείωση'],
        ...covRows], { widths: [2700, 1500, 1500, 1300, 2638] }));
      add(note('Τα δύο συστήματα μετρούν διαφορετικούς πληθυσμούς (ασθενείς εκτός ΓεΣΥ, ενδονοσοκομειακές διακομιδές, ψυχιατρική και παραπληγικό εκτός DRG). '
        + 'Οι αποκλίσεις είναι ενδείξεις για διερεύνηση, όχι αυτόματα χαμένα έσοδα.'));
    }
    add(table([['Μέγεθος', r('Τιμή')],
      ['CMI (θετικά βάρη)', r(H.cmi == null ? '—' : U.fmt(H.cmi, 3))],
      ['Μέση διάρκεια νοσηλείας', r(H.alos == null ? '—' : U.fmt(H.alos, 1) + ' ημέρες')],
      ['Επείγουσες εισαγωγές', r(H.emergPct == null ? '—' : U.fmt(H.emergPct, 0) + '%')],
      ['Απορρίψεις / αναθεωρήσεις', r(`${U.fmt(H.revRows)} γραμμές · ${money(H.revAmt)}`)]],
      { widths: [6138, 3500] }));
  }

  /* ---- 5. flags ---- */
  const flags = buildFlags();
  if (flags.length) {
    add(heading('Σημεία προσοχής', 1));
    add(...flags.map(f => para(f.m, { bullet: true, size: 10.5 })));
  }

  /* ---- 6. one page per clinic ---- */
  if (model.clinics.length) {
    add(heading('Ανά κλινική', 1, { pageBreak: true }));
    add(para(`Ακολουθεί μία σελίδα για κάθε κλινική, με τη σειρά μεγέθους. Κάθε μέγεθος αφορά την περίοδο Ιανουαρίου–${periodEnd} `
      + `και συγκρίνεται με την ίδια περίοδο του ${y - 1} και με κάθε προηγούμενο έτος του αρχείου.`, { size: 11 }));
    add(...model.clinics.map((c, i) => para(`${i + 1}. ${c.label}`, { size: 10, after: 40 })));
    for (const c of model.clinics) add(...clinicPages(c, model, S));
  }

  /* ---- 7. method and provenance ---- */
  add(heading('Μεθοδολογία και προέλευση δεδομένων', 1, { pageBreak: true }));
  add(table([['Πηγή', 'Αρχείο'],
    ['Στατιστικά νοσοκομείου', S.title || '—'],
    ['IS Auditor (ΟΑΥ)', state.isFiles.size ? [...state.isFiles].join(' · ') : 'δεν φορτώθηκαν'],
    ['ALL and AE (ΟΑΥ)', state.aeFiles.size ? [...state.aeFiles].join(' · ') : 'δεν φορτώθηκαν'],
    ['Πληρωμένες Απαιτήσεις OS', state.osFiles.size ? [...state.osFiles].join(' · ') : 'δεν φορτώθηκαν'],
    ['Έκθεση Στατιστικών', state.report ? state.report.file : 'δεν φορτώθηκε'],
    ['Ημερομηνία εξαγωγής', stamp()]], { widths: [2800, 6838] }));
  add(...[
    `Τα μεγέθη «${y}» αφορούν την περίοδο Ιανουαρίου–${periodEnd} ${y} και συγκρίνονται με την ίδια περίοδο του ${y - 1}.`,
    `Οι ετήσιοι στόχοι ανάγονται αναλογικά σε ${S.mN}/12.`,
    'Η διασταύρωση με τον ΟΑΥ μετρά κατά ημερομηνία εξιτηρίου, όχι κατά μήνα υποβολής.',
    'Τα έσοδα ανά κλινική είναι τιμολογημένα στον ΟΑΥ, από το φύλλο «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ» — όχι εισπραγμένα. Το ΤΑΕΠ και οι υπηρεσίες ΥΓΟΣ πληρώνονται συνολικά ανά νοσοκομείο και δεν επιμερίζονται σε κλινικές.',
    'Τα αρχεία ALL and AE περιέχουν πληρωμές (€), όχι αριθμούς επισκέψεων· τα «€ ανά επίσκεψη» συνδυάζουν πληρωμές ΟΑΥ με τις επισκέψεις των στατιστικών του νοσοκομείου.',
  ].map(t => para(t, { bullet: true, size: 10 })));

  return { body: body.join('\n'), media, hospital, period, model };
}

/* ---------- one clinic ---------- */

function clinicPages(c, model, S) {
  const y = S.year, out = [];
  out.push(heading(c.label, 1, { pageBreak: true }));

  const place = [];
  if (c.revenue) {
    const ranked = model.clinics.filter(x => x.revenue).sort((a, b) => b.revenue.cur.total - a.revenue.cur.total);
    const pos = ranked.findIndex(x => x.key === c.key) + 1;
    const total = model.totals?.cur?.total || ranked.reduce((a, x) => a + x.revenue.cur.total, 0);
    place.push(`${pos}η από ${ranked.length} σε έσοδα ΟΑΥ`);
    if (total) place.push(`${U.fmt(100 * c.revenue.cur.total / total, 1)}% των εσόδων του νοσοκομείου`);
  }
  if (c.beds?.beds) place.push(`${U.fmt(c.beds.beds)} κλίνες`);
  if (c.beds?.dayCareBeds) place.push(`${U.fmt(c.beds.dayCareBeds)} θέσεις ημερήσιας`);
  if (place.length) out.push(para(place.join(' · '), { size: 9.5, bold: true, color: BRAND.blue, after: 100 }));

  out.push(para(clinicStory(c, model, S), { size: 11 }));

  if (c.revenue) {
    const { cur, prev } = c.revenue;
    out.push(heading('Έσοδα ΟΑΥ', 2));
    out.push(table([['Ροή', r(String(y)), r(String(y - 1)), r('Μεταβολή')],
      ...REVENUE_STREAMS.map(s => [s.label, r(money(cur[s.key])), r(money(prev[s.key])),
        { ...moveEur(cur[s.key], prev[s.key]), align: 'right' }]),
      [{ text: 'Σύνολο', bold: true }, { ...r(money(cur.total)), bold: true },
        { ...r(money(prev.total)), bold: true }, { ...moveEur(cur.total, prev.total), align: 'right' }]],
      { widths: [3838, 1950, 1950, 1900] }));
    if (c.revenueSources.length > 1) {
      out.push(note(`Αθροίζονται οι γραμμές τιμολόγησης του ΟΑΥ: ${c.revenueSources.join(' · ')}.`));
    }
  } else {
    out.push(note('Το φύλλο «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ» δεν έχει γραμμή εσόδων ΟΑΥ με αυτή την ονομασία — συνήθως πρόκειται για μονάδα που τιμολογείται μέσα σε άλλη κλινική.'));
  }

  const indRows = ALL_INDICATORS.filter(def => c.series[def.key]?.[y] != null).map(def => {
    const t = clinicTrend(c, def.key, model.years);
    return [def.label, r(val(c.series[def.key][y], def)), r(val(c.series[def.key][y - 1], def)),
      { ...move(clinicYoY(c, def.key, y)), align: 'right' },
      r(t ? `${U.pct(t.total)} (${t.from}→${t.to})` : '—')];
  });
  if (indRows.length) {
    out.push(heading('Δραστηριότητα και διαχρονική πορεία', 2));
    out.push(table([['Δείκτης', r(String(y)), r(String(y - 1)), r('Δ%'), r('Διαχρονικά')], ...indRows],
      { widths: [3300, 1400, 1400, 1338, 2200] }));
  }

  const e = clinicEfficiency(c, S);
  const effRows = [
    ['Έσοδο ανά εισαγωγή', e.perAdmission == null ? null : money(e.perAdmission), 'ενδονοσοκομειακά έσοδα ÷ εισαγωγές'],
    ['Έσοδο ανά επίσκεψη', e.perVisit == null ? null : U.fmt(e.perVisit, 2) + ' €', 'έσοδα εξωτερικών ÷ επισκέψεις'],
    ['Έσοδο ανά κλίνη', e.perBed == null ? null : money(e.perBed), 'σύνολο εσόδων ÷ κλίνες της περιόδου'],
    ['Εισαγωγές ανά κλίνη', e.admissionsPerBed == null ? null : U.fmt(e.admissionsPerBed, 1), 'ρυθμός εναλλαγής κλίνης'],
  ].filter(x => x[1]);
  if (effRows.length) {
    out.push(heading('Αποδοτικότητα', 2));
    out.push(table([['Μέγεθος', r('Τιμή'), 'Υπολογισμός'],
      ...effRows.map(([a, b, n]) => [a, r(b), n])], { widths: [2800, 1800, 5038] }));
  }

  if (c.hio) {
    const h = c.hio;
    out.push(heading('Τιμολόγηση ΟΑΥ — IS Auditor', 2));
    out.push(table([['Μέγεθος', r('Τιμή')],
      ['Περιστατικά DRG', r(U.fmt(h.cases) + (h.daycare ? ` (+${U.fmt(h.daycare)} ημερήσια)` : ''))],
      ['CMI (θετικά βάρη)', r(h.cmi == null ? '—' : U.fmt(h.cmi, 3))],
      ['Μέση διάρκεια νοσηλείας', r(h.alos == null ? '—' : U.fmt(h.alos, 1) + ' ημέρες')],
      ['Επείγουσες εισαγωγές', r(h.emergPct == null ? '—' : U.fmt(h.emergPct, 0) + '%')],
      ['Απορρίψεις / αναθεωρήσεις', r(`${U.fmt(h.revRows)} · ${money(h.revAmt)}`)]],
      { widths: [6138, 3500] }));
    out.push(note(`Ειδικότητα «${h.label}», με καταμέτρηση κατά ημερομηνία εξιτηρίου. `
      + (h.maturity?.immature ? `Οι μήνες ${h.maturity.immature} δεν έχουν υποβληθεί πλήρως και λείπουν από τα νούμερα αυτά.`
        : 'Όλοι οι μήνες της περιόδου έχουν υποβληθεί.')));
  }

  const actions = clinicActions(c, S);
  if (actions.length) {
    out.push(heading('Σημεία δράσης', 2));
    out.push(...actions.map(t => para(t, { bullet: true, size: 10.5 })));
  }

  if (c.notes.length) {
    out.push(heading('Από την έκθεση', 2));
    out.push(...c.notes.slice(0, 6).map(n => para([{ text: n.section + ' — ', bold: true }, { text: n.text }],
      { bullet: true, size: 10 })));
    out.push(note(`Αυτούσια αποσπάσματα από «${state.report?.file ?? ''}».`));
  }
  return out;
}

/* the same rules as the screen's «Σημεία δράσης», as plain sentences */
function clinicActions(c, S) {
  const out = [];
  const rev = c.revenue ? pctChange(c.revenue.cur.total, c.revenue.prev.total) : null;
  const adm = clinicYoY(c, 'adm', S.year);
  if (rev != null && adm != null && rev < -5 && adm >= -2) {
    out.push(`Τα έσοδα υποχώρησαν ${U.pct(rev)} ενώ οι εισαγωγές κρατήθηκαν (${U.pct(adm)}) — το μείγμα περιστατικών ή η τιμολόγηση θέλουν έλεγχο, όχι ο όγκος.`);
  }
  if (rev != null && adm != null && rev > 5 && adm < -2) {
    out.push(`Τα έσοδα ανέβηκαν ${U.pct(rev)} με λιγότερες εισαγωγές (${U.pct(adm)}) — βαρύτερα περιστατικά ανά νοσηλεία.`);
  }
  const occ = c.series.occ?.[S.year];
  if (occ != null && occ > 100) out.push(`Πληρότητα ${U.fmt(occ, 1)}% — συστηματική υπερφόρτωση κλινών· η ΜΔΝ και οι διασπορές θέλουν παρακολούθηση.`);
  else if (occ != null && occ < 55) out.push(`Πληρότητα ${U.fmt(occ, 1)}% — υπάρχει περιθώριο για περισσότερα προγραμματισμένα περιστατικά ή ανακατανομή κλινών.`);
  const alosD = clinicYoY(c, 'alos', S.year);
  if (alosD != null && alosD > 8) out.push(`Η μέση διάρκεια νοσηλείας αυξήθηκε ${U.pct(alosD)} — κάθε επιπλέον ημέρα δεσμεύει κλίνη χωρίς πρόσθετο έσοδο DRG.`);
  const outD = clinicYoY(c, 'out', S.year);
  if (outD != null && outD < -8) out.push(`Οι επισκέψεις εξωτερικών ιατρείων μειώθηκαν ${U.pct(outD)} — λιγότερες παραπομπές σημαίνει και λιγότερες μελλοντικές εισαγωγές.`);
  const dcD = clinicYoY(c, 'dc', S.year);
  if (dcD != null && dcD > 15) out.push(`Η ημερήσια νοσηλεία αυξήθηκε ${U.pct(dcD)} — μετατόπιση από την κλασική νοσηλεία, με χαμηλότερο κόστος ανά περιστατικό.`);
  return out;
}

/* ---------- packaging ---------- */

export async function buildDocxBlob() {
  const { body, media, hospital, period, model } = await buildDocxParts();
  const parts = [
    { name: '[Content_Types].xml', data: contentTypes(new Set(media.length ? ['png'] : [])) },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: coreProps(`Πίνακας Δεικτών — ΓΝ ${hospital} — ${period}`) },
    { name: 'docProps/app.xml', data: appProps },
    { name: 'word/document.xml', data: documentXml(body, { headerRid: 'rIdHdr', footerRid: 'rIdFtr' }) },
    { name: 'word/_rels/document.xml.rels', data: documentRels(media) },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'word/fontTable.xml', data: fontTable },
    { name: 'word/header1.xml', data: header(`ΓΝ ${hospital} · Πίνακας Δεικτών · ${period}`) },
    { name: 'word/footer1.xml', data: footer('Οργανισμός Κρατικών Υπηρεσιών Υγείας') },
    ...media.map(m => ({ name: `word/media/${m.name}`, data: m.bytes })),
  ];
  return { blob: await zipWrite(parts), clinicCount: model.clinics.length };
}

export async function exportDOCX() {
  const { blob, clinicCount } = await buildDocxBlob();
  download(blob, exportFileName(state.stats, 'docx'));
  return clinicCount;
}
