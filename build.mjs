#!/usr/bin/env node
/* Build the single self-contained HTML file.
   Everything (SheetJS, CSS, logos, app bundle) is inlined: the output opens
   from disk on a hospital PC with no server and no network access. */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT_DIR = join(ROOT, 'dist');
export const OUT_FILE = join(OUT_DIR, 'ΟΚΥπΥ_Πίνακας_Δεικτών_Νοσοκομείου.html');

/* placeholder → content. Substitution is literal (no regex, no $-expansion),
   because the payloads contain base64 and minified JS. */
async function slots() {
  return {
    '<!--VENDOR_XLSX-->': await readFile(join(SRC, 'vendor/xlsx.full.min.cjs'), 'utf8'),
    '<!--STYLES-->': await readFile(join(SRC, 'styles.css'), 'utf8'),
    '<!--LOGO_HEADER-->': (await readFile(join(SRC, 'assets/logo-header.b64.txt'), 'utf8')).trim(),
    '<!--LOGO_FOOTER-->': (await readFile(join(SRC, 'assets/logo-footer.b64.txt'), 'utf8')).trim(),
  };
}

function inject(html, token, payload) {
  const at = html.indexOf(token);
  if (at < 0) throw new Error(`build: placeholder ${token} missing from src/index.html`);
  if (html.indexOf(token, at + token.length) >= 0) throw new Error(`build: placeholder ${token} appears more than once`);
  return html.slice(0, at) + payload + html.slice(at + token.length);
}

export async function buildSingleFile({ minify = false, quiet = false } = {}) {
  const bundled = await build({
    entryPoints: [join(SRC, 'main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    charset: 'utf8',
    minify,
    legalComments: 'inline',
    write: false,
  });
  const app = bundled.outputFiles[0].text;

  // Nothing may reach the network at runtime, and nothing may be left unbundled.
  if (/<script[^>]+src=/i.test(app)) throw new Error('build: app bundle references an external script');

  let html = await readFile(join(SRC, 'index.html'), 'utf8');
  for (const [token, payload] of Object.entries(await slots())) html = inject(html, token, payload);
  html = inject(html, '<!--APP_BUNDLE-->', app);

  // A stray </script> inside the bundle would close the tag early.
  const appAt = html.indexOf(app);
  if (/<\/script/i.test(app)) throw new Error('build: app bundle contains a literal </script>');
  if (appAt < 0) throw new Error('build: app bundle did not make it into the page');

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, html, 'utf8');
  const { size } = await stat(OUT_FILE);
  if (!quiet) {
    console.log(`✓ ${OUT_FILE}`);
    console.log(`  ${(size / 1048576).toFixed(2)} MB  (όριο: 3 MB)`);
  }
  if (size > 3 * 1024 * 1024) throw new Error(`build: output is ${(size / 1048576).toFixed(2)} MB, over the 3 MB limit`);
  return OUT_FILE;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildSingleFile({ minify: process.argv.includes('--minify') }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
