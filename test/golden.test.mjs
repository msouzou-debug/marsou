/* Golden regression: everything v1.4 rendered, the current build still renders
   identically.
 *
 * When milestone 1 landed this compared the whole of <main>. The app has grown
 * a section since («Ανά κλινική»), so the comparison is scoped to the regions
 * v1.4 owned — each one still has to match character for character — plus the
 * state fields v1.4 computed. New sections are asserted separately, below.
 *
 * Both pages are driven through the real user path: setInputFiles on the hidden
 * input, then a wait on the rendered result.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { requirePrerequisites, DIST_FILE, REFERENCE_FILE, fixturePayloads, assertSame } from './helpers.mjs';

requirePrerequisites();

const FILES = fixturePayloads();

/* the regions v1.4 rendered — the contract this test defends */
const LEGACY_REGIONS = ['story', 'kpis', 'trends', 'targets', 'flags', 'hio', 'allae', 'os', 'method'];
/* the row fields v1.4's IS parser produced; the parser has since gained
   `spec` and `proc` for the per-clinic view */
const LEGACY_IS_FIELDS = ['prov', 'caseNbr', 'drg', 'pid', 'ht', 'at', 'dt', 'qty', 'acw', 'alos', 'ff', 'dd', 'file'];

let browser;

async function snapshot(file) {
  const page = await browser.newPage();
  const problems = [], failedRequests = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  /* a blocked network request also logs a console error; it is counted once,
     by URL, in failedRequests */
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('requestfailed', r => failedRequests.push(r.url()));

  await page.goto(pathToFileURL(file).href);
  await page.setInputFiles('#fileInput', FILES);
  await page.waitForFunction(
    n => document.querySelectorAll('#chips .chip').length === n && document.getElementById('method').innerHTML.length > 0,
    FILES.length,
    { timeout: 120_000 },
  );

  const snap = await page.evaluate(({ regions, isFields }) => {
    const S = window.OKYPY.state;
    const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) =>
      x instanceof Set ? { set: [...x] } : x instanceof Map ? { map: [...x.entries()] } : x));
    const legacy = {};
    for (const id of regions) legacy[id] = document.getElementById(id)?.innerHTML ?? null;
    return {
      renderError: window.__renderError ?? null,
      stats: JSON.stringify(plain(S.stats)),
      isRows: JSON.stringify(S.isRows.map(r => isFields.map(f => plain(r[f])))),
      allae: JSON.stringify(plain(S.allae)),
      files: JSON.stringify({ is: [...S.isFiles], ae: [...S.aeFiles], os: [...S.osFiles], codes: [...S.osCodes] }),
      osClaims: JSON.stringify(plain(S.osClaims)),
      title: document.getElementById('hTitle').textContent,
      period: document.getElementById('hPeriod').textContent,
      legacy: JSON.stringify(legacy),
      /* v1.4 has no such element at all — absent must not read as «visible» */
      hasClinics: document.getElementById('secClinics')?.classList.contains('hidden') === false,
      clinicOptions: [...document.querySelectorAll('#clinicPick option')].map(o => o.textContent),
      clinicsHTML: document.getElementById('clinics')?.innerHTML ?? '',
      main: document.querySelector('main').innerHTML,
    };
  }, { regions: LEGACY_REGIONS, isFields: LEGACY_IS_FIELDS });
  await page.close();
  return { snap, problems, failedRequests };
}

/* The only request the page may make — and may fail — is the Lato webfont
   inherited from v1.4; offline it falls back to Arial. Removing it belongs to
   the offline pass in milestone 6. */
const ALLOWED_FAILED_REQUEST = /^https:\/\/fonts\.googleapis\.com\//;

let ref, built;
before(async () => {
  browser = await chromium.launch();
  ref = await snapshot(REFERENCE_FILE);
  built = await snapshot(DIST_FILE);
});
after(async () => { await browser?.close(); });

test('ό,τι έδειχνε το v1.4, το δείχνει ακόμη ίδιο', { timeout: 300_000 }, async (t) => {
  assert.deepEqual(ref.problems, [], 'το v1.4 δεν έβγαλε σφάλματα');
  assert.deepEqual(built.problems, [], 'το build δεν έβγαλε σφάλματα');
  assert.equal(built.snap.renderError, null);
  assert.deepEqual(
    built.failedRequests.filter(u => !ALLOWED_FAILED_REQUEST.test(u)), [],
    'η σελίδα δεν ζητά τίποτα άλλο από το δίκτυο',
  );

  for (const key of ['title', 'period', 'stats', 'files', 'isRows', 'allae', 'osClaims', 'legacy']) {
    assertSame(t, key, ref.snap[key], built.snap[key]);
  }
});

test('η ενότητα «Ανά κλινική» υπάρχει μόνο στο νέο build', () => {
  assert.equal(ref.snap.hasClinics, false, 'το v1.4 δεν είχε ανάλυση ανά κλινική');
  assert.equal(built.snap.hasClinics, true);
  assert.deepEqual(built.snap.clinicOptions,
    ['Παθολογική', 'Χειρουργική', 'Καρδιολογική', 'Γυναικολογική', 'Ορθοπεδική', 'Παιδιατρική', 'Ογκολογικό', 'Ρευματολογικό'],
    'όλες οι κλινικές των φύλλων, ταξινομημένες κατά εισαγωγές');
});

test('η καρτέλα κλινικής δείχνει δείκτες, έσοδα ΟΑΥ και διαχρονική πορεία', () => {
  const html = built.snap.clinicsHTML;
  assert.match(html, /Η κλινική έκλεισε την περίοδο με 187 εισαγωγές, \+4,5% σε σχέση με πέρσι/);
  assert.match(html, /Διαχρονικά 2024→2026/);
  assert.match(html, /Τιμολογημένα έσοδα ΟΑΥ/);
  assert.match(html, /221\.309 €/, 'έσοδα ΟΑΥ της Παθολογικής');
  assert.match(html, /1η από 6 σε εισαγωγές/);
  assert.match(html, /31,4% του νοσοκομείου/);
  /* revenue with no matching clinic is shown, not quietly dropped */
  assert.match(html, /NEPHROLOGY \(79\.288 €\)/);
  /* and the caveat about what per-clinic revenue does not include */
  assert.match(html, /δεν περιλαμβάνουν ΤΑΕΠ ή εξωτερικά ιατρεία/);
});

test('το πακέτο διαβάζει και τις τέσσερις οικογένειες αρχείων και απορρίπτει τα άγνωστα', () => {
  const files = JSON.parse(built.snap.files);
  assert.equal(files.is.length, 4);
  assert.equal(files.ae.length, 3);
  assert.equal(files.os.length, 4);
  assert.deepEqual(files.codes, ['F1054']);

  const stats = JSON.parse(built.snap.stats);
  assert.equal(stats.hospital, 'Nicosia General');
  assert.equal(stats.mN, 3);
  assert.equal(built.snap.title, 'Πίνακας Δεικτών — ΓΝ Λευκωσίας');
  assert.match(built.snap.period, /Ιανουάριος – Μάρτιος 2026/);

  /* the unrecognised workbook gets an inline message, it does not break intake */
  assert.match(built.snap.main, /δεν αναγνωρίστηκε ο τύπος αρχείου/);
  /* and the rendered numbers are the Greek-formatted model values */
  assert.match(built.snap.main, /Εισαγωγές ασθενών/);
  assert.match(built.snap.main, /εκκρεμείς πληρωμές/);
  assert.match(built.snap.main, /Πλήρεις μήνες/);
  assert.match(built.snap.main, /ανάγονται σε 3\/12/);
});
