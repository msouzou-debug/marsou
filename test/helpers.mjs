/* Shared test helpers. Not a test file — it is never passed to `node --test`. */
import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_DIR = join(ROOT, 'test/fixtures/generated');
export const DIST_FILE = join(ROOT, 'dist/ΟΚΥπΥ_Πίνακας_Δεικτών_Νοσοκομείου.html');
export const REFERENCE_FILE = join(ROOT, 'reference/okypy-kpi-v1.4.html');

/* The parsers use XLSX as a global, exactly as they do in the browser where the
   library is a separate inlined <script>. */
export const XLSX = require(join(ROOT, 'src/vendor/xlsx.full.min.cjs'));
globalThis.XLSX = XLSX;

export function requirePrerequisites() {
  const missing = [];
  if (!existsSync(DIST_FILE)) missing.push('dist/ (npm run build)');
  if (!existsSync(FIXTURE_DIR)) missing.push('test/fixtures/generated/ (npm run fixtures)');
  if (missing.length) throw new Error(`Λείπουν: ${missing.join(', ')} — τρέξτε «npm test».`);
}

export const fixturePath = (name) => join(FIXTURE_DIR, name);
export const readWorkbook = (name) => XLSX.read(readFileSync(fixturePath(name)), { type: 'buffer' });
export const fixtureNames = () => readdirSync(FIXTURE_DIR).sort();

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* setInputFiles is given the bytes rather than a path: handed a path with Greek
   characters in it, Chromium silently attaches nothing and the test hangs on an
   input that never fires. The names still have to be the real Greek ones — the
   OS parser reads the provider code (F1054) out of the filename, and the chips
   show it — so the payload form is the one that exercises the real path. */
export const fixturePayloads = () => fixtureNames().map(name => ({
  name,
  mimeType: XLSX_MIME,
  buffer: readFileSync(fixturePath(name)),
}));

/* Two multi-megabyte strings compared with assert.strictEqual produce an
   unreadable dump. Report the first divergence with a window of context. */
export function firstDifference(a, b, context = 140) {
  if (a === b) return null;
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const from = Math.max(0, i - context);
  return {
    at: i,
    reference: JSON.stringify(a.slice(from, i + context)),
    built: JSON.stringify(b.slice(from, i + context)),
    lengths: [a.length, b.length],
  };
}

export function assertSame(t, label, reference, built) {
  const d = firstDifference(reference, built);
  if (d) {
    t.diagnostic(`${label}: διαφορά στη θέση ${d.at} (μήκη ${d.lengths.join(' vs ')})`);
    t.diagnostic(`  v1.4  … ${d.reference}`);
    t.diagnostic(`  build … ${d.built}`);
    throw new Error(`${label}: το build διαφέρει από το v1.4 στη θέση ${d.at}`);
  }
}
