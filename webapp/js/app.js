/* UI wiring — browser equivalent of app.py.  All logic lives in the other
 * js/ modules; files never leave the machine, the workbook is built in
 * memory and offered as a download. */
'use strict';

const state = { files: [], running: false };

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
  const files = state.files;
  const crosscheck = $('crosscheck-mode').checked;
  $('results').innerHTML = '';
  if (!files.length) {
    $('checklist-wrap').innerHTML = '';
    $('gates').innerHTML = '';
    $('sra-review').innerHTML = '';
    $('run-btn').disabled = true;
    return;
  }

  const { gates } = validateBatch(files, crosscheck);
  renderChecklist(files, crosscheck);
  renderGates(gates.filter((g) => !g.passed));
  renderSraReview(files);

  const warnings = files.flatMap((f) => f.warnings.map((w) => `${f.filename}: ${w}`));
  $('warnings').innerHTML = warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('');

  $('run-btn').disabled = !gates.every((g) => g.passed) || state.running;
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
    html += `<tr><td>Άγνωστο (unrecognised)</td><td>${esc(f.filename)}</td><td>—</td><td>—</td>`
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
  ).join('');
}

function renderSraReview(files) {
  const sra = files.find((f) => f.reportType === RT.SRA && f.rawText != null);
  if (!sra) { $('sra-review').innerHTML = ''; return; }
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
  const { gates, hospital, period } = validateBatch(state.files, crosscheck);
  if (!gates.every((g) => g.passed)) return;
  state.running = true;
  $('run-btn').disabled = true;
  $('results').innerHTML = '<p>Εκτέλεση… (running)</p>';
  try {
    const [year, month] = period;
    const bundle = { hospitalCode: hospital, year, month };
    const sraOverride = $('sra-text') ? $('sra-text').value : null;
    for (const f of state.files) {
      const override = f.reportType === RT.SRA ? sraOverride : null;
      bundle[SLOT[f.reportType]] = await extractReport(f.reportType, f, hospital, override);
    }

    if (bundle.sra) {
      const have = new Set(state.files.map((f) => f.reportType));
      const missing = conditionalRequirements(bundle.sra).filter((t) => !have.has(t));
      if (missing.length) {
        throw new ExtractionError('Το SRA περιέχει γραμμές που απαιτούν επιπλέον αναφορές '
          + '(SRA lines require conditional reports):\n• '
          + missing.map((t) => REPORT_LABELS[t]).join('\n• '));
      }
    }
    for (const g of gate4InternalAsserts(bundle)) {
      if (!g.passed) throw new ExtractionError(`Πύλη ${g.number} — ${g.name}\n${g.message}`);
    }

    const result = runReconciliation(bundle, crosscheck || !bundle.sra);
    const { wb, zeroChecks } = buildWorkbook(result);
    const failures = verifyWorkbook(wb, zeroChecks);  // gate 5
    if (failures.length) {
      throw new ExtractionError('Πύλη 5 — Zero-checks: κάποια κελιά ελέγχου δεν είναι 0:\n• '
        + failures.map((f) => `${f.sheet}!${f.addr} = ${formatEur(f.value)}`).join('\n• '));
    }
    const buffer = await wb.xlsx.writeBuffer();
    renderResults(result, buffer, hospital, year, month);
  } catch (e) {
    $('results').innerHTML = `<div class="error">${esc(e.message).replace(/\n/g, '<br>')}</div>`;
  } finally {
    state.running = false;
    $('run-btn').disabled = false;
  }
}

function renderResults(result, buffer, hospital, year, month) {
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
  html += '<p><button id="download-btn" class="primary">⬇ Λήψη Excel (Download Excel workbook)</button></p>';
  $('results').innerHTML = html;

  const abbr = month ? MONTH_ABBR[month] : 'XX';
  const fname = `OKYPY_HIO_${hospital}_${abbr}${year || ''}_Reconciliation.xlsx`;
  $('download-btn').addEventListener('click', () => {
    const blob = new Blob([buffer],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
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
});
