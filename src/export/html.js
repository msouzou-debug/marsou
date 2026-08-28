/* ---------- HTML export ----------
   A snapshot of the dashboard as one self-contained file: the rendered
   sections, the brand stylesheet and the logos, with the upload panel and every
   script removed. It opens from an email attachment, from a shared folder, or
   on a phone, with no network and nothing to install.

   The clinic picker survives without JavaScript: the export writes one hidden
   radio per clinic and a sibling rule that reveals its panel. */
import { U } from '../util.js';
import { state } from '../state.js';
import { buildClinics } from '../model/clinic.js';
import { clinicTabsHTML } from '../render/clinics.js';
import { el, wrapWideTables } from '../render/dom.js';

const stamp = (d = new Date()) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

export function exportFileName(S, ext) {
  const city = (S.title.match(/ΓΕΝΙΚΟΥ ΝΟΣΟΚΟΜΕΙΟΥ\s+([Α-ΩΪΫ]+)/) || [null, ''])[1];
  const period = `${S.year}-${String(S.mN).padStart(2, '0')}`;
  return `Πίνακας Δεικτών${city ? ' ΓΝ ' + city : ''} ${period}.${ext}`;
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* the browser needs the URL alive until the download has actually started */
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* the sources a reader of the file needs in order to trust it */
function provenance(S) {
  const rows = [
    ['Στατιστικά νοσοκομείου', S.title || '—'],
    ['IS Auditor (ΟΑΥ)', state.isFiles.size ? [...state.isFiles].join(' · ') : 'δεν φορτώθηκαν'],
    ['ALL and AE (ΟΑΥ)', state.aeFiles.size ? [...state.aeFiles].join(' · ') : 'δεν φορτώθηκαν'],
    ['Πληρωμένες Απαιτήσεις OS', state.osFiles.size ? [...state.osFiles].join(' · ') : 'δεν φορτώθηκαν'],
    ['Έκθεση Στατιστικών', state.report ? state.report.file : 'δεν φορτώθηκε'],
  ];
  return `<section><h2>Προέλευση δεδομένων</h2>
    <div class="scrollx"><table class="ok"><tbody>${rows.map(([k, v]) =>
      `<tr><td style="white-space:nowrap"><b>${U.esc(k)}</b></td><td>${U.esc(v)}</td></tr>`).join('')}
      <tr><td style="white-space:nowrap"><b>Ημερομηνία εξαγωγής</b></td><td>${stamp()}</td></tr>
    </tbody></table></div>
    <div class="note">Στιγμιότυπο του πίνακα δεικτών. Τα δεδομένα δεν ενημερώνονται· για νεότερη εικόνα ξαναφορτώστε τα αρχεία στην εφαρμογή.</div></section>`;
}

export function buildExportHTML() {
  const S = state.stats;
  if (!S) throw new Error('Δεν έχει φορτωθεί αρχείο στατιστικών.');

  const dash = el('dash').cloneNode(true);
  dash.classList.remove('hidden');
  /* the toolbar belongs to the app, not to the snapshot */
  dash.querySelector('#exportbar')?.remove();
  /* the live picker only shows the selected clinic; the file shows them all */
  const clinics = dash.querySelector('#clinics');
  if (clinics) clinics.innerHTML = clinicTabsHTML(buildClinics(), S);
  /* nothing in a snapshot should be able to run. The ids stay: the clinic tabs
     are radio inputs addressed by id, which is what makes them work with no
     JavaScript at all. */
  dash.querySelectorAll('script').forEach(n => n.remove());
  /* the clinic tabs were just built as a string; their tables need the same
     scroll boxes the live page gets */
  wrapWideTables(dash);

  const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
  const header = document.querySelector('header').outerHTML;
  const footer = document.querySelector('footer').outerHTML;
  const title = `${el('hTitle').textContent} — ${el('hPeriod').textContent}`;

  return `<!DOCTYPE html>
<html lang="el">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${U.esc(title)}</title>
<style>
${css}
</style>
</head>
<body>
${header}
<main>
${dash.innerHTML}
${provenance(S)}
</main>
${footer}
</body>
</html>`;
}

export function exportHTML() {
  const html = buildExportHTML();
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), exportFileName(state.stats, 'html'));
  return html;
}
