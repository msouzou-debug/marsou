# eCapital — specification briefs

Source documents for the build. Read them in this order.

| File | What it is | Status |
|---|---|---|
| `OKYPY-CAPEX-01-Claude-Code-Build-Brief.md` | Scope, architecture, data model, modules, R01–R50, build order, definition of done | Present |
| `OKYPY-CAPEX-02-Claude-Design-UI-Brief.md` | The Claude Design UI brief — wins over the UI instructions where they disagree; carries the personas, screen inventory and the fixed Greek glossary (§7) | Present |
| `eCapital-UI-Instructions-for-Claude-Code.md` | Build rules derived from CAPEX-02: tokens, layout, components, screens S01–S27, states, accessibility | Present |
| `OKYPY-CAPEX-03-Capex-Plan-Migration-Mapping.md` | Column-by-column mapping of the Capex Plan sheet, org-unit lookup, validation rules V01–V14, import profile | Present |

Also referenced but not in the repo:

- `brand-tokens.css` — now in `/brand/`, taken from the okypy-brand-guidelines skill together with the logo files and the CMYK spec. `src/styles/tokens.css` extends it.
- `MASTER_FILE - ΑΝΑΠΤΥΞΙΑΚΟΣ ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ - Αναθεώρηση Budget 2026.xlsx` — the migration source. Needed to test the importer against the figures in CAPEX-03 §0. Do not commit the workbook itself; keep it outside the repo and point the CLI at it.

CAPEX-03 replaces §9 of CAPEX-01. Where CAPEX-01 §4 and CAPEX-03 disagree on a field (for example `project.category` values, or `project.phase` having three source states against nine target ones), CAPEX-03 describes what the source file can carry and CAPEX-01 describes the target model. The importer maps the first into the second and flags the gap.

## Errata agreed with the owner

- **Unit count.** CAPEX-01 §1 and §4 say "nine hospitals plus three services". The Capex Plan has eleven units: eight hospitals plus three services. Troodos and Kyperounta are the same hospital, so the ninth was a double count (18/09/2026). Code and seeds use eleven; the Troodos unit carries both spellings as aliases.
- **Project phases.** CAPEX-01 §4 lists eight phases, CAPEX-03 §4 says the target has nine. The code inserts `PREPARATION` between `IDEA` and `APPROVED` to hold the 70 preparation rows. Not yet confirmed by the owner; change `packages/shared/src/project.ts` if the ninth phase is something else.
- **Budget changes after approval.** Finance only (19/09/2026). See ADR-0014.
