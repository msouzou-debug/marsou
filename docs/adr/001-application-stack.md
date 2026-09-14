# ADR-001 — Application stack for the ΤΑΕΠ costing tool

**Status:** decided, pending sign-off from Τμήμα Πληροφορικής
**Date:** 2026-09-14
**Answers:** build brief §2 "step zero" and §14 Q1, and incidentally Q7.

## The question

The brief said inspect eFinance before Phase 1, and offered two defaults: Next.js/PostgreSQL if
eFinance is greenfield or Node, ASP.NET Core/SQL Server if it is .NET/IIS — calling the second
likely, on the strength of the 2024 PATSOFT specification asking for Windows Server and SQL Server
Express.

## What eFinance actually is

Neither. It is a **Python / Flask** application, on-prem, and it has been in build since July 2026.
Source: `msouzou-debug/finance-app`, inspected directly at commit `2e719aa`.

| Layer | eFinance today | Evidence |
|---|---|---|
| Runtime | Python 3, Flask ≥ 3.0 | `requirements.txt`, `app.py` |
| Server | Gunicorn on Ubuntu 22.04 LTS, systemd unit `finance.service`, port 5004, `/opt/finance` | `deploy.sh`, `DESIGN.md` |
| Database | MySQL in production, SQLite in dev — one dual-mode layer, `%s` placeholders rewritten to `?` for SQLite | `app.py` DB section |
| Auth | Local accounts **plus Active Directory over LDAP** (`ldap3`) | `app.py` ~L1177–1205 |
| PDF | `reportlab` | `requirements.txt`, used in `oayrecon.py` |
| Excel | `openpyxl` | `requirements.txt` |
| i18n | Greek is the source language; `translations/en.json` keyed on the **exact Greek string** | `app.py` i18n section |
| Scale | 1226 tests passing as of 2026-08-15 | `CLAUDE.md` |

## Decision

Build the ΤΑΕΠ tool as **`taep.py`, a module inside eFinance**, following the binding module
contract in `DESIGN.md`. Not a separate application.

```python
SCHEMA_STATEMENTS = [...]   # CREATE TABLE IF NOT EXISTS, with {AUTO_INCREMENT} / {ENGINE}
ALTER_STATEMENTS  = [...]   # idempotent
def seed(ctx): ...          # idempotent, runs at boot — loads seed/*.csv
def register(app, ctx): ... # routes as closures over ctx
```

Modules never import `app.py`. Everything they need arrives in `ctx`.

The costing engine stays a **pure function with zero I/O**, as the brief requires — the same shape
`bankrec.py` and `oayrecon.py` already use ("engine (pure functions) + routes"). That part of the
brief survives the stack change intact, which is the point of having written it that way.

## What this changes in the build brief

Seven things. None is a judgement call — they follow from what eFinance is.

1. **PostgreSQL features are unavailable.** No `unaccent`, no `pg_trgm`, no `JSONB`. §11's search
   requirement is met instead by the accent-insensitive normaliser already written in
   `oayrecon.py` (Unicode NFD, combining marks stripped, final sigma folded). Reuse it; do not
   write a second one.

2. **The rate-overlap exclusion constraint cannot exist.** §5 mandates a Postgres exclusion
   constraint so two rate periods for the same (category, hospital, rate type) can never overlap.
   MySQL and SQLite have no `EXCLUDE`. Overlap prevention moves into the application: the
   close-old-row/insert-new-row pair runs in one transaction with an explicit overlap check, plus
   a unique key on (financial_category_id, hospital_code, rate_type, valid_from) as a backstop.
   **This is a weaker guarantee than the brief assumes** and needs to be stated in the acceptance
   tests, not buried. Concurrency test required.

3. **No new `hospital` table.** eFinance already has `entities(code, name, type)` with
   `type='hospital'`, `user_entities`, `user_entity()` and `can_access_entity()`. The nine
   hospitals are already seeded there, sharing codes with eMAP and eQuality. The ΤΑΕΠ tool keys
   episodes on `hospital_code` and reuses the existing scoping. Building a parallel hospital table
   would put the same nine hospitals in two places with no mechanism keeping them equal.

4. **No new roles, and no Entra ID.** §8's five roles become permission keys (`taep.create`,
   `taep.finalise`, `taep.cancel`, `taep.rates`, `taep.admin`) in eFinance's existing
   `PERMISSIONS_CATALOG` and `role_permissions` table. §14 Q7 is answered by the code: eFinance
   authenticates against Active Directory and its own user table. Adding an Entra OIDC path for
   one module would be a second front door to the same building.

5. **i18n runs the other way round.** The brief asks for every Greek string in `messages/el.json`.
   eFinance puts Greek **inline as the source string** and translates to English in
   `translations/en.json`, keyed on the Greek text itself. Following the brief here would give the
   portal two incompatible i18n systems. Follow eFinance.

6. **PDF is reportlab, not Playwright or QuestPDF.** Already a dependency, already used for the
   ΟΑΥ reconciliation output. §12's byte-identical-render requirement is achievable with reportlab
   provided the document timestamp is taken from stored data rather than `now()`.

7. **Money is `DECIMAL(15,2)`,** the house convention in `DESIGN.md`, not the brief's
   `DECIMAL(10,2)`. No practical difference at ΤΑΕΠ amounts; consistency is worth more.

## Consequences

Good: no new server, no new database engine, no new auth integration, no new deployment pipeline.
Hospital scoping, roles, audit logging, Excel export and PDF rendering already exist and are
already tested. The estimate drops substantially against either of the brief's two defaults.

Costs: the tool inherits eFinance's constraints, including the missing exclusion constraint (2)
and a shared release cadence — a ΤΑΕΠ fix ships when eFinance ships.

One thing to watch: eFinance's `deploy.sh` is a first-install script that does `cp -r . /opt/finance/`
and would overwrite the live database. `CLAUDE.md` is emphatic that it must never be run again.
Deployment is file-by-file. That applies to us too.

## Note, not a decision

eFinance's `requirements.txt` carries `anthropic` (LLM invoice extraction) and `msal` (Microsoft
Graph mailbox adapter, off by default). The ΤΑΕΠ brief states flatly that nothing leaves the OKYπY
network. Those two are existing eFinance choices and not ours to revisit here, but the ΤΑΕΠ module
will not call either, and someone should confirm the patient-data boundary is understood before
go-live. Relevant because §14 Q8 already flags a DPIA over asylum seekers, prisoners and minors.
