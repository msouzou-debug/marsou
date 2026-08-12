/* The output has to stay one self-contained file that opens from disk on a
   hospital PC with the network blocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { requirePrerequisites, DIST_FILE, REFERENCE_FILE } from './helpers.mjs';

requirePrerequisites();
const html = readFileSync(DIST_FILE, 'utf8');

/* Carried over verbatim from v1.4: the only remote reference in the page, a
   webfont that degrades to Arial when the network is blocked. Removing it is
   part of the offline pass in milestone 6 — until then it is pinned here so a
   new remote reference cannot slip in unnoticed. */
const KNOWN_REMOTE = ['https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap'];

test('ένα αρχείο, κάτω από 3 MB', () => {
  const mb = statSync(DIST_FILE).size / 1048576;
  assert.ok(mb < 3, `${mb.toFixed(2)} MB`);
  assert.ok(mb > 0.5, 'η SheetJS πρέπει να είναι ενσωματωμένη');
});

/* Only things the browser actually fetches count — the SheetJS source is full
   of OOXML namespace URIs, which are identifiers, not downloads. */
function fetchedResources(page) {
  const out = new Set();
  for (const m of page.matchAll(/<(?:script|link|img|iframe|source|video|audio|embed)\b[^>]*?\s(?:src|href)\s*=\s*"([^"]*)"/gi)) out.add(m[1]);
  for (const m of page.matchAll(/@import\s+url\(\s*['"]?([^'")]+)/gi)) out.add(m[1]);
  for (const m of page.matchAll(/\burl\(\s*['"]?(?!data:)([^'")]+)/gi)) out.add(m[1]);
  return [...out].filter(u => !u.startsWith('data:')).sort();
}

test('τίποτα δεν φορτώνεται από το δίκτυο κατά την εκτέλεση', () => {
  assert.equal(html.match(/<script[^>]+\ssrc=/gi), null, 'κανένα εξωτερικό <script src>');
  assert.equal(html.match(/<link[^>]+href=/gi), null, 'κανένα εξωτερικό stylesheet');
  assert.deepEqual(fetchedResources(html), KNOWN_REMOTE);
});

test('το build δεν πρόσθεσε ούτε αφαίρεσε εξωτερικές αναφορές σε σχέση με το v1.4', () => {
  assert.deepEqual(fetchedResources(html), fetchedResources(readFileSync(REFERENCE_FILE, 'utf8')));
});

test('τα λογότυπα και η SheetJS είναι ενσωματωμένα', () => {
  assert.equal((html.match(/src="data:image\/png;base64,/g) || []).length, 2);
  assert.match(html, /SheetJS 0\.18\.5 \(Apache-2\.0\)/);
  assert.ok(!html.includes('<!--APP_BUNDLE-->'), 'όλα τα placeholders αντικαταστάθηκαν');
  assert.ok(!html.includes('<!--VENDOR_XLSX-->'));
  assert.ok(!html.includes('<!--LOGO_HEADER-->'));
});

test('το δημόσιο API μένει ίδιο με το v1.4', () => {
  const surface = /window\.OKYPY\s*=\s*\{\s*state\s*,\s*handleFiles\s*,\s*parseStats\s*,\s*parseIS\s*,\s*computeHIO\s*,\s*U\s*\}/;
  assert.match(html, surface);
});

test('το σημείο εκκίνησης του v1.4 μένει στο αποθετήριο για σύγκριση', () => {
  const ref = readFileSync(REFERENCE_FILE, 'utf8');
  assert.match(ref, /window\.OKYPY/);
  assert.match(ref, /id="fileInput"/);
});

test('η σήμανση και οι θέσεις του πίνακα δεν άλλαξαν', () => {
  const ref = readFileSync(REFERENCE_FILE, 'utf8');
  const ids = s => [...s.matchAll(/\sid="([\w]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(ids(html), ids(ref), 'ίδια δομή DOM με το v1.4');
});
