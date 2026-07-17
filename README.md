# CY-DRG Lookup — ΟΚΥπΥ

A standalone, single-file, offline HTML tool for OKYpY clinical coders: search the
CY-DRG catalogue by code or keyword, see everything about a DRG on one card, compute
the indicative € amount, collect results in a persistent list and export them to Excel.

**Deliverable:** [`CY-DRG-Lookup.html`](CY-DRG-Lookup.html) (~950 KB). Open it by
double-clicking or from a network share — no server, no install, no internet needed.

## ⚠ Data status — sample only

The embedded catalogue (22 rows) and the base-rate table are **clearly-labelled sample
data**, created so the tool is fully testable. They are **not** the official
«ΚΥΠΡΙΑΚΟΣ ΚΑΤΑΛΟΓΟΣ DRG — CY-DRG Version 2». The tool shows a permanent warning
banner while sample data is active. Loading the real catalogue needs **no code change**:
either upload it via the built-in «Συντήρηση» panel (template provided by the tool), or
replace the `EMBEDDED_CATALOGUE` / `EMBEDDED_BASE_RATES` arrays in
`src/CY-DRG-Lookup.src.html` and rebuild, then redistribute the file.

## Repository layout

| Path | Purpose |
|---|---|
| `CY-DRG-Lookup.html` | Built, self-contained deliverable |
| `src/CY-DRG-Lookup.src.html` | Source (all UI, logic, i18n, embedded data) |
| `vendor/xlsx.full.min.js` | SheetJS 0.18.5 (Apache-2.0), embedded at build time |
| `build.js` | Assembles the deliverable: `node build.js` |

## Features (per the build brief)

- Bilingual EL/EN with toggle (EL default); all strings and the manual exist in both.
- Search: code prefix (`s63` → S63A, S63B) and keywords, accent- and case-insensitive
  (νοσος = νόσος = ΝΟΣΟΣ), all words in any order; partition (Χ/Π) and MDC filters.
- Detail card: all catalogue fields, LOS band (lower bound — ΜΔΝ — upper bound),
  hospital selector with base rate, and a LOS input showing the full arithmetic for
  inlier / short-stay / long-stay / transfer cases, labelled «Ενδεικτικός υπολογισμός —
  δεν υποκαθιστά τον grouper του ΟΑΥ».
- Basket persisted in localStorage with badge; Excel export (`CY-DRG_Λίστα_{yyyy-mm-dd}.xlsx`)
  with bilingual header rows; export does not clear the basket.
- Maintenance panel: template download (with an «Οδηγίες» sheet), validated .xlsx/.csv
  upload (missing columns, duplicate codes, non-numeric values and bad partitions are
  rejected with the exact row/column named), version metadata shown in the footer,
  restore-embedded, round-trip catalogue export, editable base rates.
- Manual: in-tool, bilingual, with one worked example per payment case;
  «Λήψη οδηγιών (PDF)» opens a print-optimised view (choose "Save as PDF").
- Greek typography: monotonic, Greek question mark «;» (U+037E), άνω τελεία,
  1.234,56 € number format, DD/MM/YYYY dates.

## Payment arithmetic (assumptions to confirm with ΟΑΥ)

Following the G-DRG conventions the CY-DRG system derives from:

- **Short stay** (LOS ≤ 1st day with reduction): days = `lo_first + 1 − LOS`,
  CW′ = CW − days × `lo_cw_day`.
- **Long stay** (LOS ≥ 1st day with surcharge): days = `LOS − hi_first + 1`,
  CW′ = CW + days × `hi_cw_day`.
- **Transfer** (ticked, DRG not exempt, LOS < rounded ΜΔΝ, and not already short-stay):
  days = `round(alos) − LOS`, CW′ = CW − days × `transfer_cw_day`.
- Amount = CW′ × base rate; CW′ clamped at 0.

The short-stay rule takes precedence over the transfer rule when both apply — this
precedence and the exact day-counting conventions should be confirmed against the ΟΑΥ
rules before production use.

## Build & test

```bash
node build.js          # writes CY-DRG-Lookup.html
```

A Playwright acceptance suite (48 checks: search semantics, hand-computed payment
examples, Excel export content, upload validation/restore cycle, persistence,
bilingual toggle) was run against the built file in headless Chromium — all passing.

## Open items for the operator (brief §8)

1. **Official CY-DRG v2 table** — extract per the template («Λήψη προτύπου» in the
   tool), validate the row count against the official document, then embed or upload.
2. **Base-rate list per hospital** — the embedded list is a sample (uniform 2.565,00 €);
   confirm hospitals, values, and whether they may be embedded.
3. **Official version label** to display (e.g. «CY-DRG v2, 17η αναπροσαρμογή»).
4. **OKYpY logo** — a styled text placeholder is used (`brand-mark` block, marked
   `LOGO-PLACEHOLDER` in the source); swap in the official base64 logo.
5. **Catalogue maintainer name/role** — placeholder in manual §6 to fill in.
6. Confirm the payment-arithmetic assumptions above; optionally replace the
   print-based PDF manual with a pre-generated embedded PDF once real screenshots exist.
