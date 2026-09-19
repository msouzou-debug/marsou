# ADR-0016 — The capex plan is imported by a CLI whose mapping is data and whose default is a dry run

**Status:** accepted · 19/09/2026

## Context

R41 asks for an Excel migration CLI with a reconciliation report, and CAPEX-03 is the mapping for the first file: 116 rows of a shared workbook, 36 columns, eleven organisational units spelled the way a person typed them, three formula defects, thirteen cells holding text where a number or a date belongs, and a footer block that was counted as three projects the first time anybody looked.

The register it loads is the system of record for €275m of capital works. Two things follow. The import has to be repeatable — the real file arrives on a Monday, and the revision after it arrives in a few months with columns in different places. And it has to be reviewable — whoever signs off the migration has to be able to read, before anything is written, what would be written.

## Decision

### The mapping is a YAML profile, not code

`src/cli/profiles/capex_plan_2026_02.yaml` is CAPEX-03 §8 plus what the importer needs to act on it: the sheet name, the header and first data rows, the footer titles, the expected row counts, the column map with each column's header text and target, the budget vintages, the alias-backed lookups, the phase map, the two rule thresholds and the columns that are read but not imported. The next revision of the spreadsheet is a new file next to it, not a patch to a parser.

What the profile may **not** invent is a way of reading a cell. Every column names one of fifteen transforms the importer implements, and a genuinely new kind of cell is a code change with its own ADR. A profile that names a transform, a target or a column the importer does not know fails to load, with the line named, before the workbook is opened.

Two mappings CAPEX-03 gives are resolved in the profile rather than in code, because both are judgements ΟΚΥπΥ may take differently:

- §4 maps ΟΛΟΚΛΗΡΩΘΗΚΕ to a phase it calls `COMPLETED`, which is not one of the nine phases in `packages/shared` (ADR-0014). The profile maps it to `CLOSED`, the terminal phase. One line to change.
- §3 puts the directorate in column C and on `org_unit`. The importer reads the column to **check** the unit it resolved and reports a disagreement; it does not rewrite an organisational fact from a project row, because 113 rows would otherwise fight over eleven records.

### A dry run is the default

Without `--commit` the whole import runs inside one transaction and the transaction is rolled back. The report is produced either way. Reading what would happen is the normal case; writing is the exception you ask for.

On top of that, §9's seven blocking rules — V04, V06, V07, V10, V11, V12, V13 — turn a `--commit` back into a dry run. The February file fails V06 on six rows, so it cannot be committed until somebody fixes the spreadsheet. That is the intended answer, not an obstacle: nothing is ever fixed in the spreadsheet *by the importer*, and a register loaded from cells nobody could read is worse than a register that is a week late.

Before any of that, the row counts stop the run. If the file does not classify into the profile's expected 113 project rows and 3 footer rows, the importer reports and exits before the first insert. The first read of this file counted the footer block as three projects and put €36m in the wrong place; the count check is what makes that impossible to repeat quietly.

### One transaction, under the importing user

The CLI opens one transaction, sets `app.user_id`, `app.roles` and `app.org_unit_ids` exactly as the API's RLS interceptor sets them (ADR-0010), and does everything inside it. Three consequences, all of them wanted:

- The policies apply. `import_batch` is admin-only, so a unit-scoped account is refused by Postgres on the first insert, not by an `if` in the CLI. An import writes to every unit at once, which is precisely what an estates head must not be able to do.
- The audit trigger applies (ADR-0011). Every project, budget line, cost transaction and note the import writes carries the importing user as its actor, and an import is as reviewable afterwards as a form somebody filled in.
- Either all of it lands or none of it does. There is no half-imported register to unpick by hand.

`--as <email>` is how the identity arrives in development, read over the owner connection the way `AuthService.devTokenFor` reads it — there is no token yet, and under the policy on `app_user` a session with no identity correctly sees no users. The CLI refuses to run without it.

### The natural key is the unit and the normalised title

The sheet has no stable key: column B is blank on four rows and holds text on seven (ADR-0014). A project is therefore found again by its unit plus its title with accents folded, case dropped and whitespace collapsed — the same folding `ecapital.normalise` does in SQL, so the key means the same thing on both sides. V13 refuses a file that has the same key twice.

Re-running the same file compares every imported field and **writes nothing where nothing changed**: a second run of an unchanged file is 0 created, 0 updated, 113 unchanged, and no audit rows. The file's hash is deliberately left out of that comparison — a one-cell edit gives the whole file a new hash, and comparing it would report all 113 rows as changed and bury the one that did.

Two fields the importer does not overwrite on a second run:

- **`phase`**, after the project exists. R04 moves a phase one step at a time with a reason, and ADR-0014 says there is no "correct the phase" edit; an import that rewrote it would walk projects backwards with neither. The sheet sets the phase when the project is created, and a later disagreement is reported instead.
- Nothing else. `approvedBudget` **is** updated, and a move of more than €1,000 is listed in the report's diff against the previous batch, which is exactly what CAPEX-03 §9 asks the diff to show.

### exceljs, not SheetJS

Both were considered. exceljs, because:

- It keeps the cell's type. `cell.type` distinguishes a number from a string that looks like one, and V06 — the rule that rejects «περίπου 1,2 εκ.» in an amount column instead of reading it as zero — is the whole reason the reconciliation can be trusted. A reader that coerces produces a report that ties perfectly to a file that is wrong.
- It reads a formula cell as both the formula and the value Excel last calculated, which is what the footer totals and the three defects in CAPEX-03 §6 are made of.
- It writes as well as it reads, so the synthetic fixture is built by the same library that reads it, with no second dependency.
- The only SheetJS build on the npm registry is 0.18.5, which the project abandoned there in 2023 and which carries open prototype-pollution and ReDoS advisories. The maintained build is served from the vendor's own CDN, which is not a dependency an on-premise ΟΚΥπΥ deployment should have to mirror.

The cost is weight — exceljs pulls in a zip stack — and it is a development and operations dependency, not something the API serves a request with.

## Consequences

- A column that moves is an edit to a YAML file and a re-run of `inspect`. A column that means something new is a code change and another ADR.
- The February file cannot be committed as it stands. `pnpm import:capex` will say so, per rule and per row, in Greek, and the sentence names the cell.
- Because the run is one transaction under one identity, an import cannot be used to write past a policy. It also cannot be run by anyone but an administrator, which is a deliberate narrowing of who can touch 113 projects at once.
- The report is stored in `import_batch.report` as jsonb, so it can be reprinted a year later without the spreadsheet — which is what CAPEX-01 §9's "keep the source file hash and a link from each record to the file it came from, for the first year" is for.
- Two enum values were added to carry the file: `funding_source.RRF` for «ΣΑΑ» (CAPEX-03 §2 col L) and `project_category.CAPITAL_WORKS` for «Αναπτυξιακά Έργα» (col A). Both are additive and neither changes an existing row. `CAPITAL_WORKS` is the one to argue about: the capex plan's only category names the programme rather than one of the six kinds of works the model carries, and forcing 113 rows into `RENOVATION` would label them with something the sheet never said. The raw cell is kept in `project.category_source` either way, so the decision is reversible. **Both need a label in `apps/web/src/i18n` before either appears in a dropdown.**
