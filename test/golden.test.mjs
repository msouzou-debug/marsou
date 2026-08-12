/* Golden equivalence: v1.4 and the rebuilt bundle must produce the same
   dashboard from the same files.
 *
 * Milestone 1 is a pure repo split — no behaviour change — so this is the test
 * that proves it. Both pages are driven through the real user path
 * (setInputFiles on the hidden input) and then compared on the computed state
 * and on the rendered DOM, character for character.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { requirePrerequisites, DIST_FILE, REFERENCE_FILE, fixturePayloads, assertSame } from './helpers.mjs';

requirePrerequisites();

const FILES = fixturePayloads();
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

/* Everything that differs between two runs of the *same* page — the footer date
   — lives outside <main>, so <main> is safe to compare verbatim. */
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

  const snap = await page.evaluate(() => {
    const S = window.OKYPY.state;
    const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) =>
      x instanceof Set ? { set: [...x] } : x instanceof Map ? { map: [...x.entries()] } : x));
    return {
      renderError: window.__renderError ?? null,
      stats: JSON.stringify(plain(S.stats)),
      isRows: JSON.stringify(plain(S.isRows)),
      allae: JSON.stringify(plain(S.allae)),
      files: JSON.stringify({ is: [...S.isFiles], ae: [...S.aeFiles], os: [...S.osFiles], codes: [...S.osCodes] }),
      osClaims: JSON.stringify(plain(S.osClaims)),
      title: document.getElementById('hTitle').textContent,
      period: document.getElementById('hPeriod').textContent,
      main: document.querySelector('main').innerHTML,
    };
  });
  await page.close();
  return { snap, problems, failedRequests };
}

/* The only request the page may make — and may fail — is the Lato webfont
   inherited from v1.4; offline it falls back to Arial. Removing it belongs to
   the offline pass in milestone 6. */
const ALLOWED_FAILED_REQUEST = /^https:\/\/fonts\.googleapis\.com\//;

test('το ξαναχτισμένο πακέτο συμπεριφέρεται όπως το v1.4', { timeout: 300_000 }, async (t) => {
  const ref = await snapshot(REFERENCE_FILE);
  const built = await snapshot(DIST_FILE);

  assert.deepEqual(ref.problems, [], 'το v1.4 δεν έβγαλε σφάλματα');
  assert.deepEqual(built.problems, [], 'το build δεν έβγαλε σφάλματα');
  assert.equal(built.snap.renderError, null);
  assert.deepEqual(
    built.failedRequests.filter(u => !ALLOWED_FAILED_REQUEST.test(u)), [],
    'η σελίδα δεν ζητά τίποτα άλλο από το δίκτυο',
  );

  for (const key of ['title', 'period', 'stats', 'files', 'isRows', 'allae', 'osClaims', 'main']) {
    assertSame(t, key, ref.snap[key], built.snap[key]);
  }
});

test('το πακέτο διαβάζει και τα τέσσερα οικογένειες αρχείων και απορρίπτει τα άγνωστα', { timeout: 300_000 }, async () => {
  const { snap } = await snapshot(DIST_FILE);
  const files = JSON.parse(snap.files);
  assert.equal(files.is.length, 4);
  assert.equal(files.ae.length, 3);
  assert.equal(files.os.length, 4);
  assert.deepEqual(files.codes, ['F1054']);

  const stats = JSON.parse(snap.stats);
  assert.equal(stats.hospital, 'Nicosia General');
  assert.equal(stats.mN, 3);
  assert.equal(snap.title, 'Πίνακας Δεικτών — ΓΝ Λευκωσίας');
  assert.match(snap.period, /Ιανουάριος – Μάρτιος 2026/);

  /* the unrecognised workbook gets an inline message, it does not break intake */
  assert.match(snap.main, /δεν αναγνωρίστηκε ο τύπος αρχείου/);
  /* and the rendered numbers are the Greek-formatted model values */
  assert.match(snap.main, /Εισαγωγές ασθενών/);
  assert.match(snap.main, /εκκρεμείς πληρωμές/);
  assert.match(snap.main, /Πλήρεις μήνες/);
  assert.match(snap.main, /ανάγονται σε 3\/12/);
});
