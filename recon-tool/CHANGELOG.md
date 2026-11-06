# Changelog

Every iteration gets its own version. The number is shown in the tool's
header badge and footer, stamped into every exported workbook (row
«Έκδοση εργαλείου / Tool version» of the documentation sheet), into the
export file name (`…_v3.20.xlsx`) and into progress/profile files
(`tool` field). Delivered files are named `OKYpY_Reconciliation_Tool_v3.20.html`.

## Reconciliation Tool (OKYpY_Reconciliation_Tool.html)

| Version | Date | Change |
|---|---|---|
| v3.21 | 2026-11-06 | Table headers are no longer forced to capitals: Greek column names keep their accents and case (CSS uppercasing left the tonos on capitals — ΠΕΡΙΓΡΑΦΉ). |
| v3.20 | 2026-11-06 | Version stamping: single `APP_VERSION`, header badge, version in export file name and documentation sheet, this changelog. |
| v3.19 | 2026-11-06 | Carry-forward no longer takes last month's row number as an identity (a September deposit vanished behind October's row 9); exact same-day batches stand aside when a 1-to-1 partner exists and "family minus 1–2 lines" only for targets ≥ €500. |
| v3.18 | 2026-10-22 | When the tool switches itself to line-by-line mode it also clears the guessed key columns. |
| v3.17 | 2026-10-20 | Sensible defaults: no near-constant key columns, automatic line-by-line mode when the files share no key, card/day-batch pass on by default, exact batches pre-ticked. |
| v3.16 | 2026-10-16 | Documentation sheet reports pass 2 as the main pass in no-key runs. |
| v3.15 | 2026-10-16 | Pass 2 pairs reference-linked lines first, then name-linked (Greek/Latin transliteration), then nearest date. |
| v3.14 | 2026-10-16 | Reference numbers (terminal, UN/EP, invoice) link lines across sides; guard against coincidental cross-date splits; adjusted pairs confined to the day window. |
| v3.13 | 2026-10-16 | Day batches minus one or two lines; group labels reflect the group (card settlement / same-day batch / day batch to check). |
| v3.12 | 2026-10-16 | Card groups absorb the ledger's own commission line (zero difference). |
| v3.11 | 2026-10-16 | Lone-line card proposals labelled "small difference — check". |
| v3.10 | 2026-10-16 | Exact same-day batches reserved before the 1-to-1 passes; letters-only description families. |
| v3.9 | 2026-10-16 | JCC/POS card-settlement pass; bank statement header auto-detect. |
| v3.8 | 2026-10 | Unmatch button for wrong automatic matches. |
| v3.7 | 2026-10 | Many files per side. |
| v3.6 | 2026-10 | Carry-forward injects prior open items not found in the current files. |
| v3.5 | 2026-10 | Search and select-all for manual matching. |
| v3.4 | 2026-10 | Description fallback chain in exports. |
| v3.3 | 2026-10 | Pair with adjustment line (FX/rounding). |
| v3.2 | 2026-10 | Fee sweep (one GL entry vs many small bank lines), pack dedupe, live warnings. |
| v3.1 | 2026-10 | Adjustable columns, no scroll jump, twins and reversals. |

## IC Matrix Tool (OKYpY_IC_Matrix_Tool.html)

| Version | Date | Change |
|---|---|---|
| v1.11 | 2026-11-06 | Matrix and table headers show entity names as written («ΓΝ Λευκωσίας»), no CSS capitals (which produced ΓΝ ΛΕΥΚΩΣΊΑΣ with a tonos on the capital). |
| v1.10 | 2026-11-06 | Registry rebuilt from the SAP Chart of Accounts («Company Codes» sheet): 1000 HO, 1001 ΥΠΑΣ, 1002 ΔΠΦΥ (Health Centres), 1003 ΔΥΨΥ, 1020 Nicosia GH, 1021 Makarios III, 1030 Limassol, 1031 Pafos, 1032 Troodos, 1033 Polis Chrysochous, 1040 Larnaca, 1041 Ammochostos. The 1221xx intercompany accounts fill in «Έναντι» (one account → one counterparty; several → split by the Account column, mapped). |
| v1.9 | 2026-11-06 | Registry: company codes for all hospitals and Head Office — 1000 HO, 1010 Nicosia, 1021 Makarios III, 1030 Limassol, 1032 Troodos, 1040 Larnaca, 1050 Pafos, 1060 Ammochostos (codes supplied by the user). |
| v1.8 | 2026-11-06 | Registry: Head Office carries company code 1000 (from the GL 122105 benchmark); codes known so far: 1000 HO, 1021 Makarios III, 1030 Limassol, 1032 Troodos — the rest to be entered once in the register. |
| v1.7 | 2026-11-06 | Default-settings check: a file whose SAP «Company Code» column carries one value gets its «Books» entity pre-filled from the registry (names may end in the company codes, e.g. «ΓΝ Λεμεσού / Limassol GH (1030)»); card shows the code. |
| v1.6 | 2026-11-06 | Version stamping (badge, documentation row, export file name, progress file). |
| v1.5 | 2026-10-16 | Header auto-detect prefers the first row with four or more text cells. |
| v1.4 | 2026-10 | Description fallback chain in exports. |
| v1.3 | 2026-10 | Multi-counterparty files split by column. |
| v1.2 | 2026-10 | Matched entries visible and exported; Greek wording fixes. |
| v1.1 | 2026-10 | Green = every open item categorised; bulk categorise. |
| v1.0 | 2026-10 | First release. |
