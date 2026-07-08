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

  /* UNRECOGNISED files are excluded with a warning, never a hard stop: a
   * full-month dump may contain report types the app doesn't know yet —
   * they are captured in the diagnostics so support can add them. */
  const bad = files.filter((f) => f.error || !f.reportType);
  if (bad.length) {
    notes.push('Προσοχή (warning): τα εξής αρχεία δεν αναγνωρίστηκαν και ΑΓΝΟΟΥΝΤΑΙ '
      + 'στη συμφωνία (unrecognised files, ignored): '
      + bad.map((f) => f.filename).join(' · ')
      + '. Δείτε τα Διαγνωστικά και κατεβάστε την αναφορά για να προστεθούν '
      + '(download the diagnostics report so they can be supported).');
    files = files.filter((f) => !bad.includes(f));
  }
  const byType = new Map();
  for (const f of files) {
    if (f.reportType) {
      if (!byType.has(f.reportType)) byType.set(f.reportType, []);
      byType.get(f.reportType).push(f.filename);
    }
  }
  // multiple SRAs are allowed — a month can be settled by several cheques
  const dupeMsgs = [...byType.entries()]
    .filter(([t, names]) => names.length > 1 && t !== RT.SRA)
    .map(([t, names]) => `${REPORT_LABELS[t]}: ${names.join(', ')}`);
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
    const sps = [...sraPeriods].map((p) => p.split('-').map(Number));
    if (!service) {
      period = sps[0];
      notes.push(`Μήνας υπηρεσιών από το SRA: ${fmtP(period)} (ημερομηνία εγγράφου `
        + `${fmtP(nextMonth(period))} — η ΟΑΥ πληρώνει με καθυστέρηση / paid in arrears).`);
    } else {
      if (sps.some((sp) => sp[0] === service[0] && sp[1] === service[1])) {
        notes.push(`Το SRA φέρει ημερομηνία ${fmtP(nextMonth(service))} — αντιστοιχίστηκε `
          + `στον μήνα υπηρεσιών ${fmtP(service)} (η ΟΑΥ πληρώνει με καθυστέρηση / SRA is `
          + 'dated one month after the service month).');
      }
      for (const sp of sps.filter((p) => p[0] !== service[0] || p[1] !== service[1])) {
        notes.push(`Προσοχή (warning): SRA φαίνεται να αφορά τον ${fmtP(sp)} (ημερομηνία `
          + `εγγράφου ${fmtP(nextMonth(sp))}), ενώ οι υπόλοιπες αναφορές τον ${fmtP(service)}. `
          + 'Αν ανέβηκε λάθος SRA, οι έλεγχοι δεν θα δέσουν — η συμφωνία θα δείξει τη διαφορά '
          + '(a wrong month\'s SRA will not tie out).');
      }
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

function claimCandidates(bundle, diff) {
  /* claims whose single amount equals the diff — usually old-period claims
   * paid in this cheque but absent from the Ενδ. summary */
  if (!bundle.claims || !bundle.claims.inpatientRows) return '';
  const hits = bundle.claims.inpatientRows
    .filter(([, , amt]) => Math.abs(amt - Math.abs(diff)) <= 0.01);
  if (!hits.length) return '';
  const shown = hits.slice(0, 3)
    .map(([cid, date, amt]) => `claim ${cid} (${date}) ${formatEur(amt)}`).join(' · ');
  return '\nΠιθανή αιτία — απαίτηση παλαιότερης περιόδου που πληρώθηκε τώρα '
    + `(old-period claim paid in this cheque): ${shown}`;
}

function gate4InternalAsserts(bundle) {
  let ok = true;
  const msgs = [];
  if (bundle.inpatient && bundle.claims) {
    const claimsIp = bundle.claims.bySegment['Inpatient'] || 0;
    const d = round2(claimsIp - bundle.inpatient.synolo);
    if (Math.abs(d) > CENT) {
      ok = false;
      const segs = Object.entries(bundle.claims.bySegment).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `«${k}»: ${formatEur(v)}`).join(' · ');
      msgs.push('Claims «all» Inpatient ≠ Ενδ. Σύνολο: '
        + `${formatEur(claimsIp)} vs ${formatEur(bundle.inpatient.synolo)} (διαφορά ${formatEur(d)})`
        + claimCandidates(bundle, d)
        + `\nΤιμές DR SEGMENT στο αρχείο claims: ${segs}`);
    }
  }
  if (bundle.sra) {
    const parts = bundle.sra.parts && bundle.sra.parts.length
      ? bundle.sra.parts
      : [[bundle.sra.chequeNo, bundle.sra.linesTotal, bundle.sra.statedTotal]];
    for (const [cheque, linesTotal, stated] of parts) {
      const d = round2(linesTotal - stated);
      if (Math.abs(d) > CENT) {
        ok = false;
        msgs.push(`Άθροισμα γραμμών SRA #${cheque} ≠ δηλωμένο σύνολο επιταγής: `
          + `${formatEur(linesTotal)} vs ${formatEur(stated)} (διαφορά ${formatEur(d)})`);
      }
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
  if ((up.includes('ΠΟΙΟΤΙΚ') || up.includes('QUALITY')) && source === 0) {
    return ['Η εξαγωγή Ποιοτικών Κριτηρίων δεν περιέχει ποσά (κενό αρχείο) ενώ το SRA '
      + 'πληρώνει γραμμές KPI/MRI-CT — κατεβάστε ξανά την αναφορά από την πύλη ΟΑΥ '
      + '(the quality-criteria export is empty; re-download it from the HIO portal).', 'red'];
  }
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
  const mk = (o) => ({ ...o,
    get diff() { return this.sraSide == null ? null : round2(this.sourceTotal - this.sraSide); } });

  // documented finding: SRA line sum vs stated cheque (only when broken)
  if (sra) {
    const residual = round2(sra.linesTotal - sra.statedTotal);
    if (Math.abs(residual) > CENT) {
      checks.push(mk({
        name: 'SRA: άθροισμα γραμμών = δηλωμένο σύνολο επιταγής (lines vs stated)',
        sourceTotal: sra.statedTotal, sraCodes: [], sraSide: sra.linesTotal,
        note: 'Διαφορά ανάλυσης γραμμών (αναδιπλωμένες γραμμές PDF;) — δείτε τα '
          + 'Διαγνωστικά. Τεκμηριωμένη διαφορά, εμφανίζεται και στα zero-checks '
          + '(documented parsing residual).',
        flag: 'red' }));
    }
  }
  // claims-file vs Ενδ. summary (report-vs-report) with old-claim candidates
  if (bundle.inpatient && bundle.claims) {
    const d = round2((claimsIp || 0) - bundle.inpatient.synolo);
    checks.push(mk({
      name: 'Claims «all» Inpatient = Ενδ. Σύνολο (report vs report)',
      sourceTotal: claimsIp || 0, sraCodes: [], sraSide: bundle.inpatient.synolo,
      note: Math.abs(d) <= CENT ? 'OK — ταυτίζεται (ties out)'
        : 'Ανεξήγητη διαφορά claims vs Ενδ.' + claimCandidates(bundle, d),
      flag: Math.abs(d) <= CENT ? 'ok' : 'red' }));
  }

  if (bundle.inpatient) {
    add('Ενδ. Πληρωμένες Απαιτήσεις (inpatient claims file) = SRA IS',
        bundle.inpatient.synolo, ['IS'], null, claimsIp);
    const c = checks[checks.length - 1];
    // when SRA IS ties the claims file to the cent, the gap vs the Ενδ.
    // summary is the old-period claims — name them instead of «unexplained»
    if (sra && claimsIp != null && c.sraSide != null
        && Math.abs(c.sraSide - claimsIp) <= CENT && Math.abs(c.diff || 0) > CENT) {
      c.flag = 'amber';
      c.note = 'Το SRA IS ταυτίζεται με το αρχείο Claims «all» — η διαφορά προς την '
        + 'Ενδ. είναι απαιτήσεις παλαιότερων περιόδων που πληρώθηκαν τώρα (SRA IS ties '
        + 'the claims file; the gap vs the Ενδ. summary is old-period claims paid in '
        + 'this cheque).' + claimCandidates(bundle, c.diff || 0);
    }
  }
  if (sraCodeSet.has('PH') && (bundle.pharma || bundle.phfee)) {
    /* Newer SRAs pay ALL pharmacy invoices as daily «PH - HCP SERVICES»
     * lines — including the pharmacist-fee invoice.  Credit notes and
     * manual adjustments are classified apart (PH-ADJ / PHF), so the
     * daily lines obey the clean identity, verified Feb+Apr 2026:
     *   SRA PH = pharma claims gross + fee(packages × unit) */
    const phSum = sraSum(sra, ['PH']);
    const phfSum = sraSum(sra, ['PHF']);
    const fee = bundle.phfee ? bundle.phfee.computed : 0;
    if (bundle.phfee) {
      const unitStr = bundle.phfee.unitPrice.toFixed(2).replace('.', ',');
      const sideNet2 = round2(phSum - (bundle.pharma ? bundle.pharma.total : 0));
      let [note, flag] = annotate('fee net', fee, sideNet2);
      if (Math.abs(fee - sideNet2) <= CENT) {
        note = 'OK — το τιμολόγιο αμοιβής πληρώνεται μέσα στις ημερήσιες γραμμές PH '
          + '(fee invoice paid inside the daily PH lines).';
        if (Math.abs(phfSum) > CENT) {
          note += ' Οι διορθώσεις CRN-Packages εμφανίζονται χωριστά ως PHF '
            + '(package-correction credit notes shown separately as PHF).';
        }
      }
      checks.push({ name: `Αμοιβή Φαρμακοποιού (packages × ${unitStr} €) = SRA PH − claims`,
                    sourceTotal: round2(fee), sraCodes: ['PH'], sraSide: sideNet2,
                    note, flag, sideKind: 'fee_net',
                    get diff() { return this.sraSide == null ? null : round2(this.sourceTotal - this.sraSide); } });
    }
    if (bundle.pharma) {
      const sideA = round2(phSum - fee);
      let [note, flag] = annotate('pharma vs PH', bundle.pharma.total, sideA);
      if (Math.abs(bundle.pharma.total - sideA) <= CENT) {
        note = 'OK — SRA PH μείον το τιμολόγιο αμοιβής φαρμακοποιού (PH lines net '
          + 'of the pharmacist-fee invoice).';
      }
      checks.push({ name: 'Φάρμακα & Αναλώσιμα (pharma claims gross) = SRA PH − αμοιβή φαρμακοποιού',
                    sourceTotal: bundle.pharma.total, sraCodes: ['PH'], sraSide: sideA,
                    note, flag, sideKind: 'ph_minus_fee',
                    get diff() { return this.sraSide == null ? null : round2(this.sourceTotal - this.sraSide); } });
    }
  } else {
    if (bundle.pharma) {
      add('Φάρμακα (pharma drugs) = SRA PHD', bundle.pharma.byType['Drugs'] || 0, ['PHD']);
      const cons = bundle.pharma.byType['Consumables'] || 0;
      if (cons) add('Αναλώσιμα (pharma consumables) = SRA PHC', cons, ['PHC']);
    }
    if (bundle.phfee) {
      const unitStr = bundle.phfee.unitPrice.toFixed(2).replace('.', ',');
      add(`Αμοιβή Φαρμακοποιού (packages × ${unitStr} €) = SRA PHF`, bundle.phfee.computed, ['PHF']);
    }
  }
  const capBundled = bundle.capitation != null && sra != null && !sraCodeSet.has('PD-CAP');
  if (bundle.claims) {
    const capExtra = capBundled ? bundle.capitation.total : 0;
    const name = capExtra
      ? 'Πληρωμένες Απαιτήσεις «all» + capitation ≈ SRA service lines'
      : 'Πληρωμένες Απαιτήσεις «all» (HCP claims ex-capitation) ≈ SRA service lines';
    add(name, round2(claimsTotal(bundle.claims) + capExtra), SERVICE_CODES,
        'Κατά προσέγγιση: οι γραμμές SRA περιέχουν προσαρμογές (ADJ/COR) και επιταγές '
        + 'δορυφορικών παροχέων που δεν υπάρχουν στο αρχείο claims (approximate: SRA '
        + 'includes adjustments and satellite-supplier cheques absent from the claims export).');
  }
  const claimsPd = bundle.claims ? bundle.claims.bySegment['Personal Doctors'] : null;
  if (bundle.capitation) {
    if (capBundled && claimsPd != null) {
      // exact identity, verified Apr+May 2026: the daily PD lines pay
      // capitation + the PD fee-for-service claims; fixed-price items
      // (OOH, vaccinations) are classified apart as PD-FP
      add('Capitation + Claims «Personal Doctors» = SRA PD (ημερήσιες γραμμές)',
          round2(bundle.capitation.total + claimsPd), ['PD']);
    } else if (capBundled) {
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
    const hemoAmt = sra ? sraSum(sra, ['HEMO']) : 0;
    // GL inpatient income (26xxx) includes hemodialysis (per diem) and the
    // A&E-referral adjustment — verified to the cent on Apr-2026:
    // 26xxx = SRA IS + HEMO + IS-ADJ
    add('GL: Ενδονοσοκομειακή (26001+26002+26003+26007) = SRA IS + αιμοκάθαρση + προσαρμογές',
        gl.inpatient, ['IS', 'IS-ADJ', 'HEMO'],
        null, bundle.inpatient ? bundle.inpatient.synolo : claimsIp);
    const glIpCheck = checks[checks.length - 1];
    add('GL: Z-catalogue & per diem (26003+26007) vs ΟΑΥ Z + αιμοκάθαρση', gl.zCatalogue, []);
    if (bundle.inpatient) {
      const c = checks[checks.length - 1];
      c.sraSide = round2(bundle.inpatient.zCatalogue + hemoAmt);
      [c.note, c.flag] = annotate('Z-CATALOGUE GL', c.sourceTotal, c.sraSide);
      const cand = claimCandidates(bundle, c.diff || 0);
      if (Math.abs(c.diff || 0) > CENT && cand) { c.note += cand; c.flag = 'amber'; }
      // the SAME gap on both rows = the known Z-tail classification issue,
      // not a cash break — say so on the inpatient row too
      if (Math.abs(glIpCheck.diff || 0) > CENT && c.diff != null
          && Math.abs((glIpCheck.diff || 0) - c.diff) <= CENT) {
        glIpCheck.flag = 'amber';
        glIpCheck.note = 'Ίδια διαφορά με τη γραμμή Z — Z-procedures/tail χρεωμένα σε '
          + 'κλινικούς λογαριασμούς (same gap as the Z row: classification, not cash).';
      }
    }
    add('GL: ΤΑΕΠ / A&E (25801) = SRA AE', gl.ae, ['AE', 'A&E'],
        null, bundle.claims ? (bundle.claims.bySegment['A&E'] || 0) : null);
    // PD fixed-price items (vaccinations, out-of-office, KPIs) sit in the
    // clinical 25xxx centres; capitation (51001001) is booked apart but
    // paid inside the SRA PD lines — compare the two wholes
    add('GL: Εξωνοσοκομειακή & ΠΙ (25xxx clinical + capitation) = SRA OS+NM+AP+PD+KPI',
        round2(gl.outpatient + gl.capitation),
        ['OS', 'NM', 'AP', 'PD', 'PD-CAP', 'PD-KPI', 'PD-FP', 'KPI', 'MRI', 'CT', 'MRI/CT'],
        'Επιταγές δορυφορικών παροχέων (άλλος κωδικός F στην κεφαλίδα SRA, π.χ. κέντρα '
        + 'υγείας) μένουν εκτός του GL αυτού του νοσοκομείου (satellite-supplier cheques '
        + 'sit outside this hospital GL vendor).',
        claimsOut);
    // the SRA pays the fee invoice inside the daily PH lines, so compare
    // GL 25501 to the fee REPORT (packages × unit) — known flat-booking gap
    add('GL: Αμοιβή Φαρμακοποιού - pharmacist fee (25501) vs αναφορά αμοιβής',
        gl.pharmacistFee, []);
    if (bundle.phfee) {
      const c = checks[checks.length - 1];
      c.sraSide = bundle.phfee.computed;
      [c.note, c.flag] = annotate(c.name, c.sourceTotal, c.sraSide);
    }
    add('GL: Φάρμακα (255xx) vs pharma claims gross', gl.pharmaOther, []);
    if (bundle.pharma) {
      const c = checks[checks.length - 1];
      c.sraSide = bundle.pharma.total;
      [c.note, c.flag] = annotate('PHARMA GL', c.sraSide, c.sourceTotal);
      if (Math.abs(c.diff || 0) <= CENT) c.note = 'OK — ταυτίζεται (ties out)';
    }
    if (gl.capitation) {
      if (sra && sraCodeSet.has('PD-CAP')) {
        add('GL: Capitation (51001001) = SRA PD capitation', gl.capitation, ['PD-CAP'],
            null, bundle.capitation ? bundle.capitation.total : null);
      } else {
        // capitation is bundled inside the SRA PD lines — tie the GL
        // account to the capitation REPORT instead (exact on Apr-2026)
        add('GL: Capitation (51001001) = Capitation report', gl.capitation, [],
            null, bundle.capitation ? bundle.capitation.total : null);
        if (bundle.capitation) {
          const c = checks[checks.length - 1];
          c.sraSide = bundle.capitation.total;
          [c.note, c.flag] = annotate(c.name, c.sourceTotal, c.sraSide);
        }
      }
    }
  }

  if (bundle.isaud) {
    add('IS Auditor: inpatient (DRG fees + Z-catalogue) = SRA IS', bundle.isaud.inpatientTotal, ['IS'],
        'IS Auditor org-wide detail; μικρές διαφορές στρογγυλοποίησης.',
        bundle.inpatient ? bundle.inpatient.synolo : claimsIp);
    const c = checks[checks.length - 1];
    // per-row rounding across ~10k detail rows — the brief accepts small
    // tolerances (F1054: €0.45); the Diff cell still shows the live gap
    if (c.flag !== 'ok' && c.diff != null && Math.abs(c.diff) <= 5.00) {
      c.flag = 'ok';
      c.note = 'OK — εντός ανοχής στρογγυλοποίησης του αναλυτικού αρχείου '
        + `(rounding tolerance, διαφορά ${formatEur(c.diff)}).`;
    }
  }
  if (bundle.xmlActivity) {
    const x = bundle.xmlActivity;
    let src = x.total;
    let name = 'XML activity export (OS+NM+AP) = SRA OS+NM+AP';
    if (sra && x.byPayment && Object.keys(x.byPayment).length) {
      // the PAYMENT NO. gate: keep only activities the uploaded cheques
      // actually paid — the export may span other payments
      const cheques = new Set((sra.parts || []).map((p) => p[0]));
      if (!cheques.size) cheques.add(sra.chequeNo);
      const matched = round2(Object.entries(x.byPayment)
        .filter(([k]) => cheques.has(k)).reduce((a, [, v]) => a + v, 0));
      if (matched && Math.abs(x.total - matched) > CENT) {
        src = matched;
        name = 'XML activity (μόνο PAYMENT NO. αυτών των επιταγών) = SRA OS+NM+AP';
      }
    }
    add(name, src, ['OS', 'NM', 'AP'],
        'Κατά προσέγγιση: activity-level έναντι γραμμών SRA (προσαρμογές/χρονισμός εκτός export).',
        claimsOut);
    if (src !== x.total) {
      checks[checks.length - 1].note += ` Εκτός επιταγών: ${formatEur(round2(x.total - src))} `
        + '(activities paid by other cheques, excluded).';
    }
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
  } else if (sra) {
    const isAmt = sraAmount(['IS']);
    if (isAmt) ip.rows.push({ label: 'Ενδονοσοκομειακή (SRA IS)', amount: isAmt });
  }
  tieRows(ip, sraAmount(['IS']), 'Διαφορά προς SRA (reconciling diff to SRA)');
  if (bundle.hemo || (sra && sra.lines.some((l) => l.code === 'HEMO'))) {
    const hemoAmt = sra ? sraAmount(['HEMO']) : (bundle.hemo ? bundle.hemo.total : 0);
    // bucket depends on the patient — default Inpatient per ΟΑΥ's «ADJ-IS»
    // label; flip the blue Bucket cell on the SRA tab and SUMIFS re-tie
    if (hemoAmt) ip.rows.push({ label: 'Αιμοκάθαρση (Hemodialysis — Inpatient ή Outpatient ανά ασθενή)', amount: hemoAmt });
  }
  const isAdj = sraAmount(['IS-ADJ']);
  if (isAdj) {
    ip.rows.push({ label: 'Ενδονοσοκομειακή — προσαρμογή παραπομπών ΤΑΕΠ (A&E-referral adjustment, GL 26xxx)',
                   amount: isAdj });
  }
  const isPrior = sraAmount(['IS-PRIOR']);
  if (isPrior) {
    ip.rows.push({ label: 'Τακτοποίηση προηγούμενων περιόδων — DRG (prior-period settlement, e.g. year-end DRG true-up)',
                   amount: isPrior });
  }
  sections.push(ip);

  const ae = { title: 'ΤΑΕΠ (A&E)', bucket: 'A&E', rows: [] };
  let aeAmt = sraAmount(['AE', 'A&E']);
  if (aeAmt == null && bundle.claims) aeAmt = bundle.claims.bySegment['A&E'] || 0;
  ae.rows.push({ label: 'Ατυχήματα & Επείγοντα (A&E)', amount: aeAmt || 0 });
  const aeAdj = sraAmount(['AE-ADJ']);
  if (aeAdj) ae.rows.push({ label: 'ΤΑΕΠ — προσαρμογές/παραπομπές (A&E adjustments/referrals)', amount: aeAdj });
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
  const pdFp = sraAmount(['PD-FP']);
  if (pdFp) out.rows.push({ label: 'Προσωπικοί Ιατροί — σταθερές χρεώσεις (PD fixed price: OOH, εμβολιασμοί)', amount: pdFp });
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
  if (fee) {
    ph.rows.push({ label: phClaims
      ? 'Αμοιβή Φαρμακοποιού — διορθώσεις CRN-Packages (fee corrections)'
      : 'Αμοιβή Φαρμακοποιού (Pharmacist fee)', amount: fee });
  }
  const phAdj = sraAmount(['PH-ADJ']);
  if (phAdj) ph.rows.push({ label: 'Φάρμακα — προσαρμογές/πιστωτικά (pharmacy adjustments/CRN)', amount: phAdj });
  const phPrior = sraAmount(['PH-PRIOR']);
  if (phPrior) {
    ph.rows.push({ label: 'Τακτοποίηση προηγούμενων περιόδων — φάρμακα (prior-period settlement, e.g. innovative antibiotics)',
                   amount: phPrior });
  }
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
  // documented parsing residual (SRA lines − stated): zero-checks may read
  // exactly this value; it stays visible as a red Source_crosscheck row
  result.sraResidual = bundle.sra
    ? round2(bundle.sra.linesTotal - bundle.sra.statedTotal) : 0;
  return result;
}
