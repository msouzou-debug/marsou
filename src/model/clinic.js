/* ---------- per-clinic model ----------
   The hospital-level dashboard answers «πώς πάει το νοσοκομείο». A clinic
   director needs «πώς πάει η δική μου κλινική»: the same indicators, the ΟΑΥ
   revenue booked under the clinic, the move against last year, and the
   multi-year line.

   Sources, all joined on clinicKey():
     · monthly blocks of the stats sheets      — εισαγωγές, εξωτερικά, ημερήσια,
                                                 χειρουργεία, πληρότητα, ΜΔΝ
     · «Μικρά Χειρουργεία», «Συνολο Κλινών»    — annual table and bed snapshot
     · «ΣΥΝΟΛΟ ΚΛΙΝΙΚΩΝ»                        — ΟΑΥ revenue, inpatient /
                                                 outpatient / day-care, 2 periods
     · IS Auditor `Claim Speciality`            — CMI, ΜΔΝ ΟΑΥ, επείγοντα (optional)
     · «Έκθεση Στατιστικών» (.docx)             — the administration's commentary

   Every figure is computed over the same Ιαν–{mN} window of each year, so a
   year-on-year comparison never puts a full year against a quarter. */
import { state } from '../state.js';
import { clinicKey, hospOf } from '../domain.js';
import { reportNotesFor } from '../parsers/report.js';
import { maturity } from './hio.js';
import { U } from '../util.js';

/* which stats sheet feeds which indicator, and how a period value is formed */
export const CLINIC_INDICATORS = [
  { key: 'adm',  block: 'adm',  label: 'Εισαγωγές',                     agg: 'sum', dec: 0, unit: '' },
  { key: 'out',  block: 'out',  label: 'Επισκέψεις εξωτερικών ιατρείων', agg: 'sum', dec: 0, unit: '' },
  { key: 'dc',   block: 'dcm',  label: 'Ημερήσια νοσηλεία',             agg: 'sum', dec: 0, unit: '' },
  { key: 'surg', block: 'surg', label: 'Χειρουργικές επεμβάσεις',       agg: 'sum', dec: 0, unit: '' },
  { key: 'occ',  block: 'occ',  label: 'Πληρότητα κλινών',              agg: 'avg', dec: 1, unit: '%' },
  { key: 'alos', block: 'alos', label: 'Μέση διάρκεια νοσηλείας',       agg: 'avg', dec: 1, unit: ' ημ.' },
];
/* indicators that come from a per-year table rather than monthly blocks */
export const CLINIC_ANNUAL = [
  { key: 'minor', table: 'minor', label: 'Μικρά χειρουργεία', dec: 0, unit: '' },
];
export const REVENUE_STREAMS = [
  { key: 'inpatient',  label: 'Ενδονοσοκομειακή φροντίδα' },
  { key: 'outpatient', label: 'Εξωτερικά ιατρεία' },
  { key: 'daycare',    label: 'Ημερήσια νοσηλεία' },
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

/* The financial sheet spells the clinics properly and in the nominative
   («Καρδιολογία», not «Καρδιολ.» or «Καρδιολογική Μονάδα»), so its name wins
   for display; otherwise the fullest spelling seen on any sheet. */
const betterLabel = (a, b) => (!a ? b : !b ? a : b.length > a.length ? b : a);
/* «Ογκολογία: Ακτινοθεραπευτική» is a billing line of the Ογκολογική clinic */
const clinicOf = (name) => String(name).split(':')[0].trim() || String(name).trim();

/* ΟΑΥ clinical figures per `Claim Speciality` — the revenue itself comes from
   the workbook, so this only adds what the IS Auditor uniquely knows. */
export function computeClinicHIO(isRows, S) {
  const y = S.year, mN = S.mN;
  const inPeriod = d => d && d.getFullYear() === y && d.getMonth() < mN;
  const out = new Map();
  const get = (name) => {
    const key = clinicKey(name);
    if (!out.has(key)) out.set(key, {
      key, label: String(name || '').trim() || '—',
      cases: 0, byMonth: Array(mN).fill(0), billed: 0, daycare: 0,
      cwSum: 0, cwN: 0, alosSum: 0, alosN: 0, emerg: 0, revRows: 0, revAmt: 0,
    });
    return out.get(key);
  };
  for (const r of isRows) {
    if (hospOf(r.prov) !== S.hospital) continue;
    if (!inPeriod(r.dd) || !r.spec) continue;
    const c = get(r.spec);
    c.billed += r.ff + r.proc;
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
  /* the same submission lag applies to every clinic — say so on each card */
  const M = maturity(isRows, S);
  const immature = M.mature.map((m, i) => (m ? null : U.MONTHS_EL[i])).filter(Boolean).join(', ');
  for (const c of out.values()) {
    c.maturity = { ...M, immature };
    c.cmi = c.cwN ? c.cwSum / c.cwN : null;
    c.alos = c.alosN ? c.alosSum / c.alosN : null;
    c.emergPct = c.cases ? 100 * c.emerg / c.cases : null;
    c.billedPerCase = c.cases ? c.billed / c.cases : null;
  }
  return out;
}

/* One row per clinic: every indicator, every euro, and the years behind both. */
export function buildClinics() {
  const S = state.stats;
  if (!S) return { clinics: [], years: [], unmatched: [], hasHio: false, hasRevenue: false };

  const byKey = new Map();
  const yearSet = new Set();
  const touch = (key, name, preferred = false) => {
    if (!byKey.has(key)) byKey.set(key, { key, label: name, names: new Set(), ind: {}, hio: null, revenue: null, revenueSources: [], beds: null });
    const c = byKey.get(key);
    if (preferred) c.preferred = betterLabel(c.preferred, clinicOf(name));
    c.label = c.preferred || betterLabel(c.label, name);
    c.names.add(name);
    return c;
  };
  /* the sheets carry a column for next year already; it holds no data yet */
  const addYear = (y) => { if (+y <= S.year) yearSet.add(+y); };

  for (const def of CLINIC_INDICATORS) {
    for (const block of S.blocks[def.block] || []) {
      const key = clinicKey(block.name);
      if (!key) continue;
      const c = touch(key, String(block.name).trim());
      /* a clinic can appear on the same sheet more than once; add the blocks up */
      const slot = c.ind[def.key] || (c.ind[def.key] = { years: {} });
      for (const [year, months] of Object.entries(block.years)) {
        addYear(year);
        const target = slot.years[year] || (slot.years[year] = {});
        for (const [mi, v] of Object.entries(months)) target[mi] = (target[mi] || 0) + v;
      }
    }
  }
  for (const def of CLINIC_ANNUAL) {
    for (const row of S.annual?.[def.table]?.rows || []) {
      const key = clinicKey(row.name);
      if (!key) continue;
      const c = touch(key, String(row.name).trim());
      const slot = c.annual || (c.annual = {});
      slot[def.key] = {};
      for (const [year, v] of Object.entries(row.vals)) { addYear(year); if (+year <= S.year) slot[def.key][year] = v; }
    }
  }
  for (const row of S.beds || []) {
    const key = clinicKey(row.name);
    if (!key) continue;
    touch(key, String(row.name).trim()).beds = row;
  }

  const years = [...yearSet].sort((a, b) => a - b);
  const hio = state.isRows.length ? computeClinicHIO(state.isRows, S) : null;
  const matchedHio = new Set(), matchedRev = new Set();

  /* ΟΑΥ revenue straight from the workbook — no apportionment */
  const revenueRows = S.fin?.revenue?.rows || [];
  for (const row of revenueRows) {
    const key = clinicKey(row.name);
    if (!key) continue;
    /* a revenue line may name a clinic no stats sheet lists; it still belongs
       to the hospital and must be visible somewhere */
    const c = touch(key, String(row.name).trim(), true);
    /* a clinic can be billed on more than one ΟΑΥ line (the three oncology
       lines, for one); they add up, and the lines are kept for the caveat */
    c.revenue = c.revenue
      ? { cur: mergeStreams(c.revenue.cur, row.cur), prev: mergeStreams(c.revenue.prev, row.prev) }
      : { cur: row.cur, prev: row.prev };
    c.revenueSources.push(String(row.name).trim());
    matchedRev.add(key);
  }

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
    for (const def of CLINIC_ANNUAL) {
      const s = c.annual?.[def.key];
      if (s && Object.keys(s).length) c.series[def.key] = s;
    }
    if (hio?.has(c.key)) { c.hio = hio.get(c.key); matchedHio.add(c.key); }
    c.notes = reportNotesFor(state.report, [...c.names, c.label]);
  }

  /* ΟΑΥ specialties with no clinic on the stats side still carry activity —
     show them rather than let the figures disappear */
  const unmatched = hio
    ? [...hio.values()].filter(h => !matchedHio.has(h.key)).sort((a, b) => b.billed - a.billed)
    : [];

  const clinics = [...byKey.values()].sort((a, b) => {
    const v = (c) => c.revenue?.cur?.total ?? c.series.adm?.[S.year] ?? c.series.out?.[S.year] ?? 0;
    return v(b) - v(a) || a.label.localeCompare(b.label, 'el');
  });

  return {
    clinics, years, unmatched,
    hasHio: !!hio,
    hasRevenue: matchedRev.size > 0,
    totals: S.fin?.revenue?.totals || null,
  };
}

const mergeStreams = (a, b) => ({
  inpatient: (a.inpatient || 0) + (b.inpatient || 0),
  outpatient: (a.outpatient || 0) + (b.outpatient || 0),
  daycare: (a.daycare || 0) + (b.daycare || 0),
  total: (a.total || 0) + (b.total || 0),
});

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
  const from = present[0], to = present[present.length - 1];
  const first = s[from], last = s[to];
  if (!first) return null;
  const span = to - from;
  return { from, to, total: 100 * (last - first) / first,
           perYear: span ? (Math.pow(last / first, 1 / span) - 1) * 100 : null };
}

export const pctChange = (cur, prev) => (cur == null || !prev ? null : 100 * (cur - prev) / prev);

/* €, visits and beds put together into the things a director can act on */
export function clinicEfficiency(clinic, S) {
  const rev = clinic.revenue?.cur;
  const adm = clinic.series.adm?.[S.year];
  const out = clinic.series.out?.[S.year];
  const beds = clinic.beds?.beds;
  const daysInPeriod = S.mN * 30.4;
  return {
    perAdmission: rev?.inpatient && adm ? rev.inpatient / adm : null,
    perVisit: rev?.outpatient && out ? rev.outpatient / out : null,
    perBed: rev?.total && beds ? rev.total / beds : null,
    admissionsPerBed: adm && beds ? adm / beds : null,
    bedDays: beds ? beds * daysInPeriod : null,
  };
}
