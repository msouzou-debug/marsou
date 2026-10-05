# ΤΑΕΠ Non-GESY Patient Costing Tool

ΟΚΥπΥ / SHSO — module of the eFinance portal.
Turns the services ticked on form ΟΚΥπΥ 1-125 into a priced, numbered, printable
Κοστολόγηση Περιστατικού for patients who are not GESY beneficiaries.

## Status — Phase 1, analysis stage

| | |
|---|---|
| Seed data loaded | yes, `seed/` |
| Data-quality findings | `docs/phase1-data-quality-memo.md` |
| Overlap decision list | `docs/overlap_decision_list.xlsx` (41 pairs, awaiting Μονάδα ruling) |
| Stack decision | answered — `docs/adr/001-application-stack.md` |
| Μονάδα rulings | applied (22/09 – 02/10) — `docs/monada-rulings.md` |
| Costing engine | built, pure, golden €120 case green |
| Schema + seed loader | built; loads clean from the source catalogue |
| Phase 2 clerk path | built — entry, costing, finalisation, printed PDF |
| Phase 3 administration | built — rates, tariff Excel round trip, list export, cancellation |
| Phase 4 rollout | acceptance scenarios, readiness check, runbook, clerk guide |
| Tests | 323 green (`python3 -m pytest -q`) |

**Pricing model**, per the Μονάδα's ruling of 22/09/2026: weight maps straight to an
amount — 4→€60, 8→€120, 12→€180, national, no per-category unit price. Tariff charges
apply only to self-paying categories (600, 602, 640). Triage is €10, its own
amount rather than part of the scale. Registration fee is €10 for 603, 605
and 608 and zero elsewhere; the €100 on 600 is a deposit paid against the bill, not a
charge added to it. Costing numbers belong to the **ΤΑΕΠ
unit**, not the hospital: eight units across seven eFinance entities, with Γενικό
Νοσοκομείο Λευκωσίας running two (adults 1054, paediatrics 1106). See
`seed/taep_units.csv`. The sequence is per unit; access control stays per entity.

The build brief (§14 Q1) said inspect eFinance before Phase 1, and offered a Next.js/PostgreSQL
build or an ASP.NET Core/SQL Server one. It is neither. eFinance is a **Flask / Python** application
on MySQL with Active Directory auth, in build since July 2026. The ΤΑΕΠ tool becomes `taep.py`, a
module inside it, following the binding module contract in that repo's `DESIGN.md`. ADR-001 records
what that changes — seven items, including a Postgres exclusion constraint the brief relies on that
MySQL cannot provide.

## Layout

```
taep.py            the eFinance module: engine (pure) · schema · seed · queries ·
                   persistence · routes · the printed document
templates/         Greek templates — clerk path and administration
conftest.py        test harness: real SQLite + a real Flask app
test_taep.py       the pure engine
test_taep_db.py    seed loader, rates, costing-number allocation
test_taep_episode.py  the episode lifecycle
test_taep_routes.py   the clerk path end to end, including the PDF
test_taep_rates.py    rate administration and its concurrency
test_taep_excel.py    the tariff Excel round trip and the export
test_taep_admin_routes.py  the administration screens
test_taep_readiness.py     the go-live check, each test breaking one thing
acceptance.py              the 25 acceptance scenarios, in Greek
test_acceptance.py         runs them under pytest
taep_harness.py            the runnable environment both consumers share
seed/         master data, generated from seed/source/ — do not hand-edit
seed/source/  the authoritative A&E catalogue workbook
tools/        import_catalogue.py, apply_monada_rulings.py, make_questions_doc.py
docs/         deliverables and the ruling record
docs/adr/     architecture decision records
```

Rebuild the seed from the catalogue after any change to it:

```
python3 tools/import_catalogue.py      # services.csv + care_levels.csv
python3 tools/apply_monada_rulings.py  # flags on financial_categories.csv
python3 tools/build_tariff.py          # tariff.csv, with the multi-tier splits
python3 tools/build_taep_units.py      # taep_units.csv, the eight ΤΑΕΠ units
```

All three are idempotent and all read from `seed/source/`. Everything directly under
`seed/` is generated — edit the sources, not the CSVs.

## Tests

```
python3 -m pytest test_taep.py -q
```

323 tests, all green. 80 of them run against a real Flask app and a real database
rather than mocks, which is how the three defects below were found.

Five things testing caught that reading would not have:

- **Costing numbers were not unique under concurrency.** A counter incremented and read
  back in a second statement races, because eFinance's `db_execute` commits per call and
  a transaction cannot span two of them. Four threads, forty allocations, twenty-four
  distinct numbers. The read and the write are now a single `INSERT … SELECT`, so there
  is no window between choosing a number and taking it. Third attempt; the two dead ends
  are recorded in the docstring.
- **A UNIQUE key over nullable columns constrained nothing.** The guard meant to stop two
  rate periods starting on the same day covered `(financial_category_id, entity_code,
  rate_type, weight, valid_from)` — and the national weight-scale rows have NULL category
  and NULL entity. SQL treats NULLs as distinct, so six concurrent changes all inserted.
  Rates now carry a NULL-free `series_key`.
- **The printed document overprinted itself.** The weight band label was drawn beside its
  own caption and the two Greek strings physically overlapped. `pdfplumber` reads by
  position and returned them interleaved; `pypdf`'s line grouping had hidden it.
- **The PDF was not reproducible.** reportlab stamps a creation date, so two renders of
  one episode differed, against the brief's byte-identical requirement.

A note on where Phase 1 went wrong: the `services.csv` we started from was a corrupted
extract, and four of the seven "defects" reported to the Μονάδα were artifacts of it. The
loader's hard-fail on duplicates worked exactly as designed — but a hard fail cannot tell
a bad extract from a real defect. Findings from derived files now get checked against the
source before they leave the building.

## Deploying into eFinance

`taep.py` and `seed/` drop into the eFinance tree alongside `bankrec.py` and `oayrecon.py`,
and `taep` is added to the module list in `app.py`. File by file — **never** run eFinance's
`deploy.sh`, which overwrites the live database.

`register(app, ctx)` is not written yet, so the module currently contributes schema and
seed only. That is Phase 2.

## The printed document

`docs/sample_kostologisi.pdf` is a rendered example: the golden case under category 600
ΕΠΙ ΠΛΗΡΩΜΗ with two tariff lines, €120,00 weight + €55,00 tariff = €175,00.

It carries the Τέλος Εγγραφής row the supplied sample omits, itemises tariff lines above
the totals, and renders byte-identically on every render.

## Administration

**Rates** are effective-dated and never updated in place. `change_rate()` closes the
current period and opens the next, refuses to backdate into a closed period, and demands
a source document. The screen distinguishes the three fee states the UI brief requires —
set, a documented exemption at €0,00, and unconfirmed — because conflating them is how a
wrong bill gets issued. Every series has a history page showing who changed what, when,
and from which document.

MySQL has no exclusion constraint (ADR-001), so `verify_rate_periods()` re-checks after
every change and is surfaced on the rate screen. An overlap it cannot prevent makes the
engine refuse to price rather than pick a period arbitrarily.

**The tariff** round-trips through Excel: download, edit, upload, review a diff of added
/ changed / deactivated rows, confirm once. Validation is per row with its spreadsheet
row number, and a file with any error applies nothing. A code missing from the upload is
deactivated, never deleted, so historic costings stay readable.

**Roles** are permission keys, not new roles — `taep.create`, `taep.finalise`,
`taep.cancel`, `taep.rates`, `taep.admin`. eFinance already has roles, a
`role_permissions` table and a user-administration screen; a second set would be two
places to get wrong. Add the keys to eFinance's `PERMISSIONS_CATALOG` and let the Μονάδα
decide which existing roles get them.

## Rollout

**Acceptance scenarios** are executable, not a Word document someone typed. The 25
scenarios live in `acceptance.py`, `test_acceptance.py` runs them under pytest, and
`tools/make_acceptance_document.py` runs them against a real database and real screens
and generates `docs/TAEP_senaria_apodochis.docx` from what actually happened. It exits
non-zero on any failure, so it works as a release gate — and a scenario that fails is
printed in the document as a failure with its error, which is the only way the document
is worth signing.

**Readiness check** — `tools/check_readiness.py`, or `/taep/readiness` as a system_admin.
It checks *this installation*, not the code: tables present, master data at the expected
counts, the weight matrix in the database still matching the algorithm, every weight
priced, no registration fee unconfirmed, no overlapping rate periods, unique unit
numbers, no gap in any costing-number sequence, no episode finalised without a number or
holding one without being finalised. Exits non-zero on a blocker.

```
FINANCE_DB=/opt/finance/finance.db python3 tools/check_readiness.py
```

**`docs/deployment-runbook.md`** — what to copy, how to register the module, the
permission keys, the per-unit rollout order, how to perform the paediatric relocation as
a data change, and how to back the module out. It opens with the warning that eFinance's
own `deploy.sh` would overwrite the live database.

**`docs/TAEP_odigos_kodikopoiiti.docx`** — the clerk's guide in Greek: the six steps, what
each message means and what to do about it, the two mistakes that cost money, and who to
call. Its figures are read from the seed data so it cannot drift from the system.

## Still to build

One §12 requirement is deliberately not built: the costing document has no QR code. It
needs a barcode library, a new eFinance dependency, so it is left for a decision rather
than added quietly.

The two-week parallel run against manual pricing (brief §15) is operational, not code.
The tool is not right by default and the runbook says so.
