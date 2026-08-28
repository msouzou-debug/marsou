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

test('το δημόσιο API του v1.4 μένει διαθέσιμο', () => {
  /* the surface may grow — the exports are part of it now — but nothing the
     v1.4 harness relied on may disappear */
  const assigned = html.match(/window\.OKYPY\s*=\s*\{([^}]*)\}/);
  assert.ok(assigned, 'το window.OKYPY δεν ανατίθεται');
  const names = assigned[1].split(',').map(s => s.trim());
  for (const n of ['state', 'handleFiles', 'parseStats', 'parseIS', 'computeHIO', 'U']) {
    assert.ok(names.includes(n), `λείπει το ${n} από το window.OKYPY`);
  }
  for (const n of ['exportHTML', 'exportPPTX', 'exportDOCX']) assert.ok(names.includes(n), `λείπει το ${n}`);
});

test('το σημείο εκκίνησης του v1.4 μένει στο αποθετήριο για σύγκριση', () => {
  const ref = readFileSync(REFERENCE_FILE, 'utf8');
  assert.match(ref, /window\.OKYPY/);
  assert.match(ref, /id="fileInput"/);
});

/* Positions added to the page after v1.4. Listing them here means a section or
   a control can only appear deliberately, and that nothing v1.4 rendered can
   quietly disappear. */
const ADDED_IDS = ['secFinance', 'finance', 'secClinics', 'clinics',
  'scopebar', 'scopeswitch', 'clinicPick', 'btnScopeHosp', 'btnScopeClinic',
  'clinicSelect', 'secMethod',
  'exportbar', 'btnHtml', 'btnPptx', 'btnDocx'];

test('η σήμανση του v1.4 διατηρείται· οι νέες ενότητες δηλώνονται ρητά', () => {
  const ref = readFileSync(REFERENCE_FILE, 'utf8');
  /* only the page's own markup — the bundle carries OOXML template strings with
     their own id attributes, which are not positions on the page */
  const markup = s => s.replace(/<script[\s\S]*?<\/script>/gi, '');
  const ids = s => [...markup(s).matchAll(/\sid="([\w]+)"/g)].map(m => m[1]).sort();
  const before = ids(ref), now = ids(html);
  assert.deepEqual(before.filter(id => !now.includes(id)), [], 'δεν χάθηκε καμία θέση του v1.4');
  assert.deepEqual(now.filter(id => !before.includes(id)).sort(), [...ADDED_IDS].sort());
});
