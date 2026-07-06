/* Validation gates, reconciliation and cross-checks — JS port of
 * recon/checks.py.  Never plug a difference: unexplained diffs are red
 * findings; known variances are noted, never absorbed. */
'use strict';

/* ------------------------------------------------------------------ gates */

function nextMonth([y, m]) {
  return m === 12 ? [y + 1, 1] : [y, m + 1];
}

function validateBatch(files, crosscheckMode) {
  const gates = [];
  const notes = [];

  const bad = files.filter((f) => f.error || !f.reportType);
  const byType = new Map();
  for (const f of files) {
    if (f.reportType) {
      if (!byType.has(f.reportType)) byType.set(f.reportType, []);
      byType.get(f.reportType).push(f.filename);
    }
  }
  const dupeMsgs = [...byType.entries()].filter(([, names]) => names.length > 1)
    .map(([t, names]) => `${REPORT_LABELS[t]}: ${names.join(', ')}`);
  if (bad.length) {
    const msg = bad.map((f) => `• ${f.filename}: ${f.error || 'άγνωστος τύπος'}`).join('\n');
    gates.push({ number: 1, name: 'Αναγνώριση αρχείων (file identification)', passed: false,
                 message: `Κάποια αρχεία δεν αναγνωρίστηκαν (unidentified files):\n${msg}` });
    return { gates, hospital: null, period: null, notes };
  }
  if (dupeMsgs.length) {
    gates.push({ number: 1, name: 'Αναγνώριση αρχείων (file identification)', passed: false,
                 message: 'Διπλά αρχεία για τον ίδιο τύπο αναφοράς (duplicate files for one '
                   + 'report type):\n• ' + dupeMsgs.join('\n• ') });
    return { gates, hospital: null, period: null, notes };
  }
  gates.push({ number: 1, name: 'Αναγνώριση αρχείων (file identification)', passed: true, message: '' });

  /* Gate 2 — single hospital, single month.  The SRA votes separately:
   * ΟΑΥ pays in arrears, so an SRA dated one month after the claim reports
   * is the SAME settlement, not a mixed batch. */
  const hospitals = new Set(files.filter((f) => f.hospitalCode && !ORG_WIDE_TYPES.has(f.reportType))
    .map((f) => f.hospitalCode));
  const sraPeriods = new Set(files.filter((f) => f.reportType === RT.SRA && f.year && f.month)
    .map((f) => `${f.year}-${f.month}`));
  // org-wide files (GL, IS Auditor) span providers/months — they don't vote
  const otherPeriods = new Set(files.filter((f) => f.reportType !== RT.SRA && f.year && f.month
      && !ORG_WIDE_TYPES.has(f.reportType))
    .map((f) => `${f.year}-${f.month}`));
  const fmtP = ([y, m]) => `${String(m).padStart(2, '0')}/${y}`;
  const gate2 = { number: 2, name: 'Ένα νοσοκομείο, ένας μήνας (single hospital/month)' };
  if (hospitals.size > 1) {
    const names = [...hospitals].sort().map((h) => `${h} (${HOSPITALS[h][1]})`).join(', ');
    gates.push({ ...gate2, passed: false,
                 message: `Η παρτίδα περιέχει δύο νοσοκομεία (mixed batch): ${names}. Ανεβάστε έναν φορέα τη φορά.` });
    return { gates, hospital: null, period: null, notes };
  }
  if (otherPeriods.size > 1) {
    const ps = [...otherPeriods].sort().map((p) => fmtP(p.split('-').map(Number))).join(', ');
    gates.push({ ...gate2, passed: false,
                 message: `Η παρτίδα περιέχει δύο μήνες (mixed months): ${ps}. Ανεβάστε έναν μήνα τη φορά.` });
    return { gates, hospital: null, period: null, notes };
  }
  if (!hospitals.size) {
    gates.push({ ...gate2, passed: false,
                 message: 'Δεν εντοπίστηκε νοσοκομείο σε κανένα αρχείο (no hospital code detected in any file).' });
    return { gates, hospital: null, period: null, notes };
  }
  const hospital = [...hospitals][0];
  const service = otherPeriods.size ? [...otherPeriods][0].split('-').map(Number) : null;
  let period = service;
  /* The SRA's period is already the derived SERVICE month (document date −1,
   * ΟΑΥ pays in arrears).  A month mismatch is a warning, never a hard stop:
   * a wrong month's SRA will not tie out and the reconciliation shows it. */
  if (sraPeriods.size) {
    const sp = [...sraPeriods][0].split('-').map(Number);
    const doc = nextMonth(sp);
    if (!service) {
      period = sp;
      notes.push(`Μήνας υπηρεσιών από το SRA: ${fmtP(sp)} (ημερομηνία εγγράφου ${fmtP(doc)} `
        + '— η ΟΑΥ πληρώνει με καθυστέρηση / paid in arrears).');
    } else if (sp[0] === service[0] && sp[1] === service[1]) {
      notes.push(`Το SRA φέρει ημερομηνία ${fmtP(doc)} — αντιστοιχίστηκε στον μήνα υπηρεσιών `
        + `${fmtP(service)} (η ΟΑΥ πληρώνει με καθυστέρηση / SRA is dated one month after `
        + 'the service month).');
    } else {
      notes.push(`Προσοχή (warning): το SRA φαίνεται να αφορά τον ${fmtP(sp)} (ημερομηνία `
        + `εγγράφου ${fmtP(doc)}), ενώ οι υπόλοιπες αναφορές τον ${fmtP(service)}. `
        + 'Αν ανέβηκε λάθος SRA, οι έλεγχοι δεν θα δέσουν — η συμφωνία θα δείξει τη διαφορά '
        + '(a wrong month\'s SRA will not tie out; the checks will show the break).');
    }
  }
  if (!period) period = [null, null];
  gates.push({ ...gate2, passed: true, message: '' });

  const have = new Set(files.map((f) => f.reportType));
  const required = REQUIRED_TYPES.filter((t) => !(crosscheckMode && t === RT.SRA));
  const missing = required.filter((t) => !have.has(t));
  const gate3 = { number: 3, name: 'Πλήρες σετ αναφορών (required set complete)' };
  if (missing.length) {
    gates.push({ ...gate3, passed: false,
                 message: 'Λείπουν αναφορές (missing reports):\n• ' + missing.map((t) => REPORT_LABELS[t]).join('\n• ') });
    return { gates, hospital, period, notes };
  }
  gates.push({ ...gate3, passed: true, message: '' });
  return { gates, hospital, period, notes };
}

function conditionalRequirements(sra) {
  const needed = [];
  const codes = new Set(sra.lines.map((l) => l.code));
  if (codes.has('PD-CAP')) needed.push(RT.CAPITATION);
  if (['KPI', 'PD-KPI', 'MRI', 'CT', 'MRI/CT'].some((c) => codes.has(c))) needed.push(RT.QUALITY_CRITERIA);
  if (codes.has('HEMO')) needed.push(RT.HEMODIALYSIS);
  return needed;
}

function gate4InternalAsserts(bundle) {
  let ok = true;
  const msgs = [];
  if (bundle.inpatient && bundle.claims) {
    const claimsIp = bundle.claims.bySegment['Inpatient'] || 0;
    const d = round2(claimsIp - bundle.inpatient.synolo);
    if (Math.abs(d) > CENT) {
      ok = false;
      msgs.push('Claims «all» Inpatient ≠ Ενδ. Σύνολο: '
        + `${formatEur(claimsIp)} vs ${formatEur(bundle.inpatient.synolo)} (διαφορά ${formatEur(d)})`);
    }
  }
  if (bundle.sra) {
    const d = round2(bundle.sra.linesTotal - bundle.sra.statedTotal);
    if (Math.abs(d) > CENT) {
      ok = false;
      msgs.push('Άθροισμα γραμμών SRA ≠ δηλωμένο σύνολο επιταγής: '
        + `${formatEur(bundle.sra.linesTotal)} vs ${formatEur(bundle.sra.statedTotal)} (διαφορά ${formatEur(d)})`);
    }
  }
  return [{ number: 4, name: 'Εσωτερικοί έλεγχοι (internal asserts)', passed: ok, message: msgs.join('\n') }];
}

/* -------------------------------------------------------- reconciliation */

const SERVICE_CODES = ['IS', 'AE', 'A&E', 'OS', 'NM', 'AP', 'PD'];

function sraSum(sra, codes) {
  return round2(sra.lines.filter((l) => codes.includes(l.code)).reduce((a, l) => a + l.amount, 0));
}

function annotate(name, source, sraSide, flagHint) {
  if (sraSide == null) return ['', 'ok'];
  const diff = round2(source - sraSide);
  if (Math.abs(diff) <= CENT) return ['OK — ταυτίζεται (ties out)', 'ok'];
  const up = name.toUpperCase();
  if (up.includes('Z-CATALOGUE') && up.includes('GL') && diff < 0) {
    return ['GL κάτω από ΟΑΥ: Z-procedures/tail booked to clinical accounts. Classification, not cash.', 'amber'];
  }
  if (up.includes('PHARMACIST') && up.includes('GL')) {
    return ['GL ≈ flat booking vs report packages × 1,60 € — known booking issue, flag amber.', 'amber'];
  }
  if (up.includes('PHARMA') && up.includes('GL') && diff > 0) {
    return ['Pharma claims gross above GL: generics/discounts/co-pay reclass.', 'amber'];
  }
  if (flagHint) return [flagHint, 'amber'];
  return ['Ανεξήγητη διαφορά (unexplained difference) — δείτε τα δύο ποσά και το άνοιγμα.', 'red'];
}

function buildCrosschecks(bundle) {
  const sra = bundle.sra;
  const checks = [];
  // alt = report-vs-report comparison side used in cross-check mode (no SRA),
  // so known variances still get flagged without a cheque
  const add = (name, source, codes, flagHint, alt) => {
    const side = sra ? sraSum(sra, codes) : (alt != null ? alt : null);
    const [note, flag] = annotate(name, source, side, flagHint);
    checks.push({ name, sourceTotal: round2(source), sraCodes: sra ? codes : [], sraSide: side,
                  note, flag,
                  get diff() { return this.sraSide == null ? null : round2(this.sourceTotal - this.sraSide); } });
  };

  const claimsIp = bundle.claims ? (bundle.claims.bySegment['Inpatient'] || 0) : null;
  const claimsOut = bundle.claims
    ? round2((bundle.claims.bySegment['Outpatient Specialists'] || 0)
      + (bundle.claims.bySegment['Nurses-Midwives'] || 0)
      + (bundle.claims.bySegment['Allied Health'] || 0))
    : null;

  const sraCodeSet = new Set(sra ? sra.lines.map((l) => l.code) : []);

  if (bundle.inpatient) {
    add('Ενδ. Πληρωμένες Απαιτήσεις (inpatient claims file) = SRA IS',
        bundle.inpatient.synolo, ['IS'], null, claimsIp);
  }
  if (bundle.pharma) {
    if (sraCodeSet.has('PH')) {
      // newer SRAs pay pharmacy claims as daily «PH - HCP SERVICES» invoices
      add('Φάρμακα & Αναλώσιμα (pharma claims gross) = SRA PH',
          bundle.pharma.total, ['PH', 'PHD', 'PHC']);
    } else {
      add('Φάρμακα (pharma drugs) = SRA PHD', bundle.pharma.byType['Drugs'] || 0, ['PHD']);
      const cons = bundle.pharma.byType['Consumables'] || 0;
      if (cons) add('Αναλώσιμα (pharma consumables) = SRA PHC', cons, ['PHC']);
    }
  }
  if (bundle.phfee) {
    const unitStr = bundle.phfee.unitPrice.toFixed(2).replace('.', ',');
    add(`Αμοιβή Φαρμακοποιού (packages × ${unitStr} €) = SRA PHF`, bundle.phfee.computed, ['PHF']);
  }
  if (bundle.claims) {
    add('Πληρωμένες Απαιτήσεις «all» (HCP claims ex-capitation) ≈ SRA service lines',
        claimsTotal(bundle.claims), SERVICE_CODES,
        'Κατά προσέγγιση έλεγχος (approximate: PD FFS timing/scope).');
  }
  if (bundle.capitation) {
    if (sra && !sraCodeSet.has('PD-CAP')) {
      // newer SRAs bundle capitation inside the PD service lines
      add('Capitation report ≈ SRA PD (bundled with FFS)', bundle.capitation.total,
          ['PD', 'PD-CAP'],
          'Κατά προσέγγιση: η κατά κεφαλήν αμοιβή πληρώνεται μέσα στις γραμμές PD '
          + '(capitation bundled in PD lines).');
    } else {
      add('Capitation report = SRA PD capitation', bundle.capitation.total, ['PD-CAP']);
    }
  }
  if (bundle.quality) {
    add('Ποιοτικά Κριτήρια (quality criteria) = SRA KPI/MRI-CT', bundle.quality.total,
        ['KPI', 'PD-KPI', 'MRI', 'CT', 'MRI/CT']);
  }
  if (bundle.hemo) add('Αιμοκάθαρση (hemodialysis report) = SRA HEMO', bundle.hemo.total, ['HEMO']);

  if (bundle.gl) {
    const gl = bundle.gl;
    add('GL: Ενδονοσοκομειακή (26001+26002+26003+26007) = SRA IS', gl.inpatient, ['IS'],
        null, bundle.inpatient ? bundle.inpatient.synolo : claimsIp);
    add('GL: Z-catalogue (26003+26007) vs ΟΑΥ Z', gl.zCatalogue, []);
    if (bundle.inpatient) {
      const c = checks[checks.length - 1];
      c.sraSide = bundle.inpatient.zCatalogue;
      [c.note, c.flag] = annotate('Z-CATALOGUE GL', c.sourceTotal, c.sraSide);
    }
    add('GL: ΤΑΕΠ / A&E (25801) = SRA AE', gl.ae, ['AE', 'A&E'],
        null, bundle.claims ? (bundle.claims.bySegment['A&E'] || 0) : null);
    add('GL: Εξωνοσοκομειακή (25xxx clinical) = SRA OS+NM+AP', gl.outpatient,
        ['OS', 'NM', 'AP'], null, claimsOut);
    add('GL: Αμοιβή Φαρμακοποιού - pharmacist fee (25501) = SRA PHF', gl.pharmacistFee,
        ['PHF'], null, bundle.phfee ? bundle.phfee.computed : null);
    add('GL: Φάρμακα (255xx) vs pharma claims gross', gl.pharmaOther, []);
    if (bundle.pharma) {
      const c = checks[checks.length - 1];
      c.sraSide = bundle.pharma.total;
      [c.note, c.flag] = annotate('PHARMA GL', c.sraSide, c.sourceTotal);
      if (Math.abs(c.diff || 0) <= CENT) c.note = 'OK — ταυτίζεται (ties out)';
    }
    if (gl.capitation) {
      add('GL: Capitation (51001001) = SRA PD capitation', gl.capitation, ['PD-CAP'],
          null, bundle.capitation ? bundle.capitation.total : null);
    }
  }

  if (bundle.isaud) {
    add('IS Auditor: inpatient (DRG fees + Z-catalogue) = SRA IS', bundle.isaud.inpatientTotal, ['IS'],
        'IS Auditor org-wide detail; μικρές διαφορές στρογγυλοποίησης.',
        bundle.inpatient ? bundle.inpatient.synolo : claimsIp);
  }
  if (bundle.xmlActivity) {
    add('XML activity export (OS+NM+AP) = SRA OS+NM+AP', bundle.xmlActivity.total,
        ['OS', 'NM', 'AP'], null, claimsOut);
  }
  return checks;
}

/* ------------------------------------------------ cross-check mode matrix */

const STREAMS = ['Ενδονοσοκομειακή (Inpatient)', 'DRG fees', 'Z-catalogue',
  'ΤΑΕΠ (A&E)', 'Εξωνοσοκομειακή (Outpatient OS+NM+AP)',
  'Φάρμακα (Pharma drugs)', 'Αναλώσιμα (Consumables)',
  'Αμοιβή Φαρμακοποιού (Pharmacist fee)', 'Capitation'];

function buildMatrix(bundle) {
  const cols = {};
  const put = (col, stream, value) => {
    if (!cols[col]) cols[col] = {};
    cols[col][stream] = round2(value);
  };

  if (bundle.inpatient) {
    const ip = bundle.inpatient;
    put('Ενδ. summary', STREAMS[0], ip.synolo);
    put('Ενδ. summary', STREAMS[1], ip.regular + ip.specialized);
    put('Ενδ. summary', STREAMS[2], ip.zCatalogue);
  }
  if (bundle.claims) {
    const c = bundle.claims;
    put('Claims «all»', STREAMS[0], c.bySegment['Inpatient'] || 0);
    put('Claims «all»', STREAMS[3], c.bySegment['A&E'] || 0);
    put('Claims «all»', STREAMS[4], (c.bySegment['Outpatient Specialists'] || 0)
      + (c.bySegment['Nurses-Midwives'] || 0) + (c.bySegment['Allied Health'] || 0));
  }
  if (bundle.pharma) {
    put('Pharma claims', STREAMS[5], bundle.pharma.byType['Drugs'] || 0);
    if (bundle.pharma.byType['Consumables']) put('Pharma claims', STREAMS[6], bundle.pharma.byType['Consumables']);
  }
  if (bundle.phfee) put('Pharmacist fee', STREAMS[7], bundle.phfee.computed);
  if (bundle.capitation) put('Capitation report', STREAMS[8], bundle.capitation.total);
  if (bundle.gl) {
    const gl = bundle.gl;
    put('GL', STREAMS[0], gl.inpatient);
    put('GL', STREAMS[2], gl.zCatalogue);
    put('GL', STREAMS[3], gl.ae);
    put('GL', STREAMS[4], gl.outpatient);
    put('GL', STREAMS[5], gl.pharmaOther);
    put('GL', STREAMS[7], gl.pharmacistFee);
    if (gl.capitation) put('GL', STREAMS[8], gl.capitation);
  }
  if (bundle.isaud) {
    put('IS Auditor', STREAMS[0], bundle.isaud.inpatientTotal);
    put('IS Auditor', STREAMS[1], bundle.isaud.drgFees);
    put('IS Auditor', STREAMS[2], bundle.isaud.zCatalogue);
  }
  if (bundle.xmlActivity) put('XML activity', STREAMS[4], bundle.xmlActivity.total);

  const columns = Object.keys(cols);
  const rows = [];
  for (const stream of STREAMS) {
    const values = {};
    for (const col of columns) values[col] = cols[col][stream] != null ? cols[col][stream] : null;
    const present = Object.values(values).filter((v) => v != null);
    if (!present.length) continue;
    const range = present.length > 1 ? round2(Math.max(...present) - Math.min(...present)) : null;
    rows.push({ stream, values, range });
  }
  return { rows, columns };
}

/* --------------------------------------------------- By_Clinic_Split data */

function buildSplit(bundle) {
  const sra = bundle.sra;
  const sraAmount = (codes) => (sra ? sraSum(sra, codes) : null);
  const sections = [];
  const subtotal = (sec) => round2(sec.rows.reduce((a, r) => a + r.amount, 0));
  const tieRows = (sec, target, label) => {
    // never silently plugged: the reconciling row is visible and labelled
    if (target == null || !sec.rows.length) return;
    const gap = round2(target - subtotal(sec));
    if (Math.abs(gap) > 0.005) sec.rows.push({ label, amount: gap });
  };

  const ip = { title: 'Ενδονοσοκομειακή περίθαλψη (Inpatient)', bucket: 'Inpatient', rows: [] };
  // per-clinic detail: claims file when present, else the Ενδ. «per clinic» pivot
  const clinicRows = (bundle.claims && bundle.claims.inpatientByClinic.length
    ? bundle.claims.inpatientByClinic
    : (bundle.inpatient && bundle.inpatient.byClinic ? bundle.inpatient.byClinic : []));
  if (clinicRows.length) {
    for (const r of clinicRows) {
      ip.rows.push({ label: r.clinic, amount: r.total,
                     fixedFee: r.fixedFee || null, drg: r.drg || null });
    }
  } else if (bundle.claims) {
    ip.rows.push({ label: 'Ενδονοσοκομειακή (inpatient claims)', amount: bundle.claims.bySegment['Inpatient'] || 0 });
  } else if (bundle.inpatient) {
    ip.rows.push({ label: 'Κανονικά (Regular)', amount: bundle.inpatient.regular });
    ip.rows.push({ label: 'Εξειδικευμένα (Specialized)', amount: bundle.inpatient.specialized });
    if (bundle.inpatient.gennes) ip.rows.push({ label: 'Γέννες (Births)', amount: bundle.inpatient.gennes });
    ip.rows.push({ label: 'Κατάλογος Z (Z-catalogue)', amount: bundle.inpatient.zCatalogue });
    for (const [label, amount] of Object.entries(bundle.inpatient.other || {})) {
      ip.rows.push({ label, amount });
    }
  }
  tieRows(ip, sraAmount(['IS']), 'Διαφορά προς SRA (reconciling diff to SRA)');
  if (bundle.hemo || (sra && sra.lines.some((l) => l.code === 'HEMO'))) {
    const hemoAmt = sra ? sraAmount(['HEMO']) : (bundle.hemo ? bundle.hemo.total : 0);
    if (hemoAmt) ip.rows.push({ label: 'Αιμοκάθαρση (Hemodialysis adjustment)', amount: hemoAmt });
  }
  sections.push(ip);

  const ae = { title: 'ΤΑΕΠ (A&E)', bucket: 'A&E', rows: [] };
  let aeAmt = sraAmount(['AE', 'A&E']);
  if (aeAmt == null && bundle.claims) aeAmt = bundle.claims.bySegment['A&E'] || 0;
  ae.rows.push({ label: 'Ατυχήματα & Επείγοντα (A&E)', amount: aeAmt || 0 });
  sections.push(ae);

  const out = { title: 'Εξωνοσοκομειακή περίθαλψη (Outpatient)', bucket: 'Outpatient', rows: [] };
  if (bundle.claims && Object.keys(bundle.claims.osBySpecialty).length) {
    for (const [spec, amt] of Object.entries(bundle.claims.osBySpecialty).sort((a, b) => b[1] - a[1])) {
      out.rows.push({ label: `Ειδικοί Ιατροί — ${spec} (OS)`, amount: amt });
    }
    tieRows(out, sraAmount(['OS']), 'Ειδικοί Ιατροί — διαφορά προς SRA (OS diff)');
  } else {
    let osAmt = sraAmount(['OS']);
    if (osAmt == null && bundle.claims) osAmt = bundle.claims.bySegment['Outpatient Specialists'] || 0;
    if (osAmt) out.rows.push({ label: 'Ειδικοί Ιατροί (Outpatient Specialists)', amount: osAmt });
  }
  let nmAmt = sraAmount(['NM']);
  if (nmAmt == null && bundle.claims) nmAmt = bundle.claims.bySegment['Nurses-Midwives'] || 0;
  if (nmAmt) out.rows.push({ label: 'Νοσηλευτές/Μαίες (Nurses-Midwives)', amount: nmAmt });
  let apAmt = sraAmount(['AP']);
  if (apAmt == null && bundle.claims) apAmt = bundle.claims.bySegment['Allied Health'] || 0;
  if (apAmt) out.rows.push({ label: 'Άλλοι Επαγγελματίες Υγείας (Allied Health)', amount: apAmt });
  const pdFfs = sraAmount(['PD']);
  if (pdFfs) out.rows.push({ label: 'Προσωπικοί Ιατροί — FFS (PD fee-for-service)', amount: pdFfs });
  let pdCap = sraAmount(['PD-CAP']);
  if (pdCap == null && bundle.capitation) pdCap = bundle.capitation.total;
  if (pdCap) out.rows.push({ label: 'Προσωπικοί Ιατροί — κατά κεφαλήν (PD capitation)', amount: pdCap });
  let kpi = sraAmount(['KPI', 'PD-KPI', 'MRI', 'CT', 'MRI/CT']);
  if (kpi == null && bundle.quality) kpi = bundle.quality.total;
  if (kpi) out.rows.push({ label: 'Ποιοτικά Κριτήρια / MRI-CT (Quality criteria)', amount: kpi });
  if (sra) {
    for (const l of sra.lines.filter((x) => x.channel === 'Unmapped')) {
      out.rows.push({ label: `Προσαρμογή (adjustment): ${l.description}`, amount: l.amount });
    }
  }
  sections.push(out);

  const ph = { title: 'Φάρμακα (Pharma)', bucket: 'Pharma', rows: [] };
  const phClaims = sraAmount(['PH']);
  if (phClaims) ph.rows.push({ label: 'Φάρμακα & Αναλώσιμα — PH (pharmacy claims)', amount: phClaims });
  let drugs = sraAmount(['PHD']);
  if (drugs == null && bundle.pharma) drugs = bundle.pharma.byType['Drugs'] || 0;
  if (drugs) ph.rows.push({ label: 'Φάρμακα (Drugs)', amount: drugs });
  let cons = sraAmount(['PHC']);
  if (cons == null && bundle.pharma) cons = bundle.pharma.byType['Consumables'] || 0;
  if (cons && !(phClaims && sra)) ph.rows.push({ label: 'Αναλώσιμα (Consumables)', amount: cons });
  let fee = sraAmount(['PHF']);
  if (fee == null && bundle.phfee) fee = bundle.phfee.computed;
  if (fee) ph.rows.push({ label: 'Αμοιβή Φαρμακοποιού (Pharmacist fee)', amount: fee });
  sections.push(ph);

  for (const s of sections) s.subtotal = subtotal(s);
  return sections;
}

/* -------------------------------------------------------------- run */

function runReconciliation(bundle, crosscheckMode) {
  const result = { bundle, crosscheckMode: !!crosscheckMode, buckets: {}, crosschecks: [],
                   split: [], matrix: [], matrixColumns: [] };
  if (!crosscheckMode && bundle.sra) {
    for (const b of BUCKETS) {
      result.buckets[b] = round2(bundle.sra.lines.filter((l) => l.bucket === b)
        .reduce((a, l) => a + l.amount, 0));
    }
    result.crosschecks = buildCrosschecks(bundle);
    result.chequeTotal = bundle.sra.statedTotal;
  } else {
    const { rows, columns } = buildMatrix(bundle);
    result.matrix = rows;
    result.matrixColumns = columns;
    result.crosschecks = buildCrosschecks(bundle);
    result.chequeTotal = null;
  }
  result.split = buildSplit(bundle);
  result.openVariances = result.crosschecks.filter((c) => c.diff != null
    && Math.abs(c.diff) > CENT && c.flag !== 'ok');
  return result;
}
