# OKYπY / SHSO Reconciliation Tool

Single-file, offline, bilingual (EL/EN) browser app for account reconciliation,
used by hospital staff across the State Health Services Organisation (ΟΚΥπΥ / SHSO),
Cyprus. Users double-click the built HTML file — no install, no server, no
internet. All data stays on the local machine. Current version: **v2.4**.

## Architecture

- `src/app_template.html` — the ONLY file you normally edit. Full app: HTML,
  CSS, and JS with two placeholders: `__XLSX_LIB__` (SheetJS injection point)
  and `__LOGO_FULL__` (base64 logo injection point). Never edit `dist/` output
  directly; it is generated.
- `vendor/xlsx.full.min.js` — SheetJS 0.18.5 (parsing + writing xlsx/csv).
  Do not upgrade casually; 0.18.5 is the last Apache-licensed npm build.
  Note: this build DROPS formula cells that have `f` but no cached `v` when
  writing — every formula cell must carry both (Excel recalculates `f`).
- `assets/okypy_logo_full.png` — official logo, embedded at build time.
- `build.py` — inlines vendor lib + logo into `dist/OKYpY_Reconciliation_Tool.html`.
- `tests/` — Playwright headless tests driving the built file
  (`test_app.js`, `test_edge.js`, `test_v2.js`, `test_v3.js`,
  `gen_fixtures.js`, `screenshot.js` for design review shots).
- `samples/` — test fixtures with known expected results (see Tests below).

## Commands

```bash
python3 build.py                 # rebuild dist/ after ANY src change
cd tests && npm install playwright
# if the pinned browser is missing, point at any Chromium:
export CHROMIUM_PATH=/opt/pw-browsers/chromium
node test_app.js && node test_edge.js && node test_v2.js && node test_v3.js
node gen_fixtures.js             # only to regenerate fixtures
```

Tests print JSON lines (AUTO-MAP, KPIS, COUNTS, RESULT, SPLIT, TIERS, PERF…).
Expected values:

- `test_app.js` (samples A_SAP vs B_HIO, tolerance 0.01): matched=2, diffs=1
  (MAT002, diff 100.50), onlyA=2, onlyB=2, totA=2330.505, totB=1975.
  Exported xlsx must contain live formulas (`=N(E2)-N(F2)` in detail sheets,
  cross-sheet SUM/COUNTA in Σύνοψη).
- `test_edge.js` (edge_A.xlsx vs edge_B.csv): matched=2 (keys 000123↔123 via
  leading-zero normalisation; 80.005↔80.00 and 999.99↔1000.00 within
  tolerance), diffs=0, onlyB=1 (789 = −50.25 parsed from `"(50,25)"`).
- `test_v2.js` (asserts, exits 1 on failure):
  - split_A/split_B: exactly 2 proposals — INV-500 = PAY-01+02+03 (exact
    1-to-3) and INV-250 = PAY-04+05 (diff 0.01, within tolerance); decoy
    INV-300 must stay unexplained after better groups consume its members.
  - export after accepting: `Ομάδες` sheet with `=SUM(E2:E5)-SUM(F2:F5)`
    block formulas, Summary COUNTA over Groups!A, self-check
    `ROUND(B12-(C5+C6+C7+C8),2)` = 0, Only-in-A sheet excludes grouped items.
  - progress JSON round-trip restores categories + accepted groups.
  - tier_A/tier_B: REF-A1⇄ZZZ-9 matched by rule 2, REF-A2⇄YYY-8 by rule 3.
  - perf_A/perf_B (2,200 open items): run completes <5 s or sets
    `RESULT.splitTruncated` (graceful degradation).
- `test_v3.js` (ic_A vs ic_B, SAP-style intercompany GLs):
  - auto-mapping detects the Debit/Credit pair (amount = debit, credit
    subtracted) and auto-switches the hopeless Document Number guess to the
    suggested Reference↔Reference key (shared-value overlap).
  - keyed run + flip B: rule-1 matched = [R-101 175, R-102 200, R-103 400
    (netted), T-9 −1000 (credit-side)] plus the keyless 40.00 pair as rule 2;
    diffs 0; open = H-77 + keyless 15.50 (A) / L-88 + keyless 7.77 (B);
    totals −94.50 / −117.23; one footer total row excluded per side; no warns.
  - export contains the adjusted-balances sheet on a NON-bank preset with
    live formulas; doc sheet records the credit columns.
  - no-shared-key mode: 7 line pairs matched rule 2, same two open lines.
  - guardrail: keying on Document Number → 0 matches → visible banner that
    names the suggested Reference key.
- Real-world benchmark (files not in repo — hospital data): GL 122105 (Head
  Office 1000) vs GL 122113 (Limassol 1030). Expected with auto-config +
  flip B (v2.4 hybrid): matched = 249 refs (rule 1) + 888 keyless line pairs
  (rule 2), 0 diffs, 54 open (sum = net 11,995,952.00), totA = 14,819,319.94,
  totB = 2,823,367.94, one footer row excluded per side whose value equals
  the file's closing balance. No-shared-key mode matches 4,488 line pairs
  (equal to Reconcilio's A+S).

## Domain logic (do not break)

1. **Matching engine** (`aggregate()` + `runRecon()`): rows are summed per
   composite key on each side, then compared within tolerance. Keys are the
   user-ticked columns joined with `' | '`. Normalisation (`normKey`):
   uppercase, collapse whitespace, strip leading zeros from purely-numeric
   keys only (0MAT004 ≠ MAT004 on purpose; 000123 = 123).
   **Debit/Credit netting** (v2.1, `netAmount()`): each side may map an
   optional credit column; the row amount is Debit − Credit. Auto-guess
   pre-selects the pair when headers contain debit+credit (or χρέωση/πίστωση)
   — SAP GL exports never work without this.
   **Keyless rows are first-class** (v2.4, `keylessItems()` +
   `extractTotalRows()`): rows whose composite key is empty are NOT discarded
   in a keyed run — they are line-matched (amount within tolerance + date
   within the ±N window of `#nokeydays`) against the other side's keyless
   rows, labelled rule 2 with key `#<sheet-row>`; unexplained ones join the
   open lists, and totals cover every row. A file's grand-total footer (no
   key, no date, amount == net of all other rows within 0.02) is detected,
   excluded and reported with its value in the Documentation sheet — without
   this, raw column sums double.
   **No-shared-key mode** (v2.1, `#nokeyon` + `lineItems()`): skips the key
   pass entirely; every row is an open item matched 1-to-1 by amount within
   tolerance + date within ±N days (`pass2`, cent-bucketed so thousands of
   lines stay fast; undated items only match undated items). Matches are
   labelled rule 2. This is the mode for two files with no common reference.
   Bank reconciliations are out of scope — a separate single-file bank
   reconciliation tool exists for those; the bank preset was removed in v2.3.
   **Key guardrails** (v2.1, `crossKeySuggest()` + `RESULT.warns` banner):
   after both files load, column value-overlap is computed between the sides;
   the best pair (≥50% shared values, non-amount/date columns) is shown as a
   suggestion, and a hopeless auto-guess (<5% overlap) is auto-switched to
   it. After a run, warnings fire for: amount column used as key, one key
   value hoarding >20% of rows (degenerate key), zero/low match rates (with
   the suggested key named), and opposite-sign totals (suggest flip B).
2. **Cascading passes** (v2): pass 1 by key; pass 2 (opt-in `#tier2on`) on the
   remainder by amount-within-tolerance + date within ±N days, greedy 1-to-1,
   largest amounts first; pass 3 (opt-in `#tier3on`) by bigram-Dice
   description similarity ≥ 0.7 + amount within tolerance. Merged pairs get
   `rule:2|3` and key `A ⇄ B`; shown as a pill in the Matched tab and a Rule
   column in the export.
3. **Split (subset-sum) proposals** (v2, `proposeSplits()` + `findCombo()`):
   after all passes, 1-to-N combinations (N=2..maxK, default 4, hard cap 6)
   are searched on the open items of the other side — bounded DFS on CENT
   INTEGERS (never float-sum), same-sign candidates only, descending order
   with best-possible pruning, 60k node budget per target, ~4.5 s global time
   guard (`splitTruncated` flag + on-screen notice when hit). Greedy: largest
   |amount| targets first; every item belongs to at most one group. Proposals
   are NEVER auto-applied: the user accepts each group (checkbox) in the
   "Προτεινόμενοι συνδυασμοί / Suggested groups" tab; only accepted groups
   leave the open lists (`inAccepted()` filters KPIs, tabs and export).
4. **Number parsing** (`parseAmount`): must handle Greek format `1.234,56`,
   English `1,234.56`, `€`, parentheses negatives `(50,25)`. CSVs are read
   with `raw:true` so strings reach this parser — SheetJS would otherwise
   misparse Greek decimals. Never remove that flag.
5. **Excel export** (`exportExcel()`): every computed cell must be a LIVE
   formula — audit requirement. Because of the SheetJS quirk above, each
   formula cell is written as `{t:'n', v:<cached>, f:<formula>}`. Difference
   cells: `=N(Ex)-N(Fx)`. Accepted groups sheet: one block per group, target
   row carries `=SUM(E first:last)-SUM(F first:last)`; group numbers appear in
   col A only on target rows so `COUNTA` counts groups. Summary: cross-sheet
   SUM/COUNTA incl. Groups, self-check row `ROUND(B12-(C5+C6+C7+C8),2)` must
   evaluate to 0. Every preset gets an adjusted-balances sheet (side labels in the row
   captions): balance per B + items
   only in A = adjusted B; balance per A + items only in B = adjusted A;
   residual check row. Documentation sheet records files, sheets, mapping
   (incl. credit/date columns), tolerance, no-key mode, passes, split
   settings, group counts, truncation flag, preparer, reviewer sign-off
   line, skipped-row counts.
6. **Progress sidecar** (v2, `saveProgress()`/`applyProgress()`): "Save
   progress" downloads a JSON (settings, mapping, categories keyed by item
   key, group decisions keyed by `side|targetKey|memberKeys` signature);
   "Load progress" restores settings immediately and applies categories/group
   decisions to the current RESULT, or after the next run (`PENDING_PROGRESS`).
   No localStorage — files only.
7. **Reconciliation methodology** comes from the `reconciliation` skill
   (Anthropic finance plugin): open-item categories are exactly Timing
   difference / Adjustment required / Requires investigation; ageing buckets
   0-30 / 31-60 / 61-90 / 90+ days with escalation.
8. **Brand**: colours and layout follow the OKYπY brand — green `#8BC53F`,
   bright blue `#069FEC`, deep blue `#1B75BB`, text grey `#58595B`, light grey
   `#EAEAEA`; white background; bright-blue bar along the bottom; Lato →
   Source Sans Pro → Open Sans → Arial; dates DD/MM/YYYY. No other accent
   colours (`#C0392B` is reserved for negative/error semantics only). Side A
   is colour-coded deep blue, side B green, everywhere. The results header's
   balance-scale SVG (tilt ∝ net difference, level+green when within
   tolerance) is the signature element — keep it.
9. **Bilingual**: every user-visible string lives in the `I18N` dictionary
   (el + en). Greek is the default. Never hard-code a UI string outside I18N.
10. **Offline + single file**: no CDN links, no external requests, no
    localStorage. Everything inlined at build time.
11. **Test-visible contract**: keep these IDs/globals stable — `#fileA/B`,
    `#boxA/B`, `#sheetA/B`, `#hdrA/B`, `#stepMap`, `#keysA/B` (checkbox
    inputs), `#amtA/B`, `#dateA/B`, `#descA/B`, `#tolerance`, `#flipB`,
    `#normKeys`, `#preparer`, `#runBtn`, `#stepRes`, `.kpi .v/.l`, `.preset`
    (order gen/gl/hio), `#pane-<tab>` + `.catsel`, `#btn-el/#btn-en`,
    `#progFile`, globals `SIDES`, `RESULT`, `PRESETS`, `exportExcel()`,
    `saveProgress()`, `acceptAllGroups()`.

## Backlog

- Many-to-many (N-to-M) group suggestions.
- Per-pass tolerance overrides.
- Optional PDF export of the summary for sign-off circulation.

## Known limitations (v2.4)

- Split search proposes 1-to-N only (no N-to-M), same-sign combinations only.
- Pass 2 matches dated items with dated items (window) and undated with
  undated (amount only) — never mixed.
- Key suggestion samples the first 3,000 rows per file.
- Progress JSON matches items by key: if the mapping or files change, stale
  entries are ignored silently.
- The downloadable user manual (MANUAL dict, `downloadManual()`) generates
  in the ACTIVE language; its Greek follows native public-sector register and
  its English plain human prose — keep that tone when editing it.
- Header auto-detect scans the first 25 rows for a row with ≥2 text cells;
  merged-cell double-row headers need the manual header-row override.
