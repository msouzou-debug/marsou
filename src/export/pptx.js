/* ---------- PowerPoint export ----------
   Replaces the 51-slide manual deck: the hospital's period in ~14 branded
   slides, then one slide for every clinic so a director can be handed their own
   page. Everything comes from the same computed model as the screen.

   Charts are the dashboard's own SVG components rasterised to PNG at 2× —
   nothing is drawn twice, so a chart can never disagree with the page. */
import { U } from '../util.js';
import { state } from '../state.js';
import { computeHIO } from '../model/hio.js';
import { sumBlocksMonthly, yoy } from '../model/blocks.js';
import { buildStory, buildFlags } from '../model/story.js';
import { buildClinics, clinicYoY, clinicTrend, clinicEfficiency, pctChange, REVENUE_STREAMS } from '../model/clinic.js';
import { C, lineChart, barChartYears, barChartPaired, barChartSigned } from '../render/charts.js';
import { zipWrite } from './zipwrite.js';
import { download, exportFileName } from './html.js';
import {
  SLIDE_W, SLIDE_H, BRAND, textBox, rect, picture, table, slideXml, slideRels,
  theme, slideMaster, slideMasterRels, slideLayout, slideLayoutRels,
  presentation, presentationRels, presProps, viewProps, tableStyles,
  rootRels, contentTypes, coreProps, appProps,
} from './ooxml.js';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/* ---------- images ---------- */

const dataUrlToBytes = (url) => {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/* SVG → PNG through a canvas, at twice the placed size so it stays crisp when
   the slide is projected. */
export function svgToPng(svg, w, h, scale = 2) {
  return new Promise((resolve, reject) => {
    const doc = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(dataUrlToBytes(canvas.toDataURL('image/png')));
    };
    img.onerror = () => reject(new Error('Το γράφημα δεν μετατράπηκε σε εικόνα.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(doc);
  });
}

const logoBytes = (selector) => {
  const src = document.querySelector(selector)?.getAttribute('src');
  return src?.startsWith('data:image/png') ? dataUrlToBytes(src) : null;
};

/* ---------- slide chrome ---------- */

const M = 48;                       // page margin
const BAR_H = 40;                   // the bright-blue bottom bar

function chrome(title, subtitle, index, total, dateText, logoRid) {
  const shapes = [
    rect({ x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: BRAND.white }),
    textBox({ x: M, y: 30, w: SLIDE_W - 2 * M, h: 30, lines: [title], size: 21, bold: true, color: BRAND.blueDeep }),
  ];
  if (subtitle) shapes.push(textBox({ x: M, y: 58, w: SLIDE_W - 2 * M, h: 18, lines: [subtitle], size: 11, color: BRAND.muted }));
  shapes.push(rect({ x: M, y: 80, w: SLIDE_W - 2 * M, h: 1, fill: BRAND.grey }));
  shapes.push(rect({ x: 0, y: SLIDE_H - BAR_H, w: SLIDE_W, h: BAR_H, fill: BRAND.blue }));
  if (logoRid) shapes.push(picture({ x: SLIDE_W / 2 - 34, y: SLIDE_H - BAR_H + 7, w: 68, h: 26, rId: logoRid }));
  shapes.push(textBox({ x: M, y: SLIDE_H - BAR_H + 14, w: 240, h: 16, lines: [dateText], size: 9.5, color: BRAND.white }));
  shapes.push(textBox({ x: SLIDE_W - M - 120, y: SLIDE_H - BAR_H + 14, w: 120, h: 16,
    lines: [`${index} / ${total}`], size: 9.5, color: BRAND.white, align: 'r' }));
  return shapes;
}

/* a KPI tile, the same shape as on screen */
function tile(x, y, w, h, label, value, delta) {
  return [
    rect({ x, y, w, h, fill: BRAND.white, line: { color: BRAND.grey, w: 0.75 } }),
    rect({ x, y, w, h: 3, fill: BRAND.blue }),
    textBox({ x: x + 10, y: y + 12, w: w - 20, h: 26, lines: [label], size: 9.5, color: BRAND.text }),
    textBox({ x: x + 10, y: y + 36, w: w - 20, h: 26, lines: [value], size: 20, bold: true, color: BRAND.blueDeep }),
    textBox({ x: x + 10, y: y + 62, w: w - 20, h: 16, lines: [delta || ''], size: 9.5, bold: true,
      color: !delta ? BRAND.muted : delta.startsWith('▼') ? BRAND.neg : delta.startsWith('▲') ? '5A8A1F' : BRAND.muted }),
  ];
}

const tileRow = (items, y, h = 84) => {
  const gap = 12, w = (SLIDE_W - 2 * M - gap * (items.length - 1)) / items.length;
  return items.flatMap((it, i) => tile(M + i * (w + gap), y, w, h, it[0], it[1], it[2]));
};

const money = (v) => (v == null ? '—' : U.fmt(v, 0) + ' €');
const arrow = (d) => (d == null ? '' : (d > 1 ? '▲ ' : d < -1 ? '▼ ' : '≈ ') + U.pct(d));

/* ---------- the deck ---------- */

export async function buildSlides() {
  const S = state.stats;
  if (!S) throw new Error('Δεν έχει φορτωθεί αρχείο στατιστικών.');
  const K = S.kpi, y = S.year;
  const model = buildClinics();
  const H = state.isRows.length ? computeHIO(state.isRows, S) : null;
  const periodEnd = U.MONTHS_FULL[S.mN - 1];
  const period = `Ιανουάριος – ${periodEnd} ${y} (σύγκριση με την ίδια περίοδο του ${y - 1})`;
  const hospital = (S.title.match(/ΓΕΝΙΚΟΥ ΝΟΣΟΚΟΜΕΙΟΥ\s+([Α-ΩΪΫ]+)/) || [null, 'ΝΟΣΟΚΟΜΕΙΟ'])[1];

  const media = [];                 // {name, bytes}
  const addImage = (bytes, ext = 'png') => {
    const name = `image${media.length + 1}.${ext}`;
    media.push({ name, bytes });
    return name;
  };
  const headerLogo = logoBytes('header img');
  const footerLogo = logoBytes('footer img');
  const headerLogoName = headerLogo && addImage(headerLogo);
  const footerLogoName = footerLogo && addImage(footerLogo);

  const slides = [];                // {shapes:[], images:[{name}]}
  const chart = async (svg, w, h) => (svg ? addImage(await svgToPng(svg, w, h)) : null);

  /* 1 — title */
  slides.push({
    plain: true,
    images: [headerLogoName, footerLogoName].filter(Boolean),
    shapes: [
      rect({ x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: BRAND.white }),
      rect({ x: 0, y: 0, w: SLIDE_W, h: 6, fill: BRAND.blueDeep }),
      ...(headerLogoName ? [picture({ x: M, y: 70, w: 150, h: 58, rId: 'rIdImg1' })] : []),
      textBox({ x: M, y: 190, w: SLIDE_W - 2 * M, h: 60, lines: [`ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ${hospital}`], size: 34, bold: true, color: BRAND.blueDeep }),
      textBox({ x: M, y: 244, w: SLIDE_W - 2 * M, h: 30, lines: ['Πίνακας Δεικτών — Στατιστικά και Οικονομικά Στοιχεία'], size: 17, color: BRAND.text }),
      textBox({ x: M, y: 288, w: SLIDE_W - 2 * M, h: 24, lines: [period], size: 13, color: BRAND.muted }),
      rect({ x: M, y: 330, w: 120, h: 4, fill: BRAND.green }),
      textBox({ x: M, y: 356, w: SLIDE_W - 2 * M, h: 40,
        lines: ['Οργανισμός Κρατικών Υπηρεσιών Υγείας (ΟΚΥπΥ)'], size: 12, color: BRAND.text }),
      rect({ x: 0, y: SLIDE_H - BAR_H, w: SLIDE_W, h: BAR_H, fill: BRAND.blue }),
    ],
  });

  /* 2 — the period in one page */
  const kpiOrder = ['adm', 'dc', 'opd', 'taepA', 'surg', 'dial'];
  slides.push({
    title: 'Σύνοψη περιόδου', subtitle: period,
    shapes: [
      textBox({ x: M, y: 100, w: SLIDE_W - 2 * M, h: 80, lines: [buildStory()], size: 12.5, color: BRAND.text }),
      ...tileRow(kpiOrder.filter(k => K[k]?.cur != null).slice(0, 3).map(k =>
        [K[k].label, U.fmt(K[k].cur), `${arrow(yoy(k))} (${U.fmt(K[k].prev)})`]), 196),
      ...tileRow(kpiOrder.filter(k => K[k]?.cur != null).slice(3, 6).map(k =>
        [K[k].label, U.fmt(K[k].cur), `${arrow(yoy(k))} (${U.fmt(K[k].prev)})`]), 292),
    ],
  });

  /* 3 — targets */
  const targets = Object.values(K).filter(x => x.target > 0 && x.cur != null)
    .map(x => ({ label: x.label, cur: x.cur, pro: x.target * S.mN / 12 }))
    .map(x => ({ ...x, pct: 100 * x.cur / x.pro })).sort((a, b) => a.pct - b.pct).slice(0, 11);
  if (targets.length) {
    slides.push({
      title: 'Στόχοι έτους — αναλογική πορεία', subtitle: `οι ετήσιοι στόχοι ανάγονται σε ${S.mN}/12`,
      shapes: [table({
        x: M, y: 100, w: SLIDE_W - 2 * M, colWidths: [380, 140, 170, 174], rowHeight: 25,
        rows: [['Δείκτης', 'Επίτευξη', 'Πραγματοποίηση', 'Αναλογικός στόχος'],
          ...targets.map(t => [t.label, { text: U.fmt(t.pct, 0) + '%', bold: true, color: t.pct >= 100 ? '5A8A1F' : t.pct >= 90 ? 'B98400' : BRAND.neg },
            U.fmt(t.cur), U.fmt(t.pro)])],
      })],
    });
  }

  /* 4 — admissions: trend and the clinics that moved */
  const admSeries = (yy) => { const m = sumBlocksMonthly('adm', yy); const v = []; for (let i = 0; i < 12; i++) v.push(m?.[i] ?? null); return v; };
  const admChart = await chart(lineChart([
    { name: String(y - 2), color: C.old, vals: admSeries(y - 2), w: 1.6 },
    { name: String(y - 1), color: C.y1, vals: admSeries(y - 1), dash: true, w: 1.8 },
    { name: String(y), color: C.y0, vals: admSeries(y), w: 2.6 },
  ], U.MONTHS_EL), 380, 190);
  const movers = model.clinics.map(c => ({ name: c.label, val: clinicYoY(c, 'adm', y) }))
    .filter(x => x.val != null && (model.clinics.find(c => c.label === x.name)?.series.adm?.[y] ?? 0) > 30)
    .sort((a, b) => b.val - a.val);
  const moversChart = movers.length > 5
    ? await chart(barChartSigned([...movers.slice(0, 5), ...movers.slice(-5)]), 380, 228) : null;
  slides.push({
    title: 'Εισαγωγές ασθενών', subtitle: `${U.fmt(K.adm?.cur)} εισαγωγές · ${arrow(yoy('adm'))} έναντι του ${y - 1}`,
    images: [admChart, moversChart].filter(Boolean),
    shapes: [
      ...(admChart ? [textBox({ x: M, y: 96, w: 420, h: 18, lines: ['Ανά μήνα, με τα δύο προηγούμενα έτη'], size: 10.5, color: BRAND.muted }),
        picture({ x: M, y: 118, w: 420, h: 210, rId: 'rIdImg1' })] : []),
      ...(moversChart ? [textBox({ x: SLIDE_W / 2 + 10, y: 96, w: 420, h: 18, lines: ['Μεγαλύτερες μεταβολές ανά κλινική'], size: 10.5, color: BRAND.muted }),
        picture({ x: SLIDE_W / 2 + 10, y: 118, w: 400, h: 240, rId: admChart ? 'rIdImg2' : 'rIdImg1' })] : []),
    ],
  });

  /* 5 — occupancy and length of stay per clinic */
  const occRows = model.clinics
    .filter(c => c.series.occ?.[y] != null)
    .sort((a, b) => b.series.occ[y] - a.series.occ[y]).slice(0, 12)
    .map(c => [c.label, U.fmt(c.series.occ[y], 1) + '%', arrow(clinicYoY(c, 'occ', y)),
      c.series.alos?.[y] == null ? '—' : U.fmt(c.series.alos[y], 1), c.beds?.beds == null ? '—' : U.fmt(c.beds.beds)]);
  if (occRows.length) {
    slides.push({
      title: 'Πληρότητα και μέση διάρκεια νοσηλείας', subtitle: 'ανά κλινική, μέσος όρος περιόδου',
      shapes: [table({
        x: M, y: 100, w: SLIDE_W - 2 * M, colWidths: [364, 130, 130, 130, 110], rowHeight: 24,
        rows: [['Κλινική', 'Πληρότητα', 'Δ% έναντι ' + (y - 1), 'ΜΔΝ (ημ.)', 'Κλίνες'], ...occRows],
      })],
    });
  }

  /* 6-9 — the activity blocks of the manual deck */
  const activity = [
    ['Χειρουργεία', [['surg', K.surg], ['minor', K.minor]], 'Χειρουργικές επεμβάσεις και μικρά χειρουργεία'],
    ['Εξωτερικά ιατρεία', [['opd', K.opd]], 'Επισκέψεις εξωτερικών ιατρείων'],
    ['ΤΑΕΠ', [['taepA', K.taepA], ['taepP', K.taepP]], 'Τμήμα Ατυχημάτων και Επειγόντων Περιστατικών'],
    ['Ημερήσια νοσηλεία και αιμοκαθάρσεις', [['dc', K.dc], ['dial', K.dial]], 'Ημερήσια φροντίδα και νεφρολογικό'],
  ];
  for (const [title, keys, subtitle] of activity) {
    const present = keys.filter(([, k]) => k?.cur != null);
    if (!present.length) continue;
    const perClinicKey = title.startsWith('Χειρουργεία') ? 'surg' : title.startsWith('Εξωτερικά') ? 'out' : null;
    const rows = perClinicKey ? model.clinics.filter(c => c.series[perClinicKey]?.[y] != null)
      .sort((a, b) => b.series[perClinicKey][y] - a.series[perClinicKey][y]).slice(0, 12)
      .map(c => [c.label, U.fmt(c.series[perClinicKey][y]), U.fmt(c.series[perClinicKey][y - 1]), arrow(clinicYoY(c, perClinicKey, y))]) : [];
    slides.push({
      title, subtitle,
      shapes: [
        ...tileRow(present.map(([k, kpi]) => [kpi.label, U.fmt(kpi.cur), `${arrow(yoy(k))} (${U.fmt(kpi.prev)})`]), 100),
        ...(rows.length ? [table({
          x: M, y: 204, w: SLIDE_W - 2 * M, colWidths: [438, 142, 142, 142], rowHeight: 22,
          rows: [['Κλινική', String(y), String(y - 1), 'Δ%'], ...rows],
        })] : []),
      ],
    });
  }

  /* 10 — ΟΑΥ revenue per clinic */
  if (model.hasRevenue) {
    const top = model.clinics.filter(c => c.revenue).slice(0, 12);
    const totals = model.totals;
    const revChart = totals ? await chart(barChartPaired([
      { name: 'Ενδονοσ.', cur: totals.cur.inpatient, prev: totals.prev.inpatient },
      { name: 'Εξωτερικά', cur: totals.cur.outpatient, prev: totals.prev.outpatient },
      { name: 'Ημερήσια', cur: totals.cur.daycare, prev: totals.prev.daycare },
    ], { curLabel: String(y), prevLabel: String(y - 1) }), 380, 160) : null;
    slides.push({
      title: 'Έσοδα ΟΑΥ ανά κλινική', subtitle: totals ? `Σύνολο ${money(totals.cur.total)} · ${arrow(pctChange(totals.cur.total, totals.prev.total))} έναντι του ${y - 1}` : '',
      images: [revChart].filter(Boolean),
      shapes: [
        table({
          x: M, y: 100, w: 540, colWidths: [250, 150, 140], rowHeight: 22,
          rows: [['Κλινική', String(y), 'Δ%'],
            ...top.map(c => [c.label, money(c.revenue.cur.total), arrow(pctChange(c.revenue.cur.total, c.revenue.prev.total))])],
        }),
        ...(revChart ? [picture({ x: 610, y: 110, w: 302, h: 127, rId: 'rIdImg1' })] : []),
      ],
    });
  }

  /* 11 — P&L */
  if (S.fin?.pl) {
    const lines = S.fin.pl.filter(l => !l.heading).slice(0, 14);
    slides.push({
      title: 'Λογαριασμός αποτελεσμάτων', subtitle: `Ιανουάριος – ${periodEnd}, ${y} έναντι ${y - 1}`,
      shapes: [table({
        x: M, y: 100, w: SLIDE_W - 2 * M, colWidths: [404, 156, 156, 148], rowHeight: 22,
        rows: [['', String(y), String(y - 1), 'Δ%'],
          ...lines.map(l => [{ text: l.label, bold: !!l.strong }, money(l.cur), money(l.prev),
            l.prev > 0 ? arrow(pctChange(l.cur, l.prev)) : (l.cur == null ? '—' : (l.cur - (l.prev ?? 0) >= 0 ? '+' : '') + U.fmt(l.cur - (l.prev ?? 0), 0) + ' €')])],
      })],
    });
  }

  /* 12 — the ΟΑΥ cross-check and what is still unsubmitted */
  if (H) {
    const admM = sumBlocksMonthly('adm', y) || {};
    const rows = [];
    for (let i = 0; i < S.mN; i++) {
      const mature = H.maturity.mature[i];
      rows.push([`${U.MONTHS_EL[i]}${mature ? '' : '  (εκκρεμείς υποβολές)'}`,
        U.fmt(admM[i] ?? null), U.fmt(H.byMonth[i]),
        admM[i] ? U.fmt(100 * H.byMonth[i] / admM[i], 0) + '%' : '—']);
    }
    const missing = H.maturity.missingRuns.map(k => `${U.MONTHS_EL[k % 12]} ${Math.floor(k / 12)}`).join(' και ');
    slides.push({
      title: 'Διασταύρωση με ΟΑΥ', subtitle: 'εξιτήρια DRG κατά μήνα εξιτηρίου, έναντι των εισαγωγών του νοσοκομείου',
      shapes: [
        table({ x: M, y: 100, w: 560, colWidths: [230, 110, 110, 110], rowHeight: 23,
          rows: [['Μήνας', 'Εισαγωγές', 'Τιμολογημένα', 'Κάλυψη'], ...rows] }),
        textBox({ x: 630, y: 104, w: SLIDE_W - 630 - M, h: 200, size: 11, color: BRAND.text, lines: [
          { runs: [{ text: 'Ο ΟΑΥ εξοφλεί σε παράθυρο τριών μηνών.', bold: true }] },
          `Τα εξιτήρια ενός μήνα υποβάλλονται στη δική του υποβολή και στις δύο επόμενες, οπότε μόνο οι πλήρεις μήνες συγκρίνονται.`,
          missing ? `Εκκρεμούν τα IS Auditor ${missing}.` : 'Όλοι οι μήνες της περιόδου έχουν υποβληθεί.',
        ] }),
        ...tileRow([
          ['CMI (θετικά βάρη)', H.cmi ? U.fmt(H.cmi, 3) : '—', ''],
          ['Μέση διάρκεια νοσηλείας', H.alos ? U.fmt(H.alos, 1) + ' ημ.' : '—', ''],
          ['Επείγουσες εισαγωγές', H.emergPct ? U.fmt(H.emergPct, 0) + '%' : '—', ''],
          ['Απορρίψεις / Αναθεωρήσεις', U.fmt(H.revRows), money(H.revAmt)],
        ], 356),
      ],
    });
  }

  /* 13 — what to watch */
  const flags = buildFlags().slice(0, 9);
  if (flags.length) {
    slides.push({
      title: 'Σημεία προσοχής', subtitle: 'αυτόματοι έλεγχοι στα δεδομένα της περιόδου',
      shapes: flags.map((f, i) => textBox({
        x: M, y: 104 + i * 40, w: SLIDE_W - 2 * M, h: 34, size: 11.5,
        color: f.t === 'flag' ? BRAND.neg : f.t === 'good' ? '5A8A1F' : BRAND.text,
        lines: [`• ${f.m}`],
      })),
    });
  }

  /* 14 — how the figures were produced */
  slides.push({
    title: 'Μεθοδολογία και παραδοχές', subtitle: 'πηγές και κανόνες υπολογισμού',
    shapes: [textBox({
      x: M, y: 100, w: SLIDE_W - 2 * M, h: 360, size: 11.5, color: BRAND.text, lines: [
        `• Πηγή: το μηνιαίο αρχείο «ΣΤΑΤΙΣΤΙΚΑ ΣΤΟΙΧΕΙΑ» του νοσοκομείου. Τα μεγέθη του ${y} αφορούν την περίοδο Ιανουαρίου–${periodEnd} και συγκρίνονται με την ίδια περίοδο του ${y - 1}.`,
        `• Οι στόχοι του φύλλου ΣΤΟΧΟΣ είναι ετήσιοι και ανάγονται αναλογικά σε ${S.mN}/12.`,
        '• Τα έσοδα ΟΑΥ ανά κλινική προέρχονται από το φύλλο «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ» του ίδιου αρχείου: είναι τιμολογημένα, όχι εισπραγμένα, και δεν επιμερίζονται ΤΑΕΠ ή ΥΓΟΣ.',
        '• Η διασταύρωση με τον ΟΑΥ βασίζεται στα IS Auditor Reports, με καταμέτρηση κατά ημερομηνία εξιτηρίου. Ο ΟΑΥ εξοφλεί σε παράθυρο τριών μηνών, οπότε ένας μήνας θεωρείται πλήρης μόνο όταν υπάρχουν και οι δύο επόμενες υποβολές.',
        '• Τα δύο συστήματα μετρούν διαφορετικούς πληθυσμούς (ασθενείς εκτός ΓεΣΥ, ενδονοσοκομειακές διακομιδές, ψυχιατρική και παραπληγικό εκτός DRG). Οι αποκλίσεις είναι ενδείξεις για διερεύνηση, όχι αυτόματα «χαμένα έσοδα».',
        `• Αρχεία που χρησιμοποιήθηκαν: ${[S.title, ...state.isFiles, ...state.aeFiles, ...state.osFiles, state.report?.file].filter(Boolean).join(' · ')}`,
      ],
    })],
  });

  /* one slide per clinic — the page a director is handed */
  for (const c of model.clinics) {
    const e = clinicEfficiency(c, S);
    const t = clinicTrend(c, c.series.adm ? 'adm' : 'out', model.years);
    const yearsChart = c.series.adm || c.series.out
      ? await chart(barChartYears(model.years.map(yy => ({
          label: String(yy), val: (c.series.adm ?? c.series.out)[yy] ?? null, current: yy === y,
        })), { dec: 0 }), 380, 150)
      : null;
    const revTiles = c.revenue
      ? [['Έσοδα ΟΑΥ', money(c.revenue.cur.total), arrow(pctChange(c.revenue.cur.total, c.revenue.prev.total))],
         ...REVENUE_STREAMS.map(s => [s.label, money(c.revenue.cur[s.key]), arrow(pctChange(c.revenue.cur[s.key], c.revenue.prev[s.key]))])]
      : [['Έσοδα ΟΑΥ', '—', 'χωρίς δική της γραμμή τιμολόγησης']];
    const actRows = [
      ['Εισαγωγές', c.series.adm?.[y], c.series.adm?.[y - 1], clinicYoY(c, 'adm', y)],
      ['Εξωτερικά ιατρεία', c.series.out?.[y], c.series.out?.[y - 1], clinicYoY(c, 'out', y)],
      ['Ημερήσια νοσηλεία', c.series.dc?.[y], c.series.dc?.[y - 1], clinicYoY(c, 'dc', y)],
      ['Χειρουργεία', c.series.surg?.[y], c.series.surg?.[y - 1], clinicYoY(c, 'surg', y)],
      ['Πληρότητα κλινών', c.series.occ?.[y], c.series.occ?.[y - 1], clinicYoY(c, 'occ', y)],
      ['Μέση διάρκεια νοσηλείας', c.series.alos?.[y], c.series.alos?.[y - 1], clinicYoY(c, 'alos', y)],
    ].filter(r => r[1] != null)
      .map(([label, cur, prev, d]) => [label,
        U.fmt(cur, label.startsWith('Πληρότητα') || label.startsWith('Μέση') ? 1 : 0),
        U.fmt(prev, label.startsWith('Πληρότητα') || label.startsWith('Μέση') ? 1 : 0), arrow(d)]);

    slides.push({
      title: c.label, subtitle: `Ιανουάριος – ${periodEnd} ${y}${t ? ` · διαχρονικά ${t.from}→${t.to}: ${U.pct(t.total)}` : ''}`,
      images: [yearsChart].filter(Boolean),
      shapes: [
        ...tileRow(revTiles, 96, 78),
        ...(actRows.length ? [table({
          x: M, y: 192, w: 540, colWidths: [240, 100, 100, 100], rowHeight: 22,
          rows: [['Δραστηριότητα', String(y), String(y - 1), 'Δ%'], ...actRows],
        })] : []),
        ...(yearsChart ? [
          textBox({ x: 610, y: 192, w: SLIDE_W - 610 - M, h: 16, lines: ['Διαχρονικά, ίδια περίοδος κάθε έτους'], size: 10, color: BRAND.muted }),
          picture({ x: 610, y: 212, w: 302, h: 119, rId: 'rIdImg1' })] : []),
        textBox({ x: M, y: 400, w: SLIDE_W - 2 * M, h: 70, size: 11, color: BRAND.text, lines: [
          [e.perAdmission == null ? null : `Έσοδο ανά εισαγωγή ${money(e.perAdmission)}`,
           e.perVisit == null ? null : `ανά επίσκεψη ${U.fmt(e.perVisit, 2)} €`,
           e.perBed == null ? null : `ανά κλίνη ${money(e.perBed)}`,
           c.beds?.beds ? `${U.fmt(c.beds.beds)} κλίνες` : null].filter(Boolean).join(' · '),
          c.hio ? `ΟΑΥ: ${U.fmt(c.hio.cases)} περιστατικά DRG · CMI ${c.hio.cmi == null ? '—' : U.fmt(c.hio.cmi, 3)} · ΜΔΝ ${c.hio.alos == null ? '—' : U.fmt(c.hio.alos, 1)} ημ.${c.hio.maturity?.immature ? ` · ελλιπείς μήνες: ${c.hio.maturity.immature}` : ''}` : '',
        ] }),
      ],
    });
  }

  return { slides, media, footerLogoName, hospital, period };
}

/* ---------- packaging ---------- */

export async function buildPptxBlob() {
  const { slides, media, footerLogoName, hospital, period } = await buildSlides();
  const dateText = new Date().toLocaleDateString('el-GR');
  const total = slides.length;

  const parts = [
    { name: '[Content_Types].xml', data: contentTypes(total, new Set(media.map(m => m.name.split('.').pop()))) },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: coreProps(`Πίνακας Δεικτών — ΓΝ ${hospital} — ${period}`) },
    { name: 'docProps/app.xml', data: appProps(total) },
    { name: 'ppt/presentation.xml', data: presentation(total) },
    { name: 'ppt/_rels/presentation.xml.rels', data: presentationRels(total) },
    { name: 'ppt/theme/theme1.xml', data: theme },
    { name: 'ppt/presProps.xml', data: presProps },
    { name: 'ppt/viewProps.xml', data: viewProps },
    { name: 'ppt/tableStyles.xml', data: tableStyles },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: slideMaster },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: slideMasterRels },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: slideLayout },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: slideLayoutRels },
  ];

  slides.forEach((slide, i) => {
    /* every slide gets the footer logo plus whatever charts it carries, in the
       order the shapes reference them */
    const own = slide.plain ? (slide.images || []) : [...(slide.images || []), footerLogoName].filter(Boolean);
    const images = own.map((name, k) => ({ name, rId: `rIdImg${k + 1}` }));
    const logoRid = slide.plain ? null : images.find(im => im.name === footerLogoName)?.rId;
    const shapes = slide.plain
      ? slide.shapes
      : [...chrome(slide.title, slide.subtitle, i + 1, total, dateText, logoRid), ...slide.shapes];
    parts.push({ name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(shapes) });
    parts.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: slideRels(images) });
  });

  for (const m of media) parts.push({ name: `ppt/media/${m.name}`, data: m.bytes });

  return { blob: await zipWrite(parts, PPTX_MIME), slideCount: total };
}

export async function exportPPTX() {
  const { blob, slideCount } = await buildPptxBlob();
  download(blob, exportFileName(state.stats, 'pptx'));
  return slideCount;
}
