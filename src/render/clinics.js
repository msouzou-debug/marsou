/* ---------- «Ανά κλινική» ----------
   A clinic director opens this and sees only their own clinic: the indicators,
   the ΟΑΥ revenue filed under it, the move against the same period last year,
   and the multi-year line. The table underneath keeps the whole hospital in
   view so a clinic can be read in context — and so a director can find their
   own row quickly. */
import { U } from '../util.js';
import { state } from '../state.js';
import { CLINIC_INDICATORS, buildClinics, clinicYoY, clinicTrend } from '../model/clinic.js';
import { C, lineChart, barChartYears } from './charts.js';
import { el } from './dom.js';

/* survives a re-render when more files are loaded */
let selectedKey = null;

const delta = (d) => {
  if (d == null) return '<span class="delta flat">—</span>';
  const cls = d > 1 ? 'up' : d < -1 ? 'down' : 'flat';
  const arrow = d > 1 ? '▲ ' : d < -1 ? '▼ ' : '≈ ';
  return `<span class="delta ${cls}">${arrow}${U.pct(d)}</span>`;
};

const val = (v, def) => v == null ? '—' : U.fmt(v, def.dec) + def.unit;

export function renderClinics() {
  const S = state.stats, box = el('clinics');
  if (!S) { el('secClinics').classList.add('hidden'); return; }
  const model = buildClinics();
  if (!model.clinics.length) { el('secClinics').classList.add('hidden'); return; }
  el('secClinics').classList.remove('hidden');

  if (!model.clinics.some(c => c.key === selectedKey)) selectedKey = model.clinics[0].key;

  const options = model.clinics
    .map(c => `<option value="${U.esc(c.key)}"${c.key === selectedKey ? ' selected' : ''}>${U.esc(c.label)}</option>`)
    .join('');

  box.innerHTML = `
    <div class="clinicbar">
      <label for="clinicPick">Κλινική:</label>
      <select id="clinicPick">${options}</select>
      <span class="note" style="margin:0">Σύγκριση με την ίδια περίοδο (Ιαν–${U.MONTHS_EL[S.mN - 1]}) κάθε έτους.</span>
    </div>
    <div id="clinicDetail"></div>
    <h3 class="clinic-h3">Όλες οι κλινικές — περίοδος ${S.year} έναντι ${S.year - 1}</h3>
    <div class="scrollx">${summaryTable(model, S)}</div>
    ${unmatchedNote(model)}`;

  el('clinicPick').addEventListener('change', (e) => {
    selectedKey = e.target.value;
    renderDetail(model, S);
  });
  box.querySelectorAll('[data-clinic]').forEach(row => row.addEventListener('click', () => {
    selectedKey = row.dataset.clinic;
    el('clinicPick').value = selectedKey;
    renderDetail(model, S);
    el('clinicDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));

  renderDetail(model, S);
}

function renderDetail(model, S) {
  const c = model.clinics.find(x => x.key === selectedKey);
  if (!c) return;
  const y = S.year;

  /* one tile per indicator the workbook actually carries for this clinic */
  const tiles = CLINIC_INDICATORS.filter(def => c.series[def.key]?.[y] != null).map(def => {
    const d = clinicYoY(c, def.key, y);
    const t = clinicTrend(c, def.key, model.years);
    return `<div class="kpi"><div class="label">${def.label}</div>
      <div class="value">${val(c.series[def.key][y], def)}</div>
      <div class="subline">${delta(d)}
        <span style="color:#8a8b8d">(${val(c.series[def.key][y - 1], def)} το ${y - 1})</span></div>
      ${t ? `<div class="note" style="margin-top:6px">Διαχρονικά ${t.from}→${t.to}: ${U.pct(t.total)}${t.perYear == null ? '' : ` (${U.pct(t.perYear)}/έτος)`}</div>` : ''}
    </div>`;
  }).join('');

  /* «διαχρονικά»: the same period of every year the workbook holds */
  const yearCards = CLINIC_INDICATORS.filter(def => Object.keys(c.series[def.key] || {}).length >= 2).map(def => {
    const items = model.years.map(yy => ({ label: String(yy), val: c.series[def.key][yy] ?? null, current: yy === y }));
    return `<div class="card"><h3>${def.label} — διαχρονικά</h3>
      ${barChartYears(items, { dec: def.dec, unit: def.unit })}</div>`;
  }).join('');

  /* monthly shape of the two indicators that drive a clinic's workload */
  const monthCards = ['adm', 'out'].map(k => {
    const def = CLINIC_INDICATORS.find(d => d.key === k);
    const months = c.ind[k]?.years;
    if (!months || !months[y]) return '';
    const f = (yy) => { const m = months[yy]; const v = []; for (let i = 0; i < 12; i++) v.push(m?.[i] ?? null); return v; };
    const series = [
      { name: String(y - 2), color: C.old, vals: f(y - 2), w: 1.6 },
      { name: String(y - 1), color: C.y1, vals: f(y - 1), dash: true, w: 1.8 },
      { name: String(y), color: C.y0, vals: f(y), w: 2.6 },
    ].filter(s => s.vals.some(v => v != null));
    const leg = series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    return `<div class="card"><h3>${def.label} — ανά μήνα</h3><div class="legend">${leg}</div>${lineChart(series, U.MONTHS_EL)}</div>`;
  }).join('');

  el('clinicDetail').innerHTML = `
    <div class="clinic-head"><h3>${U.esc(c.label)}</h3>${rank(model, c, S)}</div>
    <div class="narrative">${U.esc(clinicStory(c, model, S))}</div>
    <div class="kpis" style="margin-top:16px">${tiles || '<div class="note">Το αρχείο στατιστικών δεν περιέχει δείκτες για αυτή την κλινική.</div>'}</div>
    ${hioCard(c, S)}
    <div class="grid2" style="margin-top:20px">${monthCards}</div>
    <div class="grid3" style="margin-top:20px">${yearCards}</div>`;
}

/* where the clinic sits in the hospital, and how much of it the clinic is */
function rank(model, c, S) {
  const key = c.series.adm ? 'adm' : c.series.out ? 'out' : null;
  if (!key) return '';
  const def = CLINIC_INDICATORS.find(d => d.key === key);
  const ranked = model.clinics.filter(x => x.series[key]?.[S.year] != null)
    .sort((a, b) => b.series[key][S.year] - a.series[key][S.year]);
  const pos = ranked.findIndex(x => x.key === c.key) + 1;
  const total = ranked.reduce((a, x) => a + x.series[key][S.year], 0);
  const share = total ? 100 * c.series[key][S.year] / total : null;
  return `<span class="pill">${pos}η από ${ranked.length} σε ${def.label.toLowerCase()}</span>` +
    (share == null ? '' : `<span class="pill">${U.fmt(share, 1)}% του νοσοκομείου</span>`);
}

function hioCard(c, S) {
  if (!state.isRows.length) {
    return `<div class="flag info" style="margin-top:16px">Ανεβάστε τα IS Auditor Ιαν–${U.MONTHS_EL[S.mN - 1]} ${S.year}
      (και του επόμενου μήνα, για τις καθυστερημένες υποβολές) για να δείτε τα τιμολογημένα έσοδα ΟΑΥ και το CMI της κλινικής.</div>`;
  }
  const h = c.hio;
  if (!h) {
    return `<div class="flag warn" style="margin-top:16px">Δεν βρέθηκαν τιμολογημένες απαιτήσεις ΟΑΥ με ειδικότητα που να αντιστοιχεί
      σε αυτή την κλινική. Πιθανή αιτία: η ειδικότητα γράφεται διαφορετικά στα αρχεία IS Auditor — δείτε τη λίστα κάτω από τον πίνακα.</div>`;
  }
  const chip = (label, value, note) => `<div class="kpi" style="border-top-color:${C.green}">
    <div class="label">${label}</div><div class="value" style="font-size:22px">${value}</div>
    ${note ? `<div class="note" style="margin-top:4px">${note}</div>` : ''}</div>`;
  return `<h3 class="clinic-h3">Έσοδα και τιμολόγηση ΟΑΥ</h3>
    <div class="kpis">
      ${chip('Τιμολογημένα έσοδα ΟΑΥ', U.fmt(h.revenue, 0) + ' €', 'DRG/FFS + πράξεις, καθαρά από αναθεωρήσεις')}
      ${chip('Περιστατικά DRG', U.fmt(h.cases), h.daycare ? U.fmt(h.daycare) + ' ημερήσια νοσηλεία επιπλέον' : '')}
      ${chip('Έσοδο ανά περιστατικό', h.revPerCase == null ? '—' : U.fmt(h.revPerCase, 0) + ' €')}
      ${chip('CMI (θετικά βάρη)', h.cmi == null ? '—' : U.fmt(h.cmi, 3))}
      ${chip('Μέση διάρκεια νοσηλείας (ΟΑΥ)', h.alos == null ? '—' : U.fmt(h.alos, 1) + ' ημ.')}
      ${chip('Επείγουσες εισαγωγές', h.emergPct == null ? '—' : U.fmt(h.emergPct, 0) + '%')}
      ${chip('Απορρίψεις / Αναθεωρήσεις', U.fmt(h.revRows) + ' · ' + U.fmt(h.revAmt, 0) + ' €')}
    </div>
    <div class="note">Ειδικότητα «${U.esc(h.label)}» στα αρχεία IS Auditor, με καταμέτρηση κατά ημερομηνία εξιτηρίου εντός της περιόδου.
      Τα έσοδα είναι τιμολογημένα προς τον ΟΑΥ, όχι εισπραγμένα, και δεν περιλαμβάνουν ΤΑΕΠ ή εξωτερικά ιατρεία — αυτά πληρώνονται συνολικά
      ανά νοσοκομείο και δεν επιμερίζονται ανά κλινική στα αρχεία του ΟΑΥ.</div>`;
}

function summaryTable(model, S) {
  const y = S.year;
  const cols = CLINIC_INDICATORS.filter(def => model.clinics.some(c => c.series[def.key]?.[y] != null));
  const head = cols.map(def => `<th class="r" colspan="2">${def.label}</th>`).join('');
  const sub = cols.map(() => `<th class="r">${y}</th><th class="r">Δ%</th>`).join('');
  const rows = model.clinics.map(c => {
    const cells = cols.map(def => {
      const v = c.series[def.key]?.[y];
      return `<td class="r">${val(v, def)}</td><td class="r">${delta(clinicYoY(c, def.key, y))}</td>`;
    }).join('');
    const rev = c.hio ? U.fmt(c.hio.revenue, 0) + ' €' : model.hasHio ? '—' : '';
    return `<tr data-clinic="${U.esc(c.key)}" class="pick${c.key === selectedKey ? ' on' : ''}">
      <td><b>${U.esc(c.label)}</b></td>${cells}${model.hasHio ? `<td class="r">${rev}</td>` : ''}</tr>`;
  }).join('');
  return `<table class="ok clinics"><thead>
      <tr><th rowspan="2">Κλινική</th>${head}${model.hasHio ? '<th rowspan="2" class="r">Έσοδα ΟΑΥ</th>' : ''}</tr>
      <tr>${sub}</tr></thead><tbody>${rows}</tbody></table>`;
}

function unmatchedNote(model) {
  if (!model.unmatched.length) return '';
  const list = model.unmatched.slice(0, 12)
    .map(h => `${U.esc(h.label)} (${U.fmt(h.revenue, 0)} €)`).join(' · ');
  return `<div class="flag info" style="margin-top:12px">Ειδικότητες του ΟΑΥ χωρίς αντίστοιχη κλινική στο αρχείο στατιστικών:
    ${list}${model.unmatched.length > 12 ? ' κ.ά.' : ''}. Τα ποσά αυτά δεν εμφανίζονται σε καμία κλινική παραπάνω — συνήθως πρόκειται
    για διαφορετική ονομασία της ίδιας ειδικότητας ή για δραστηριότητα εκτός κλινικών (π.χ. ΤΑΕΠ, εργαστήρια).</div>`;
}

/* two to four sentences a director can put in a report as they are */
function clinicStory(c, model, S) {
  const y = S.year, s = [];
  const admD = clinicYoY(c, 'adm', y);
  if (c.series.adm?.[y] != null) {
    s.push(`Η κλινική έκλεισε την περίοδο με ${U.fmt(c.series.adm[y])} εισαγωγές` +
      (admD == null ? '.' : Math.abs(admD) < 1 ? ', στα ίδια επίπεδα με πέρσι.' : `, ${U.pct(admD)} σε σχέση με πέρσι.`));
  } else if (c.series.out?.[y] != null) {
    const d = clinicYoY(c, 'out', y);
    s.push(`Η κλινική έκλεισε την περίοδο με ${U.fmt(c.series.out[y])} επισκέψεις εξωτερικών ιατρείων` +
      (d == null ? '.' : `, ${U.pct(d)} σε σχέση με πέρσι.`));
  }
  const t = clinicTrend(c, c.series.adm ? 'adm' : 'out', model.years);
  if (t) {
    s.push(t.total > 5 ? `Διαχρονικά η πορεία είναι ανοδική: ${U.pct(t.total)} από το ${t.from}.`
      : t.total < -5 ? `Διαχρονικά η πορεία είναι καθοδική: ${U.pct(t.total)} από το ${t.from}.`
      : `Διαχρονικά τα μεγέθη μένουν σταθερά (${U.pct(t.total)} από το ${t.from}).`);
  }
  const occ = c.series.occ?.[y];
  if (occ != null) {
    s.push(occ > 100 ? `Η πληρότητα στο ${U.fmt(occ, 1)}% δείχνει συστηματική υπερφόρτωση κλινών.`
      : occ < 50 ? `Η πληρότητα στο ${U.fmt(occ, 1)}% αφήνει περιθώριο ανακατανομής κλινών.`
      : `Η πληρότητα κινείται στο ${U.fmt(occ, 1)}%.`);
  }
  if (c.hio) {
    s.push(`Ο ΟΑΥ έχει τιμολογημένα ${U.fmt(c.hio.revenue, 0)} € για την κλινική` +
      (c.hio.revPerCase == null ? '.' : `, δηλαδή ${U.fmt(c.hio.revPerCase, 0)} € ανά περιστατικό DRG.`) +
      (c.hio.revRows ? ` Καταγράφηκαν ${U.fmt(c.hio.revRows)} αναθεωρήσεις/απορρίψεις (${U.fmt(c.hio.revAmt, 0)} €).` : ''));
  }
  return s.join(' ');
}
