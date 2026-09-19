# ADR-0025 — One CAPEX budget code per contract

**Status:** accepted · 19/09/2026

## Context

`docs/briefs/README.md`'s errata already recorded the owner's decision the day it was made: *"One CAPEX budget code per contract. Owner decision 19/09/2026; eFinance's draft contract assumes it."* The "draft contract" is ADR-0022's loopback contract: `PUT /api/v1/capital/contracts/{cap_ref}` (INTEGRATION-eFinance-eMAP-eCapital.md §5) carries `budget_code` as one of the two fields eFinance uses to check a re-submitted contract has not silently moved to a different budget line (`entity_code` is the other). eCapital cannot fill that field on a write it has not built yet, but it can — and, per the errata, must — have somewhere to keep the answer to "which code" before that write exists, because the answer is a fact about the contract today, not something that starts being true only once the integration is built.

The codes themselves are eFinance's: twenty CAPEX budget codes, the capital subset of its 203 operational ones (INTEGRATION-eFinance-eMAP-eCapital.md §2), for example `7402` (medical and other equipment), `7501` (machinery and equipment), `7502` (air conditioning), `7551` (passenger vehicles) and `7585` (ambulances) — the five the owner named. eFinance has not published the other fifteen, and the read route this decision would rather use, `GET /api/v1/master/budget-codes?kind=capex`, does not exist yet either (§4: *"Not yet built"*). Waiting for both before eCapital's contract form could ask for a budget code would mean shipping S07a without a field ADR-0022's own write route already assumes, which is the wrong order to build the two ends of one integration in.

## Decision

### 1. A contract carries exactly one CAPEX budget code

`contract.budget_code` (migration `0013_contract_budget_code.sql`), nullable — a contract recorded before this column existed has none, and nothing back-fills it by guessing — but required by the API on create, and by S07a's own form before it lets a person start one. Editable afterwards by the same roles that edit a contract at all (`admin`, `estates_head`, `project_engineer`, subject to unit access), including clearing it back to nothing.

One code, not a set: CAPEX-01 §4's model already has no field for "which fraction of the contract sits under which code", and eFinance's own write route has one `budget_code`, singular. A contract that genuinely spans two budget codes is a decision for the owner to make explicitly (split it into two contracts, or pick the code that dominates), not a data model eCapital invents to avoid asking.

### 2. eCapital carries its own reference table, refreshed from eFinance

`ecapital.budget_code` (`code` text primary key, `description_el`, `description_en`, `category`, `is_capex`, `active`, `source`, `synced_at`) is a small reference table with the same shape and the same row-level-security discipline as `org_unit`: every signed-in role reads it, only `admin` and `finance` write it. `contract.budget_code` references it, so a code a contract carries is always one the table can describe — no free-text budget code, ever.

`GET /budget-codes?kind=capex` lists the active rows; `POST /budget-codes/sync` (`admin`/`finance` only) refreshes them from a `BudgetCodeSourceReader` — `EFinanceBudgetCodeReader`, which calls eFinance's own `GET /api/v1/master/budget-codes?kind=capex` over the ADR-0022 loopback contract when `EFINANCE_URL` and `EFINANCE_TOKEN` are both configured, or `SeedBudgetCodeReader` otherwise. The sync upserts by code and marks whatever it no longer sees `active = false` — deactivated, never deleted, because `contract.budget_code`'s foreign key is `on delete restrict` and a code a contract already carries is not eFinance's to remove from under it.

### 3. The twenty rows today are placeholders for fifteen of them, and everyone building against them has to know that

Migration 0013 seeds twenty rows: the five the owner named by number and description, real eFinance text, and fifteen invented ones in the same numeric band, each carrying «(προσωρινή περιγραφή)» in `description_el` and "(placeholder description)" in `description_en`. `source = 'SEED'` says the same thing in a column a query can filter on. **The real fifteen come from eFinance** — either published by hand once somebody there compiles the list, or read automatically the day `GET /api/v1/master/budget-codes?kind=capex` exists and `POST /budget-codes/sync` is pointed at it. Nothing in eCapital's code has to change for that day to arrive; only the fifteen placeholder rows do, by a sync, not a migration.

This ADR does not claim the five real ones are complete or the fifteen placeholders are close guesses at what eFinance actually calls them — a name like "Έργα υποδομής" for `7562` is a plausible CAPEX bucket, not a confirmed one. Anyone reading a placeholder row off a screen or a report should read the `source` column, or ask before treating the description as authoritative.

### 4. Existence and active are checked here; overspend is not

The API refuses a `budgetCode` that does not name an active row — `errors.budgetCodeNotFound`, 400, in both languages — the same way it refuses a contractor id or a project id nobody else can see. That is a referential check, not a budget check: eCapital does not ask eFinance whether the code has money left, and does not warn or block a contract for spending against one that is exhausted. **Warn-not-block for money stays on eFinance's side of the ownership split** ADR-0022 already draws — eFinance owns execution against budget codes, eCapital owns planning and commitment — and CAPEX-01 §1's own rule ("budget control is warn-and-flag, never a hard block") already governs eCapital's *own* budget lines (R31, ADR-0021) without needing a second copy of the same discipline built against a budget axis eCapital does not hold the numbers for.

## Consequences

- S07a asks for a budget code on every new contract, from a list of twenty codes that will read as smaller and less certain than the real eFinance twenty until someone there confirms the other fifteen. That is a known, temporary state, not a bug to file.
- `POST /budget-codes/sync` is safe to call at any time, configured or not: unconfigured, it re-asserts eCapital's own seed and changes nothing that was already right; configured, it is the one place eFinance's real text enters the system.
- The day eFinance's read endpoint exists, moving from placeholder to confirmed text is an operational action (run the sync, or wait for whatever schedule ends up calling it), not a schema change — `contract.budget_code` already points at the same table either way.
- If eFinance's write route (ADR-0022) is ever built, `budget_code` is one of the fields it needs and this ADR is why eCapital already has an answer for it, rather than that route being the first place the question comes up.
