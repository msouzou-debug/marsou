# Capex plan migration — mapping spec

Replaces §9 of `OKYPY-CAPEX-01-Claude-Code-Build-Brief.md` with the concrete mapping for the first source file. Written against `MASTER_FILE - ΑΝΑΠΤΥΞΙΑΚΟΣ ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ - Αναθεώρηση Budget 2026`, sheet `Α)Capex Plan-Updated - clean`, as at February 2026 revision.

## 0. Correction to the first read

My earlier figures counted three footer rows as projects. Corrected, and these are the numbers the import must reproduce:

| | Earlier (wrong) | Correct |
|---|---|---|
| Project rows | 116 | **113** |
| Estimated total cost (col O) | €311.2m | **€275,087,583** |
| Actual to 03/2026 (col S) | €124.3m | **€101,113,949** |
| Rows failing the total tie | 6, €38.2m | **3, €1,394,309** |
| Rows with no estimated cost | 18 | **15** |
| Rows with no ΑΡΘΡΟ | 20 | **17** |

Rows 123 (ΣΥΝΟΛΟ), 126 (ΑΠΟΖΗΜΙΩΣΗ ΑΠΌ ΣΑΑ) and 128 (ΔΑΠΑΝΗ ΝΕΤ) are a footer block, not projects. The large negatives in the file all come from row 128.

Spend profile the import must reproduce: 2026 €65,224,025 · 2027 €62,897,204 · 2028 €44,630,443 · after 2028 €2,616,272 · column Y total €276,481,892. Prior vintage (cols AF–AJ): 2025 €71,591,105 · 2026 €66,004,161 · 2027 €42,672,530 · total €184,237,797.

## 1. Row classification

Read rows 6 to 118 of the sheet. For each row:

- No value in column E (ΕΡΓΟ) → skip silently.
- Column E in {ΣΥΝΟΛΟ, ΑΠΟΖΗΜΙΩΣΗ ΑΠΌ ΣΑΑ, ΔΑΠΑΝΗ (ΝΕΤ)} or columns A–D all empty → classify as `FOOTER`, log, do not import. Do not hardcode row numbers; the next revision will move them.
- Otherwise → `PROJECT`.

Expect 113 PROJECT and 3 FOOTER. If the counts differ, stop and report rather than import.

## 2. Column mapping

Excel columns are given by letter and by the index the importer sees.

| Col | Header | → Target | Transform / rule |
|---|---|---|---|
| A (1) | ΚΑΤΗΓΟΡΙΑ ΔΑΠΑΝΗΣ | `project.category` | Only value present is «Αναπτυξιακά Έργα» → `CAPITAL_WORKS`. Blank on 9 rows → default `CAPITAL_WORKS`, flag V03 |
| B (2) | Α/Α | `project.source_row_ref` | Reference only, never the key. 7 rows hold text, 4 are blank |
| C (3) | Διεύθυνση | `org_unit.directorate` | Lookup §3 |
| D (4) | ΝΟΣΟΚΟΜΕΙΟ | `project.hospital_id` | Lookup §3. Three rows blank → V04 |
| E (5) | ΕΡΓΟ | `project.title_el` | Trim, collapse whitespace, strip the trailing parenthetical note into `project.note_el` where it starts with «μικρές ανάγκες» or similar. Natural key = `hospital_id` + normalised title |
| F (6) | ΑΡΘΡΟ | `project.budget_article` | Domain {08021, 08022, 08023}. One row holds «ΟΧΙ» → null + V05. 17 blank → V05 |
| G (7) | — | — | Empty column, ignore |
| H (8) | Δεσμεύσεις ΠτΚΔ? | `project.commitment_flag` + `project.commitment_note` | «ΝΑΙ - €129.5» → flag true, note «€129.5». Never parse the euro figure as an amount; it is a reference to a Council of Ministers decision value, not this project's cost |
| I (9) | Στο Σχέδιο Δράσης? | `project.action_plan_ref` | «ΝΑΙ - 13.28» → true + ref «13.28» |
| J (10) | Προϋπολογισμός 2026? | `project.in_budget_2026` | ΝΑΙ → true. «ΝΑΙ (μόνο δαπάνη 2026)» → true + note |
| K (11) | Συμβατική Υποχρέωση | `project.contractual_commitment` | ΝΑΙ → true (38 rows) |
| L (12) | Χρηματοδότηση από 3ους? | `project.funding_source` | «ΣΑΑ» → `RRF` (Σχέδιο Ανάκαμψης και Ανθεκτικότητας). Blank → `STATE_BUDGET` |
| M (13) | Ποσό Χρηματοδότησης | `project.external_funding_amount` v1 | 16 rows, €69,222,423 |
| N (14) | Ποσό Χρηματοδότησης (Αναθεωρημένο) | `project.external_funding_amount` v2 | 15 rows. **Do not import before V12 clears** — the column sums €141.9m with a €70.9m maximum, larger than any single project's cost |
| O (15) | ΕΚΤΙΜΩΜΕΝΗ ΣΥΝΟΛΙΚΗ ΔΑΠΑΝΗ (incl. VAT) | `project.approved_budget` | Amount incl. VAT. 15 rows blank → V02 |
| P (16) | Ημερομηνία έναρξης | `project.planned_start` | One row holds text → V06 |
| Q (17) | Ημερομηνία ολοκλήρωσης | `project.planned_finish` | One row holds text → V06 |
| R (18) | % Υλοποίησης | **do not import** | Derived field with three different formula variants in the same column (§6). Recompute as `actual ÷ approved_budget` |
| S (19) | Πραγματική δαπάνη από αρχή έργου μέχρι 03/2026 | `cost_txn` one row, `txn_type = ACTUAL`, `source = EXCEL_MIGRATION` | Cumulative to 31/03/2026, not a 2026 figure despite the header. Post as a single opening balance dated 2026-03-31 |
| T (20) | Εκτιμώμενη δαπάνη υπόλοιπο 2026 | ignore | One populated cell, value 0. Column abandoned |
| U (21) | ΔΑΠΑΝΗ 2026 | `budget_line` year 2026, vintage `2026-02` | Forecast, not budget. Load as `budget_line.type = FORECAST` |
| V (22) | ΔΑΠΑΝΗ 2027 | `budget_line` year 2027, vintage `2026-02` | |
| W (23) | ΔΑΠΑΝΗ 2028 | `budget_line` year 2028, vintage `2026-02` | One row holds text → V06 |
| X (24) | ΔΑΠΑΝΕΣ ΜΕΤΑ ΤΟ 2028 | `budget_line` year 9999, vintage `2026-02` | Sentinel year for "beyond horizon" |
| Y (25) | ΣΥΝΟΛΟ | **do not import** | `=SUM(S:X)`. Recompute and use for V01 |
| Z (26) | TOTALS CHECK | **do not import** | Source's own check. Two of its formulas are misreferenced (§6). Replace with V01 |
| AA (27) | ΣΤΑΔΙΟ ΥΛΟΠΟΙΗΣΗΣ | `project.phase` | §4 |
| AB (28) | Αναθεωρημένη ημ. έναρξης | `project.forecast_start` | 26 dates, 7 text values → V06 |
| AC (29) | Αναθεωρημένη ημ. ολοκλήρωσης | `project.forecast_finish` | 38 dates, 6 text values → V06 |
| AD (30) | Σχόλια από Τεχνικό Τμήμα | `project_note` (one row, `kind = TECHNICAL`, dated at import) | 74 rows, some over 1,000 characters. Keep verbatim; these are the delay narratives and they are the only audit trail of why dates moved |
| AE (31) | Αρχείο Εσωτερικού Ελέγχου | `project.internal_audit_file` | ΝΑΙ → true (78 rows) |
| AF–AI (32–35) | ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ 2025 / 2026 / 2027 / μετά το 2027 | `budget_line` vintage `2025-prior` | The superseded vintage. Import as a closed version so variance against it is reportable |
| AJ (36) | ΣΥΝΟΛΟ | do not import | `=SUM(AF:AI)`, recompute |

Three rows in columns AG and W hold text where a number belongs. They are string-typed cells, so the importer must reject them rather than coerce to zero.

## 3. Organisational lookup

The source mixes hospitals with services. Eleven distinct values in column D; some are not hospitals at all.

| Source value | Rows | Maps to | Type |
|---|---|---|---|
| Γ.Ν. ΛΕΥΚΩΣΙΑΣ | 20 | Nicosia General | HOSPITAL |
| Γ.Ν. ΛΑΡΝΑΚΑΣ | 14 | Larnaca General | HOSPITAL |
| Γ.Ν. ΠΑΦΟΥ | 13 | Paphos General | HOSPITAL |
| Γ.Ν. ΛΕΜΕΣΟΥ | 13 | Limassol General | HOSPITAL |
| ΝΟΣΟΚΟΜΕΙΟ ΤΡΟΟΔΟΥΣ | 12 | Troodos | HOSPITAL |
| ΔΥΨΥ | 11 | Mental health services | SERVICE |
| ΝΑΜΙΙΙ | 9 | Archbishop Makarios III | HOSPITAL |
| ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΕΩΣ ΧΡΥΣΟΧΟΥΣ | 7 | Polis Chrysochous | HOSPITAL |
| Γ.Ν. ΑΜΜΟΧΩΣΤΟΥ | 5 | Famagusta General | HOSPITAL |
| ΠΡΩΤΟΒΑΘΜΙΑ ΦΡΟΝΤΙΔΑ ΥΓΕΙΑΣ | 5 | Primary healthcare | SERVICE |
| ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ | 4 | Ambulance service | SERVICE |

Consequence for the data model: `hospital` must become `org_unit` with a `type` of HOSPITAL or SERVICE, or three services get modelled as pseudo-hospitals and every report that says "per hospital" quietly lies. Take the first option — it is a one-line change now and a migration later.

Directorate (column C) is a grouping above the unit: ΛΕΜΕΣΟΥ–ΠΑΦΟΥ 44, ΛΕΥΚΩΣΙΑΣ 29, ΛΑΡΝΑΚΑΣ–ΑΜΜΟΧΩΣΤΟΥ 19, ΔΥΨΥ 11, ΠΦΥ 5, ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ 4. Store as `org_unit.directorate`, do not derive it from the unit — Troodos sits under Λεμεσού–Πάφου and nothing in the name says so.

Both lookups ship as seed data with an `alias` table, because the next revision of the spreadsheet will spell at least one of these differently.

## 4. Status mapping

| Source | → `project.phase` | Count |
|---|---|---|
| ΣΤΑΔΙΟ ΠΡΟΕΤΟΙΜΑΣΙΑΣ | `PREPARATION` | 70 |
| ΣΕ ΕΞΕΛΙΞΗ | `IN_PROGRESS` | 21 |
| ΟΛΟΚΛΗΡΩΘΗΚΕ | `COMPLETED` | 22 |
| blank | `PREPARATION` + flag | 3 (all footer rows) |

The source has three states where the target model has nine. Preparation covers everything from idea to signed contract, which is why one row is flagged contractually committed while still sitting in preparation. Post-migration, anything with a contract moves to `AWARDED` or beyond, and that reclassification is the first real job the system does.

## 5. Validation rules

Run on every import. Severity: ERROR blocks the row, WARN imports it flagged, INFO is logged only.

| ID | Rule | Severity | Observed now |
|---|---|---|---|
| V01 | Estimated total (O) = actual (S) + forecast years (U:X), ±€10 | WARN | 3 rows, net €1,394,309 — rows 39 (ΕΠΕΚΤΑΣΗ ΤΑΕΠ ΛΕΥΚΩΣΙΑΣ, €515,565), 56 (ΑΝΑΚΑΙΝΙΣΗ ΤΑΕΠ, €878,742), 99 (€2 rounding) |
| V02 | Estimated total present and > 0 | WARN | 15 rows |
| V03 | Category present | INFO | 9 rows |
| V04 | Hospital/unit present and resolves in the lookup | ERROR | 3 rows (footers only) |
| V05 | ΑΡΘΡΟ present and in {08021, 08022, 08023} | WARN | 18 rows (17 blank + 1 «ΟΧΙ») — these cannot be reconciled to SAP |
| V06 | Date and amount cells are typed correctly, not text | ERROR | 2 date cols, 13 text cells, 3 amount cells |
| V07 | Planned finish ≥ planned start; forecast finish ≥ forecast start | ERROR | 0 |
| V08 | Phase = COMPLETED implies actual ≥ 95% of estimated total | WARN | 1 row (row 56, 79%) |
| V09 | Phase = PREPARATION and contractual commitment = true | WARN | 1 row |
| V10 | Actual spend ≥ 0 | ERROR | 0 after footer exclusion |
| V11 | Sum of imported rows ties to the file's own footer total | ERROR | Run at batch level |
| V12 | External funding amount ≤ estimated total cost per row | ERROR | Column N fails — resolve before importing that column |
| V13 | Natural key (unit + normalised title) is unique | ERROR | 0 duplicates |
| V14 | Forecast year columns are non-negative | WARN | 0 after footer exclusion |

Nothing gets fixed in the spreadsheet. The exceptions go into the import report, someone at Technical Services resolves them in the system, and the resolution is logged with a name against it. That is the point of moving off Excel.

## 6. Defects found in this specific file

Worth raising with whoever maintains it, independently of the migration:

1. **Row 20** — TOTALS CHECK reads `=ROUND(Y20,-1)=ROUND(O21,-1)`, comparing row 20's total against row 21's estimated cost. Reports FALSE on a row that actually ties.
2. **Row 22** — same defect in TOTALS CHECK, plus `% Υλοποίησης` reads `=IFERROR(S22/O23,0%)`, dividing row 22's spend by row 23's budget.
3. **Column R has three formula variants.** Most rows read `=IF(AA{r}="ΟΛΟΚΛΗΡΩΘΗΚΕ",100%,IFERROR(S{r}/O{r},0%))`; row 56 still carries an older version without the completed branch, which is why a completed project shows 79%.

All three come from rows being inserted after the formulas were written. This is the ordinary failure mode of a 116-row shared workbook and the reason the register should not stay in one.

## 7. What the spreadsheet cannot carry

The migration imports what exists. These fields stay empty and are filled in the system afterwards, per project:

- Contractor and contract (value, dates, retention, bond, LDs) — from the contract files
- Commitments — from SAP ME2N once ingestion runs
- Actual spend by year rather than one cumulative figure to 03/2026 — from SAP KSB1/FBL5N history
- Forecast final cost and cost-to-complete — derived once commitments exist
- The asset the project creates — links at handover
- Milestones, risks, issues — currently living in the ΣΧΟΛΙΑ free text

Practical sequence: import, then for the 21 in-progress projects attach the contract and let SAP fill the cost columns. The 70 in preparation need nothing else to be useful on day one.

## 8. Import profile

Ship the mapping as a versioned YAML, not code, so the next revision of the spreadsheet is a config change:

```yaml
profile: capex_plan_2026_02
sheet: "Α)Capex Plan-Updated - clean"
header_row: 4
first_data_row: 6
last_data_row: auto            # stop at 20 consecutive blank column-E rows
footer_titles: ["ΣΥΝΟΛΟ", "ΑΠΟΖΗΜΙΩΣΗ ΑΠΌ ΣΑΑ", "ΔΑΠΑΝΗ (ΝΕΤ)"]
natural_key: [hospital, title_normalised]
budget_vintages:
  - { id: "2026-02", type: FORECAST, columns: { 2026: U, 2027: V, 2028: W, 9999: X } }
  - { id: "2025-prior", type: BUDGET, columns: { 2025: AF, 2026: AG, 2027: AH, 9999: AI } }
opening_actual: { column: S, as_at: 2026-03-31 }
ignore_columns: [G, R, T, Y, Z, AJ]
```

## 9. Reconciliation report

Every run produces one page, in Greek, before anything is committed to the database:

- Rows read, classified PROJECT / FOOTER / SKIPPED
- Rows created, updated, rejected
- Value totals per column against the source file, to the cent, with a pass/fail per column
- Exceptions by rule, each with row number, project title and the offending value
- A diff against the previous import: projects added, removed, amounts changed by more than €1,000

The importer commits only if V04, V06, V07, V10, V11, V12 and V13 all pass. Everything else imports flagged.

## 10. Other sheets in the file

Not in this scope, flagged for a second pass:

- `Β) Ιατρικοτ. Εξοπλισμός` — 199 rows, €60.1m of medical equipment, already linked to the project it belongs to. This is the biomedical seed for the asset register.
- `Αναγκαιότητα Έργων - Ανάλυση` — the prioritisation view, carrying the RRF flag and ΣΑΑ amounts per project. Closest thing you have to a scoring model; worth turning into the criticality fields rather than rebuilding from scratch.
- `Γ) ΟΠΣΥ ΙΙ`, `Δ) Άλλος Εξοπλισμός`, `IT Details`, `Προϋπολογισμός Πληροφορικής` — IT and other equipment, separate category, same treatment.
