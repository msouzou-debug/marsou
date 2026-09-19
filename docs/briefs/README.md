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

- **Unit count.** CAPEX-01 §1 and §4 say "nine hospitals plus three services". The Capex Plan has eleven units: eight hospitals plus three services. Troodos and Kyperounta are the same hospital, so the ninth was a double count (18/09/2026). Code and seeds used eleven units from that reconciliation. **Update, 19/09/2026:** the owner added `HQ` (Κεντρικά Γραφεία) as a twelfth unit, type `CENTRAL`, directorate `KENTRIKI_DIOIKISI` — Central Administration can commission capital works of its own, and CAPEX-01 §4's count never covered it because the Capex Plan sheet has no HQ rows to count. Code and seeds now use twelve units: eight hospitals, three services and HQ; the Troodos unit still carries both spellings as aliases, and HQ carries none (see ADR-0019 §5).
- **Project phases.** CAPEX-01 §4 lists eight phases, CAPEX-03 §4 says the target has nine. The code inserts `PREPARATION` between `IDEA` and `APPROVED` to hold the 70 preparation rows. Not yet confirmed by the owner; change `packages/shared/src/project.ts` if the ninth phase is something else.
- **Budget changes after approval.** Finance only (19/09/2026). See ADR-0014.
- **Euro format:** eFinance uses `1.234,56 €`; UI brief §1 says `€ 84.000`. Owner decision 19/09/2026: match eFinance, `1.234,56 €` everywhere.
- **eMetroon is now eArchive.** CAPEX-01 §1 and §3 say «eMetroon»; the document system was renamed eArchive on the server (paths still say `emetroon`). The brief text is kept as written.
- **One CAPEX budget code per contract.** Owner decision 19/09/2026; eFinance's draft contract assumes it.
- **CNS entity code.** eFinance's `CNS` is Central Nursing Services. It has no eCapital unit; capital work for it files under HQ (assumption, owner to confirm).
- **FBL5N against FBL1N.** CAPEX-01 §7 and CAPEX-03 §7 name «FBL5N» as the actuals extract beside KSB1. `packages/shared/src/cost.ts` — the contract the API and the web app share — says `FBL1N`. FBL5N is the customer line-item report and FBL1N the vendor one, and what a clerk runs to get invoices by supplier is FBL1N. **The contract wins:** the enum, the import profile (`apps/api/src/cost/profiles/fbl1n.yaml`) and the routes all say FBL1N. If ΟΚΥπΥ's finance office really does run FBL5N, the fix is a new profile beside the other three and a value on the enum, not a rename.
- **Cost centre on a project.** CAPEX-01 §4 puts `cost_centre` on `org_unit` and on `area` and not on `project`. R14's third matching step — «matches on WBS then PO then cost centre» — has nothing to compare against without it: a KSB1 posting carries a cost centre, and most postings carry neither a WBS nor a purchase order. `project.cost_centre` is added by migration `0011_m2_cost.sql` and filled by the seed. See ADR-0021 §3.
- **The retention base on a payment certificate.** CAPEX-01 §7's shorthand reads as retention on the work done; `packages/shared/src/cost.ts` says `retentionHeld = retentionPct × (workDone + materials)`. The shared contract is what the web app is built against, so that is what the API computes. ADR-0021 §10.
- **Glossary terms for M2.** CAPEX-02 §7 fixes «Πιστοποίηση πληρωμής» for a payment certificate and «Κρατήσεις» for retention. The first M2 build used «Πιστοποιητικό πληρωμής» and «Παρακράτηση» because the project manager's instructions named those words, not because of an owner decision; the strings are being corrected to §7. «Δεδουλευμένα» is used for the year-end accruals, which §7 has no entry for.
- **`budget_line.category` is a cost category, not a kind of project.** Migration 0005 typed it as `project_category`; nothing ever wrote it. Migration 0011 retypes it as text with a closed list — `works`, `equipment`, `fees`, `contingency`, `other` — in the lower-case spelling the interface resolves as an i18n key suffix, with `uncategorised` («Χωρίς κατηγορία») for money that has none. ADR-0021 §7.
