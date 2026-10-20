# OKYπY / SHSO Reconciliation Tools

Single-file, offline, bilingual (EL/EN) browser apps for the finance
departments of the State Health Services Organisation (ΟΚΥπΥ / SHSO), Cyprus.
Users double-click a built HTML file — no install, no server, no internet.
All data stays on the local machine. TWO tools share this repo:

1. **Reconciliation Tool** (`src/app_template.html` →
   `dist/OKYpY_Reconciliation_Tool.html`) — pairwise account reconciliation.
   Current version: **v3.17**.
2. **IC Matrix Tool** (`src/ic_template.html` →
   `dist/OKYpY_IC_Matrix_Tool.html`) — every hospital vs Head Office in one
   intercompany matrix. Current version: **v1.5**. See "IC Matrix Tool" below.

## Architecture

- `src/app_template.html`, `src/ic_template.html` — the ONLY files you
  normally edit. Each is a full app: HTML, CSS, and JS with two placeholders:
  `__XLSX_LIB__` (SheetJS injection point) and `__LOGO_FULL__` (base64 logo
  injection point). Never edit `dist/` output directly; it is generated.
- `vendor/xlsx-style.full.min.js` — xlsx-js-style 1.2.0 (SheetJS 0.18.5 API
  + cell-style writer, Apache-2.0). Built as `dist/cpexcel.js` +
  `dist/xlsx.min.js` concatenated, plus a Node shim appended
  (`module.exports=exports` when `exports.utils` exists) so the tests can
  `require()` it. Do not upgrade casually. Two inherited SheetJS quirks:
  it DROPS formula cells that have `f` but no cached `v` when writing —
  every formula cell must carry both (Excel recalculates `f`) — and it drops
  cells outside `!ref`, so extend the range when adding formula columns.
  The old `vendor/xlsx.full.min.js` is kept for reference but unused.
- `assets/okypy_logo_full.png` — official logo, embedded at build time.
- `build.py` — inlines vendor lib + logo into `dist/OKYpY_Reconciliation_Tool.html`.
- `tests/` — Playwright headless tests driving the built files
  (`test_app.js`, `test_edge.js`, `test_v2.js`, `test_v3.js`, `test_v4.js`,
  `test_ic.js`, `gen_fixtures.js`, `screenshot.js` for design review shots).
- `samples/` — test fixtures with known expected results (see Tests below).

## Commands

```bash
python3 build.py                 # rebuild dist/ after ANY src change
cd tests && npm install playwright
# if the pinned browser is missing, point at any Chromium:
export CHROMIUM_PATH=/opt/pw-browsers/chromium
node test_app.js && node test_edge.js && node test_v2.js && node test_v3.js && node test_v4.js && node test_ic.js
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
  - split_A/split_B: exactly 4 proposals — incl. INV-55 5,500 = 5 x 1,000 +
    500 past a 2,557.35 greedy dead-end (retry-with-skip) — INV-13M = 13 equal PAY-M lines of
    1,000,000 (beyond the DFS cap; instalment/denomination path), INV-500 =
    PAY-01+02+03 (exact 1-to-3), INV-250 = PAY-04+05 (diff 0.01, within
    tolerance); decoy INV-300 must stay unexplained after better groups
    consume its members.
  - accept-all + commit: 3 groups move to Matched as rule 4, undo returns one
    to proposals; export after committing: `Ομάδες` sheet with block SUM
    formulas + Manual rule column, Matched sheet has 0 rule-4 rows, Summary
    self-check = 0, Only-in-A sheet excludes grouped items.
  - progress JSON round-trip restores categories + committed groups (state 2).
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
  - no-shared-key mode with keys still ticked: 5 pairs (4 per-side ref groups
    + keyless pair); keys unticked: 8 raw line pairs. Open = 75/15.50 (A) and
    60/7.77 (B); footer rows excluded there too.
  - fee_A/fee_B (bank style, no-key + keysB=RefNo + pass 4 at 2%): CY222
    group matches 1,000.00 exactly (rule 2, key '#2 ⇄ CY222'); CY111 group
    (48,639.52, desc from its principal line) pairs with SAP −48,663.40 →
    Differences rule 5, diff −23.88; nothing left open. Export: Differences
    sheet has Περιγραφή A ('HNS PHARMA LTD') and Περιγραφή B (the OUTWARD
    line) in separate columns, CY111 in the key.
  - guardrail: keying on Document Number → 0 matches → visible banner that
    names the suggested Reference key.
- `test_v4.js` (v3.0 features; asserts, exits 1 on failure):
  - ic pair: mirrored signs auto-tick `#flipB` on load (detectFlip) with a
    hint; tie-out line shows ✓ for both detected footer totals; search filter
    'H-77' narrows Only-in-A from 2 rows to 1; manual selection H-77 (75)
    ⇄ L-88 (60) commits as rule 4 with diff 15; a second selection of the
    remaining keyless items empties both open lists.
  - the export of the UNTOUCHED run is saved as `export_prev.xlsx` (the
    carry-forward fixture — it must still contain the open items); a second
    export AFTER the manual commits checks the brand header fill
    (`A1.s.fgColor.rgb === '069FEC'`) and that sel-groups export cleanly.
  - pack: two `addToPack()` runs → `exportPack()` workbook with a 'Πακέτο'
    sheet (per-run check formula `ROUND(J4-(E4+G4+I4),2)`, totals row
    `SUM(E4:E5)`) plus two 'Εκκρεμή n' sheets.
  - carry-forward: fresh ic run + `#filePrev` = export_prev.xlsx → `bf.n=4`,
    flagged keys ['#10','#10','H-77','L-88'], 'Από προηγ. περίοδο' KPI shown.
  - v3.8 unmatch (ic pair keyed): 5 matched rows → 5 ↩ buttons; undoing
    R-101 → matched 4, both open lists +1 with ['R-101', 175], totA
    unchanged, sig '1|R-101|17500|17500'; saving progress and rerunning
    fresh replays the undo (R-101 stays open).
  - v3.7 many-files (multi_A1/A2 vs multi_B): setInputFiles with two files
    → SIDES.A.files.length 2, merged rows 4, name 'multi_A1.csv +
    multi_A2.csv', 2 chips; no-key run matches 3 rows ACROSS both A files
    ('#N' continues through the merge: open = ['#4', 45.67], totA 645.67);
    removeSideFile(1) re-merges to 2 rows.
  - v3.6 month-shift roll-forward (bfm1/bfm2 fixtures): M1's open 555.55
    cheque (cat catT) exported; M2 files don't contain it → injected as
    'B/F #2' and CLEARS against M2's bank entry (matched 'B/F #2 ⇄ #3',
    bf.n=0, resolved=1, totA=705.55 vs totAFile=150); with a ±20d window it
    STAYS OPEN as ['B/F #2', 555.55, 'catT', bf=true], bf.n=1.
  - profile round-trip on the fee pair: save profile, reload page, load the
    profile BEFORE the files → keysB RefNo, amtB/crB Debit/Credit, no-key on,
    days 9, pass 4 on, flip on all re-applied.
  - dup_A/dup_B: duplicate line on side A only → `RESULT.dupA=1`, warning.
  - nm_A/nm_B (no-key): one same-day 2-vs-3 N-to-M proposal, diff 0;
    committing it exports as one Groups block `SUM(E2:E6)-SUM(F2:F6)`.
  - easy_A/easy_B (no-key, ±7d): the 500.00 pair matches (pass 2); one TWIN
    proposal 77.10 (dates 54 days apart, unique on both sides) and one
    REVERSAL proposal (+250/−250 on side A); committing both empties the
    open lists, the Matched keys and Groups sheet carry the Αντιλογισμός /
    Ίδιο ποσό labels. UI: `toggleSel` keeps the pane DOM node (no scroll
    reset); `.colgrip` handles render, and `COLW` widths survive a re-render
    (`table.fixedw`, th width 120px); desc cells have `td.clip` + tooltip.
  - v3.2 — pack dedupe: `addToPack()` twice on the same files keeps
    PACK.length 1; renaming `SIDES.B.name` then adding appends (total 2).
  - v3.2 — sweep_A/sweep_B (no-key): ONE charges entry 90.00 vs 65 fee
    lines (64×1.37 + 2.32) → exactly one proposal ['A', 65 members, diff 0]
    via the take-all shortcut; committing clears both sides.
  - v3.2 — warn_A/warn_B (no-key): two identical open 5.00 fees show the
    live duplicate warning; committing the 10 = 5+5 group hides #resWarn.
  - v3.5 — sweep pair, search 'COMMISSION' → 64 visible rows; clicking
    `#pane-onlyB .selall` selects exactly those 64 (selInfo shows 64),
    unticking clears them; select-all both sides + matchSelected → 1
    committed group, both open lists empty.
  - v3.3 — adj_A/adj_B (no-key, the real 05.2026 HNS miss): SAP −8818.40 +
    FX +0.13 vs bank −8818.27 → exactly one `{adj:true}` proposal
    [2×A, 1×B, diff 0]; committing clears both sides and the Matched key
    carries the 'Ζεύγος με γραμμή προσαρμογής' tag.
  - v3.9 — pos_A.xlsx/pos_B.csv (JCC/POS card settlements): pos_A is a
    BOC-style statement with 7 preamble rows (header row 8 'Date,
    Description, Transaction type, Reference number, Debit, Credit') —
    `hdrA` must auto-detect '8', amount Debit / credit Credit; pos_B is SAP
    (Text picked as description). Run no-key ±3d, flip B, POS pass on at 1 %
    ±4d → matched 1 (the 500.00 cash settlement), exactly two `{pos:true}`
    proposals: VISA 03.08 −1496.41 vs 7 JCC deposits of 04/08 (diff 6.12)
    and VISA 4/8 −981.40 vs 8 JCC deposits of 05/08 (diff 5.61); no other
    proposals (the exact-split pass must NOT steal JCC lines). Cards show
    the 'Εκκαθάριση καρτών JCC/POS' tag; committing leaves open [1,0] and
    groupDiff 11.73; the Groups sheet label (H2) is the POS tag.
  - v3.10 — batch_A/batch_B (the real 1030 British Forces shape): bank
    credit advice 1000.00 on 28/09 vs SAP 'FULL SET. FOR INV.' lines
    500+300+175+25 of 28/09 (the 175 spelled 'FULLSET.FORINV.') plus a
    2031.37 line that has its OWN credit advice, and a coincidental 25.00
    tip on 29/09. Expect: matched [[-2031.37, rule 2]], exactly one
    `{batch:true}` proposal [A, 1000, members −500/−300/−175/−25, diff 0],
    no other proposals, card text 'Παρτίδα ίδιας ημέρας'; after commit the
    only open item is the 29/09 tip (−25) — the batch's own 25 was NOT
    stolen by pass 2.
- `test_ic.js` (IC Matrix Tool; mx_*.csv fixtures; asserts, exits 1 on
  failure): five files load with auto-guessed columns, balances
  [350, −320, 400, −400, 75]; HO⇄LIM pairs by suggested key `Ref` (2 matched,
  R3 50 vs R4 20 open, raw = residual = 30 → red cell), HO⇄LAR line-matches
  with zero residual (Ref value sets too small for the key suggest → line
  mode, green ✓ cell), mx_ho_paf stays a single (grey cell shows the
  one-sided 75); matrix cells: 2 ok + 2 bad (symmetric) + 2 miss texts.
  Drill-down lists the open items and holds categories; the cell stays red
  while any item is uncategorised (`setCat` re-renders live) and `bulkCat`
  turns the pair green (4 ok cells, KPI 'fully categorised' = 2). Export:
  'Πίνακας' sheet first with live formulas (D=B−C, F/G=SUM over the pair
  sheet's E/F, H=F−G, I=ROUND(D−(E+H),2)=0, J=COUNTBLANK category count,
  H filled red while uncategorised remain), brand header fill, per-pair
  sheets with category labels, 'Τεκμηρίωση' last. Progress JSON stores
  registry + per-file setup (by filename) + categories; loading it BEFORE
  the files re-assigns entities automatically and re-applies categories
  after the next build.
- Real-world benchmark (files not in repo — hospital data): GL 122105 (Head
  Office 1000) vs GL 122113 (Limassol 1030). Expected with auto-config +
  flip B (v2.4 hybrid): matched = 249 refs (rule 1) + 888 keyless line pairs
  (rule 2), 0 diffs, 54 open (sum = net 11,995,952.00), totA = 14,819,319.94,
  totB = 2,823,367.94, one footer row excluded per side whose value equals
  the file's closing balance. No-shared-key mode matches 4,488 line pairs
  (equal to Reconcilio's A+S).
- Real-world benchmark 2 (files not in repo): BOC_SAP_03.2026 vs BOC
  TransactionHistory 03.2026, no-key mode ±60d, flip B, D/C netting both
  sides, bank header row = 6. Expected proposals include 13,000,000 =
  10 x 1M + 6 x 500k (diff 0), 11,000,000 = 22 x 500k (diff 0), and the
  6,216,168.10 payroll = 2 lines; ~260 line pairs matched. With pass 4 at
  2%: −5,500,000 = 5 x 1M + 500k (retry-with-skip) and 4 near-diffs incl.
  HNS PHARMA −48,663.40 vs −48,557.40 → diff −106.00 (FX/fees).
- Real-world benchmark 3 (files not in repo): hospital 1021 BOC income
  account statement 08.2026 (side A, preamble rows, header auto-detected
  at row 8) vs INCOME_SAP (side B), no-key ±7d, flip B, POS pass 1 % ±4d:
  20 POS proposals pairing every settleable 'VISA dd.mm' SAP line PLUS its
  own 'VISA. d/8' commission line (0.38–0.89 %) with the next-business-day
  JCC deposits, all diff 0.00 (v3.12); VISA 31/08 (−1,050.81 + fee 6.18)
  correctly stays open (settles in September); the 03/08 deposits (1,590.00)
  are July's takings and stay open too; 5 exact split proposals (cash +
  cheque deposit of one slip = SAP cash settlement) and, from v3.13, the
  SBAA day batch (0.10 to check). Remaining open after accepting all: bank
  only — AP SOLUTIONS inward 1,608.57, credit advice 200.00, July deposit
  fees 36.00 + 7.50, pay-in 50.00 (slip 24.6), HIO GESY payments 14/08
  (11 transfers, 2,411,759.14) and EUROPEAN UNIVERSITY 75,479.00 — none of
  which the SAP income account carries; SAP only — VISA 31/08 + its fee. Hospital 1030 (1030_INCOME_125300_09.2026 SAP vs bank
  statement, v3.10): 358 matched, 9 batch proposals (diff 0: the 1Bank
  'BRITISH FORCES' credit advice 14,896.82 = 33 'FULL SET. FOR INV.' lines
  of 28/09, the TRF 3,000,000/1,500,000 and the exact CASH DEPOSIT days)
  + 13 POS proposals (remaining exact TRF/CASH batches at 0 %). Before
  v3.10 the British Forces advice came out as a WRONG 31-member POS
  proposal with a 148.00 'commission': pass 2 had paired its 25.00 line
  with an unrelated 25.00 Revolut tip of the next day and the 123.00 line
  ('FULLSET.FORINV.' spelling) fell outside the description family.
  Open after accepting everything (v3.14): SAP — exactly the 11 'JCC NET
  AMOUNT, 31/08/2026' lines (1,429.55) whose deposits the bank credited in
  August (brought forward); bank — the four JCC deposits of 30/09 (388.51)
  SAP posts in October, two €25 tips, one 5.98 deposit, and the four HIO
  GESY transfers of 14–15/09 (7,339,795.78) the income account does not
  carry. An independent terminal+amount matching of the 302 bank / 308 SAP
  JCC lines (scratch script, not in repo) gives the same leftovers; four
  SAP lines carry a terminal number off by one (SAP typo) and are rightly
  matched by amount+date.

- Untouched-defaults benchmark (v3.17, the user's own "test run" on the
  1030 files with yellow/green highlights): loading the two files and
  pressing Run with NOTHING changed must give 358 matched + 28 proposals
  with the British Forces batch (#1, 1⇄33) and the 7.9.26 cash slip
  (#4, 1⇄4) pre-ticked. Before v3.17 the defaults auto-picked 'Κωδικός
  Καταστήματος' / 'Company Code' as keys (hint words, near-constant
  values) and the keyed run produced 0 matches.

## Domain logic (do not break)

0. **Many files per side** (v3.7): `SIDES[side].files[]` holds slots
   {name,wb,sheet,hdr,rows,cols}; `mergeSide()` concatenates their rows in
   slot order (slots are pushed SYNCHRONOUSLY on selection, so FileReader
   completion order cannot scramble '#N' numbering) with a UNION of columns
   (missing cells padded null — never undefined, which would leak
   'UNDEFINED' into key-overlap sets). `SIDES[side].rows/cols/name/wb`
   remain the merged view every consumer uses; `wb` is the primary file's
   workbook (profiles re-apply sheet/header to it). Choosing files via the
   main box REPLACES the side; the '+ Αρχείο' button (`#fileAddA/B`)
   APPENDS; chips in `#extraA/B` remove single files (`removeSideFile`
   promotes the next file's sheet list when the primary goes). The sheet
   and header controls always describe `files[0]`; extra files auto-detect
   their own header row.

1. **Matching engine** (`aggregate()` + `runRecon()`): rows are summed per
   composite key on each side, then compared within tolerance. Keys are the
   user-ticked columns joined with `' | '`. Normalisation (`normKey`):
   uppercase, collapse whitespace, strip leading zeros from purely-numeric
   keys only (0MAT004 ≠ MAT004 on purpose; 000123 = 123).
   **Debit/Credit netting** (v2.1, `netAmount()`): each side may map an
   optional credit column; the row amount is Debit − Credit. Auto-guess
   pre-selects the pair when headers contain debit+credit (or χρέωση/πίστωση)
   — SAP GL exports never work without this. Description columns are also
   auto-guessed (v2.9, DESC_HINTS): an EXACT header match ('Text',
   'Description', 'Περιγραφή'…) beats a 'contains' match, so SAP's 'Text'
   wins over 'Document Header Text'; columns already used for amount/credit/
   date are never picked. Without this the Description A/B export columns
   sat empty whenever users forgot the dropdowns. The doc sheet records the
   description mapping.
   **Description fallback chain** (v3.4, `descChain()`/`descOfRow()`, same
   helpers copied into the IC tool as `descChainF`): per ROW, the mapped
   description column is read first and, when blank, every other
   description-like column (DESC_HINTS) is tried in order. SAP leaves
   'Text' empty on invoice lines while 'Document Header Text' carries the
   story — a real IC run exported 1,137 matched rows with blank
   descriptions on both sides before this. Used by aggregate(),
   lineItems(), keylessItems() and the IC buildItems().
   **Keyless rows are first-class** (v2.4, `keylessItems()` +
   `extractTotalRows()`): rows whose composite key is empty are NOT discarded
   in a keyed run — they are line-matched (amount within tolerance + date
   within the ±N window of `#nokeydays`) against the other side's keyless
   rows, labelled rule 2 with key `#<N>` where N is the DATA-relative row
   (first row after the headers = #1, regardless of the header-row setting;
   changed in v2.8 from sheet-row numbering); unexplained ones join the
   open lists, and totals cover every row. A file's grand-total footer (no
   key, no date, amount == net of all other rows within 0.02) is detected,
   excluded and reported with its value in the Documentation sheet — without
   this, raw column sums double.
   **No-shared-key mode** (v2.1, `#nokeyon` + `lineItems()`): skips the key
   pass entirely; every row is an open item matched 1-to-1 by amount within
   tolerance + date within ±N days (`pass2`, cent-bucketed so thousands of
   lines stay fast; undated items only match undated items). Matches are
   labelled rule 2. This is the mode for two files with no common reference.
   **Per-side grouping in no-key mode** (v2.7): ticking key columns on ONE
   side groups that side's lines by that value before matching (e.g. the
   bank's own reference number folds a transfer and its fee lines into one
   entry; groups netting to zero are dropped). The grouped item's description
   comes from the group's largest line (`aggregate().descBig`) so the payee
   text survives for the near pass.
   **Near-match pass 4** (v2.7, opt-in `#nearon` + `#nearpct`, `nearPass()`):
   on the final remainder, pairs items with LINKED TEXT (one normalised
   desc/key contained in the other, len ≥6, or bigram-Dice ≥0.6) whose
   amounts are same-sign within ±N% (relative, default 2%) and dates within
   the `#nokeydays` window. Residual ≤ tolerance → Matched; otherwise the
   pair lands in DIFFERENCES with rule 5 ("Προσέγγιση / Near") — the FX and
   commission story (SAP 48,663.40 vs bank 48,557.40 → diff −106.00). Kept
   opt-in so the v1 baseline stays intact.
   The bank PRESET was removed in v2.3 (a separate single-file bank tool
   handles classic statement-balance reconciliation), but bank-statement vs
   SAP-GL comparison is a first-class use case through the no-key mode —
   per-side ref grouping, batch splits, near pass and same-day N-to-M all
   exist for it (validated on the BOC benchmarks below).
   **Key guardrails** (v2.1, `crossKeySuggest()` + `RESULT.warns` banner):
   after both files load, column value-overlap is computed between the sides;
   the best pair (≥50% shared values, non-amount/date columns) is shown as a
   suggestion, and a hopeless auto-guess (<5% overlap) is auto-switched to
   it. After a run, warnings fire for: amount column used as key, one key
   value hoarding >20% of rows (degenerate key), zero/low match rates (with
   the suggested key named), and opposite-sign totals (suggest flip B).
   **Live warnings** (v3.2, `liveWarns()`): `RESULT.warns` holds only the
   SETUP-level warnings (flip, key-amount, degenerate key, keyed-run dups);
   the match-rate warnings (keyed runs) and the duplicate warning for NO-KEY
   runs (same amount + date among items STILL open) are recomputed on every
   render, so they clear as the user commits groups or matches manually —
   users complained the alert outlived the reconciliation. The banner shows
   `[...R.warns, ...liveWarns()]`.
   **Sign auto-detect** (v3.0, `detectFlip()`): once both files are mapped,
   amount cent-counts are compared; when mirrored pairs dominate (flip ≥5 and
   flip > 2×same) `#flipB` is ticked automatically and `#signHint` says so —
   the user can always untick it.
   **Duplicate detection** (v3.0, `dupCount()`): extra rows sharing key +
   amount + date on ONE side raise `RESULT.dupA/dupB` and a warning in the
   banner (possible double postings).
   **Balance tie-out** (v3.0, `#tieInfo`): when a file's grand-total footer
   was detected, the tool's own total for that side is compared against it
   and the verdict (✓ / mismatch with both values) is shown under the KPIs.
   **Search & filters** (v3.0, `#resQ`/`#resMin` → `RESULT.filterQ/filterMin`):
   text search across key/descriptions and a minimum-|amount| filter narrow
   the visible tab rows only — they never change RESULT, KPIs or the export.
   **Results-table ergonomics** (v3.1): description cells are clipped
   (`td.clip`, max-width 300px, full text in the `title` tooltip) so amounts
   stay visible; every header carries a `.colgrip` drag handle (`gripDown()`)
   — first drag freezes the current layout into `COLW[tab]` and switches the
   table to `table-layout:fixed`; `applyAllColW()` re-applies stored widths
   after every render. `toggleSel()` MUST NOT call `renderResults()` — it
   only updates the selection toolbar (`renderSelBar()`), otherwise every
   tick rebuilds the DOM and throws the scroll position back to the top;
   renders that do rebuild the panes save and restore each pane's scrollTop.
   **Unmatch** (v3.8, `unmatchRec(tab,idx)` + the ↩ `.unbtn` column on the
   Matched and Differences tabs): every auto-matched rec (rules 1/2/3/5)
   carries `_a`/`_b` — the per-side originals attached by `mergePair` and
   by the rule-1 rec builder — so a wrong match (same amount, wrong
   counterpart) splits back into two open items with dates, descriptions
   and bf flags intact; totals are untouched. Rule-4 rows are excluded
   (their undo lives in the Groups tab). Each undo records
   `unmatchSig(r)` = rule|key|centsA|centsB into `RESULT.unmatched`,
   saved in the progress JSON and REPLAYED at the top of `applyProgress`
   (before categories, so cats can land on the released items).
   **Select-all-visible** (v3.5, `.selall` master checkbox in the selection
   column header of Only-in-A/B, `selAll(id,on)`): (de)selects every row the
   CURRENT filters show (`passFilter`, not accepted) — the 'search, then
   take them all' flow for manual matching. Updates the visible row
   checkboxes in place (no re-render, no scroll jump); its own checked
   state is recomputed per render (`view.every(x=>x.r._sel)`).
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
   guard (`splitTruncated` flag + on-screen notice when hit).
   **Take-all shortcut** (v3.2): before the batch heuristics, if the WHOLE
   remaining pool (≤400 items, same sign, after date/prefix filters) sums to
   the target within tolerance, the entire pool is proposed as one group —
   the month-end shape of one bank-charges GL entry against every small fee
   line on the statement (a user had to hand-select 71 fee lines before
   this existed).
   **Large batches** (v2.5): when the DFS finds nothing, two cheap strategies
   run with an internal cap of 120 members (60 until v3.1) —
   `findGreedyCompose()` composes
   the target from the largest available denominations downwards (13M =
   10 x 1M + 6 x 500k, the shape of real transfer batches; since v2.7 it
   RETRIES skipping progressively more of the largest denominations, so a
   big odd line can no longer dead-end it — 5.5M = 5 x 1M + 500k even with a
   2,557,349.29 line in the pool), then
   `findInstalments()` looks for k equal lines summing exactly to the target
   (k = 2..120, exact cents division). Both respect the same-sign, date-window
   and prefix filters. Greedy: largest |amount| targets first; every item
   belongs to at most one group. Proposals
   are NEVER auto-applied: the user accepts each group (checkbox) in the
   "Προτεινόμενοι συνδυασμοί / Suggested groups" tab; only accepted groups
   leave the open lists (`inAccepted()` filters KPIs, tabs and export).
   **Manual reconciliation commit** (v2.6, `commitGroups()`/`uncommitGroup()`):
   the "Move to reconciled" button turns ticked proposals into Matched-tab
   entries with rule 4 ("Χειροκίνητη / Manual" pill) and per-group Undo in a
   green "Manually reconciled groups" section. Committed groups persist in the
   progress JSON as state 2 and are re-committed on load. In the export they
   live ONLY in the Groups sheet (now with a Rule column = Manual); the
   Matched sheet and all Summary cached values use matched EXCLUDING rule 4,
   otherwise amounts double-count.
   **Manual selection matching** (v3.0, `toggleSel()`/`matchSelected()`):
   every row in Differences / Only-in-A / Only-in-B carries a checkbox
   (`r._sel`); the results toolbar shows per-side counts/sums and Δ of the
   selection. "Match selected" commits it as a rule-4 group shaped
   `{sel:true, itemsA, itemsB, diff}` — cross-side or SAME-side (a debit and
   its reversing credit in one GL). `grpHas()`/`inAccepted()` and the export
   understand BOTH group shapes (`target`+`members` vs `itemsA`+`itemsB`);
   the Summary caches `gESum`/`gFSum` must branch on `p.sel||p.nm`, or
   `exportExcel` crashes on reduce. Committed selections persist in the
   progress JSON via `grpSignature` ('S|aKeys|bKeys') and rebuild on load.
   **Same-day N-to-M proposals** (v3.0, `proposeSameDay()`): in NO-KEY runs
   only (user decision — the bank-reconciliation aspect), leftover open items
   are bucketed by exact date; a bucket with ≤40 lines per side whose sides
   net within tolerance (and is not a plain 1-to-1) becomes a proposal
   `{nm:true}` labelled "Ν προς Μ / N to M", accepted and committed like any
   other group and exported as one Groups block.
   **Easy-pair proposals** (v3.1, `proposeEasy()`, ALL runs, after splits and
   same-day): (a) cross-side TWINS — an exact cent amount that exists exactly
   ONCE among the open items of each side (ambiguous amounts are skipped on
   purpose) is proposed as `{tw:true}` "Ίδιο ποσό, άλλη ημερομηνία / Same
   amount, different date"; these are the equal-amount pairs pass 2 rejects
   because the dates sit outside the ± day window. (b) same-side REVERSALS —
   a +x and a −x left open in ONE file are paired (nearest dates first) as
   `{rev:true}` "Αντιλογισμός / Reversal"; this automates the manual
   same-side matches users did by hand. Cap 400 proposals. Group-shape
   helpers `twoSided(p)` (sel/nm/rev/tw/adj → itemsA/itemsB) and
   `grpTagKey(p)` are used by EVERY consumer — gcardHTML, commitGroups,
   grpSignature, grpHas, exportExcel — never re-test `p.sel||p.nm` directly.
   **Adjusted pairs** (v3.3, `proposeAdjusted()`, ALL runs, last): a
   cross-side pair whose gap is small (≤ €100, and smaller than either main
   amount) plus ONE small open line on EITHER side (any sign) that closes
   the gap to the cent → `{adj:true}` "Ζεύγος με γραμμή προσαρμογής / Pair
   with adjustment line". This is the FX-difference/rounding-line shape the
   split passes can NEVER find because they filter candidates to the
   target's sign (real miss: SAP −8,818.40 + FX +0.13 vs bank −8,818.27).
   Tightest pairs claim their adjustment lines first; cap 400.
   **Exact same-day batches** (v3.10, `holdBatches()` + `famKey()`): BEFORE
   pass 2/3/4 run, every dated open item is tested against the other side's
   same-day, same-sign description families (`famKey` = letters only, first
   12, so 'FULL SET. FOR INV.' and 'FULLSET.FORINV.' agree and dates /
   references inside the wording never split a family). A family of ≥3
   lines taken whole, or minus at most two lines (one of them usually has
   its own 1-to-1 partner), that equals the target to the cent is HELD:
   target + members leave onlyA/onlyB (`heldA/heldB`), the 1-to-1 passes
   run on the rest, the held items come back before sorting and are pushed
   as `{batch:true, target, members, diff}` proposals first (ids 1..n, the
   POS pass continues the numbering) labelled 'Παρτίδα ίδιας ημέρας —
   ακριβές σύνολο / Same-day batch — exact total' (`batchTag`) in cards and
   the Groups sheet. Rationale: pass 2 picks small common amounts (a €25
   fee) off a batch whenever an equal amount sits nearby on the other side,
   which leaves the batch short and every later group proposal wrong. The
   hold only runs when split proposals are enabled (`scfg.on`, now read at
   the top of runRecon). Never widen it to subsets smaller than
   'family minus two': arbitrary exact subsets of 30 small lines hit random
   targets by the birthday problem.
   **Pass 2 in three rounds** (v3.15): `pass2()` first pairs equal amounts
   that share a reference number (`tokenLinked`), then equal amounts that
   share a name/word (`wordsShared` > 0, more shared words first), then the
   rest by nearest date; each round picks the nearest date within its
   level. A single nearest-date pass in statement order let an orphan
   steal a linked partner and the error cascaded down every chain of equal
   amounts (eighteen €70 medical-report fees of one day crossed over, a
   €25 'JAGBIR' tip paired with another law firm, six 5.98 terminals
   shifted). `wordSet(rec)` holds words of ≥4 letters, accents stripped,
   Greek transliterated to one Latin form (`translit`: ΟΥ→OU, Χ→CH, Θ→TH,
   Y→I …) so 'ΛΑΤΥΣΟΒΙΤΣ' meets 'LATISOVITIS'; `sameWord` accepts equal
   words or a common stem ≥80 % of the longer word (min 5 letters). Words
   carried by more than max(4, 1 %) of the run's open lines (CREDIT,
   DEPOSIT, MEDICAL, REPORT …) are ignored via `WORD_DF`, filled by pass 2
   and cleared after. On 1030 every €70 name now pairs with itself, JCC
   terminal agreement is 290 of 294 (the 4 left are SAP terminal typos).
   **Setup defaults** (v3.17): `guess()` ticks a key column only if it
   identifies rows (`identifies`: ≥2 distinct values and ≥30 % of the
   non-empty cells distinct) — 'Company Code', a branch code or a document
   number shared by a day's lines are skipped. `crossKeySuggest()` then
   switches 'no shared key' ON with the `nokeyAuto` hint when a side has no
   key at all, or when the ticked keys have different headers, ≥3 distinct
   values each and <5 % overlap (identically named key columns are taken as
   deliberate — tiny fixtures with 'Key' on both sides stay keyed). The
   JCC/POS + day-batch pass is ON by default. Exact batches (`batch`) and
   exact multi-line card groups (`pos`, not `one`, diff 0) are
   PRE-TICKED (`accepted:true` at the end of runRecon) — they leave the
   open lists at once and can be unticked in the Suggested groups tab.
   A single line plus its own fee/FX line found by the card pass is
   emitted as `{adj:true}` (not pos), so the v3.3 label and test hold.
   **Reference numbers** (v3.14, `numTokens(rec)` / `tokenLinked(a,b)`):
   digit runs of ≥4 in desc/key, leading zeros dropped, years ignored — a
   card terminal ('Remittance Num 024390' ↔ 'JCC NET AMOUNT, 31/08/2026,
   24390'), a UN/EP number, an invoice. Used in three places: (1) pass 2
   tie-break — among equal amounts inside the window a token-linked
   candidate outranks the nearer date (same net amounts from one terminal
   recur across the month; on 1030 terminal agreement of the JCC pairs went
   265→285 of 294); (2) `proposeEasy` twins — an AMBIGUOUS amount still
   pairs when exactly one line per side shares a token (SAP books terminal
   16334's 139.30 under 24/09, the bank credited it 17/09); (3) the split
   guard below. **Split guard** (v3.14, in `proposeSplits`): a target under
   €1,000 assembled from members of several days that are neither one
   dominant wording family (≥80 %) nor text/token-linked to the target is
   dropped as a coincidence (real miss: 178.30 = 139.30 + 25 + 8.03 + 5.97
   from four dates of deposits and tips); the take-all shortcut is exempt
   (fee sweep fixture). **Adjusted pairs** now take a `days` window
   (nokeydays, default 7): main pair and adjustment line must be within it —
   the same coincidence shape otherwise re-appears there (100 + 78.30).
   **Card settlements JCC/POS** (v3.9, `proposePos()`, opt-in `#poson`,
   default commission 1 % / ±4 days, runs right after the batch hold and
   shares one `consumed` Set with `proposeSplits(onlyA,onlyB,tol,cfg,
   consumed0,startId)`): the acquirer (JCC) credits the bank with daily
   batches net of commission while SAP books the gross POS takings per day
   ('VISA dd.mm'), or the bank shows many small 'JCC NET' deposits against
   one bulk GL posting. For every dated open item (both sides, largest
   first) the pool is the other side's same-sign unconsumed lines within
   ±days; a candidate group `fits` when |target − sum| ≤ band
   (band = max(1 cent, |target|×pct)) AND |sum| ≤ |target| + 1 cent — the
   commission can only leave the deposits SHORT, never over. Candidates:
   whole-day groups ('D|day') and day+description-family groups
   ('F|day|famKey'), evaluated together (smallest residual wins,
   nearer date breaks ties); else a single nearest fitting line; else a
   subset of ONE day-family via findCombo (cap 8000) then
   findGreedyCompose (60). Never compose across the whole window — that
   produced 31-line garbage groups. Proposals are `{pos:true, target,
   members, diff}` (target shape → `twoSided()` false) labelled
   'Εκκαθάριση καρτών JCC/POS / JCC/POS card settlement' in cards and in
   the Groups sheet; the residual is the commission the user books. Running
   POS first matters: the exact subset-sum pass otherwise consumes JCC
   lines into coincidental combos.
   The ledger's OWN commission line (v3.12): when an open line on the
   TARGET side, within ±days, equals the residual to the cent (SAP books
   'VISA. 12/8/2026' +28.13 beside 'ΕΚΚΑΘΑΡΙΣΗ VISA. 12/8/2026' −6,174.98),
   it joins the group and the proposal becomes TWO-SIDED
   `{pos:true, itemsA, itemsB, diff:0}` (`twoSided()` recognises
   `p.pos&&p.itemsA`, `grpTagKey` returns 'posTag' for pos). Without this
   the fee lines stayed open and the commission would be booked twice. On
   1021 all 20 VISA days now close at 0.00 (fixture pos_B carries the 6.12
   fee line for VISA 03.08; VISA 4/8 has none and stays one-sided, 5.61).
   Day minus one or two lines (v3.13): only when NO whole day/family group
   fits, step 1 retries every group of ≥4 lines minus one line and every
   group of ≥5 minus two (never arbitrary subsets) — the real miss was a
   SBAA (British bases) credit advice 818.94 vs nine SAP lines of 19/08
   (invoice + eight patient names, 818.84) polluted by that day's VISA
   gross line. Tags are resolved in `posTagKey(p)`: `one` → posOneTag;
   `card` (JCC/VISA/MASTER/CARD/POS/ΚΑΡΤ in target or member wording) →
   posTag; diff 0 → batchTag; else dayTag 'Παρτίδα ημέρας με μικρή
   διαφορά — προς έλεγχο / Day batch, small difference — check'. The
   settings label now reads 'Εκκαθαρίσεις καρτών (JCC/POS) και ημερήσιες
   παρτίδες'. Fixture batch_A/batch_B carry the SBAA shape (818.94 vs
   543.86+60.50+33.00+181.48 plus an unrelated VISA 383.63 on 19/09):
   expect one `{pos:true}` day proposal diff −0.10 tagged dayTag, VISA
   left open. v3.14 adds to the same fixture: bank 17/09 'Remittance Num
   016334' 139.30 vs SAP 25/09 'JCC NET AMOUNT, 24/09/2026, 16334' 139.30
   → one twin; SAP 01/09 '…, 24387' 178.30 vs bank 100.00 (03/09) + TIPS
   78.30 (16/09) → NO split and NO adjusted pair; after commit open A =
   [100, 78.30, 25], open B = [−383.63, −178.30]. v3.15 adds bank 21/09
   'MAKIS ANASTASIOU … >JAGBIR' 25 + bank 24/09 'PANAGIDIS …>MEDICAL FILE'
   25 vs SAP 21/09 'JAGBIR JAGBIR' 25: the JAGBIR lines pair (matched
   [−2031.37, −25]), PANAGIDIS stays open (open A = [100, 78.30, 25, 25]).
   A LONE line inside the band (step 2 of proposePos) is flagged `one:true`
   and labelled 'Μία γραμμή με μικρή διαφορά — προς έλεγχο / Single line,
   small difference — check' (`posOneTag`, v3.11): one line is no evidence
   of a card settlement — on 1030 it was a cash deposit keyed 2,237.40 in
   SAP against 2,237.10 credited (0.30 to investigate), not a commission.
4. **Number parsing** (`parseAmount`): must handle Greek format `1.234,56`,
   English `1,234.56`, `€`, parentheses negatives `(50,25)`. CSVs are read
   with `raw:true` so strings reach this parser — SheetJS would otherwise
   misparse Greek decimals. Never remove that flag.
5. **Excel export** (`exportExcel()`): every computed cell must be a LIVE
   formula — audit requirement. Because of the SheetJS quirk above, each
   formula cell is written as `{t:'n', v:<cached>, f:<formula>}`. Difference
   cells: `=N(Ex)-N(Fx)`. Detail-sheet layout (v2.8): A key, B Description A,
   C Description B (both files' wording — recs carry `descA`/`descB` from
   every creation site), D date, E amount A, F amount B, G diff, H age,
   I/J row counts, K category, L rule. E/F/G positions are LOAD-BEARING for
   every summary/adjusted formula — never move them. Accepted groups sheet: one block per group, target
   row carries `=SUM(E first:last)-SUM(F first:last)`; group numbers appear in
   col A only on target rows so `COUNTA` counts groups. Summary: cross-sheet
   SUM/COUNTA incl. Groups, self-check row `ROUND(B12-(C5+C6+C7+C8),2)` must
   evaluate to 0. Every preset gets an adjusted-balances sheet (side labels in the row
   captions): balance per B + items
   only in A = adjusted B; balance per A + items only in B = adjusted A;
   residual check row. Documentation sheet records files, sheets, mapping
   (incl. credit/date columns), tolerance, no-key mode, passes, split
   settings, group counts, truncation flag, preparer, reviewer sign-off
   line, skipped-row counts. In a no-key run the 'Pass 2' row reports
   'Ναι (κύριο πέρασμα — χωρίς κλειδί)' with the no-key window (v3.16) —
   it used to echo the unused keyed-mode tier switch ('Όχι').
   Export audit on the 1021 benchmark (scratch verify script, not in
   repo): 8 sheets, 96 formulas, every cached value equals an independent
   recomputation; Summary self-check 0, adjusted-balance residual 0;
   Σύνολο A/B equal the app KPIs; the SAP grand-total footer (628,041.11)
   is excluded and reported; two-sided card groups export as one block
   (deposits on E, gross + fee on F, `SUM(E)-SUM(F)` = 0).
   **Styled cells** (v3.0, xlsx-js-style `ST` map): header rows filled brand
   blue `069FEC` with white bold text; open-item rows tinted by category
   (`catT` D6EBFA / `catA` E9F4DA / `catI` F8DEDA), rule-5 near rows `EAEAEA`;
   negative diffs get red font `C0392B`; the Summary self-check row fills
   green at zero, red otherwise. Only OKYπY palette tints — no other colours.
6. **Progress sidecar** (v2, `saveProgress()`/`applyProgress()`): "Save
   progress" downloads a JSON (settings, mapping, categories keyed by item
   key, group decisions keyed by `side|targetKey|memberKeys` signature);
   "Load progress" restores settings immediately and applies categories/group
   decisions to the current RESULT, or after the next run (`PENDING_PROGRESS`).
   No localStorage — files only.
   **Profiles** (v3.0, `saveProfile()` / `type:'profile'` JSON): a profile
   stores the setup WITHOUT data — preset, per-side sheet + header row, keys,
   amount/credit/date/description columns, and every setting from
   `collectSettings()`. Loaded through the SAME `#progFile` input (the loader
   branches on `type`): sheet/header apply on file load
   (`applyProfileSheet`), column mapping at the end of `rebuildMapping`
   (`applyProfileMapping` via `PENDING_PROFILE`) — so a profile loaded BEFORE
   the files still lands. This is what makes the tool universal per account.
   **Prior-period carry-forward** (reworked v3.6 — `#filePrev` + `bindPrev`
   → `PRIOR` entry lists {key,cents,date,descA,descB,cat} from the export's
   Only-in-A (col E), Only-in-B (col F), Differences (col G), date col D,
   category col K; empty prior file rejected on purpose). Two-stage:
   `injectPrior(onlyA,onlyB,age)` runs INSIDE runRecon, in both branches,
   BEFORE the matching passes — (1) `markPrior` flags current items that
   were open before, by key+cents first then by cents+date ('#N' keys are
   ROW NUMBERS that shift every month — the original key-only match silently
   failed for every keyless bank item); (2) prior entries NOT found in this
   month's files (monthly bank statements never re-list last month's lines)
   are PUSHED into the pools as first-class items keyed 'B/F <oldkey>'
   (bf+inj flags, category carried) so they can clear against the other
   side, join proposals, or stay open. `finishPrior(RESULT)` then flags
   recurring Differences rows and sets `RESULT.bf = {n: open bf items,
   resolved: carried − n}`. Totals: `totA/totB` INCLUDE injected values
   (summary identity holds); `totAFile/totBFile` exclude them and drive the
   tie-out (the file's footer can't know about carried items). Validated on
   the real 04→05.2026 BOC pair: payroll 3,043,862.78 / 1,369.87 /
   ΩΡΟΜΙΣΘΙΟ 3,043,832.54 all roll forward with their categories.
   **Reconciliation pack** (v3.0, `PACK[]` + `addToPack()`/`exportPack()`):
   'Add to pack' snapshots the current run (labels, totals, counts, open
   items); 'Export pack' writes one workbook — a 'Πακέτο / Pack' summary
   sheet with one row per run, live per-run check formulas
   `ROUND(J-(E+G+I),2)` and a SUM totals row, plus one 'Εκκρεμή n / Open n'
   sheet per run. The pack lives in memory only (lost on reload).
   Re-adding the SAME file pair (`entry.files` match) REPLACES the existing
   line and reports `packUpd` instead of appending a duplicate (v3.2).
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
    inputs), `#amtA/B`, `#crA/B`, `#dateA/B`, `#descA/B`, `#tolerance`,
    `#flipB`, `#signHint`, `#normKeys`, `#nokeyon`/`#nokeydays`,
    `#nearon`/`#nearpct`, `#preparer`, `#runBtn`, `#stepRes`, `#tieInfo`,
    `.kpi .v/.l`, `.preset` (order gen/gl/hio), `#pane-<tab>` + `.catsel`,
    `#btn-el/#btn-en`, `#progFile`, `#filePrev`/`#boxPrev`/`#fnamePrev`/
    `#finfoPrev`, `#resQ`/`#resMin`, `#selInfo`, `#manualBtn`,
    `#saveProf`/`#saveProg`, `#addPackBtn`/`#packBtn`, globals `SIDES`,
    `RESULT`, `PRESETS`, `PACK`, `SUGGESTED_KEY`, functions `exportExcel()`,
    `saveProgress()`, `saveProfile()`, `acceptAllGroups()`, `commitGroups()`,
    `uncommitGroup()`, `matchSelected()`, `toggleSel()`, `inAccepted()`,
    `addToPack()`, `exportPack()`, `renderResults()`, `downloadManual()`,
    `renderSelBar()`, `COLW`, `gripDown()`, `.colgrip`, `td.clip`,
    `table.grid[data-tab]`.

## IC Matrix Tool (src/ic_template.html, v1.5)

Sibling app: every entity's intercompany ledgers in ONE matrix. Shares the
brand, i18n pattern, parsing helpers (parseAmount, parseDateVal, normKey,
D/C netting `netA`, footer-total exclusion in `computeBalance`) — copied,
not imported; keep fixes in sync when touching shared logic.

- **Model**: `FILES[]` — one file per RELATIONSHIP (entity X's ledger about
  entity Y). Each card sets entity ('Books of') + cp ('About'), sheet,
  header row, amount/credit/date/desc (auto-guessed). `ENTITIES[]` registry,
  names 'Ελληνικά / English' (`entLabel` picks by LANG), editable, persisted
  in the progress JSON.
- **Pairing** (`runMatrix`): X-about-Y pairs with Y-about-X; a relationship
  declared twice is an error; unpaired files land in `MATRIX.singles`.
  **One-to-many** (v1.3): a card's «Έναντι» select has a «Πολλοί
  αντισυμβαλλόμενοι…» option (value `'*'` → `f.cpMode='multi'`): the user
  picks the column that identifies the counterparty (`f.cpCol`, e.g. the GL
  account or trading partner) and maps its distinct values to entities
  (`f.cpMap`, auto-guessed by registry-name overlap, top-40 shown).
  `expandFiles()` splits such a file into VIRTUAL files (one per mapped
  entity, name suffixed ' — <entity>', footer rows excluded first, balance
  = subset sum); unmapped/blank/self rows are counted and reported in
  `#runInfo` — never silently dropped. `MATRIX.filesUsed` carries the
  expanded list (doc sheet iterates it). Progress persists
  cpMode/cpCol/cpMap per filename and `applyPendingFile` restores them.
- **Per-pair matching** (`matchPair`): `pairKeySuggest` picks the key column
  pair by value overlap (≥0.5, ≥3 values, amount/date columns excluded) —
  if none, pure line mode. Keyed aggregates match on equal sum within
  tolerance; leftovers + keyless rows line-match on amount within tolerance
  + date within ± days (cent buckets). `mirror` (default ON) flips side Y.
  Invariant: `raw = balX − balY` and `residual = ΣopenX − ΣopenY`;
  matched-net is DERIVED as raw − residual so the matrix check row is exact.
  `matched[]` RETAINS every match ({key, descX, descY, date, ax, ay}) —
  v1.2 was forced by a real run where everything on side Y matched: the
  user saw an empty Y table and read it as "no numbers load for Y". The
  drill shows a collapsible 'Συμφωνημένες εγγραφές' table (capped at 800
  rows on screen, full list in the export).
- **Matrix UI** (v1.1 semantics — IMPORTANT): a pair's difference is fully
  itemised BY CONSTRUCTION, so "residual ≤ tol" is the WRONG green test
  (real IC pairs almost always keep timing items — the first real run showed
  the perfectly reconciled HO⇄Limassol 11,995,952.00 as a red 'unexplained'
  cell). `pairState(p)` drives everything: green ✓ = every open item
  CATEGORISED (sign-off state; net open amount shown under the ✓), red =
  n uncategorised items (amount + count shown; click → drill), grey =
  missing counterparty file (one-sided balance). `setCat`/`bulkCat` re-render
  the KPIs and matrix live; each drill table has a 'Categorise all' bulk
  select that fills only blank categories.
- **Export**: each pair sheet = open-items block (rows 2..lastOpen) THEN a
  blank row, a 'ΣΥΜΦΩΝΗΜΕΝΕΣ ΕΓΓΡΑΦΕΣ (n)' title, a header and the matched
  rows (E=amt X, F=amt Y, G live '=Er-Fr'). 'Πίνακας' sheet — per pair:
  B/C cached balances, D=B−C, E=LIVE SUM over the matched block
  (E{mStart}:E{mEnd} minus F...), F/G=SUM over the OPEN block only
  (E2:E{lastOpen} — never whole columns, the matched block sits below),
  H=F−G, I=ROUND(D−(E+H),2) must be 0, J=COUNTBLANK(G2:G{lastOpen})
  (uncategorised count, live); H and J fill green when fully categorised,
  red otherwise; totals row; singles listed with a note. Ranges come from
  `p._mRange` set while writing the pair sheet.
  Pair sheets 'Pn X⇄Y' (sanitized ≤31 chars): Side/Key/Desc/Date/Amt X/
  Amt Y/Category, category tints, autofilter. Documentation sheet lists every
  file's setup + balances + footer exclusions + preparer/reviewer lines.
- **Progress JSON** (`app:'okypy-ic'`): registry, settings, per-file setup
  keyed BY FILENAME (entity/cp/sheet/hdr/map — applied when a file with the
  same name loads, `applyPendingFile`), categories keyed
  `entX|entY|side|key|cents`. Monthly workflow: load progress → add files →
  everything self-assembles.
- **Test contract** (test_ic.js): `#fileAdd` (multiple), `#progFile`,
  `#tolerance`, `#days`, `#mirror`, `#runBtn`, `#stepMx`, `#drill`,
  `table.mx td.ok/.bad/.miss`, `.kpi .v`, `.catsel`, globals `FILES`,
  `ENTITIES`, `MATRIX`, `SELPAIR`, functions `runMatrix()`, `renderMatrix()`,
  `renderDrill()`, `exportExcel()`, `saveProgress()`, `entLabel()`,
  `renderCards()`, `downloadManual()`.
- **Greek copy rule** (v1.2): entity names are interpolated NOMINATIVE-only
  — never write templates that put a name after an article in another case
  («Τα βιβλία του {e}» broke on «Κεντρικά Γραφεία»). Card labels are
  «Βιβλία» / «Έναντι» ("Books" / "Versus"); balances read
  «{e} — δηλωμένο υπόλοιπο». Keep any new string genitive-safe.
- test_ic description-fallback block: dh_A/dh_B (Text blank on D1/D3,
  Document Header Text filled) → matched descX/descY carry the header
  texts; auto-guess still picks 'Text'. Same fixture drives the pairwise
  check in test_v4 (RESULT.matched descA/descB).
- test_ic one-to-many block: mx_ho_all.csv (Account column: 122113→ΓΝ
  Λεμεσού, 122140→ΓΝ Λάρνακας, 129999 unmapped) + mx_lim_ho + mx_lar_ho →
  2 pairs (LIM residual 30, LAR ties out), 0 singles, virtual names carry
  ' — <entity>', runInfo reports the 1 unmapped row; progress round-trip
  restores the split (cpMode/cpCol/cpMap) and rebuilds the same 2 pairs.
- v1 limitations: matching keys are auto-only (no manual key pick per pair);
  no split/N-to-M proposals inside the matrix (use the pairwise tool for
  deep work on one pair — the manuals cross-reference); no carry-forward.

## Backlog

- Per-pass tolerance overrides.
- Optional PDF export of the summary for sign-off circulation.
- IC Matrix: manual key override per pair, split proposals in the drill,
  prior-month carry-forward, confirmation-letter sheet per pair.

## Known limitations (v3.3)

- Split search proposes 1-to-N only, same-sign combinations only; N-to-M
  groups come solely from the same-day pass, in no-key runs, exact date only.
- Easy-pair twins require the amount to be UNIQUE among each side's open
  items (exact cents); repeated amounts are deliberately left for the user.
  Reversals pair exact-cent opposites only.
- Column widths (`COLW`) are per-session — they reset on page reload; that
  is intentional (no localStorage).
- Pass 2 matches dated items with dated items (window) and undated with
  undated (amount only) — never mixed.
- Key suggestion samples the first 3,000 rows per file.
- Progress JSON matches items by key: if the mapping or files change, stale
  entries are ignored silently. Progress files saved before v2.8 used
  sheet-row `#` labels and their keyless entries no longer apply.
- Carry-forward matches prior open items by `key|cents` exactly — an item
  whose amount changed since last period is treated as new.
- The reconciliation pack is in-memory only; reloading the page clears it.
- The downloadable user manual (MANUAL dict, `downloadManual()`) generates
  in the ACTIVE language; its Greek follows native public-sector register and
  its English plain human prose — keep that tone when editing it.
- Header auto-detect (both tools, v3.9/v1.5) scans the first 25 rows and
  prefers the FIRST row with ≥4 text cells, falling back to ≥2 — bank
  statement preambles ('Period:', 'Other Period') used to win with 2 cells;
  merged-cell double-row headers still need the manual header-row override.
