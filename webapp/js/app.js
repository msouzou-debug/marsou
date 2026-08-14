/* UI wiring — browser equivalent of app.py.  All logic lives in the other
 * js/ modules; files never leave the machine, the workbook is built in
 * memory and offered as a download. */
'use strict';

const state = {
  files: [], running: false,
  ov: { hospital: '', month: '', year: '', sraText: '' },  // manual fallbacks
};

/* Files with the manual fallbacks applied: hospital/month fill gaps only,
 * and pasted SRA text becomes a virtual SRA when no PDF one was recognised. */
function effectiveFiles() {
  const ov = state.ov;
  const out = state.files.map((f) => {
    const g = { ...f };
    if (!g.hospitalCode && ov.hospital) g.hospitalCode = ov.hospital;
    if (!g.year && ov.year && ov.month) { g.year = +ov.year; g.month = +ov.month; }
    return g;
  });
  const sraText = ov.sraText.trim();
  if (sraText && !out.some((f) => f.reportType === RT.SRA)) {
    const [y, m] = findServicePeriod(sraText);
    out.push({
      filename: '(χειροκίνητο κείμενο SRA / manual SRA text)', data: null,
      reportType: RT.SRA, hospitalCode: findHospital(sraText) || ov.hospital || null,
      year: y || (ov.year && ov.month ? +ov.year : null),
      month: m || (ov.year && ov.month ? +ov.month : null),
      warnings: [], error: null, rawText: sraText, needsManualText: false, probe: null,
    });
  }
  return out;
}

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ------------------------------------------------------------ file intake */

async function addFiles(fileList) {
  $('status').textContent = 'Αναγνώριση αρχείων… (identifying files)';
  for (const file of fileList) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // replace a previous upload with the same name
    state.files = state.files.filter((f) => f.filename !== file.name);
    state.files.push(await identify(file.name, bytes));
  }
  $('status').textContent = '';
  render();
}

function removeFile(name) {
  state.files = state.files.filter((f) => f.filename !== name);
  render();
}

/* --------------------------------------------------------------- render */

function render() {
  const files = effectiveFiles();
  const crosscheck = $('crosscheck-mode').checked;
  $('results').innerHTML = '';
  $('report-guide').open = files.length === 0;   // guide up front, folds away once files arrive
  $('manual-fallback').hidden = state.files.length === 0;
  $('diagnostics').hidden = state.files.length === 0;
  if (!files.length) {
    $('checklist-wrap').innerHTML = '';
    $('gates').innerHTML = '';
    $('sra-review').innerHTML = '';
    $('notes').innerHTML = '';
    $('diagnostics-body').innerHTML = '';
    $('run-btn').disabled = true;
    return;
  }

  const provider = isProviderBatch(files);
  const grouped = provider ? groupByProvider(files) : null;
  const { gates, notes } = provider
    ? validateProviderBatches(grouped.batches, grouped.leftovers)
    : validateBatch(files, crosscheck);
  if (provider) renderProviderChecklist(grouped.batches);
  else renderChecklist(files, crosscheck);
  renderGates(gates.filter((g) => !g.passed));
  renderSraReview(files);
  renderDiagnostics();
  $('notes').innerHTML = notes.map((n) => (n.startsWith('Προσοχή')
    ? `<div class="warn">⚠️ ${esc(n)}</div>`
    : `<div class="note">ℹ️ ${esc(n)}</div>`)).join('');

  const warnings = files.flatMap((f) => f.warnings.map((w) => `${f.filename}: ${w}`));
  $('warnings').innerHTML = warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('');

  const blocked = !gates.every((g) => g.passed);
  $('run-btn').disabled = blocked || state.running;
  // a failing gate points at the fallbacks + diagnostics so nobody is stuck
  if (blocked) $('manual-fallback').open = true;
}

function renderProviderChecklist(batches) {
  /* A non-hospital month: one row per ΟΑΥ provider, showing which of its
   * files arrived.  Attribution is by content (F-code / PAYMENT NO.), so the
   * table also proves which cheque each provider's claims file belongs to. */
  const rows = batches.map((b) => {
    const have = new Set(b.files.map((f) => f.reportType));
    const cells = REQUIRED_TYPES_PROVIDER.concat([RT.XML_ACTIVITY])
      .map((t) => `<td>${have.has(t) ? '✔' : (REQUIRED_TYPES_PROVIDER.includes(t) ? '✖' : '—')}</td>`)
      .join('');
    return `<tr><td>${esc(b.label)}</td><td>${esc(b.code)}</td>`
      + `<td>${esc((b.cheques || []).join(', '))}</td>${cells}</tr>`;
  }).join('');
  const shared = (state.files || []).filter((f) =>
    f.reportType === RT.STAFF_MAPPING || f.reportType === RT.COST_CENTRE_MAP);
  const sharedHtml = shared.length
    ? '<p class="note">📋 Κοινά αρχεία παρτίδας: '
      + shared.map((f) => `${esc(REPORT_LABELS[f.reportType])} — ${esc(f.filename)}`).join(' · ')
      + '</p>'
    : '<p class="hint">Χωρίς μητρώο προσωπικού δεν γίνεται κατανομή ανά κλινική· '
      + 'ανεβάστε το μηνιαίο αρχείο προσωπικού (και προαιρετικά την αντιστοίχιση '
      + 'κέντρων κόστους SAP) μαζί με τα αρχεία του μήνα.</p>';
  $('checklist-wrap').innerHTML =
    '<h2>Πάροχοι στην παρτίδα (providers in this batch)</h2>'
    + '<p class="hint">Μη-νοσοκομειακοί πάροχοι ΟΑΥ (υπηρεσίες ψυχικής υγείας): κάθε '
    + 'μονάδα με δική της επιταγή. Η αντιστοίχιση γίνεται από το περιεχόμενο '
    + '(κωδικός F / PAYMENT NO.), ποτέ από το όνομα αρχείου.</p>'
    + '<table><thead><tr><th>Πάροχος (Provider)</th><th>Κωδικός</th>'
    + '<th>Επιταγή (Cheque)</th><th>SRA</th><th>Claims «all»</th>'
    + '<th>Activity export</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + sharedHtml;
}

function diagnosticsText() {
  const lines = ['OKYπY HIO reconciliation — Διαγνωστικά αρχείων (file diagnostics)', ''];
  for (const f of state.files) {
    lines.push('='.repeat(70));
    lines.push(`Αρχείο (file): ${f.filename}`);
    lines.push(`Τύπος (detected type): ${f.reportType ? REPORT_LABELS[f.reportType] : '— ΔΕΝ ΑΝΑΓΝΩΡΙΣΤΗΚΕ (unrecognised)'}`);
    lines.push(`Νοσοκομείο: ${f.hospitalCode || '—'} · Μήνας: ${f.month && f.year ? `${f.month}/${f.year}` : '—'}`);
    if (f.error) lines.push(`Σφάλμα (error): ${f.error}`);
    if (f.probe) { lines.push('--- τι διάβασε η εφαρμογή (what the app read) ---'); lines.push(f.probe); }
    lines.push('');
  }
  return lines.join('\n');
}

function renderDiagnostics() {
  $('diagnostics-body').innerHTML = state.files.map((f) => {
    const type = f.reportType ? REPORT_LABELS[f.reportType]
      : '<span style="color:#C00000">ΔΕΝ ΑΝΑΓΝΩΡΙΣΤΗΚΕ (unrecognised)</span>';
    const err = f.error ? `<div class="error">${esc(f.error)}</div>` : '';
    const probe = f.probe ? `<pre>${esc(f.probe)}</pre>` : '';
    return `<h4>${esc(f.filename)} → ${type}</h4>${err}${probe}`;
  }).join('');
}

function renderChecklist(files, crosscheck) {
  const byType = new Map(files.filter((f) => f.reportType).map((f) => [f.reportType, f]));
  const listed = [...REQUIRED_TYPES,
                  ...Object.values(RT).filter((t) => !REQUIRED_TYPES.includes(t) && byType.has(t))];
  let html = '<table><thead><tr><th>Αναφορά (Report)</th><th>Αρχείο (Detected file)</th>'
    + '<th>Νοσοκομείο (Hospital)</th><th>Μήνας (Month)</th><th>OK</th><th></th></tr></thead><tbody>';
  for (const t of listed) {
    const f = byType.get(t);
    const required = REQUIRED_TYPES.includes(t) && !(crosscheck && t === RT.SRA);
    const hosp = f && f.hospitalCode ? `${f.hospitalCode} (${HOSPITALS[f.hospitalCode][1]})` : '—';
    const month = f && f.month && f.year ? `${MONTH_NAMES_EL[f.month]} ${f.year}` : '—';
    const ok = f ? '✔' : (required ? '✖' : '·');
    html += `<tr><td>${esc(REPORT_LABELS[t])}${required ? ' *' : ''}</td>`
      + `<td>${f ? esc(f.filename) : '—'}</td><td>${esc(hosp)}</td><td>${esc(month)}</td>`
      + `<td class="${f ? 'ok' : (required ? 'missing' : '')}">${ok}</td>`
      + `<td>${f ? `<button class="link" data-remove="${esc(f.filename)}">✕</button>` : ''}</td></tr>`;
  }
  for (const f of files.filter((x) => !x.reportType)) {
    html += `<tr><td>Άγνωστο — αγνοείται (unrecognised, ignored)</td><td>${esc(f.filename)}</td><td>—</td><td>—</td>`
      + `<td class="missing">✖</td><td><button class="link" data-remove="${esc(f.filename)}">✕</button></td></tr>`;
  }
  html += '</tbody></table>';
  $('checklist-wrap').innerHTML = html;
  for (const btn of $('checklist-wrap').querySelectorAll('button[data-remove]')) {
    btn.addEventListener('click', () => removeFile(btn.dataset.remove));
  }
}

function renderGates(failed) {
  $('gates').innerHTML = failed.map((g) =>
    `<div class="error"><strong>Πύλη ${g.number} — ${esc(g.name)}</strong><br>${esc(g.message).replace(/\n/g, '<br>')}</div>`
  ).join('') + (failed.length
    ? '<div class="note">💡 Δείτε τα «Διαγνωστικά αρχείων» παρακάτω για το τι διάβασε η εφαρμογή '
      + 'από κάθε αρχείο, ή χρησιμοποιήστε τη «Χειροκίνητη επιλογή». Αν κάποιο αρχείο δεν '
      + 'αναγνωρίζεται, κατεβάστε την αναφορά διαγνωστικών για να προσαρμοστεί η εφαρμογή '
      + '(download the diagnostics report so the app can be adapted to your files).</div>'
    : '');
}

function renderSraReview(files) {
  const sraFiles = files.filter((f) => f.reportType === RT.SRA && f.rawText != null);
  // on-screen correction works for a single SRA; with several cheques the
  // parsed lines are already tagged per cheque in the workbook
  if (sraFiles.length !== 1) { $('sra-review').innerHTML = ''; return; }
  const sra = sraFiles[0];
  const existing = $('sra-text');
  const value = existing ? existing.value : sra.rawText;
  $('sra-review').innerHTML = `
    <details>
      <summary>Έλεγχος κειμένου SRA (review extracted SRA text) — ${esc(sra.filename)}</summary>
      <p class="hint">Διορθώστε τις γραμμές αν χρειάζεται πριν την εκτέλεση — η εφαρμογή δεν μαντεύει ποτέ ποσά
        (correct the lines before running — amounts are never guessed).</p>
      <textarea id="sra-text" rows="14" spellcheck="false">${esc(value)}</textarea>
    </details>`;
}

/* ------------------------------------------------------------------ run */

const SLOT = {
  [RT.SRA]: 'sra', [RT.INPATIENT_SUMMARY]: 'inpatient', [RT.CLAIMS_ALL]: 'claims',
  [RT.PHARMA_CLAIMS]: 'pharma', [RT.PHARMACIST_FEE]: 'phfee', [RT.CAPITATION]: 'capitation',
  [RT.QUALITY_CRITERIA]: 'quality', [RT.HEMODIALYSIS]: 'hemo', [RT.GL_EXTRACT]: 'gl',
  [RT.IS_AUDITOR]: 'isaud', [RT.XML_ACTIVITY]: 'xmlActivity',
};

async function run() {
  const crosscheck = $('crosscheck-mode').checked;
  const files = effectiveFiles();
  if (isProviderBatch(files)) return runProviders(files);
  const { gates, hospital, period } = validateBatch(files, crosscheck);
  if (!gates.every((g) => g.passed)) return;
  state.running = true;
  $('run-btn').disabled = true;
  $('results').innerHTML = '<p>Εκτέλεση… (running)</p>';
  try {
    const [year, month] = period;
    const bundle = { hospitalCode: hospital, year, month };
    const sraOverride = $('sra-text') ? $('sra-text').value : null;
    const sras = [];
    for (const f of files) {
      if (!f.reportType) continue;  // unrecognised file — warned, ignored
      if (f.reportType === RT.SRA) {
        // a month can be settled by several cheques — collect and merge
        const override = f.data && files.filter((x) => x.reportType === RT.SRA).length === 1
          ? sraOverride : null;
        sras.push(await extractReport(RT.SRA, f, hospital, override));
      } else {
        bundle[SLOT[f.reportType]] = await extractReport(f.reportType, f, hospital, null);
      }
    }
    if (sras.length) bundle.sra = mergeSras(sras, hospital);

    let condWarning = '';
    if (bundle.sra) {
      const have = new Set(files.map((f) => f.reportType));
      const missing = conditionalRequirements(bundle.sra).filter((t) => !have.has(t));
      if (missing.length) {
        // warning, not a stop: the run proceeds, but the matching SRA amounts
        // are not vouched by a report and stay visible in the cross-checks
        condWarning = 'Το SRA περιέχει γραμμές που αντιστοιχούν σε αναφορές που δεν '
          + 'ανέβηκαν (supporting reports not uploaded): '
          + missing.map((t) => REPORT_LABELS[t]).join(' · ')
          + ' — τα σχετικά ποσά δεν επαληθεύονται από αναφορά (amounts not vouched).';
      }
    }
    // gate-4 failures are FINDINGS: warn and proceed — the diffs appear as
    // documented red rows in Source_crosscheck
    const gate4Warnings = gate4InternalAsserts(bundle)
      .filter((g) => !g.passed)
      .map((g) => `Πύλη ${g.number} — ${g.name} — ΕΥΡΗΜΑ (finding, run continues):\n${g.message}`);

    const result = runReconciliation(bundle, crosscheck || !bundle.sra);
    const { wb, zeroChecks } = buildWorkbook(result);
    // gate 5: a documented parsing residual is tolerated, never hidden
    const failures = verifyWorkbook(wb, zeroChecks, result.sraResidual || 0);
    if (failures.length) {
      throw new ExtractionError('Πύλη 5 — Zero-checks: κάποια κελιά ελέγχου δεν είναι 0:\n• '
        + failures.map((f) => `${f.sheet}!${f.addr} = ${formatEur(f.value)}`).join('\n• '));
    }
    const buffer = await wb.xlsx.writeBuffer();
    let banner = '';
    if (bundle.sra && bundle.sra.parts && bundle.sra.parts.length > 1) {
      banner += `<div class="note">ℹ️ Συγχωνεύθηκαν ${bundle.sra.parts.length} SRA (επιταγές: `
        + bundle.sra.parts.map(([c]) => `#${esc(c)}`).join(', ')
        + `) — συνολικό ποσό ${formatEur(bundle.sra.statedTotal)}.</div>`;
    }
    if (condWarning) banner += `<div class="warn">⚠️ ${esc(condWarning)}</div>`;
    for (const w of gate4Warnings) {
      banner += `<div class="warn">⚠️ ${esc(w).replace(/\n/g, '<br>')}</div>`;
    }
    if (Math.abs(result.sraResidual || 0) > 0.011) {
      banner += `<div class="warn">⚠️ Τα zero-checks διαβάζουν την τεκμηριωμένη διαφορά `
        + `${formatEur(result.sraResidual)} (SRA γραμμές − δηλωμένο σύνολο) — `
        + 'βλ. κόκκινη γραμμή στο Source_crosscheck.</div>';
    }
    // the SAP journal as its own file, ready to upload — every revenue
    // stream of the month in one document
    let sapBuffer = null;
    if (bundle.sra && !result.crosscheckMode) {
      const sap = buildSapWorkbook([{ code: hospital,
        label: (HOSPITALS[hospital] || [hospital])[0], result }]);
      sapBuffer = await sap.wb.xlsx.writeBuffer();
    }
    renderResults(result, buffer, hospital, year, month, sapBuffer);
    if (banner) $('results').insertAdjacentHTML('afterbegin', banner);
  } catch (e) {
    $('results').innerHTML = `<div class="error">${esc(e.message).replace(/\n/g, '<br>')}</div>`;
  } finally {
    state.running = false;
    $('run-btn').disabled = false;
  }
}

async function runProviders(files) {
  /* A NON-hospital month (the mental-health units): several providers in one
   * upload, each on its own cheque — reconciled per provider, delivered as
   * one workbook with a consolidated summary. */
  const { batches, leftovers } = groupByProvider(files);
  const { gates, period } = validateProviderBatches(batches, leftovers);
  if (!gates.every((g) => g.passed)) return;
  state.running = true;
  $('run-btn').disabled = true;
  $('results').innerHTML = '<p>Εκτέλεση… (running)</p>';
  try {
    const entries = await runProviderBatches(batches, period, files);
    const { wb, zeroChecks } = buildProviderWorkbook(entries);
    const failures = verifyWorkbook(wb, zeroChecks, 0);
    if (failures.length) {
      throw new ExtractionError('Πύλη 5 — Zero-checks: κάποια κελιά ελέγχου δεν είναι 0:\n• '
        + failures.map((f) => `${f.sheet}!${f.addr} = ${formatEur(f.value)}`).join('\n• '));
    }
    const buffer = await wb.xlsx.writeBuffer();
    // the SAP journal as its own file, ready to upload
    const sap = buildSapWorkbook(entries);
    const sapBuffer = await sap.wb.xlsx.writeBuffer();
    const [year, month] = period || [null, null];
    renderProviderResults(entries, buffer, year, month, sapBuffer);
  } catch (e) {
    $('results').innerHTML = `<div class="error">${esc(e.message).replace(/\n/g, '<br>')}</div>`;
  } finally {
    state.running = false;
    $('run-btn').disabled = false;
  }
}

function renderProviderResults(entries, buffer, year, month, sapBuffer) {
  const total = round2(entries.reduce((a, e) => a + (e.result.bundle.sra
    ? e.result.bundle.sra.statedTotal : 0), 0));
  let html = '<h2>Αποτέλεσμα (Result)</h2><div class="metrics">'
    + metric('Σύνολο επιταγών (all cheques)', total)
    + '<div class="metric"><div class="metric-label">Πάροχοι (providers)</div>'
    + `<div class="metric-value">${entries.length}</div></div></div>`;
  html += '<h3>Σύνοψη παρόχων (provider summary)</h3><table><thead><tr>'
    + '<th>Πάροχος</th><th>Κωδικός</th><th>Επιταγή</th><th>Ποσό</th>'
    + '<th>Claims «all»</th><th>Ανοιχτές αποκλίσεις</th></tr></thead><tbody>';
  for (const { code, label, result } of entries) {
    const b = result.bundle;
    html += `<tr><td>${esc(label)}</td><td>${esc(code)}</td>`
      + `<td>${esc(b.sra ? b.sra.chequeNo : '—')}</td>`
      + `<td class="num">${formatEur(b.sra ? b.sra.statedTotal : 0)}</td>`
      + `<td class="num">${b.claims ? formatEur(claimsTotal(b.claims)) : '—'}</td>`
      + `<td class="num">${result.crosschecks.filter((c) => c.flag !== 'ok'
        && c.diff != null && Math.abs(c.diff) > CENT).length}</td></tr>`;
  }
  html += '</tbody></table>';
  const openRows = entries.flatMap(({ label, result }) => result.crosschecks
    .filter((c) => c.flag !== 'ok' && c.diff != null && Math.abs(c.diff) > CENT)
    .map((c) => ({ label, c })));
  if (openRows.length) {
    html += '<h3>Ανοιχτές αποκλίσεις (open variances)</h3><table><thead><tr>'
      + '<th>Πάροχος</th><th>Έλεγχος</th><th>Α</th><th>Β</th><th>Διαφορά</th>'
      + '<th>Σημείωση</th></tr></thead><tbody>';
    for (const { label, c } of openRows) {
      html += `<tr class="${c.flag}"><td>${esc(label)}</td><td>${esc(c.name)}</td>`
        + `<td class="num">${formatEur(c.sourceTotal)}</td>`
        + `<td class="num">${formatEur(c.sraSide)}</td>`
        + `<td class="num">${formatEur(c.diff)}</td><td>${esc(c.note)}</td></tr>`;
    }
    html += '</tbody></table>';
  }
  html += '<p><button id="download-btn" class="primary">⬇ Λήψη Excel '
    + '(Download Excel workbook)</button> '
    + '<button id="download-sap" class="primary">⬇ Λήψη ημερολογίου SAP '
    + '(Download SAP JOURNAL ENTRIES)</button></p>';
  $('results').innerHTML = html;
  const stamp = `${month ? MONTH_ABBR[month] : 'XX'}${year || ''}`;
  const save = (buf, name) => {
    const blob = new Blob([buf],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('download-btn').addEventListener('click', () =>
    save(buffer, `OKYPY_HIO_MENTAL_HEALTH_${stamp}_Reconciliation.xlsx`));
  $('download-sap').addEventListener('click', () =>
    save(sapBuffer, `OKYPY_HIO_MENTAL_HEALTH_${stamp}_SAP_JOURNAL_ENTRIES.xlsx`));
}

function renderResults(result, buffer, hospital, year, month, sapBuffer) {
  let html = '<h2>Αποτέλεσμα (Result)</h2>';
  if (result.chequeTotal != null) {
    html += '<div class="metrics">';
    html += metric('Επιταγή (Cheque)', result.chequeTotal);
    for (const b of BUCKETS) html += metric(b, result.buckets[b]);
    html += '</div><div class="success">Zero-checks: όλα 0 ✔ (all zero-checks pass)</div>';
  } else {
    html += '<p class="hint">Cross-check mode: χωρίς έλεγχο επιταγής (no cheque tie-out).</p>';
    html += matrixTable(result);
  }

  if (result.openVariances.length) {
    html += '<h3>Ανοιχτές αποκλίσεις (Open variances)</h3><table><thead><tr>'
      + '<th>Έλεγχος (Check)</th><th>Πηγή (Source)</th><th>SRA</th><th>Διαφορά (Diff)</th>'
      + '<th>Σημείωση (Note)</th></tr></thead><tbody>';
    for (const c of result.openVariances) {
      html += `<tr class="${c.flag}"><td>${esc(c.name)}</td><td class="num">${formatEur(c.sourceTotal)}</td>`
        + `<td class="num">${c.sraSide != null ? formatEur(c.sraSide) : '—'}</td>`
        + `<td class="num">${c.diff != null ? formatEur(c.diff) : '—'}</td><td>${esc(c.note)}</td></tr>`;
    }
    html += '</tbody></table>';
  } else {
    html += '<p>Καμία ανοιχτή απόκλιση (no open variances).</p>';
  }
  html += '<p><button id="download-btn" class="primary">⬇ Λήψη Excel '
    + '(Download Excel workbook)</button>'
    + (sapBuffer ? ' <button id="download-sap" class="primary">⬇ Λήψη ημερολογίου SAP '
      + '(Download SAP JOURNAL ENTRIES)</button>' : '') + '</p>';
  $('results').innerHTML = html;

  const abbr = month ? MONTH_ABBR[month] : 'XX';
  const stamp = `${hospital}_${abbr}${year || ''}`;
  const save = (buf, name) => {
    const blob = new Blob([buf],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('download-btn').addEventListener('click', () =>
    save(buffer, `OKYPY_HIO_${stamp}_Reconciliation.xlsx`));
  if (sapBuffer) {
    $('download-sap').addEventListener('click', () =>
      save(sapBuffer, `OKYPY_HIO_${stamp}_SAP_JOURNAL_ENTRIES.xlsx`));
  }
}

function metric(label, value) {
  return `<div class="metric"><div class="metric-label">${esc(label)}</div>`
    + `<div class="metric-value">${formatEur(value)}</div></div>`;
}

function matrixTable(result) {
  let html = '<table><thead><tr><th>Ροή (Stream)</th>'
    + result.matrixColumns.map((c) => `<th>${esc(c)}</th>`).join('')
    + '<th>Range</th></tr></thead><tbody>';
  for (const r of result.matrix) {
    html += `<tr><td>${esc(r.stream)}</td>`
      + result.matrixColumns.map((c) => `<td class="num">${r.values[c] != null ? formatEur(r.values[c]) : '—'}</td>`).join('')
      + `<td class="num ${r.range != null && Math.abs(r.range) > 0.5 ? 'amber' : ''}">`
      + `${r.range != null ? formatEur(r.range) : '—'}</td></tr>`;
  }
  return html + '</tbody></table>';
}

/* ------------------------------------------------------------- bootstrap */

window.__okypyReady = true;  // index.html shows a banner if scripts failed to load

window.addEventListener('DOMContentLoaded', () => {
  const missing = [];
  if (typeof XLSX === 'undefined') missing.push('SheetJS (vendor/xlsx.full.min.js)');
  if (typeof pdfjsLib === 'undefined') missing.push('pdf.js (vendor/pdf.min.js)');
  if (typeof ExcelJS === 'undefined') missing.push('ExcelJS (vendor/exceljs.min.js)');
  if (missing.length) {
    $('gates').innerHTML = '<div class="error"><strong>Λείπουν βιβλιοθήκες (missing libraries):</strong> '
      + missing.map(esc).join(', ')
      + '<br>Χρησιμοποιήστε το αυτόνομο αρχείο <strong>okypy-recon.html</strong> (single-file build), '
      + 'ή κρατήστε τους φακέλους js/ και vendor/ δίπλα στο index.html.</div>';
    return;
  }
  const drop = $('drop-zone');
  const input = $('file-input');
  // the input lives inside the drop zone: stop its synthetic click from
  // bubbling back into this handler (browsers block the recursive picker)
  input.addEventListener('click', (e) => e.stopPropagation());
  drop.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles([...e.dataTransfer.files]);
  });
  input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
  $('crosscheck-mode').addEventListener('change', render);
  $('run-btn').addEventListener('click', run);

  // manual fallback controls
  const hosSel = $('ov-hospital');
  for (const [code, [gr, en]] of Object.entries(HOSPITALS)) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${code} — ${gr} (${en})`;
    hosSel.appendChild(opt);
  }
  const monSel = $('ov-month');
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value = String(m);
    opt.textContent = `${String(m).padStart(2, '0')} — ${MONTH_NAMES_EL[m]}`;
    monSel.appendChild(opt);
  }
  const sync = () => {
    state.ov.hospital = hosSel.value;
    state.ov.month = monSel.value;
    state.ov.year = $('ov-year').value;
    state.ov.sraText = $('ov-sra').value;
    render();
  };
  for (const id of ['ov-hospital', 'ov-month', 'ov-year']) $(id).addEventListener('change', sync);
  $('ov-sra').addEventListener('input', sync);
  $('diag-download').addEventListener('click', () => {
    const blob = new Blob([diagnosticsText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'okypy-diagnostics.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
});
