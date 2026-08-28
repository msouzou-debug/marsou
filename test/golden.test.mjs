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
/* v1.4 only ever read spreadsheets; handing it the Word report would make it
   log a parse error that has nothing to do with a regression */
const SPREADSHEETS = FILES.filter(f => !/\.docx$/i.test(f.name));

/* The regions v1.4 rendered that are still meant to be identical.
   `hio` is deliberately absent: the ΟΑΥ cross-check was rebuilt around
   submission maturity, because on the real files v1.4's single coverage figure
   silently mixed a complete January with a March that was 3% submitted. That
   section is asserted on its own content below. */
const LEGACY_REGIONS = ['story', 'kpis', 'trends', 'targets', 'flags', 'allae', 'os', 'method'];
/* the row fields v1.4's IS parser produced; the parser has since gained
   `spec` and `proc` for the per-clinic view */
const LEGACY_IS_FIELDS = ['prov', 'caseNbr', 'drg', 'pid', 'ht', 'at', 'dt', 'qty', 'acw', 'alos', 'ff', 'dd', 'file'];
/* likewise the stats model, which has since gained `beds`, `fin` and the
   «Μικρά Χειρουργεία» table */
const LEGACY_STATS_FIELDS = ['kpi', 'dq', 'title', 'hospital', 'hospitalGr', 'year', 'mN', 'blocks'];
const LEGACY_ANNUAL = ['adm', 'out', 'surg'];

let browser;

async function snapshot(file, files = FILES) {
  const page = await browser.newPage();
  const problems = [], failedRequests = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  /* a blocked network request also logs a console error; it is counted once,
     by URL, in failedRequests */
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('requestfailed', r => failedRequests.push(r.url()));

  await page.goto(pathToFileURL(file).href);
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(
    n => document.querySelectorAll('#chips .chip').length === n && document.getElementById('method').innerHTML.length > 0,
    files.length,
    { timeout: 120_000 },
  );

  const snap = await page.evaluate(({ regions, isFields, statsFields, annualKeys }) => {
    const S = window.OKYPY.state;
    const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) =>
      x instanceof Set ? { set: [...x] } : x instanceof Map ? { map: [...x.entries()] } : x));
    /* Wide tables are now wrapped in a scroll box so a phone does not have to
       scroll the whole page sideways. That wrapper is layout, not content, so
       it is unwrapped before comparing with v1.4. */
    const unwrapScrollx = (node) => {
      const copy = node.cloneNode(true);
      for (const box of [...copy.querySelectorAll('div.scrollx')]) {
        if (box.className !== 'scrollx') continue;
        box.replaceWith(...box.childNodes);
      }
      return copy.innerHTML;
    };
    const legacy = {};
    for (const id of regions) {
      const node = document.getElementById(id);
      legacy[id] = node ? unwrapScrollx(node) : null;
    }
    return {
      renderError: window.__renderError ?? null,
      stats: JSON.stringify(plain(Object.fromEntries([
        ...statsFields.map(f => [f, S.stats?.[f] ?? null]),
        ['annual', Object.fromEntries(annualKeys.map(k => [k, S.stats?.annual?.[k] ?? null]))],
      ]))),
      isRows: JSON.stringify(S.isRows.map(r => isFields.map(f => plain(r[f])))),
      allae: JSON.stringify(plain(S.allae)),
      files: JSON.stringify({ is: [...S.isFiles], ae: [...S.aeFiles], os: [...S.osFiles], codes: [...S.osCodes] }),
      osClaims: JSON.stringify(plain(S.osClaims)),
      title: document.getElementById('hTitle').textContent,
      period: document.getElementById('hPeriod').textContent,
      legacy: JSON.stringify(legacy),
      /* v1.4 has no such element at all — absent must not read as «visible» */
      hasClinics: document.getElementById('secClinics')?.classList.contains('hidden') === false,
      hasFinance: document.getElementById('secFinance')?.classList.contains('hidden') === false,
      clinicOptions: [...document.querySelectorAll('#clinicSelect option')].map(o => o.textContent),
      scope: document.getElementById('dash')?.classList.contains('scope-clinic') ? 'scope-clinic' : 'scope-hosp',
      selected: document.querySelector('#clinicDetail .clinic-head h3')?.textContent ?? null,
      clinicsHTML: document.getElementById('clinics')?.innerHTML ?? '',
      hioHTML: document.getElementById('hio')?.innerHTML ?? '',
      financeHTML: document.getElementById('finance')?.innerHTML ?? '',
      reportParas: window.OKYPY.state.report?.paraCount ?? null,
      main: document.querySelector('main').innerHTML,
    };
  }, { regions: LEGACY_REGIONS, isFields: LEGACY_IS_FIELDS, statsFields: LEGACY_STATS_FIELDS, annualKeys: LEGACY_ANNUAL });
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
  ref = await snapshot(REFERENCE_FILE, SPREADSHEETS);
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

test('οι νέες ενότητες υπάρχουν μόνο στο νέο build', () => {
  assert.equal(ref.snap.hasClinics, false, 'το v1.4 δεν είχε ανάλυση ανά κλινική');
  assert.equal(ref.snap.hasFinance, false);
  assert.equal(built.snap.hasClinics, true);
  assert.equal(built.snap.hasFinance, true);
});

test('μία επιλογή ανά κλινική στη λίστα, ταξινομημένες κατά έσοδα ΟΑΥ', () => {
  assert.deepEqual(built.snap.clinicOptions,
    ['Παθολογία', 'Γενική Χειρουργική', 'Καρδιολογία', 'Ορθοπαιδική', 'Παιδιατρική',
     'Νεφρολογία', 'Γυναικολογία', 'Ογκολογία', 'Ρευματολογικό'],
    'κάθε κλινική των φύλλων και του οικονομικού πίνακα, μία φορά');
  assert.equal(built.snap.selected, 'Παθολογία', 'η πρώτη είναι επιλεγμένη εξ αρχής');
  assert.equal(built.snap.scope, 'scope-hosp', 'η σελίδα ανοίγει στο σύνολο του νοσοκομείου');
});

test('η καρτέλα κλινικής δείχνει έσοδα, δραστηριότητα και διαχρονική πορεία', () => {
  const html = built.snap.clinicsHTML;
  assert.match(html, /Η κλινική τιμολόγησε στον ΟΑΥ 242\.200 € την περίοδο Ιανουαρίου–Μαρτίου 2026/);
  assert.match(html, /Έσοδα ΟΑΥ — Ιανουάριος–Μάρτιος 2026/);
  assert.match(html, /Ενδονοσοκομειακή φροντίδα/);
  assert.match(html, /Έγιναν 187 εισαγωγές/);
  assert.match(html, /Διαχρονικά 2024→2026/);
  assert.match(html, /Έσοδο ανά κλίνη/);
  assert.match(html, /52 κλίνες/);
  /* a specialty with no clinic stays visible instead of being folded in */
  assert.match(html, /PALLIATIVE CARE/);
});

test('η καρτέλα δείχνει τα σχόλια της έκθεσης για τη συγκεκριμένη κλινική', () => {
  assert.equal(built.snap.reportParas, 12, 'το .docx διαβάστηκε στον browser');
  const html = built.snap.clinicsHTML;
  assert.match(html, /Από την έκθεση/);
  assert.match(html, /Επισκέψεις Εξωτερικών Ιατρείων \(Διαφάνεια 6\)/);
  assert.match(html, /2026 → 1\.715/);
});

test('η διασταύρωση ΟΑΥ ξεχωρίζει τους πλήρεις από τους ελλιπείς μήνες', () => {
  const html = built.snap.hioHTML;
  assert.match(html, /εκκρεμείς υποβολές/);
  assert.match(html, /Η περίοδος δεν έχει υποβληθεί ολόκληρη/);
  assert.match(html, /Χρειάζονται τα IS Auditor Μάι 2026/);
  assert.match(html, /Κάλυψη στους πλήρεις μήνες \(Ιαν, Φεβ\)/);
  /* the headline is the mature months, not the whole period */
  assert.match(html, /Πλήρεις μήνες/);
  assert.doesNotMatch(built.snap.legacy, /εκκρεμείς υποβολές/, 'το v1.4 δεν είχε αυτή τη διάκριση');
});

test('τα οικονομικά αποτελέσματα βγαίνουν από το ίδιο αρχείο', () => {
  const html = built.snap.financeHTML;
  assert.match(html, /Σύνολο εσόδων ΟΑΥ ανά κλινική/);
  assert.match(html, /957\.700 €/);
  assert.match(html, /Λογαριασμός αποτελεσμάτων/);
  assert.match(html, /ΣΥΝΟΛΟ ΕΣΟΔΩΝ/);
  /* a percentage against a negative base would be nonsense; the move is in € */
  assert.match(html, /\+151\.900 €/);
  assert.match(html, /Υπηρεσίες Γενικού Οικονομικού Συμφέροντος/);
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
