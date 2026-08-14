/* Staff mapping — JS port of recon/mapping.py.
 *
 * The mental-health services post by CLINIC while ΟΑΥ pays by unit, so each
 * professional's amount is re-split across the clinics the monthly roster
 * puts them in.  Nothing here guesses money: a professional the roster does
 * not cover stays in an explicit «no roster row» bucket, and a fuzzy name
 * match counts only when it is both close and unique. */
'use strict';

/* Greek -> Latin, digraphs first: ΟΑΥ prints professionals as
 * «ΟΘΩΝ ΤΣΙΡΚΑΣ / OTHON TSIRKAS» (sometimes only one half) while the roster
 * is Greek only, so both sides are reduced to one alphabet. */
const TRANSLIT_PAIRS = [['ΟΥ', 'OU'], ['ΑΥ', 'AV'], ['ΕΥ', 'EV'], ['ΜΠ', 'B'],
  ['ΝΤ', 'D'], ['ΓΚ', 'G'], ['ΤΣ', 'TS'], ['ΤΖ', 'TZ'], ['Θ', 'TH'], ['Χ', 'CH'],
  ['Ψ', 'PS'], ['Ξ', 'X'], ['Φ', 'F'], ['Ω', 'O'], ['Η', 'I'], ['Υ', 'Y'],
  ['Β', 'V'], ['Γ', 'G'], ['Δ', 'D'], ['Ζ', 'Z'], ['Λ', 'L'], ['Μ', 'M'],
  ['Ν', 'N'], ['Π', 'P'], ['Ρ', 'R'], ['Σ', 'S'], ['Τ', 'T'], ['Κ', 'K'],
  ['Α', 'A'], ['Ε', 'E'], ['Ι', 'I'], ['Ο', 'O']];

/* a fuzzy match is only accepted this close AND only when unique */
const FUZZY_MIN = 0.92;

function translitName(s) {
  let out = String(s).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  for (const [gr, la] of TRANSLIT_PAIRS) out = out.split(gr).join(la);
  return out.replace(/[^A-Z ]/g, ' ');
}

function nameKey(s) {
  /* order-insensitive: «ΜΑΡΙΑ ΠΑΛΕΞΑ ΧΑΡΑΛΑΜΠΙΔΗ» equals
   * «ΧΑΡΑΛΑΜΠΙΔΗ ΠΑΛΕΞΑ ΜΑΡΙΑ» */
  return translitName(s).split(/\s+/).filter((t) => t.length > 1).sort();
}

/* Python difflib.SequenceMatcher.ratio(), ported so both ports accept and
 * reject exactly the same names. */
function findLongestMatch(a, b, alo, ahi, blo, bhi, b2j) {
  let bestI = alo, bestJ = blo, bestSize = 0;
  let j2len = new Map();
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map();
    for (const j of (b2j.get(a[i]) || [])) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) || 0) + 1;
      newj2len.set(j, k);
      if (k > bestSize) { bestI = i - k + 1; bestJ = j - k + 1; bestSize = k; }
    }
    j2len = newj2len;
  }
  return [bestI, bestJ, bestSize];
}

function seqRatio(a, b) {
  a = String(a); b = String(b);
  if (!a.length && !b.length) return 1;
  const b2j = new Map();
  for (let j = 0; j < b.length; j++) {
    if (!b2j.has(b[j])) b2j.set(b[j], []);
    b2j.get(b[j]).push(j);
  }
  let matches = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = findLongestMatch(a, b, alo, ahi, blo, bhi, b2j);
    if (!k) continue;
    matches += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return (2.0 * matches) / (a.length + b.length);
}

/* a placement fraction («3/5»), NOT a date («1/1/2025») */
const FRACTION_RE = /(?<![\d/])(\d{1,2})\s*\/\s*([1-9]|10)(?![\d/])/g;
/* JS \b is ASCII-only, so Greek word boundaries are spelled out — without
 * this the tail («ΑΠΌ 30/10/2025», «ΚΑΙ δυο Τρίτες») is never cut and the
 * clinic name differs from the Python port. */
const W = '[Α-Ωα-ωΆ-Ώά-ώA-Za-z]';
const PLACEMENT_TAIL_RE = new RegExp(
  `\\s*(?:,|·|\\(|(?<!${W})ΚΑΙ\\s+(?:ΔΥΟ|ΤΡΕΙΣ|ΜΙΑ|\\d)|(?<!${W})ΑΠΟ(?!${W})`
  + `|(?<!${W})ΕΩΣ(?!${W}))[\\s\\S]*$`, 'i');
const TIME_WORDS = new Set(['ΠΡΩΙ', 'ΑΠΟΓΕΥΜΑ', 'ΒΡΑΔΥ', 'ΚΑΙ', 'AM', 'PM']);
/* accented Greek -> plain, length-preserving so a cut index found on the
 * folded copy still applies to the original text */
const ACCENT_FROM = 'ΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰ';
const ACCENT_TO = 'ΑΕΗΙΟΥΩΙΥαεηιουωιυιυ';

function foldAccents(s) {
  let out = '';
  for (const ch of String(s)) {
    const i = ACCENT_FROM.indexOf(ch);
    out += i >= 0 ? ACCENT_TO[i] : ch;
  }
  return out;
}

function clinicKey(name) {
  /* «Ε.Ι.Ψ.Υ. ΛΑΡΝΑΚΑΣ», «Ε.Ι. Ψ.Υ. ΛΑΡΝΑΚΑΣ» and «Ε.Ι.Ψ.Υ.ΛΑΡΝΑΚΑΣ» are
   * one clinic written three ways */
  return String(name).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/[^Α-ΩA-Z0-9]/g, '');
}

function cleanClinic(raw) {
  let name = String(raw).replace(/\([^)]*\)/g, ' ');
  const cut = PLACEMENT_TAIL_RE.exec(foldAccents(name));
  if (cut) name = name.slice(0, cut.index);
  name = name.replace(/^\s*(?:και|and)\s+/i, '').replace(/\s+/g, ' ')
    .replace(/^[\s,.·\-)/]+|[\s,.·\-)/]+$/g, '');
  name = name.split(' ').filter((w) => !TIME_WORDS.has(w.toUpperCase().replace(/[.,]/g, '')))
    .join(' ').replace(/^[\s,.·-]+|[\s,.·-]+$/g, '');
  return name.slice(0, 60);
}

function parsePlacements(text) {
  /* «3/5 Ε.Ι.Ψ.Υ. ΛΑΡΝΑΚΑΣ και 2/5 Ψ.Ν.Α (21)» -> [[clinic, weight], …].
   * Weights are normalised to sum to 1: the roster sometimes states more
   * than a full week, and the split still distributes exactly 100%. */
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!t || t.toLowerCase() === 'nan') return [];
  const marks = [...t.matchAll(FRACTION_RE)];
  if (!marks.length) return [[cleanClinic(t) || t, 1.0]];
  const out = [];
  marks.forEach((m, i) => {
    const denom = parseInt(m[2], 10) || 1;
    const weight = parseInt(m[1], 10) / denom;
    const end = i + 1 < marks.length ? marks[i + 1].index : t.length;
    const name = cleanClinic(t.slice(m.index + m[0].length, end));
    if (name) out.push([name, weight]);
  });
  const total = out.reduce((a, [, w]) => a + w, 0);
  if (!total) return [[t, 1.0]];
  return out.map(([n, w]) => [n, w / total]);
}

const ROSTER_HEADERS = ['PERSONAL ID', 'FIRST NAME', 'LAST NAME'];

function monthColumns(cols, year, month) {
  const months = [];
  cols.forEach((c, j) => {
    const up = normLabel(String(c));
    const hit = Object.entries(GREEK_MONTHS).find(([name]) => up.startsWith(name));
    if (!hit) return;
    const ym = up.match(/(20\d\d)/);
    months.push([j, ym ? parseInt(ym[1], 10) : null, hit[1]]);
  });
  let want = null;
  for (const [j, y, m] of months) {
    if (m === month && (y == null || year == null || y === year)) { want = j; break; }
  }
  return [want, months.map(([j]) => j)];
}

function extractStaffMapping(bytes, year, month) {
  /* Read every sheet that looks like a roster.  A «√» cell means «unchanged»
   * — the last explicit value to its LEFT is carried forward, which is how
   * the service maintains the file. */
  const out = { rows: [], monthColumns: [], sheets: [] };
  const blank = new Set(['', 'nan', '√', 'V', 'v', '-']);
  for (const { name: sheetName, rows } of loadSheets(bytes)) {
    if (!rows.length) continue;
    let headerRow = null;
    for (let i = 0; i < Math.min(6, rows.length); i++) {
      const joined = rows[i].filter((v) => v != null && cellText(v) !== 'nan')
        .map((v) => normLabel(cellText(v))).join(' | ');
      if (ROSTER_HEADERS.every((h) => joined.includes(h))) { headerRow = i; break; }
    }
    if (headerRow === null) continue;
    const cols = rows[headerRow].map((v) =>
      (v != null && cellText(v) !== 'nan' ? cellText(v).trim() : ''));
    const idx = {};
    cols.forEach((c, j) => { if (c) idx[normLabel(c)] = j; });
    const [wantRaw, monthCols] = monthColumns(cols, year, month);
    const want = wantRaw == null && monthCols.length
      ? monthCols[monthCols.length - 1] : wantRaw;
    for (const j of monthCols) out.monthColumns.push(cols[j]);
    out.sheets.push(sheetName);
    for (const row of rows.slice(headerRow + 1)) {
      const first = cellText(row[idx['FIRST NAME'] != null ? idx['FIRST NAME'] : 1] || '').trim();
      const last = cellText(row[idx['LAST NAME'] != null ? idx['LAST NAME'] : 2] || '').trim();
      if (!first || first === 'nan' || last === 'nan') continue;
      let text = want != null ? cellText(row[want] || '').trim() : '';
      let source = want != null ? cols[want] : '';
      if (blank.has(text)) {
        const left = monthCols.filter((c) => want == null || c < want).reverse();
        for (const j of left) {
          const prev = cellText(row[j] || '').trim();
          if (!blank.has(prev)) { text = prev; source = cols[j]; break; }
        }
      }
      const name = `${first} ${last}`;
      out.rows.push({ name, key: nameKey(name), placements: parsePlacements(text),
        personnelArea: idx['PERSONNEL AREA'] != null
          ? cellText(row[idx['PERSONNEL AREA']] || '').trim() : '',
        sourceMonth: source });
    }
  }
  if (!out.rows.length) {
    throw new ExtractionError('Μητρώο προσωπικού: δεν βρέθηκαν γραμμές '
      + '(Personal ID / First Name / Last Name)');
  }
  return out;
}

function mergeStaffMappings(a, b) {
  if (!a) return b;
  if (!b) return a;
  const seen = new Set(a.rows.map((r) => r.key.join(' ')));
  for (const r of b.rows) if (!seen.has(r.key.join(' '))) a.rows.push(r);
  for (const c of b.monthColumns) if (!a.monthColumns.includes(c)) a.monthColumns.push(c);
  a.sheets = a.sheets.concat(b.sheets);
  return a;
}

function matchProfessional(displayName, mapping) {
  /* [roster row, score].  Every half of «ΕΛΛΗΝΙΚΑ / LATIN» is tried; a fuzzy
   * hit counts only when it clears FUZZY_MIN and is the ONLY candidate that
   * does — otherwise the professional is reported unmatched rather than paid
   * to the wrong clinic. */
  const halves = String(displayName).split('/').filter((p) => p.trim());
  const probes = halves.length ? halves : [displayName];
  const byKey = new Map(mapping.rows.map((r) => [r.key.join(' '), r]));
  for (const half of probes) {
    const row = byKey.get(nameKey(half).join(' '));
    if (row) return [row, 1.0];
  }
  const best = [];
  let closest = 0;
  for (const half of probes) {
    const probe = nameKey(half).join(' ');
    for (const row of mapping.rows) {
      const score = seqRatio(probe, row.key.join(' '));
      if (score > closest) closest = score;
      if (score >= FUZZY_MIN) best.push([score, row]);
    }
  }
  if (!best.length) return [null, closest];
  best.sort((x, y) => y[0] - x[0]);
  const winners = new Set(best.filter(([s]) => Math.abs(s - best[0][0]) < 1e-9)
    .map(([, r]) => r));
  if (winners.size > 1) return [null, best[0][0]];
  return [best[0][1], best[0][0]];
}

function shareRound(x) {
  /* Half-away-from-zero to the cent, computed identically in both ports:
   * Python rounds halves to even and JavaScript rounds them up, so an exact
   * midpoint (7.512,49 ÷ 2) would otherwise put a stray cent on a different
   * clinic in the browser than on the server. */
  const sign = x < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(x) * 100 + 0.5) / 100;
}

function allocateByClinic(byDoctor, mapping, unitLabel = '') {
  /* Split each professional's amount across the clinics the roster puts them
   * in.  No roster row -> the whole amount stays in one clearly-labelled
   * «unmapped» share; never dropped, never spread across clinics. */
  const out = [];
  for (const [seg, spec, doctor, amount] of (byDoctor || [])) {
    const [row, score] = (mapping && mapping.rows.length)
      ? matchProfessional(doctor, mapping) : [null, 0];
    if (!row || !row.placements.length) {
      let note = row == null
        ? 'Δεν βρέθηκε στο μητρώο προσωπικού (no roster row)'
        : 'Το μητρώο δεν δηλώνει κλινική για τον μήνα (roster cell empty)';
      /* floor(x+0.5), matching the Python port's note exactly */
      if (row == null && score) {
        note += ` — πλησιέστερο ταίριασμα ${Math.floor(score * 100 + 0.5)}%`;
      }
      out.push({ unit: unitLabel, clinic: 'ΧΩΡΙΣ ΑΝΤΙΣΤΟΙΧΙΣΗ (unmapped)',
        segment: seg || '', speciality: spec || '', professional: doctor || '',
        weight: 1.0, amount: shareRound(amount), matched: false, note });
      continue;
    }
    let allocated = 0;
    row.placements.forEach(([clinic, weight], i) => {
      const share = i === row.placements.length - 1
        ? shareRound(amount - allocated) : shareRound(amount * weight);
      allocated = shareRound(allocated + share);
      out.push({ unit: unitLabel, clinic, segment: seg || '', speciality: spec || '',
        professional: doctor || '', weight, amount: share, matched: true,
        note: score === 1.0 ? ''
          : `Ταίριασμα κατά προσέγγιση ${Math.floor(score * 100 + 0.5)}% με «${row.name}»` });
    });
  }
  return out;
}

/* ------------------------------------------------------ SAP cost centres */

const CC_CLINIC = ['ΚΛΙΝΙΚΗ', 'CLINIC', 'ΜΟΝΑΔΑ', 'UNIT', 'ΤΟΠΟΘΕΤΗΣΗ'];
const CC_CENTRE = ['ΚΕΝΤΡΟ ΚΟΣΤΟΥΣ', 'COST CENTRE', 'COST CENTER', 'KOSTL'];

function extractCostCentres(bytes) {
  /* Optional lookup: clinic -> SAP cost centre / internal order / text.
   * Accepted as a sheet inside the roster workbook or as its own file. */
  const out = { rows: [], companyCode: '' };
  for (const { rows } of loadSheets(bytes)) {
    if (!rows.length) continue;
    let headerRow = null;
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      const joined = rows[i].filter((v) => v != null && cellText(v) !== 'nan')
        .map((v) => normLabel(cellText(v))).join(' | ');
      if (CC_CLINIC.some((c) => joined.includes(c)) && CC_CENTRE.some((c) => joined.includes(c))) {
        headerRow = i; break;
      }
    }
    if (headerRow === null) continue;
    const cols = rows[headerRow].map((v) => (v == null ? '' : normLabel(cellText(v))));
    const col = (...needles) => {
      for (const needle of needles) {
        for (let j = 0; j < cols.length; j++) if (cols[j].includes(needle)) return j;
      }
      return null;
    };
    const jc = col(...CC_CLINIC), jk = col(...CC_CENTRE);
    const jo = col('ΕΣΩΤΕΡΙΚΗ ΕΝΤΟΛΗ', 'INTERNAL ORDER', 'AUFNR');
    const jt = col('ΚΕΙΜΕΝΟ', 'TEXT', 'SGTXT');
    const js = col('ΕΙΔΙΚΟΤΗΤΑ', 'SPECIALITY', 'SPECIALTY');
    const jh = col('ΝΟΣΟΚΟΜΕΙΟ', 'HOSPITAL', 'ΠΑΡΟΧΕΑ', 'PROVIDER', 'F-CODE');
    const jb = col('ΕΤΑΙΡΕΙΑ', 'COMPANY', 'BUKRS');
    if (jc == null || jk == null) continue;
    for (const row of rows.slice(headerRow + 1)) {
      const clinic = row[jc] == null ? '' : cellText(row[jc]).trim();
      if (!clinic || clinic === 'nan') continue;
      const cell = (j) => (j == null || row[j] == null || cellText(row[j]) === 'nan'
        ? '' : cellText(row[j]).trim().split('.')[0]);
      out.rows.push({ clinic, costCentre: cell(jk), internalOrder: cell(jo),
        text: jt != null && row[jt] != null && cellText(row[jt]) !== 'nan'
          ? cellText(row[jt]).trim() : '',
        speciality: js != null && row[js] != null && cellText(row[js]) !== 'nan'
          ? cellText(row[js]).trim() : '',
        hospital: cell(jh) });
      if (jb != null && !out.companyCode) out.companyCode = cell(jb);
    }
  }
  return out;
}

function costCentreRowsFor(lookup, hospital) {
  /* Rows belonging to this payee, plus the rows that name no hospital at all
   * — so one file can carry all eight hospitals and the mental health units,
   * with shared lines written once. */
  const code = normLabel(hospital || '');
  return lookup.rows.filter((r) => !r.hospital || !code
                                   || normLabel(r.hospital) === code);
}

function findCostCentre(lookup, clinic, speciality = '', hospital = '') {
  if (!lookup) return null;
  const want = normLabel(clinic);
  const spec = normLabel(speciality);
  const exact = costCentreRowsFor(lookup, hospital)
    .filter((r) => normLabel(r.clinic) === want);
  /* a row that also names a speciality wins over a clinic-only row, so the
   * lookup works whether the internal order belongs to the clinic or to the
   * professional category */
  for (const r of exact) if (r.speciality && normLabel(r.speciality) === spec) return r;
  for (const r of exact) if (!r.speciality) return r;
  return exact.length ? exact[0] : null;
}

function findCostCentreBySpeciality(lookup, speciality, hospital = '') {
  /* The internal order belongs to the professional category, not the clinic
   * (13 nurses, 14/16 allied health, 15 doctors…), so the lookup may carry it
   * on a speciality-only row.  Used only to fill an internal order a clinic
   * row leaves blank — never to invent a cost centre. */
  const spec = normLabel(speciality);
  if (!lookup || !spec) return null;
  return costCentreRowsFor(lookup, hospital)
    .find((r) => r.speciality && normLabel(r.speciality) === spec
                 && r.internalOrder) || null;
}

const MONTH_EN = ['', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function monthLabelEn(year, month) {
  return year && month ? `${MONTH_EN[month]} ${year}` : '';
}

function monthEnd(year, month) {
  if (!year || !month) return 1;
  if (month === 2) return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
