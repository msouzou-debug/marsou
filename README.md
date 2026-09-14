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
| Costing engine | built, pure, 65 tests green including the golden €120 case |
| Schema + seed loader | built; loader refuses to load while AET092 is duplicated |
| Routes / UI | Phase 2 |

The build brief (§14 Q1) said inspect eFinance before Phase 1, and offered a Next.js/PostgreSQL
build or an ASP.NET Core/SQL Server one. It is neither. eFinance is a **Flask / Python** application
on MySQL with Active Directory auth, in build since July 2026. The ΤΑΕΠ tool becomes `taep.py`, a
module inside it, following the binding module contract in that repo's `DESIGN.md`. ADR-001 records
what that changes — seven items, including a Postgres exclusion constraint the brief relies on that
MySQL cannot provide.

## Layout

```
taep.py       the eFinance module — engine (pure) + schema + seed loader
test_taep.py  acceptance tests; run them before changing anything in taep.py
seed/         master data as supplied, unmodified
tools/        analyse_seed.py — regenerates every figure in the memo
docs/         Phase 1 deliverables
docs/adr/     architecture decision records
```

Re-run the analysis after any seed change:

```
python3 tools/analyse_seed.py
```

It exits non-zero while the duplicate `AET092` code remains unresolved. That is deliberate.

## Tests

```
python3 -m pytest test_taep.py -q
```

65 tests, all green. `test_seed_loader_refuses_the_duplicate_aet092` asserts the loader
*fails* — it is the go-live blocker in §9.1 of the brief. When the Μονάδα reassigns the
code, delete that test.

## Deploying into eFinance

`taep.py` and `seed/` drop into the eFinance tree alongside `bankrec.py` and `oayrecon.py`,
and `taep` is added to the module list in `app.py`. File by file — **never** run eFinance's
`deploy.sh`, which overwrites the live database.

`register(app, ctx)` is not written yet, so the module currently contributes schema and
seed only. That is Phase 2.
