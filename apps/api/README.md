# @ecapital/api

The eCapital backend: NestJS 11, PostgreSQL 16, Drizzle, OpenAPI 3.1.

M0 is the foundation — sign in, see your own org units, see their building → floor → area tree, read the audit log. It serves R01 (Entra ID sign-in, role and unit-scoped access), R42 (audit log on every mutation, immutable to admin) and R43 (Greek first, English second).

M1 adds the project register on top of it: projects, milestones, risks and issues, and the portfolio the board opens on. It serves R03 (portfolio across the units with drill-through), R04 (phases and gate approvals), R05 and R06 (the business-case fields carried from the capex plan, and baseline vs forecast vs actual) and R07 (risk and issue registers).

M1 then adds the site log on top of the contracts: RFIs with an SLA clock, site instructions that turn into variations, and the defects found at handover and on inspection (R09, R12, R35). The SLA band is computed and never stored, a breach is a state and never a block, and a defect always belongs to an org unit even when it belongs to no contract and no project (ADR-0017).

M1 then adds the contract register: contractors, contracts, bills of quantities and variations (R08, R10), the commitment ledger they produce (R13) and the three warnings they raise (R31). A contract starts at award — the tender stage stays in e-Procurement (CAPEX-01 §1) — and a variation is approved by somebody other than the person who raised it, which is enforced in the service, on the route and in the table (ADR-0015).

M1 also brings the register in from where it lives today. `import:capex` reads the ΟΚΥπΥ capital budget workbook, checks it against fourteen validation rules and loads 113 projects with their budget lines, their opening actual spend and the Technical Services notes, under one transaction and one reconciliation report (R41). See «Importing the Capex Plan» below.

M2 is the cost module. All four ledgers are now real: `approved` from the budget lines, `committed` from the contracts or from the SAP purchase-order balance once an extract has posted one, `spent` from the SAP postings, and `forecast` from the commitment plus the submitted variations at a weight plus the contingency the engineer sets (R13, R16). On top of them: the monthly SAP extract import and the unmatched-allocation queue that is the point of it (R14), a `CostSourceReader` seam with the MCP reader stubbed and registered beside the file reader (R15), the cash-flow profile by month (R17), the year-end accrual proposal with live Excel formulas (R18), payment certificates from draft to paid (R11), and the five warn-and-flag rules, which fire on read as well as on write and never block anything (R31). ADR-0021 says why each of those is where it is. Permits, assets and maintenance are M5 and later.

A ledger with no source comes back **null and never zero** — a project nobody has committed anything on has no commitment, and «€0» would be a claim the system has not got. The screens show «—».

## Run it locally, in five commands

```bash
pnpm install                                   # 1. from the repo root
cp apps/api/.env.example apps/api/.env         # 2. the defaults work for local Postgres
pnpm --filter @ecapital/api migrate            # 3. create the schema, policies and triggers
pnpm --filter @ecapital/api seed               # 4. twelve org units, one building, eight users
pnpm --filter @ecapital/api dev                # 5. http://localhost:3001, docs at /docs
```

Step 3 needs a PostgreSQL 16 you can reach. If you have none, `docker compose up -d postgres` from the repo root gives you one — untested here, see the header of `docker-compose.yml`. The test suite does not need it: it starts and throws away its own cluster.

Then sign in: `docs/manual/en/M0-login.md` walks through the development token, and `docs/manual/el/M0-login.md` is the same thing in Greek.

## What is where

| Path | What it holds |
|---|---|
| `src/db/migrations/*.sql` | The schema. Tables, enums, row-level-security policies, grants, audit triggers. Hand-written and authoritative (ADR-0008). |
| `src/db/schema.ts` | The Drizzle view of the same tables, for typed queries. |
| `src/db/seed-data.ts` | The twelve units (HQ added 19/09/2026) and their source spellings, one seeded building, eight users, the group→role mappings, the 43 fixture projects and the twelve fixture contractors. |
| `src/db/seed-projects.ts` | The M1 half of the seed: projects, milestones, risks and issues, idempotent, codes allocated by the same function the API uses. |
| `src/db/seed-contracts.ts` | The contract half: a contract on every awarded project, a bill of quantities on three of them, and the variations R10 and R31 need something to fire on. Idempotent. |
| `src/db/seed-site.ts` | The site log half: two or three RFIs on every contract with one breached and one red, an instruction each with three of them left to price, twelve handover defects over three finished contracts across all four risk bands with two past their liability date, and three inspection defects that belong to a unit and nothing else. Idempotent. |
| `src/projects/`, `src/portfolio/` | The M1 modules. `project-rows.ts` holds the phase order and the audit-line rules as pure functions. |
| `src/contractors/`, `src/contracts/` | The contract register. `contract-rows.ts` holds the commitment arithmetic and the four warn-and-flag rules as pure functions. |
| `src/rfis/`, `src/site-instructions/`, `src/defects/` | The site log. `rfi-rows.ts` holds the SLA band, `defect-rows.ts` the defects-liability arithmetic and the backlog banding, all as pure functions. |
| `src/auth/` | The guard, the three ways in and `GET /me` (ADR-0009, ADR-0018). `directory.ts` is the port between "who is this person" and "which directory says so"; `ldap.directory.ts` is the one implementation, against the ΟΚΥπΥ Active Directory. |
| `src/admin-users/` | Διαχείριση › Χρήστες — who exists, what they may do and in which units (ADR-0020). The four rules an administrator can break by accident live in the service, each a 422 with a sentence. |
| `src/cli/grant-role.ts` | The bootstrap CLI: the first administrator on a fresh database, and the only way the auditor is appointed or unappointed. |
| `src/links/` | `GET /config/links` — where eMAP and eFinance are, for the S07 link-outs (ADR-0019). |
| `src/common/rls.interceptor.ts` | Opens the transaction that carries the caller's identity into Postgres (ADR-0010). |
| `src/cli/` | The capex plan import (R41). `profiles/*.yaml` is the mapping as data; `parse.ts` and `validate.ts` are the column transforms and the fourteen rules as pure functions (ADR-0016). |
| `src/cost/` | The M2 cost module. `cost-rows.ts` holds the ledger and certificate arithmetic as pure functions, `cost-warnings.service.ts` the five R31 rules, `cost-export.ts` the two workbooks with their live formulas. |
| `src/cost/source/` | The R15 seam. `cost-source.ts` is the interface, `sap-extract.reader.ts` the only thing in the module that knows a file exists, `sap-mcp.reader.ts` the registered stub, `values.ts` the Greek and SAP number, date and sign formats. |
| `src/cost/profiles/*.yaml` | One column map per SAP report — ME2N, KSB1, FBL1N — matched on header text, with the number format, the date format and the sign convention (ADR-0021 §2). |
| `src/db/seed-cost.ts` | The M2 half of the seed: a budget by year for every project, a month already matched, a month of twelve rows still in the queue, three payment certificates, two remembered rules and two live warnings. Idempotent. |
| `test/fixtures/sap/*.xlsx` | The synthetic extracts, built by `test/fixtures/build-sap-fixtures.ts` and checked in: matched, unmatched, repeated and unreadable rows, in the formats a Greek SAP client produces. |
| `src/i18n/{el,en}.json` | Every error sentence, keyed, Greek and English. |
| `openapi.json` | Checked in, generated from the controllers, and a test fails when it is stale. |

## Endpoints

Every route below is behind the bearer token and inside the row-level-security transaction. A record the caller may not see answers **404**, never 403 — a 403 would confirm it exists. A write the caller may not make answers **403**. The full document is `openapi.json`, served at `/docs`.

| Method and path | What it does | Milestone |
|---|---|---|
| `GET /health` | Liveness, database reachability, last applied migration. No token. | M0 |
| `POST /auth/dev-token` | A signed development token for a seeded user. Answers 404 unless `AUTH_MODE=dev`. | M0 |
| `POST /auth/login` | Username and password, checked by a simple bind against the ΟΚΥπΥ Active Directory; the same token and claims the stub issues. Answers 404 unless `AUTH_MODE=ldap` (ADR-0018). | M1 |
| `GET /me` | The caller's own claims, camelCase. | M0 |
| `GET /config/links` | Base URLs of eMAP and eFinance, or null where this deployment was told of neither. Signed in, no role (ADR-0019). | M1 |
| `GET /org-units` | The units the caller may see, each with its eFinance `entityCode` (ADR-0019). | M0 |
| `GET /org-units/:id/areas` | That unit's building → floor → area tree. | M0 |
| `POST /org-units/:id/areas` | Add an area to a floor of the unit. | M0 |
| `GET /audit-log` | The organisation's audit trail. `admin` and `auditor_readonly` only. | M0 |
| `GET /admin/users` | Διαχείριση › Χρήστες: the accounts, searched (`q` over the name, the account name and the address), filtered by `role`, `unit` and `active`, and paged. `admin` only (ADR-0020). | M1 |
| `GET /admin/users/:id` | One account with its roles and its units. | M1 |
| `POST /admin/users` | Pre-register an Active Directory account before its first sign-in. The subject is `ad:<username>` until the first bind adopts the objectGUID, so the roles set here are in force the moment the person arrives. | M1 |
| `PATCH /admin/users/:id` | Roles, units, display name, on or off. Four 422s: `errors.selfLockout`, `errors.lastAdmin`, `errors.auditorProtected`, `errors.unitRequired` (ADR-0020). | M1 |
| `GET /admin/roles` | The eight roles with `scope: all \| unit`, so no client hardcodes which carry units. | M1 |
| `GET /projects` | The register, filtered (`unit`, `phase`, `category`, `rag`, repeated for several), searched (`q`, matching the code and the Greek title without regard to case or accents), sorted and paged. | M1 |
| `GET /projects/:id` | One project with its unit, its sponsor and manager by name, its milestones, risks and issues, and the last fifty lines of its own history. | M1 |
| `POST /projects` | Open a project. The API allocates the code (ADR-0014); a body that carries one is refused. | M1 |
| `PATCH /projects/:id` | Change the fields of a project. The phase is not one of them. | M1 |
| `POST /projects/:id/phase` | Move one phase forward with a reason. 422 if it is not the next phase or a gate milestone is still open. An administrator may also move a project back (ADR-0014). | M1 |
| `POST /projects/:id/milestones`, `PATCH …/:mid` | Milestones. The baseline date is fixed at creation; 422 on an attempt to move it (R06). | M1 |
| `POST /projects/:id/risks`, `PATCH …/:rid` | The risk register, likelihood and impact on a 1–5 scale (R07). | M1 |
| `POST /projects/:id/issues`, `PATCH …/:iid` | The issue register. The issue is raised by the caller, never by a name in the body (R07). | M1 |
| `GET /portfolio` | S01: the KPI strip, one row per visible unit with its sparkline and RAG counts, and up to eight exception sentences in Greek and English — contract warnings among them, pointing at the contract. | M1 |
| `GET /contractors` | The supplier register, shared across the units, readable by everyone signed in. | M1 |
| `POST /contractors` | Add a company. `admin` and `estates_head` only (ADR-0015). | M1 |
| `PATCH /contractors/:id` | Change one. `blacklisted` is an administrator's field; anyone else gets 403 `errors.blacklistAdminOnly`. | M1 |
| `GET /contracts` | Every contract the caller may see, newest award first, filtered by `unit` and searched by `q` over the two references and the contractor's name (ADR-0019). | M1 |
| `GET /contracts/lookup?q=` | Resolve `CAP-YYYY-NNNN`, or a contract number, to an id. `{id}` or 404. This is what eFinance's invoice link lands on (ADR-0019). | M1 |
| `GET /projects/:id/contracts` | The contracts of one project. | M1 |
| `POST /projects/:id/contracts` | Record the awarded contract. The API allocates `ref` (`CAP-YYYY-NNNN`, ADR-0019); a body that carries one is ignored. 422 if the contractor is blacklisted, or if the project has not reached AWARDED (CAPEX-01 §1). | M1 |
| `GET /contracts/:id` | One contract with its project, its contractor, its bill, its variations newest first, the approved and pending totals, the variation percentage and the warnings. | M1 |
| `PATCH /contracts/:id` | Change the terms. Neither the value nor `ref` is one of them — the value follows the variations, and the reference never changes (ADR-0019). | M1 |
| `PUT /contracts/:id/boq` | Replace the whole bill of quantities. Each amount is qty × rate, worked out here. | M1 |
| `POST /contracts/:id/variations` | Raise a variation. DRAFT, raised by the caller, numbered by the database. | M1 |
| `PATCH /contracts/:id/variations/:vid` | Change one while it is DRAFT or RETURNED, and only as its raiser or an administrator. | M1 |
| `POST /contracts/:id/variations/:vid/submit` | Send it for a decision. The raiser only. | M1 |
| `POST /contracts/:id/variations/:vid/decide` | Approve, return or reject. `estates_head` or `admin`, never the raiser (R10), and a comment is required to return or reject. | M1 |
| `GET /contracts/:id/rfis` | The RFIs on the contract, newest first, each with the SLA band the chip draws. | M1 |
| `POST /contracts/:id/rfis` | Raise an RFI. The API sets the clock: `slaDueAt` is `raisedAt + slaDays × 24h`, seven days by default. | M1 |
| `POST /contracts/:id/rfis/:rid/answer` | Answer an open one. The answerer may be the raiser (ADR-0017). | M1 |
| `POST /contracts/:id/rfis/:rid/close` | ANSWERED → CLOSED. 422 on an RFI nobody has answered. | M1 |
| `GET /contracts/:id/site-instructions` | The site instructions on the contract, newest first. | M1 |
| `POST /contracts/:id/site-instructions` | Issue one. The API numbers it. | M1 |
| `POST /contracts/:id/site-instructions/:sid/variation` | Turn it into a DRAFT variation, priced at zero for the engineer. Only with cost impact, and only once. | M1 |
| `GET /defects` | The defect log, filtered by `unit`, `contract`, `project`, `status`, `riskBand` and `source`. | M1 |
| `GET /defects/backlog` | R35: the costed backlog, one row per unit per NHS ERIC risk band, over the defects still open. | M1 |
| `GET /defects/:id`, `POST /defects`, `PATCH /defects/:id` | One defect. A handover defect's due date comes from the contract (R12); `funded` needs a `targetProjectId`. | M1 |
| `POST /cost/imports` | Multipart: the monthly extract, the report (`ME2N`, `KSB1`, `FBL1N`), the period and `dryRun`. A dry run is the default and writes nothing. 409 on a file already imported for the same report. `finance`, `estates_head`, `admin` (R14). | M2 |
| `GET /cost/imports`, `GET /cost/imports/:id` | The batches, newest first, and one with its first fifty exceptions. | M2 |
| `GET /cost/imports/:id/unmatched` | The queue: each row with up to nine suggestions, best evidence first — same WBS, same PO, same cost centre, a vendor somebody allocated before, a similar narrative (S10). | M2 |
| `POST /cost/imports/:id/allocate` | Put rows on a project, and remember it unless told not to. Answers `{remaining, next}`. Engineers too — in their own units, which the row policy decides, not the route. | M2 |
| `POST /cost/imports/:id/skip` | Pass over rows. They stay unmatched and stay in the batch; the queue stops offering them. | M2 |
| `POST /cost/imports/:id/commit` | Close the batch. Whatever is still unmatched becomes an exception on it. | M2 |
| `GET /projects/:id/cost` | S04: the four ledgers with the provenance of the commitment, the category table with its variance, the live warnings, and when SAP last posted here (R13). | M2 |
| `PUT /projects/:id/cost/forecast-inputs` | The contingency and the weight submitted variations carry (R16). `project_engineer`, `estates_head`, `admin`. | M2 |
| `GET /projects/:id/budget-lines`, `PUT …` | The approved budget by year and vintage. Writing is `finance` and `admin` only, like `approvedBudget` after APPROVED (ADR-0014). | M2 |
| `POST /projects/:id/cost/warnings/:wid/dismiss` | Dismiss a warning. It stays on the record, and fires again as a new row if the figure moves (R31). | M2 |
| `GET /projects/:id/cost/cashflow`, `GET /org-units/:id/cost/cashflow` | Planned against actual by month, with both running totals, `?from=YYYY-MM&to=YYYY-MM` (R17). | M2 |
| `GET /projects/:id/cost/export` | The category table as Excel, with «Απόκλιση» and the totals as live formulas. | M2 |
| `GET /contracts/:id/payment-certs`, `POST …` | The certificates of a contract, and a new one. The number, the retention, the previously certified total and the net payable are all the API's (R11). | M2 |
| `GET /payment-certs/:id`, `POST /payment-certs/:id/transition` | DRAFT → ENGINEER_APPROVED → FINANCE_RECEIVED → PAID, forward only, never by the person who created it. | M2 |
| `GET /cost/accruals`, `GET /cost/accruals/export` | R18: certified and not yet invoiced, per project and cost centre, and the same as a workbook whose accrual column is `=F−G`. | M2 |

Who may write to the register: `admin`, `estates_head` and `project_engineer`, in units they belong to. `finance`, `technician` and `clinical_approver` read it; `executive_readonly` and `auditor_readonly` read everything and write nothing. All of that is in the policies, not in the controllers (ADR-0010).

One exception, and it is a policy too. A `technician` may create and update a **defect** whose source is `INSPECTION` or `WORK_ORDER`, in their own unit — the field persona of CAPEX-01 §2 and §8. Not a `HANDOVER` one, which is a contractual position on somebody else's work, and not a `CONDITION_SURVEY` one, which is an estates exercise. `ecapital.can_manage_defect` is the first policy in the schema that reads a column other than `org_unit_id` (ADR-0017).

Three more rules sit on top of the policies and none of them is an access rule. An RFI is closed after it has been answered and not before (422 `errors.rfiNotAnswered`). A site instruction becomes a variation only if it carries cost impact (422 `errors.noCostImpact`) and only once (422 `errors.alreadyLinked`). A defect marked `funded` names the project paying for it (422 `errors.fundedNeedsProject`). Each is a CHECK or a unique index as well as a service rule, for the reason ADR-0015 gives and ADR-0017 repeats.

M2 adds three rules of the same kind. A payment certificate is approved by somebody other than the person who created it and moves one status at a time, both enforced in the service and in the table (R11, ADR-0021 §10). The budget lines behind the approved figure are finance's, like the figure itself (ADR-0014). And a row in the unmatched queue belongs to no unit until it is allocated, so the policy — not the controller — is what stops an engineer putting one on a project outside their units (ADR-0021 §4).

Two narrower rules sit on top of the policies, and both are decisions rather than access rules. A variation is decided by `estates_head` or `admin` and never by the person who raised it (R10, ADR-0015). And once a project is APPROVED or later, only `finance` may change its `approvedBudget` — `PATCH /projects/:id` refuses everyone else with 403 `errors.budgetFinanceOnly`, and an administrator is not exempt (ADR-0014, owner's decision of 19/09/2026).

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @ecapital/api dev` | Run with reload. |
| `pnpm --filter @ecapital/api test` | The full suite against a throwaway PostgreSQL 16 cluster (ADR-0012). |
| `pnpm --filter @ecapital/api migrate` | Apply pending migrations. Safe to run twice. |
| `pnpm --filter @ecapital/api seed` | Load or refresh the seed data. Safe to run twice. |
| `pnpm --filter @ecapital/api import:capex -- …` | Import the capex plan workbook. Dry run unless `--commit`. See below. |
| `pnpm --filter @ecapital/api grant-admin -- --username <sAMAccountName> [--name "…"] [--email …]` | Give somebody the administrator role, creating the account if it does not exist. How the first administrator exists on a fresh database (ADR-0020). |
| `pnpm --filter @ecapital/api grant-role -- --username <sAMAccountName> --role <role> [--revoke]` | Grant or revoke one role. The only way `auditor_readonly` moves in either direction (CAPEX-01 §10). |
| `pnpm --filter @ecapital/api openapi` | Rewrite `openapi.json` from the controllers. |
| `node -r @swc-node/register test/fixtures/build-sap-fixtures.ts` | Rebuild the checked-in synthetic SAP extracts. |
| `./scripts/test-db.sh start` / `stop` | The throwaway cluster, by hand, if you want to poke at it. |

## Importing the Capex Plan

The project register starts as a spreadsheet. `import:capex` turns the ΟΚΥπΥ capital budget workbook into projects, budget lines, opening actual balances and the Technical Services notes, and produces a reconciliation report in Greek before anything is written (R41, CAPEX-03, ADR-0016).

The mapping is a YAML profile — `src/cli/profiles/capex_plan_2026_02.yaml` — not code. A column that moved, a header that was reworded or a footer line that was renamed is an edit to that file, and the next revision of the spreadsheet is a new profile next to it.

Four commands, in this order, on the day the file arrives:

```bash
# 1. What is in the file, and does the profile still fit it?
pnpm --filter @ecapital/api import:capex -- inspect \
  --file ~/MASTER_FILE.xlsx --profile capex_plan_2026_02

# 2. A dry run: the whole import inside one transaction, rolled back at the end.
pnpm --filter @ecapital/api import:capex -- \
  --file ~/MASTER_FILE.xlsx --profile capex_plan_2026_02 \
  --as admin@ecapital.test --report capex-import.md

# 3. Read capex-import.md. Section 3 ties every column to the file, to the cent;
#    section 4 lists the exceptions by rule with row, project and value;
#    section 7 says whether it can be committed.

# 4. Commit. Same command, plus --commit.
pnpm --filter @ecapital/api import:capex -- \
  --file ~/MASTER_FILE.xlsx --profile capex_plan_2026_02 \
  --as admin@ecapital.test --commit --report capex-import.md
```

`--as-of 2026-03-31` sets the date the opening actual balance is posted at; the profile's own date is the default. `--file` takes an absolute path or one relative to `apps/api`, which is where pnpm runs the script from. Exit codes: 0 done, 1 the run could not start, 2 the row counts did not match the profile and nothing was written, 3 a blocking rule failed so the run stayed a dry run.

Four things about it that are decisions rather than implementation:

- **A dry run is the default.** `--commit` is the exception you ask for, and even then §9's blocking rules — V04, V06, V07, V10, V11, V12, V13 — turn it back into a dry run. The February file fails V06 on the cells holding text where a number belongs, so it cannot be committed until the spreadsheet is fixed. That is the intended answer.
- **The counts stop it.** If the file does not classify into the profile's expected 113 project rows and 3 footer rows, the run reports and exits before the first insert. The first read of this file counted the footer block as three projects.
- **One transaction, under the importing user.** `--as <email>` is required and is refused without it; the run sets `app.user_id`, `app.roles` and `app.org_unit_ids` like any request (ADR-0010), so the policies decide who may run it — `import_batch` is admin-only — and the audit trigger records every row under the person who ran it (ADR-0011).
- **Re-running the same file changes nothing.** A project is found again by unit plus normalised title, and a field that did not move is not written. A second run of an unchanged file is 0 created, 0 updated, 113 unchanged, and leaves no audit rows; an amount that moved by more than €1,000 appears in the report's diff against the previous batch.

The fixture the CLI is proved against is synthetic and committed: `test/fixtures/capex-plan-synthetic.xlsx`, built by `test/fixtures/build-capex-fixture.ts`, which reproduces CAPEX-03 §0's figures to the euro. Rebuild it with `node -r @swc-node/register test/fixtures/build-capex-fixture.ts`.

Reading it needs `exceljs`, chosen over SheetJS because it keeps the cell's type — which is what lets V06 reject «περίπου 1,2 εκ.» in an amount column instead of quietly reading it as zero (ADR-0016).

## Three rules that are not negotiable

**No patient data.** CAPEX-01 §12: no patient data enters this system and the schema must make that impossible by design. `area.beds` is a count of beds in a room. `area.patient_risk_group` is the ICRA 2.0 band of the room. Neither describes a person, and no column anywhere holds a name, an identifier, a diagnosis, an episode or an appointment. A column that could is rejected in review.

**Access is decided by Postgres, not by this code.** A service method with no permission check in it is correct (ADR-0010). A unit you may not see answers 404, not 403, because a 403 would confirm it exists.

**The audit log is written by a trigger and cannot be edited by anyone**, including the table owner and a superuser (ADR-0011). Correcting a wrong row is impossible by design; you add a row describing the correction.

## Notes

- All timestamps are `timestamptz` and stored UTC. Europe/Nicosia is a display concern, and it belongs to the web app.
- Logs are JSON, one line per request, with a request id. Bodies and the `authorization` header are never logged.
- `pnpm build` type-checks and emits to `dist/`. The API runs from source through `@swc-node/register`, which keeps the decorator metadata Nest needs (esbuild-based runners such as tsx drop it); packaging it for the ΟΚΥπΥ server — `@ecapital/shared` ships as TypeScript — is part of the deploy work in M1.
