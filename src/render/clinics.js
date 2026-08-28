/* ---------- «Ανά κλινική» ----------
   A clinic director opens this, presses their clinic, and sees only their own:
   the ΟΑΥ revenue booked under it and how it moved, the activity behind that
   revenue, what a bed and a visit are worth, the multi-year line, and the
   paragraphs the quarterly report wrote about them. */
import { U } from '../util.js';
import { state } from '../state.js';
import {
  CLINIC_INDICATORS, CLINIC_ANNUAL, REVENUE_STREAMS,
  buildClinics, clinicYoY, clinicTrend, clinicEfficiency, pctChange,
} from '../model/clinic.js';
import { C, lineChart, barChartYears, barChartPaired } from './charts.js';
import { el } from './dom.js';
import { syncClinics, currentClinic, setClinic, onClinicChange } from './scope.js';

const ALL_INDICATORS = [...CLINIC_INDICATORS, ...CLINIC_ANNUAL];

/* The picked clinic lives in the scope bar at the top of the page, so this
   module only has to redraw when the bar says the choice changed. The model is
   kept alongside because that redraw arrives without one. */
let lastModel = null, lastS = null;
onClinicChange(() => { if (lastModel) renderDetail(lastModel, lastS); });

const money = (v, dec = 0) => (v == null ? '—' : U.fmt(v, dec) + ' €');
const val = (v, def) => (v == null ? '—' : U.fmt(v, def.dec) + def.unit);

function delta(d) {
  if (d == null) return '<span class="delta flat">—</span>';
  const cls = d > 1 ? 'up' : d < -1 ? 'down' : 'flat';
  const arrow = d > 1 ? '▲ ' : d < -1 ? '▼ ' : '≈ ';
  return `<span class="delta ${cls}">${arrow}${U.pct(d)}</span>`;
}

export function renderClinics() {
  const S = state.stats, box = el('clinics');
  if (!S) { el('secClinics').classList.add('hidden'); return; }
  const model = buildClinics();
  if (!model.clinics.length) { el('secClinics').classList.add('hidden'); return; }
  el('secClinics').classList.remove('hidden');

  lastModel = model; lastS = S;
  /* the list at the top of the page is the only clinic picker there is */
  syncClinics(model.clinics);

  box.innerHTML = `
    <div class="note" style="margin:0 0 16px">Κάθε μέγεθος αφορά την περίοδο Ιανουαρίου–${U.MONTHS_GEN[S.mN - 1]} και συγκρίνεται με την ίδια περίοδο κάθε προηγούμενου έτους.</div>
    <div id="clinicDetail"></div>
    <h3 class="clinic-h3">Όλες οι κλινικές — ${S.year} έναντι ${S.year - 1}</h3>
    <div class="scrollx">${summaryTable(model, S)}</div>
    ${unmatchedNote(model)}`;

  /* the summary table doubles as a picker: a row is the same choice as the list */
  box.querySelectorAll('tr[data-clinic]').forEach(row => row.addEventListener('click', () => {
    setClinic(row.dataset.clinic, { focus: false });
    box.querySelectorAll('tr[data-clinic]').forEach(x => x.classList.toggle('on', x === row));
    el('clinicDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  renderDetail(model, S);
}

/* The whole card as a string — the live panel and the static export render the
   same markup, so what a director sees on screen is what lands in the file. */
export function clinicCardHTML(c, model, S) {
  return `
    <div class="clinic-head"><h3>${U.esc(c.label)}</h3>${pills(model, c, S)}</div>
    <div class="narrative">${U.esc(clinicStory(c, model, S))}</div>
    ${revenueBlock(c, S)}
    ${activityBlock(c, model, S)}
    ${efficiencyBlock(c, S)}
    ${hioBlock(c, S)}
    ${chartsBlock(c, model, S)}
    ${actionsBlock(c, model, S)}
    ${notesBlock(c)}`;
}

function renderDetail(model, S) {
  const c = model.clinics.find(x => x.key === currentClinic());
  if (!c) return;
  const box = el('clinicDetail');
  if (box) box.innerHTML = clinicCardHTML(c, model, S);
  document.querySelectorAll('tr[data-clinic]').forEach(x =>
    x.classList.toggle('on', x.dataset.clinic === c.key));
}

/* Every clinic, as a radio-driven dropdown. The screen picks a clinic from a
   <select>, which needs script; a file has none, so the same list is written as
   a <details> of labels over hidden radios. One click, same result, in any
   browser, on a phone, and when printed. */
export function clinicTabsHTML(model, S) {
  const id = (k) => 'exp-' + String(k).replace(/[^Α-Ωα-ωA-Za-z0-9]+/g, '-');
  const radios = model.clinics.map((c, i) =>
    `<input type="radio" class="exp-pick" name="exp-clinic" id="${id(c.key)}"${i ? '' : ' checked'}>`).join('');
  const labels = model.clinics.map(c =>
    `<label class="cbtn" for="${id(c.key)}">${U.esc(c.label)}</label>`).join('');
  const panels = model.clinics.map(c =>
    `<div class="exp-panel" id="p-${id(c.key)}">${clinicCardHTML(c, model, S)}</div>`).join('');
  /* one pair of rules per clinic: reveal its panel, and mark its name in the list */
  const rules = model.clinics.map(c =>
    `#${id(c.key)}:checked~.exp-panels>#p-${id(c.key)}{display:block}` +
    `#${id(c.key)}:checked~.exp-pickbox label[for="${id(c.key)}"]{background:var(--blue-deep);border-color:var(--blue-deep);color:#fff;font-weight:700}`).join('');
  return `<div class="exp-clinics">${radios}
    <style>${rules}</style>
    <details class="exp-pickbox"><summary>Επιλογή κλινικής — ${model.clinics.length} κλινικές</summary>
      <div class="clinicbar">${labels}</div></details>
    <div class="note" style="margin:0 0 16px">Κάθε μέγεθος αφορά την περίοδο Ιανουαρίου–${U.MONTHS_GEN[S.mN - 1]} και συγκρίνεται με την ίδια περίοδο κάθε προηγούμενου έτους.</div>
    <div class="exp-panels">${panels}</div>
    <h3 class="clinic-h3">Όλες οι κλινικές — ${S.year} έναντι ${S.year - 1}</h3>
    <div class="scrollx">${summaryTable(model, S)}</div>
    ${unmatchedNote(model)}</div>`;
}

/* where the clinic sits in the hospital */
function pills(model, c, S) {
  const out = [];
  if (c.revenue) {
    const ranked = model.clinics.filter(x => x.revenue).sort((a, b) => b.revenue.cur.total - a.revenue.cur.total);
    const pos = ranked.findIndex(x => x.key === c.key) + 1;
    const total = model.totals?.cur?.total || ranked.reduce((a, x) => a + x.revenue.cur.total, 0);
    out.push(`${pos}η από ${ranked.length} σε έσοδα ΟΑΥ`);
    if (total) out.push(`${U.fmt(100 * c.revenue.cur.total / total, 1)}% των εσόδων του νοσοκομείου`);
  }
  if (c.beds?.beds) out.push(`${U.fmt(c.beds.beds)} κλίνες`);
  if (c.beds?.dayCareBeds) out.push(`${U.fmt(c.beds.dayCareBeds)} θέσεις ημερήσιας`);
  return out.map(t => `<span class="pill">${t}</span>`).join('');
}

function revenueBlock(c, S) {
  if (!c.revenue) {
    return `<div class="flag warn" style="margin-top:16px">Το φύλλο «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ» του αρχείου δεν έχει γραμμή εσόδων ΟΑΥ με αυτή την ονομασία.
      Συνήθως πρόκειται για μονάδα που τιμολογείται μέσα σε άλλη κλινική (π.χ. ΜΕΛ, ΚΑΡΕ, Επεμβατική Καρδιολογία).</div>`;
  }
  const { cur, prev } = c.revenue;
  const tile = (label, k, accent) => {
    const v = k === 'total' ? cur.total : cur[k];
    const p = k === 'total' ? prev.total : prev[k];
    const d = pctChange(v, p);
    const abs = (v ?? 0) - (p ?? 0);
    /* against a zero base a percentage says nothing; the euro move already does */
    const move = d == null ? '' : delta(d) + ' ';
    return `<div class="kpi"${accent ? ` style="border-top-color:${C.green}"` : ''}>
      <div class="label">${label}</div>
      <div class="value" style="font-size:${accent ? 30 : 24}px">${money(v)}</div>
      <div class="subline">${move}<span style="color:#8a8b8d">${abs >= 0 ? '+' : ''}${U.fmt(abs, 0)} € έναντι ${S.year - 1}</span></div>
    </div>`;
  };
  const sources = c.revenueSources.length > 1
    ? `<div class="note">Αθροίζονται οι γραμμές τιμολόγησης του ΟΑΥ: ${c.revenueSources.map(U.esc).join(' · ')}.</div>` : '';
  return `<h3 class="clinic-h3">Έσοδα ΟΑΥ — Ιανουάριος–${U.MONTHS_FULL[S.mN - 1]} ${S.year}</h3>
    <div class="kpis">
      ${tile('Σύνολο εσόδων ΟΑΥ', 'total', true)}
      ${REVENUE_STREAMS.map(s => tile(s.label, s.key)).join('')}
    </div>${sources}`;
}

function activityBlock(c, model, S) {
  const tiles = ALL_INDICATORS.filter(def => c.series[def.key]?.[S.year] != null).map(def => {
    const d = clinicYoY(c, def.key, S.year);
    const t = clinicTrend(c, def.key, model.years);
    return `<div class="kpi"><div class="label">${def.label}</div>
      <div class="value">${val(c.series[def.key][S.year], def)}</div>
      <div class="subline">${delta(d)} <span style="color:#8a8b8d">(${val(c.series[def.key][S.year - 1], def)} το ${S.year - 1})</span></div>
      ${t ? `<div class="note" style="margin-top:6px">Διαχρονικά ${t.from}→${t.to}: ${U.pct(t.total)}${t.perYear == null ? '' : ` (${U.pct(t.perYear)}/έτος)`}</div>` : ''}
    </div>`;
  }).join('');
  if (!tiles) return '<div class="note" style="margin-top:16px">Τα φύλλα στατιστικών δεν περιέχουν δείκτες για αυτή την κλινική.</div>';
  return `<h3 class="clinic-h3">Δραστηριότητα</h3><div class="kpis">${tiles}</div>`;
}

/* what a bed, an admission and a visit are worth — the numbers a director can
   actually move */
function efficiencyBlock(c, S) {
  const e = clinicEfficiency(c, S);
  const items = [
    ['Έσοδο ανά εισαγωγή', e.perAdmission == null ? '—' : money(e.perAdmission), 'ενδονοσοκομειακά έσοδα ÷ εισαγωγές'],
    ['Έσοδο ανά επίσκεψη', e.perVisit == null ? '—' : money(e.perVisit, 2), 'έσοδα εξωτερικών ÷ επισκέψεις'],
    ['Έσοδο ανά κλίνη', e.perBed == null ? '—' : money(e.perBed), 'σύνολο εσόδων ÷ κλίνες της περιόδου'],
    ['Εισαγωγές ανά κλίνη', e.admissionsPerBed == null ? '—' : U.fmt(e.admissionsPerBed, 1), 'ρυθμός εναλλαγής κλίνης'],
  ].filter(x => x[1] !== '—');
  if (!items.length) return '';
  return `<h3 class="clinic-h3">Αποδοτικότητα</h3><div class="kpis">${items.map(([label, v, note]) =>
    `<div class="kpi" style="border-top-color:${C.y1}"><div class="label">${label}</div>
      <div class="value" style="font-size:24px">${v}</div><div class="note" style="margin-top:4px">${note}</div></div>`).join('')}</div>`;
}

/* only what the IS Auditor uniquely knows; the € come from the workbook */
function hioBlock(c, S) {
  if (!state.isRows.length || !c.hio) return '';
  const h = c.hio;
  const chip = (label, v, note) => `<div class="kpi" style="border-top-color:${C.green}">
    <div class="label">${label}</div><div class="value" style="font-size:22px">${v}</div>
    ${note ? `<div class="note" style="margin-top:4px">${note}</div>` : ''}</div>`;
  const M = c.hio.maturity;
  return `<h3 class="clinic-h3">Τιμολόγηση ΟΑΥ — IS Auditor</h3><div class="kpis">
      ${chip('Περιστατικά DRG', U.fmt(h.cases), h.daycare ? U.fmt(h.daycare) + ' ημερήσια επιπλέον' : '')}
      ${chip('CMI (θετικά βάρη)', h.cmi == null ? '—' : U.fmt(h.cmi, 3))}
      ${chip('Μέση διάρκεια νοσηλείας', h.alos == null ? '—' : U.fmt(h.alos, 1) + ' ημ.')}
      ${chip('Επείγουσες εισαγωγές', h.emergPct == null ? '—' : U.fmt(h.emergPct, 0) + '%')}
      ${chip('Απορρίψεις / Αναθεωρήσεις', U.fmt(h.revRows) + ' · ' + money(h.revAmt))}
    </div>
    <div class="note">Ειδικότητα «${U.esc(h.label)}», με καταμέτρηση κατά ημερομηνία εξιτηρίου εντός της περιόδου.
      ${M ? `Προσοχή: όσα εξιτήρια δεν έχουν ακόμη υποβληθεί λείπουν από τα νούμερα αυτά — ${M.immature
        ? `οι μήνες ${M.immature} είναι ελλιπείς.` : 'όλοι οι μήνες της περιόδου έχουν υποβληθεί.'} ` : ''}
      Τα ποσά εδώ είναι όπως υποβλήθηκαν στον ΟΑΥ και μπορεί να διαφέρουν από τα έσοδα του φύλλου «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ», που είναι η λογιστική εικόνα της περιόδου.</div>`;
}

function chartsBlock(c, model, S) {
  const cards = [];
  if (c.revenue) {
    const items = REVENUE_STREAMS.map(s => ({ name: s.label.split(' ')[0], cur: c.revenue.cur[s.key], prev: c.revenue.prev[s.key] }));
    cards.push(`<div class="card"><h3>Έσοδα ΟΑΥ ανά ροή</h3>
      ${barChartPaired(items, { curLabel: String(S.year), prevLabel: String(S.year - 1) })}</div>`);
  }
  /* monthly shape of the two indicators that drive a clinic's workload */
  for (const k of ['adm', 'out']) {
    const def = ALL_INDICATORS.find(d => d.key === k);
    const months = c.ind[k]?.years;
    if (!months?.[S.year]) continue;
    const f = (yy) => { const m = months[yy]; const v = []; for (let i = 0; i < 12; i++) v.push(m?.[i] ?? null); return v; };
    const series = [
      { name: String(S.year - 2), color: C.old, vals: f(S.year - 2), w: 1.6 },
      { name: String(S.year - 1), color: C.y1, vals: f(S.year - 1), dash: true, w: 1.8 },
      { name: String(S.year), color: C.y0, vals: f(S.year), w: 2.6 },
    ].filter(s => s.vals.some(v => v != null));
    const leg = series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    cards.push(`<div class="card"><h3>${def.label} — ανά μήνα</h3><div class="legend">${leg}</div>${lineChart(series, U.MONTHS_EL)}</div>`);
  }
  const years = ALL_INDICATORS.filter(def => Object.keys(c.series[def.key] || {}).length >= 2).map(def => {
    const items = model.years.map(y => ({ label: String(y), val: c.series[def.key][y] ?? null, current: y === S.year }));
    return `<div class="card"><h3>${def.label} — διαχρονικά</h3>${barChartYears(items, { dec: def.dec, unit: def.unit })}</div>`;
  });
  return `<div class="grid2" style="margin-top:20px">${cards.join('')}</div>` +
    (years.length ? `<div class="grid3" style="margin-top:20px">${years.join('')}</div>` : '');
}

/* the two or three things worth raising in a clinic meeting */
function actionsBlock(c, model, S) {
  const out = [];
  const rev = c.revenue ? pctChange(c.revenue.cur.total, c.revenue.prev.total) : null;
  const adm = clinicYoY(c, 'adm', S.year);
  if (rev != null && adm != null && rev < -5 && adm >= -2) {
    out.push({ t: 'warn', m: `Τα έσοδα υποχώρησαν ${U.pct(rev)} ενώ οι εισαγωγές κρατήθηκαν (${U.pct(adm)}) — το μείγμα περιστατικών ή η τιμολόγηση θέλουν έλεγχο, όχι ο όγκος.` });
  }
  if (rev != null && adm != null && rev > 5 && adm < -2) {
    out.push({ t: 'good', m: `Τα έσοδα ανέβηκαν ${U.pct(rev)} με λιγότερες εισαγωγές (${U.pct(adm)}) — βαρύτερα περιστατικά ανά νοσηλεία.` });
  }
  const occ = c.series.occ?.[S.year];
  if (occ != null && occ > 100) out.push({ t: 'flag', m: `Πληρότητα ${U.fmt(occ, 1)}% — συστηματική υπερφόρτωση κλινών· η ΜΔΝ και οι διασπορές θέλουν παρακολούθηση.` });
  else if (occ != null && occ < 55) out.push({ t: 'warn', m: `Πληρότητα ${U.fmt(occ, 1)}% — υπάρχει περιθώριο για περισσότερα προγραμματισμένα περιστατικά ή ανακατανομή κλινών.` });
  const alosD = clinicYoY(c, 'alos', S.year);
  if (alosD != null && alosD > 8) out.push({ t: 'warn', m: `Η μέση διάρκεια νοσηλείας αυξήθηκε ${U.pct(alosD)} — κάθε επιπλέον ημέρα δεσμεύει κλίνη χωρίς πρόσθετο έσοδο DRG.` });
  const outD = clinicYoY(c, 'out', S.year);
  if (outD != null && outD < -8) out.push({ t: 'warn', m: `Οι επισκέψεις εξωτερικών ιατρείων μειώθηκαν ${U.pct(outD)} — λιγότερες παραπομπές σημαίνει και λιγότερες μελλοντικές εισαγωγές.` });
  const dcD = clinicYoY(c, 'dc', S.year);
  if (dcD != null && dcD > 15) out.push({ t: 'good', m: `Η ημερήσια νοσηλεία αυξήθηκε ${U.pct(dcD)} — μετατόπιση από την κλασική νοσηλεία, με χαμηλότερο κόστος ανά περιστατικό.` });
  if (!out.length) return '';
  return `<h3 class="clinic-h3">Σημεία δράσης</h3><div class="flags">${out.map(f => `<div class="flag ${f.t === 'flag' ? '' : f.t}">${U.esc(f.m)}</div>`).join('')}</div>`;
}

/* what the quarterly report says about this clinic, quoted as written */
function notesBlock(c) {
  if (!state.report) return '';
  if (!c.notes.length) {
    return `<h3 class="clinic-h3">Από την έκθεση</h3><div class="note">Η έκθεση «${U.esc(state.report.file)}» δεν αναφέρει ονομαστικά αυτή την κλινική.</div>`;
  }
  const items = c.notes.slice(0, 6).map(n => `<li><b>${U.esc(n.section)}</b> — ${U.esc(n.text)}
    ${n.figures.length ? `<div class="note" style="margin-top:2px">${n.figures.map(U.esc).join(' · ')}</div>` : ''}</li>`).join('');
  return `<h3 class="clinic-h3">Από την έκθεση</h3><ul class="reportnotes">${items}</ul>
    <div class="note">Αυτούσια αποσπάσματα από «${U.esc(state.report.file)}».</div>`;
}

function summaryTable(model, S) {
  const y = S.year;
  const cols = ALL_INDICATORS.filter(def => model.clinics.some(c => c.series[def.key]?.[y] != null));
  const head = cols.map(def => `<th class="r" colspan="2">${def.label}</th>`).join('');
  const sub = cols.map(() => `<th class="r">${y}</th><th class="r">Δ%</th>`).join('');
  const rows = model.clinics.map(c => {
    const cells = cols.map(def =>
      `<td class="r">${val(c.series[def.key]?.[y], def)}</td><td class="r">${delta(clinicYoY(c, def.key, y))}</td>`).join('');
    const rev = c.revenue
      ? `<td class="r">${money(c.revenue.cur.total)}</td><td class="r">${delta(pctChange(c.revenue.cur.total, c.revenue.prev.total))}</td>`
      : '<td class="r">—</td><td class="r">—</td>';
    return `<tr data-clinic="${U.esc(c.key)}" class="pick${c.key === currentClinic() ? ' on' : ''}">
      <td><b>${U.esc(c.label)}</b></td>${model.hasRevenue ? rev : ''}${cells}</tr>`;
  }).join('');
  return `<table class="ok clinics"><thead>
      <tr><th rowspan="2">Κλινική</th>${model.hasRevenue ? '<th class="r" colspan="2">Έσοδα ΟΑΥ</th>' : ''}${head}</tr>
      <tr>${model.hasRevenue ? `<th class="r">${y}</th><th class="r">Δ%</th>` : ''}${sub}</tr></thead><tbody>${rows}</tbody></table>`;
}

function unmatchedNote(model) {
  if (!model.unmatched.length) return '';
  const list = model.unmatched.slice(0, 12).map(h => `${U.esc(h.label)} (${U.fmt(h.cases)} περιστατικά)`).join(' · ');
  return `<div class="flag info" style="margin-top:12px">Ειδικότητες των IS Auditor χωρίς αντίστοιχη κλινική στο αρχείο στατιστικών:
    ${list}${model.unmatched.length > 12 ? ' κ.ά.' : ''}. Δεν προσμετρώνται σε καμία κλινική παραπάνω.</div>`;
}

/* three to five sentences a director can put in a report as they are */
export function clinicStory(c, model, S) {
  const y = S.year, s = [];
  if (c.revenue) {
    const d = pctChange(c.revenue.cur.total, c.revenue.prev.total);
    s.push(`Η κλινική τιμολόγησε στον ΟΑΥ ${money(c.revenue.cur.total)} την περίοδο Ιανουαρίου–${U.MONTHS_GEN[S.mN - 1]} ${y}` +
      (d == null ? '.' : Math.abs(d) < 1 ? `, στα ίδια επίπεδα με το ${y - 1}.` : `, ${U.pct(d)} έναντι του ${y - 1}.`));
    const streams = REVENUE_STREAMS.map(st => ({ st, v: c.revenue.cur[st.key] || 0 })).sort((a, b) => b.v - a.v);
    if (streams[0].v > 0) {
      s.push(`Το μεγαλύτερο μέρος προέρχεται από ${streams[0].st.label.toLowerCase()} (${U.fmt(100 * streams[0].v / c.revenue.cur.total, 0)}% των εσόδων).`);
    }
  }
  const admD = clinicYoY(c, 'adm', y);
  if (c.series.adm?.[y] != null) {
    s.push(`Έγιναν ${U.fmt(c.series.adm[y])} εισαγωγές` +
      (admD == null ? '.' : Math.abs(admD) < 1 ? ', όσες και πέρσι.' : `, ${U.pct(admD)} σε σχέση με πέρσι.`));
  } else if (c.series.out?.[y] != null) {
    const d = clinicYoY(c, 'out', y);
    s.push(`Καταγράφηκαν ${U.fmt(c.series.out[y])} επισκέψεις εξωτερικών ιατρείων` + (d == null ? '.' : `, ${U.pct(d)} σε σχέση με πέρσι.`));
  }
  const t = clinicTrend(c, c.series.adm ? 'adm' : 'out', model.years);
  if (t) {
    s.push(t.total > 5 ? `Διαχρονικά η πορεία είναι ανοδική: ${U.pct(t.total)} από το ${t.from}.`
      : t.total < -5 ? `Διαχρονικά η πορεία είναι καθοδική: ${U.pct(t.total)} από το ${t.from}.`
      : `Διαχρονικά τα μεγέθη μένουν σταθερά (${U.pct(t.total)} από το ${t.from}).`);
  }
  const occ = c.series.occ?.[y];
  if (occ != null) s.push(`Η πληρότητα κινείται στο ${U.fmt(occ, 1)}%${c.beds?.beds ? ` με ${U.fmt(c.beds.beds)} κλίνες` : ''}.`);
  return s.join(' ');
}
