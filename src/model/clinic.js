/* ---------- per-clinic model ----------
   The hospital-level dashboard answers «πώς πάει το νοσοκομείο». A clinic
   director needs «πώς πάει η κλινική μου»: the same indicators, the revenue
   billed under the clinic, the move against last year, and the multi-year line.

   Two sources are joined on clinicKey():
     · the stats workbook — one monthly block per clinic on each indicator sheet
     · the ΟΑΥ IS Auditor rows — grouped by `Claim Speciality`

   Everything is computed over the same Ιαν–{mN} window for every year, so a
   year-on-year comparison never puts a full year against a quarter. */
import { state } from '../state.js';
import { clinicKey, hospOf } from '../domain.js';

/* which stats sheet feeds which indicator, and how a period value is formed */
export const CLINIC_INDICATORS = [
  { key: 'adm',  block: 'adm',  label: 'Εισαγωγές',                agg: 'sum', dec: 0, unit: '' },
  { key: 'out',  block: 'out',  label: 'Επισκέψεις εξωτερικών ιατρείων', agg: 'sum', dec: 0, unit: '' },
  { key: 'dc',   block: 'dcm',  label: 'Ημερήσια νοσηλεία',        agg: 'sum', dec: 0, unit: '' },
  { key: 'surg', block: 'surg', label: 'Χειρουργικές επεμβάσεις',  agg: 'sum', dec: 0, unit: '' },
  { key: 'occ',  block: 'occ',  label: 'Πληρότητα κλινών',         agg: 'avg', dec: 1, unit: '%' },
  { key: 'alos', block: 'alos', label: 'Μέση διάρκεια νοσηλείας',  agg: 'avg', dec: 1, unit: ' ημ.' },
];

/* Ιαν–mN of the given year. `avg` averages only the months that carry a value,
   so a missing month never drags an occupancy average down. */
function periodValue(monthMap, mN, agg) {
  if (!monthMap) return null;
  const vals = [];
  for (let i = 0; i < mN; i++) { const v = monthMap[i]; if (v != null) vals.push(v); }
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return agg === 'avg' ? sum / vals.length : sum;
}

/* prefer the fullest spelling of a clinic's name for display */
function betterLabel(a, b) {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

/* ΟΑΥ figures per `Claim Speciality`, for this hospital and inside the period.
   Same counting rules as computeHIO — activity by discharge date, DRG rows are
   non-day-care rows with a DRG Id, revenue is DRG/FFS plus procedures. */
export function computeClinicHIO(isRows, S) {
  const y = S.year, mN = S.mN;
  const inPeriod = d => d && d.getFullYear() === y && d.getMonth() < mN;
  const out = new Map();
  const get = (name) => {
    const key = clinicKey(name);
    if (!out.has(key)) out.set(key, {
      key, label: String(name || '').trim() || '—',
      cases: 0, byMonth: Array(mN).fill(0), revenue: 0, daycare: 0,
      cwSum: 0, cwN: 0, alosSum: 0, alosN: 0, emerg: 0, revRows: 0, revAmt: 0,
    });
    return out.get(key);
  };
  for (const r of isRows) {
    if (hospOf(r.prov) !== S.hospital) continue;
    if (!inPeriod(r.dd)) continue;
    if (!r.spec) continue;
    const c = get(r.spec);
    c.revenue += r.ff + r.proc;
    if (r.ff < 0) { c.revRows++; c.revAmt += r.ff; }
    const daycare = r.ht.startsWith('3');
    if (daycare) c.daycare++;
    if (r.drg && !daycare) {
      c.cases++;
      c.byMonth[r.dd.getMonth()]++;
      c.alosSum += r.alos; c.alosN++;
      if (r.acw > 0) { c.cwSum += r.acw; c.cwN++; }
      if (r.at.startsWith('E')) c.emerg++;
    }
  }
  for (const c of out.values()) {
    c.cmi = c.cwN ? c.cwSum / c.cwN : null;
    c.alos = c.alosN ? c.alosSum / c.alosN : null;
    c.emergPct = c.cases ? 100 * c.emerg / c.cases : null;
    c.revPerCase = c.cases ? c.revenue / c.cases : null;
  }
  return out;
}

/* One row per clinic: every indicator the workbook carries for it, the ΟΑΥ
   figures when the IS Auditor files are loaded, and the year series behind
   both. */
export function buildClinics() {
  const S = state.stats;
  if (!S) return { clinics: [], years: [], unmatched: [], hasHio: false };

  const byKey = new Map();
  const yearSet = new Set();
  const touch = (key, name) => {
    if (!byKey.has(key)) byKey.set(key, { key, label: name, ind: {}, hio: null });
    const c = byKey.get(key);
    c.label = betterLabel(c.label, name);
    return c;
  };

  for (const def of CLINIC_INDICATORS) {
    for (const block of S.blocks[def.block] || []) {
      const key = clinicKey(block.name);
      if (!key) continue;
      const c = touch(key, String(block.name).trim());
      /* a clinic can appear on the same sheet twice (sub-blocks); add them up */
      const slot = c.ind[def.key] || (c.ind[def.key] = { years: {} });
      for (const [year, months] of Object.entries(block.years)) {
        yearSet.add(+year);
        const target = slot.years[year] || (slot.years[year] = {});
        for (const [mi, v] of Object.entries(months)) target[mi] = (target[mi] || 0) + v;
      }
    }
  }

  const years = [...yearSet].sort((a, b) => a - b);
  const hio = state.isRows.length ? computeClinicHIO(state.isRows, S) : null;
  const matched = new Set();

  for (const c of byKey.values()) {
    c.series = {};      // indicator → { year → period value }
    for (const def of CLINIC_INDICATORS) {
      const slot = c.ind[def.key];
      if (!slot) continue;
      const s = {};
      for (const year of years) {
        const v = periodValue(slot.years[year], S.mN, def.agg);
        if (v != null) s[year] = v;
      }
      if (Object.keys(s).length) c.series[def.key] = s;
    }
    c.monthly = (key) => c.ind[key]?.years || {};
    if (hio?.has(c.key)) { c.hio = hio.get(c.key); matched.add(c.key); }
  }

  /* ΟΑΥ specialties with no clinic on the stats side still carry revenue — show
     them rather than let the € disappear */
  const unmatched = hio
    ? [...hio.values()].filter(h => !matched.has(h.key)).sort((a, b) => b.revenue - a.revenue)
    : [];

  const clinics = [...byKey.values()].sort((a, b) => {
    const av = a.series.adm?.[S.year] ?? a.series.out?.[S.year] ?? 0;
    const bv = b.series.adm?.[S.year] ?? b.series.out?.[S.year] ?? 0;
    return bv - av || a.label.localeCompare(b.label, 'el');
  });

  return { clinics, years, unmatched, hasHio: !!hio };
}

/* percentage move of an indicator against the same period of the previous year */
export function clinicYoY(clinic, indKey, year) {
  const s = clinic.series[indKey];
  if (!s) return null;
  const cur = s[year], prev = s[year - 1];
  if (cur == null || !prev) return null;
  return 100 * (cur - prev) / prev;
}

/* compound annual move across every year the workbook carries — «διαχρονικά» */
export function clinicTrend(clinic, indKey, years) {
  const s = clinic.series[indKey];
  if (!s) return null;
  const present = years.filter(y => s[y] != null);
  if (present.length < 3) return null;
  const first = s[present[0]], last = s[present[present.length - 1]];
  if (!first) return null;
  const span = present[present.length - 1] - present[0];
  return { from: present[0], to: present[present.length - 1], total: 100 * (last - first) / first,
           perYear: span ? (Math.pow(last / first, 1 / span) - 1) * 100 : null };
}
