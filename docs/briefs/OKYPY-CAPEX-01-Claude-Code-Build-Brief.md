# eCapital — ΟΚΥπΥ Capital & Maintenance Management System — build brief for Claude Code

Product name: **eCapital**. Repo: `ecapital`. Brand mark written in Latin letters everywhere, including Greek screens, in line with eArchive (formerly eMetroon). Greek tagline: «Τα έργα, τα πάγια και η συντήρηση του ΟΚΥπΥ». The name is fixed — it goes into table prefixes, URLs and the document footers.

Read this file end to end before writing code. Read `OKYPY-CAPEX-02-Claude-Design-UI-Brief.md` and the exported design tokens before touching the frontend. Every feature you build cites an R-number from §13.

## 0. Skills to load, in this order

1. `engineering:system-design` — architecture pass and ADRs.
2. `frontend-design` — every screen.
3. `design:design-system` — consume the tokens from the Claude Design export; do not invent your own.
4. `write-like-a-human` — all English text: docs, commits, comments, error messages.
5. `greek-how-to-write` + `hellenic-linguist` — every Greek string. Greek is the default UI language. Run both over the i18n file before each release. Monotonic only, Greek question mark (;), no καθαρεύουσα.
6. `okypy-brand-guidelines` — Lato, green `#8BC53F`, blue `#069FEC` / `#1B75BB`, text grey `#58595B`.
7. `design:design-handoff` — read the Claude Design handoff spec before implementing a screen. Where the spec is silent, raise a question; never invent the value.
8. `engineering:deploy-checklist` — before every release to the ΟΚΥπΥ server, pilot included.

## 0.1 Agent setup

Run this as an orchestrated build, not one long session.

- **Project manager agent: Claude Fable 5.1.** Holds the plan, the milestone order in §14 and the traceability table in §13. It decomposes work, assigns it, reviews what comes back against the acceptance criteria, keeps the ADR log, and rejects anything arriving without its Greek and English strings and its manual section. It does not write production code itself.
- **Sub-agents by difficulty.** Architecture, the cost engine, the ICRA rules engine, offline sync and conflict resolution, security and row-level access, and the Excel migration go to **Opus**. CRUD screens, forms, tables, list views, i18n work, test scaffolding, seed data and documentation go to **Sonnet 4.6**.
- **Escalation rule.** A Sonnet sub-agent that hits a decision touching the data model, money, clinical safety or access control stops and hands back to the PM agent, which decides or escalates to Opus. It never guesses.
- **Every sub-agent** loads the skills above that apply to its task, cites R-numbers in its output, and returns a short written summary the PM agent can review without reading the diff.

## 1. What this is

A single system for ΟΚΥπΥ — one legal entity, nine hospitals plus Central Administration — covering the whole life of a built asset: capital project → contract → construction → handover → asset register → maintenance → replacement. Today this lives in Excel files held by each hospital's Technical Services, with cost visibility arriving weeks late from SAP.

Scope decisions already taken:

- **Multi-unit from day one.** One tenant, nine hospitals plus three services (ΔΥΨΥ, Πρωτοβάθμια Φροντίδα Υγείας, Υπηρεσία Ασθενοφόρων). Pilot data is one hospital's ~40 live projects; the model must not assume that.
- **Standalone** product and repo. Not a module of the eFinance portal.
- **Internal users only.** No contractor logins in v1. Contractor correspondence is attached by ΟΚΥπΥ staff. Design the contract and claim tables so an external portal can be added later without a migration.
- **Starts at awarded contract.** Tender stage stays in the e-Procurement world; the system holds the tender reference, award date, award decision document.
- **Budget control is warn-and-flag,** never a hard block. Finance decides on blocking later.
- **Assets include biomedical equipment** alongside building services and fixed plant.
- **Preventive maintenance SLAs exist** and will be uploaded — build the importer, don't generate schedules from scratch.
- **SAP is file-extract first,** MCP interface later. Build the ingestion layer so the source is swappable.
- **Offline PWA** for site work: defects, inspections, permits, meter and condition readings.
- **Shutdown / permit-to-work is a first-class module** with clinical approvers, not a form attached to a project.

Personas:

- **Τεχνικές Υπηρεσίες — Μηχανικός έργου** (project engineer). Runs 10–20 projects. Lives in cost, variations, claims, site instructions.
- **Προϊστάμενος Τεχνικών Υπηρεσιών** (head of estates, per hospital). Portfolio view, approvals, maintenance backlog.
- **Συντηρητής / Τεχνίτης** (technician). Phone only. Work orders, photos, sign-off, often in a plant room with no signal.
- **Οικονομική Διεύθυνση** (finance). Budget vs commitment vs actual, cash flow, accruals at year end.
- **Κλινικός εγκριτής** (Infection Control, Nursing, Ward manager). Only ever sees shutdown and permit requests that touch their area.
- **Διοίκηση** (CEO office, Board). Read-only programme dashboard.
- **Διαχειριστής** (admin) and **Ελεγκτής** (internal audit, read-only with full audit-trail access).

## 2. Ideas worth stealing (build these — they are the point)

| From | Idea | How it lands here |
|---|---|---|
| Kahua (healthcare suite) | Asset-centric project management: the asset, not the project, is the permanent record | The spine in §4. Projects are events in an asset's life. Whole-life cost per asset falls out for free. |
| Kahua | Infection control and interim life safety as shipped modules, not attachments | Module M5, §6. |
| ASHE ICRA 2.0 (2022) | Activity type (A–D) × patient risk group (Low/Medium/High/Highest) → precaution class I–V, with a printed permit | The ICRA wizard computes the class from the matrix; the class drives the mandatory control checklist and who must approve. Class II is never valid for construction or renovation; Type C in a high-risk area is Class IV, not III. Ship the matrix as versioned reference data, not hardcoded. |
| Procore | Field-first mobile: photo, mark up, assign, done, in 30 seconds | Defect and inspection capture in the PWA. Photo → EXIF location → asset suggestion. |
| e-Builder / Oracle Unifier | Owner-side cost model: approved budget, commitment, actual, forecast, cost-to-complete as four separate ledgers | §7. Never one "spend" number. |
| IBM Maximo / Nuvolo | Criticality-weighted asset register driving PM frequency and spares | Criticality 1–5 per asset; PM frequency and SLA response time derive from it. |
| NHS ERIC backlog reporting | Backlog maintenance costed and banded by risk (high / significant / moderate / low) | Every unfunded defect carries an estimated cost and a risk band. The sum, by hospital, is the objective input to next year's capital programme. |
| Linear / Gmail | Inbox triage people already know | Approvals inbox with keyboard shortcuts: `a` approve, `r` return with comment, `f` forward, `x` close. |
| Planon / Archibus | Space and floor-plan context | Area hierarchy in §4, floor-plan pin drop on the asset record (SVG overlay, no CAD engine in v1). |

Three things nothing on the market does for a network like ΟΚΥπΥ. Build them:

1. **Ημερολόγιο κλινικής διατάραξης** — one calendar across all nine hospitals showing every planned works-driven closure or degradation of a clinical area (theatre, ICU, oncology, imaging, isolation rooms). Clinical management sees it before it happens, not on the morning it starts.
2. **Backlog → capital pipeline loop.** Three corrective work orders on the same asset within twelve months, or cumulative repair cost above X% of replacement value, auto-drafts a replacement business case with the history attached. Stops "we keep fixing it" running for years unseen.
3. **Cost-centre allocation out to the DRG work.** Every asset carries the SAP cost centre and the clinical area it serves. Capital and maintenance spend therefore allocates to theatre / ward / department, which feeds the cost-per-case analysis that already exists. This is the reason to build rather than buy.

## 3. Architecture

Same stack as eArchive so one ops team supports both. Deviate only with a written ADR.

- **Frontend**: Next.js (App Router) + React + TypeScript, Tailwind on the exported tokens. TanStack Query and Table, react-hook-form + zod. `next-intl`, `el` default, `en` second.
- **PWA**: same Next.js app. Service worker + IndexedDB (Dexie) outbox for the offline surfaces in §8.
- **API**: NestJS, REST + OpenAPI 3.1 checked into the repo. Zod schemas shared with the frontend.
- **DB**: PostgreSQL 16. Row-level security by org unit. `pg_trgm` for Greek fuzzy search on asset and supplier names.
- **Files**: MinIO (S3 API) on-prem, server-side encryption, object lock on signed contracts and certificates. Photos resized server-side; keep the original.
- **Search**: OpenSearch with the Greek analyser (stemmer + ICU folding, so «ΑΝΤΛΙΑ», «αντλία», «αντλια» all match).
- **Queue**: BullMQ on Redis — SAP ingestion, PM work-order generation, notifications, SLA escalation, photo processing.
- **Auth**: Entra ID via OIDC. Groups map to roles. Clinical approvers are an Entra group per hospital.
- **Scheduling**: a nightly job generates due PM work orders; a separate job recalculates forecast and SLA state.
- **Deployment**: Docker Compose for dev; Compose or k3s on the ΟΚΥπΥ on-prem server. Nightly `pg_dump` + MinIO replication, monthly test restore, logged.
- **Observability**: structured JSON logs, OpenTelemetry, an admin-readable health page showing last SAP ingest, queue depth, failed jobs.

Ask before deviating on DB, object store or auth. The rest is yours.

## 4. Data model — the spine

```
org_unit → building → floor → area → asset
                                  ↑
project → contract → variation / claim
   ↓                      ↓
work_package          payment_certificate
   ↓
shutdown_permit (ICRA / ILSM)      work_order → work_order_task
```

Core tables (columns are the minimum, add what the modules need):

```
org_unit        id, code, name_el, name_en, type (HOSPITAL|SERVICE), directorate,
                cost_centre, timezone
building        id, org_unit_id, code, name_el, gross_area_m2, year_built, storeys
floor           id, building_id, code, name_el
area            id, floor_id, code, name_el, area_type (THEATRE|ICU|WARD|OPD|LAB|PLANT|OFFICE|OTHER),
                patient_risk_group (LOW|MEDIUM|HIGH|HIGHEST),   -- ICRA Table 2
                cost_centre, beds, clinical_owner_group_id

project         id, code, org_unit_id, title_el, category (NEW_BUILD|RENOVATION|SMALL_WORKS|
                EQUIPMENT|MAINTENANCE_CAPITAL|IT), phase (IDEA|APPROVED|TENDERED|AWARDED|
                IN_PROGRESS|PRACTICAL_COMPLETION|DEFECTS_LIABILITY|CLOSED),
                sponsor_id, project_manager_id, business_case_id,
                approved_budget, funding_source (STATE_BUDGET|EU|DONATION|OWN),
                budget_year_from, budget_year_to,
                planned_start, planned_finish, actual_start, actual_finish,
                rag (GREEN|AMBER|RED), rag_reason, sap_wbs, tender_reference
project_area    project_id, area_id                     -- which clinical areas the project touches
milestone       id, project_id, title_el, baseline_date, forecast_date, actual_date, is_gate
risk            id, project_id, description_el, likelihood, impact, owner_id, mitigation_el, status
issue           id, project_id, description_el, raised_by, due_date, status

contractor      id, name, vat_number, registration_no, category, sap_vendor_id, blacklisted
contract        id, project_id, contractor_id, contract_no, type (LUMP_SUM|BOQ|FRAMEWORK|
                MEASURE_TERM|SUPPLY|SERVICE), award_date, award_decision_doc_id,
                original_value, current_value, currency, start_date, completion_date,
                extension_days, retention_pct, performance_bond_value, bond_expiry,
                liquidated_damages_per_day, defects_liability_months, sap_po_number
boq_item        id, contract_id, item_no, description_el, unit, qty, rate, amount
variation       id, contract_id, number, description_el, reason (CLIENT_CHANGE|SITE_CONDITION|
                DESIGN_ERROR|STATUTORY|OTHER), value, time_impact_days, status, approved_by, approved_at
payment_cert    id, contract_id, number, period_from, period_to, work_done_value,
                materials_on_site, retention_held, previous_certified, net_payable,
                status (DRAFT|ENGINEER_APPROVED|FINANCE_RECEIVED|PAID), sap_invoice_ref, paid_date
site_instruction id, contract_id, number, text_el, issued_by, issued_at, cost_impact_flag
rfi             id, contract_id, number, question_el, answer_el, raised_at, answered_at, sla_due

asset           id, org_unit_id, area_id, tag, name_el, asset_class (BUILDING_FABRIC|HVAC|
                ELECTRICAL|MEDICAL_GAS|WATER|FIRE|LIFT|BIOMEDICAL|IT|OTHER),
                manufacturer, model, serial_no, installed_date, commissioned_date,
                source_project_id, source_contract_id, capital_cost,
                warranty_end, expected_life_years, replacement_year, replacement_cost_est,
                criticality (1..5), condition (A..E), condition_assessed_at,
                parent_asset_id, serves_area_ids[], cost_centre, sap_asset_no, status
asset_document  asset_id, document_id, kind (OM_MANUAL|CERT|COMMISSIONING|WARRANTY|DRAWING|PHOTO)
asset_reading   id, asset_id, taken_at, reading_type, value, unit, taken_by

sla             id, contractor_id, asset_class, criticality, response_hours, resolution_hours,
                coverage (24x7|OFFICE), penalty_terms_el, valid_from, valid_to
pm_schedule     id, asset_id, task_set_id, frequency_months, next_due, responsible (IN_HOUSE|CONTRACT),
                contractor_id, sla_id, statutory boolean, statutory_reference
work_order      id, no, org_unit_id, asset_id, area_id, type (PM|CORRECTIVE|INSPECTION|STATUTORY),
                priority (P1..P4), reported_by, reported_at, description_el,
                assigned_to, contractor_id, sla_id, sla_due_at, sla_state (GREEN|AMBER|RED|BREACHED),
                status (NEW|ASSIGNED|IN_PROGRESS|ON_HOLD|COMPLETED|CANCELLED),
                completed_at, downtime_minutes, labour_hours, materials_cost, contractor_cost,
                failure_code, cause_code, remedy_code, permit_id, offline_uuid
defect          id, source (HANDOVER|INSPECTION|WORK_ORDER|CONDITION_SURVEY), asset_id, area_id,
                contract_id, description_el, photo_ids[], estimated_cost,
                risk_band (HIGH|SIGNIFICANT|MODERATE|LOW), funded boolean, target_project_id, status

shutdown_permit id, no, org_unit_id, project_id, contract_id, requested_by, requested_at,
                systems[] (ELECTRICAL|HVAC|MEDICAL_GAS|WATER|FIRE|IT|STEAM|DRAINAGE),
                affected_area_ids[], planned_start, planned_end, actual_start, actual_end,
                icra_activity_type (A|B|C|D), icra_risk_group, icra_class (I..V),
                ilsm_required boolean, ilsm_measures[], contingency_plan_el,
                status (DRAFT|SUBMITTED|CLINICAL_REVIEW|APPROVED|ACTIVE|CLOSED|REJECTED),
                closed_by, closed_at, closeout_checklist jsonb
permit_approval permit_id, role (INFECTION_CONTROL|NURSING|TECHNICAL|SAFETY|HOSPITAL_DIRECTOR),
                approver_id, decision, comment_el, decided_at
icra_matrix     version, activity_type, risk_group, class, controls jsonb   -- versioned reference data

budget_line     id, org_unit_id, budget_year, category, sap_gl, approved_amount, revised_amount
cost_txn        id, project_id, contract_id, work_order_id, asset_id, budget_line_id,
                txn_type (COMMITMENT|ACTUAL|ACCRUAL), source (SAP_EXTRACT|SAP_MCP|MANUAL),
                source_ref, doc_date, posting_date, amount, currency, description, imported_batch_id
import_batch    id, source, file_name, period, rows_in, rows_matched, rows_unmatched, imported_by, imported_at
document        id, entity_type, entity_id, kind, title_el, mime, size, sha256, version, object_key
audit_log       id, actor_id, entity_type, entity_id, action, before jsonb, after jsonb, at, ip
```

**Why `org_unit` and not `hospital`.** The capital register holds 113 live projects and 20 of them belong to units that are not hospitals: ΔΥΨΥ (11), Πρωτοβάθμια Φροντίδα Υγείας (5) and Υπηρεσία Ασθενοφόρων (4). Modelling them as pseudo-hospitals makes every "per hospital" report quietly wrong. `org_unit.type` is HOSPITAL or SERVICE, `org_unit.directorate` is the grouping above it (ΛΕΜΕΣΟΥ–ΠΑΦΟΥ, ΛΕΥΚΩΣΙΑΣ, ΛΑΡΝΑΚΑΣ–ΑΜΜΟΧΩΣΤΟΥ, ΔΥΨΥ, ΠΦΥ, ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ) and is stored, never derived from the unit — Troodos sits under Λεμεσού–Πάφου and nothing in its name says so. Reports offer both levels: by unit and by directorate. Seed the eleven units and their aliases from §3 of the migration mapping, `OKYPY-CAPEX-03`.

Every mutating endpoint writes `audit_log`. No exceptions, no soft edits that bypass it.

## 5. Modules

| # | Module | Covers |
|---|---|---|
| M1 | Χαρτοφυλάκιο (portfolio dashboard) | All projects across nine hospitals, budget/commitment/actual/forecast, RAG, exceptions, drill-through |
| M2 | Έργα (capital projects) | Business case, approval, phases, milestones, team, risks, issues, photos, monthly report |
| M3 | Συμβάσεις & κατασκευή | Contracts, BOQ, RFIs, site instructions, variations, payment certificates, defects, handover |
| M4 | Κόστος | Four ledgers, SAP ingestion, forecast, cash flow, budget warnings, year-end accruals |
| M5 | Διακοπές & άδειες εργασίας | Shutdown requests, ICRA, ILSM, permit-to-work, clinical approvals, disruption calendar |
| M6 | Πάγια (assets) | Register, hierarchy, criticality, condition, warranty, O&M docs, whole-life cost, replacement forecast |
| M7 | Συντήρηση | PM schedules from uploaded SLAs, corrective and statutory work orders, backlog, contractor performance |
| M8 | Έγγραφα | Drawings, contracts, certificates, manuals, versioning, links to eArchive protocol numbers |
| M9 | Αναφορές | Board pack, capital programme, contractor scorecard, backlog by risk band, asset lifecycle cost, Excel/PDF export |
| M10 | Γλώσσα & εγχειρίδια | Full Greek/English parity, in-app contextual help, embedded user manuals per persona, printable PDF guides generated from the same source |

## 6. Shutdown and permit module (M5) — the differentiator, get it right

Flow: request → ICRA wizard → ILSM check → routing → clinical approval → active → closeout.

1. **Request.** Engineer picks systems affected and the areas affected. The area record already carries its patient risk group, so the system knows what is downstream. Pulling a riser feeds theatres two floors up — model that with `serves_area_ids` on the asset, and warn on indirect impact.
2. **ICRA wizard.** Four steps mirroring ASHE ICRA 2.0: activity type A–D, patient risk group (highest of all affected areas), class I–V from the versioned matrix, surrounding-area assessment (above, below, lateral, behind, in front). Class III and above generates a printable permit with the mandatory control checklist. Class II is invalid for construction or renovation — the wizard must refuse it. Type C touching a high-risk group resolves to Class IV. Ship the matrix as reference data with a version and effective date; ΟΚΥπΥ Infection Control approves the local edition and can amend it without a release.
3. **ILSM.** If the work affects fire detection, suppression, compartmentation, exits or evacuation routes, ILSM is mandatory: interim measures list, fire watch, extra drills, notification to the fire officer.
4. **Routing.** Approvers derive from the affected areas: Infection Control always for Class III+, ward/department manager for every clinical area touched, Nursing for inpatient areas, Technical Services head always, Hospital Director for anything above a threshold duration or any Class V.
5. **Active state.** Permit is live only inside its window. Overrun flips it to breach and notifies the head of estates and the area owner. Print view fits A4 and gets posted on the barrier.
6. **Closeout.** Checklist: barriers removed, area cleaned, air balance restored, systems tested and returned, fire systems re-enabled, clinical owner signs acceptance. No closeout, no permit closure, and an open permit blocks the project milestone.
7. **Disruption calendar.** Every approved permit lands on a network-wide calendar filtered by hospital, area type and system. Clash detection: two permits closing redundant halves of the same system, or two theatres in one hospital, raise a warning at submission.

## 6.1 Bilingual operation and embedded manuals (M10)

The system is bilingual end to end, and the manual lives inside it. Nobody hunts for a PDF on a shared drive.

**Language.** Greek is the default and the language of record; English is a full second language, not a partial translation. One `el.json` and one `en.json`, same keys, and a CI check that fails the build when a key exists in one and not the other. Every screen, email, notification, validation message, PDF export and printed permit renders in both. The language toggle is per user and persists. Data the user types stays in the language they typed it — the system never machine-translates content, only its own interface.

Greek strings pass `greek-how-to-write` and `hellenic-linguist` before every release: monotonic, Greek question mark (;), no καθαρεύουσα, verbs over noun chains. English strings pass `write-like-a-human`.

**Embedded manuals.** Written in Markdown in the repo under `/docs/manual/{el,en}/`, versioned with the code, and rendered three ways from that one source:

1. **Contextual help.** A `?` on every screen opens a drawer with the section of the manual for that screen. The mapping screen → manual section is a config file, checked in CI so a new screen cannot ship without a help section.
2. **Help centre.** A searchable in-app section with the full manual, search running over Greek and English text with the same analyser as the main search (R16 stemming rules apply).
3. **Printable PDF.** One guide per persona — project engineer, head of estates, technician, finance, clinical approver — generated on release, downloadable from inside the app and carrying the version number and date. These are what get handed out in training.

Each manual section opens with what the screen is for in two sentences, then the steps, then what goes wrong and what to do about it. Screenshots are generated by the test suite, so they never go stale. A feature is not done until its manual section is written in both languages — that is part of the definition of done in §15, not a later task.

## 7. Cost engine (M4)

Four independent ledgers per project and per contract. Never collapse them into one number.

- **Approved budget** — from `budget_line`, by year. Multi-year projects carry an annual profile.
- **Commitments** — contract value plus approved variations, or the SAP PO balance once ingestion is live.
- **Actuals** — SAP postings, matched to project by WBS or PO, to contract by PO, to asset where the work order carries one.
- **Forecast final cost** — committed + approved variations + pending variations at a probability weight + a contingency the engineer sets. Cost-to-complete = forecast − actual.

Warn-and-flag rules (R31): commitment above the year's approved budget line; forecast above approved budget; cumulative variations above 10% of original contract value; payment certificate that would take cumulative certified above current contract value; retention released before defects liability ends. Each fires a flag on the project, an entry in the exceptions list and an email to the head of estates. None of them block.

**SAP ingestion.** Phase 1: the user drops the monthly extract files (ME2N commitments, KSB1 / FBL5N actuals) into an upload screen. The importer maps columns, matches on WBS then PO then cost centre, writes `import_batch` and `cost_txn`, and presents an unmatched queue for manual allocation — this queue is where the value is, so make it fast: bulk-assign, remember previous allocations, suggest by supplier and text similarity. Phase 2: swap the file reader for the SAP MCP interface behind the same `CostSource` interface. Nothing above the interface changes.

Year-end: accrual proposal listing work certified but not invoiced, per project and cost centre, exportable to Excel with live formulas.

## 8. Offline PWA

Offline surfaces only: work order execution, defect capture, inspection checklists, meter and condition readings, permit closeout sign-off. Everything else is online.

- IndexedDB outbox, each record with a client-generated `offline_uuid` for idempotent replay.
- Sync on reconnect, newest-write-wins per field with a conflict list for a human when both sides changed the same field.
- Photos queue locally, compress to max 1600px before upload, keep EXIF timestamp and location.
- Pre-cache the technician's assigned work orders, their assets and the asset QR map for the current shift.
- QR code on the asset label opens the asset directly. Print sheets of labels from the asset register.
- Big touch targets, works in gloves, readable in a dark plant room. Test at 390px.

## 9. Migration from Excel

The existing project spreadsheets are the v1 seed. Build a migration CLI, not a one-off script:

- Sheet-per-hospital and sheet-per-project layouts both exist. Write an inspector that reports detected columns per file and asks for a mapping, saved as a reusable YAML profile.
- Import in this order: hospitals and areas, contractors, projects, contracts, budget lines, assets, PM schedules and SLAs, open defects.
- Every import produces a reconciliation report: rows in, rows created, rows rejected with reason, and a value total that must tie back to the source file. Do not import silently.
- Keep the source file hash and a link from each record to the file it came from, for the first year.

## 10. Roles and permissions

Row-level by org unit. Central Administration sees all. Roles: `admin`, `estates_head`, `project_engineer`, `technician`, `finance`, `clinical_approver`, `executive_readonly`, `auditor_readonly`. Clinical approvers see only permits touching their areas and nothing else. Auditor sees everything read-only, including the audit log, and cannot be edited by admin. Segregation: whoever approves a variation cannot be the person who raised it, and payment certificate approval requires a different user from the one who created it.

## 11. Reporting (M9)

Board and management set, all exportable to Excel with live formulas and to PDF:

- Capital programme by hospital: approved, committed, spent, forecast, slippage, % of year elapsed vs % spent.
- Exceptions: projects RAG amber or red with reason and owner.
- Contractor scorecard: on-time completion, variation rate, defect rate, SLA breach rate, claim accuracy.
- Maintenance backlog by hospital and risk band, with the funded / unfunded split.
- Asset lifecycle: capital cost, cumulative maintenance cost, downtime, remaining life, replacement year.
- Clinical disruption: theatre and ICU hours lost to planned works, by hospital and month.
- Statutory compliance: lifts, pressure vessels, medical gas, fire systems — due, done, overdue.

Excel exports carry live formulas, not pasted values, and follow the house convention: blue inputs, black formulas, green cross-sheet links, amber assumptions.

## 12. Non-functional

Greek default, English full second language (§6.1). WCAG 2.1 AA. p95 page load under 2s on the hospital LAN. Portfolio queries over 500 projects and 50k work orders must stay under 500ms — index accordingly. All timestamps stored UTC, displayed Europe/Nicosia. Retention: project and contract records permanent, work orders 10 years, photos 7 years, audit log permanent. GDPR: personal data is limited to staff names and contact details; no patient data enters this system, and the schema must make that impossible by design.

## 13. Requirements traceability

| R | Requirement | Module |
|---|---|---|
| R01 | Entra ID SSO with MFA; role and hospital-scoped access | Platform |
| R02 | Eight personas per §1 with distinct home screens | Platform |
| R03 | Portfolio dashboard across nine hospitals with drill-through | M1 |
| R04 | Project lifecycle with phases and gate approvals | M2 |
| R05 | Business case with option appraisal and benefit statement | M2 |
| R06 | Milestones with baseline vs forecast vs actual | M2 |
| R07 | Risk and issue registers per project | M2 |
| R08 | Contract register with BOQ, bond and retention terms | M3 |
| R09 | RFI and site instruction logs with SLA timers | M3 |
| R10 | Variation workflow with reason coding and segregation of duties | M3 |
| R11 | Payment certificate workflow through to SAP invoice reference | M3 |
| R12 | Defects list at handover, tracked to close within defects liability | M3 |
| R13 | Four-ledger cost model per §7 | M4 |
| R14 | SAP extract import with unmatched-allocation queue | M4 |
| R15 | Swappable cost source for later SAP MCP interface | M4 |
| R16 | Forecast final cost and cost-to-complete | M4 |
| R17 | Cash-flow profile by month and year | M4 |
| R18 | Year-end accrual proposal | M4 |
| R19 | Shutdown request with system and area impact, including indirect | M5 |
| R20 | ICRA 2.0 wizard producing class I–V from versioned matrix | M5 |
| R21 | ILSM trigger and interim measures checklist | M5 |
| R22 | Clinical approval routing derived from affected areas | M5 |
| R23 | Permit print view, active-window enforcement, overrun breach | M5 |
| R24 | Permit closeout checklist with clinical acceptance | M5 |
| R25 | Network-wide clinical disruption calendar with clash detection | M5 |
| R26 | Asset register with hierarchy, criticality, condition, warranty | M6 |
| R27 | Asset linked to source project, contract and capital cost | M6 |
| R28 | O&M documents, certificates and commissioning pack per asset | M6 |
| R29 | QR label printing and scan-to-asset | M6 |
| R30 | Whole-life cost and replacement forecast per asset | M6 |
| R31 | Budget warning rules, warn-and-flag only | M4 |
| R32 | PM schedule generation from uploaded SLAs and statutory rules | M7 |
| R33 | Work orders with SLA timers and escalation | M7 |
| R34 | Failure / cause / remedy coding | M7 |
| R35 | Backlog costed and banded by risk | M7 |
| R36 | Backlog-to-capital auto-draft business case | M7 |
| R37 | Contractor performance scorecard | M7/M9 |
| R38 | Document versioning, eArchive protocol link | M8 |
| R39 | Reporting set per §11 with Excel and PDF export | M9 |
| R40 | Offline PWA for the five field surfaces | Platform |
| R41 | Excel migration CLI with reconciliation report | Platform |
| R42 | Full audit log on every mutation, immutable to admin | Platform |
| R43 | Greek default UI, English second | Platform |
| R44 | Cost-centre allocation of capital and maintenance spend | M4/M6 |
| R45 | Biomedical equipment in the same register as building assets | M6 |
| R46 | Full Greek/English parity on every string, with a CI check for missing keys | M10 |
| R47 | Per-user language preference, persisted, applied to exports and emails | M10 |
| R48 | Contextual help drawer on every screen, mapped in a checked file | M10 |
| R49 | Searchable in-app help centre over the full manual, both languages | M10 |
| R50 | Per-persona printable PDF guides generated from the manual source at release | M10 |

## 14. Build order

- **M0 — Foundations (2 weeks).** Repo, CI, Docker, Postgres, Entra auth, RLS, audit log, i18n scaffold, design tokens, org_unit/building/floor/area seeded with the real ΟΚΥπΥ structure. Done when a user can log in and see their own unit's area tree and nothing else.
- **M1 — Projects and contracts (3 weeks).** R04–R12 minus payment certificates. Excel migration of the pilot hospital's 40 projects. Done when the head of estates stops opening the spreadsheet.
- **M2 — Cost (3 weeks).** R13–R18, R31. Done when one month of SAP extract imports with under 5% unmatched after the allocation queue.
- **M3 — Shutdown and permits (3 weeks).** R19–R25. Done when Infection Control approves a real Class IV permit in the system and the paper form is retired at the pilot hospital.
- **M4 — Assets (2 weeks).** R26–R30, R45. Done when a technician scans a QR label and sees the full history.
- **M5 — Maintenance (3 weeks).** R32–R37, plus the offline PWA (R40). Done when a month of PM work orders generate, dispatch and close without a spreadsheet.
- **M6 — Reporting and rollout (2 weeks).** R39, then hospital-by-hospital rollout.

Language and manuals (M10, R46–R50) are not a milestone of their own. Each milestone ships its own Greek and English strings and its own manual sections; the PM agent rejects work that arrives without them. The per-persona PDF guides are assembled at M3 for the pilot and refreshed at every release after that.

Every deployment, pilot included, runs `engineering:deploy-checklist` first: migrations rehearsed on a copy, rollback path written down, backup verified, feature flags listed, and the checklist archived with the release tag.

Each milestone ships with migrations, seed data, integration tests, updated OpenAPI, and a one-page Greek release note for users.

## 15. Definition of done

No feature merges without: unit tests on business rules (ICRA class resolution, SLA state, forecast maths, budget warnings, number allocation), an integration test on the happy path and one failure path, Greek and English strings present for every visible label, the manual section written in both languages and mapped to the screen, an audit-log assertion, a 390px screenshot, and a passing accessibility check. Seed data ships 9 hospitals, ~40 projects with real-shaped values, 200 assets, 50 work orders and 5 permits at different states so every screen has something in it on first run.
