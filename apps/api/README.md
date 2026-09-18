# @ecapital/api

The eCapital backend: NestJS 11, PostgreSQL 16, Drizzle, OpenAPI 3.1.

M0 is the foundation — sign in, see your own org units, see their building → floor → area tree, read the audit log. It serves R01 (Entra ID sign-in, role and unit-scoped access), R42 (audit log on every mutation, immutable to admin) and R43 (Greek first, English second).

M1 adds the project register on top of it: projects, milestones, risks and issues, and the portfolio the board opens on. It serves R03 (portfolio across the units with drill-through), R04 (phases and gate approvals), R05 and R06 (the business-case fields carried from the capex plan, and baseline vs forecast vs actual) and R07 (risk and issue registers). Contracts, cost, permits, assets and maintenance are M2 and later — until the SAP ingestion lands, the committed, spent and forecast ledgers come back null and the screens show «—» (CAPEX-01 §7).

## Run it locally, in five commands

```bash
pnpm install                                   # 1. from the repo root
cp apps/api/.env.example apps/api/.env         # 2. the defaults work for local Postgres
pnpm --filter @ecapital/api migrate            # 3. create the schema, policies and triggers
pnpm --filter @ecapital/api seed               # 4. eleven org units, one building, six users
pnpm --filter @ecapital/api dev                # 5. http://localhost:3001, docs at /docs
```

Step 3 needs a PostgreSQL 16 you can reach. If you have none, `docker compose up -d postgres` from the repo root gives you one — untested here, see the header of `docker-compose.yml`. The test suite does not need it: it starts and throws away its own cluster.

Then sign in: `docs/manual/en/M0-login.md` walks through the development token, and `docs/manual/el/M0-login.md` is the same thing in Greek.

## What is where

| Path | What it holds |
|---|---|
| `src/db/migrations/*.sql` | The schema. Tables, enums, row-level-security policies, grants, audit triggers. Hand-written and authoritative (ADR-0008). |
| `src/db/schema.ts` | The Drizzle view of the same tables, for typed queries. |
| `src/db/seed-data.ts` | The eleven units and their source spellings, one seeded building, six users, the group→role mappings, the 42 fixture projects. |
| `src/db/seed-projects.ts` | The M1 half of the seed: projects, milestones, risks and issues, idempotent, codes allocated by the same function the API uses. |
| `src/projects/`, `src/portfolio/` | The M1 modules. `project-rows.ts` holds the phase order and the audit-line rules as pure functions. |
| `src/auth/` | The OIDC guard, the development stub, `GET /me` (ADR-0009). |
| `src/common/rls.interceptor.ts` | Opens the transaction that carries the caller's identity into Postgres (ADR-0010). |
| `src/i18n/{el,en}.json` | Every error sentence, keyed, Greek and English. |
| `openapi.json` | Checked in, generated from the controllers, and a test fails when it is stale. |

## Endpoints

Every route below is behind the bearer token and inside the row-level-security transaction. A record the caller may not see answers **404**, never 403 — a 403 would confirm it exists. A write the caller may not make answers **403**. The full document is `openapi.json`, served at `/docs`.

| Method and path | What it does | Milestone |
|---|---|---|
| `GET /health` | Liveness, database reachability, last applied migration. No token. | M0 |
| `POST /auth/dev-token` | A signed development token for a seeded user. Dead unless `DEV_AUTH` is on. | M0 |
| `GET /me` | The caller's own claims, camelCase. | M0 |
| `GET /org-units` | The units the caller may see. | M0 |
| `GET /org-units/:id/areas` | That unit's building → floor → area tree. | M0 |
| `POST /org-units/:id/areas` | Add an area to a floor of the unit. | M0 |
| `GET /audit-log` | The organisation's audit trail. `admin` and `auditor_readonly` only. | M0 |
| `GET /projects` | The register, filtered (`unit`, `phase`, `category`, `rag`, repeated for several), searched (`q`, matching the code and the Greek title without regard to case or accents), sorted and paged. | M1 |
| `GET /projects/:id` | One project with its unit, its sponsor and manager by name, its milestones, risks and issues, and the last fifty lines of its own history. | M1 |
| `POST /projects` | Open a project. The API allocates the code (ADR-0014); a body that carries one is refused. | M1 |
| `PATCH /projects/:id` | Change the fields of a project. The phase is not one of them. | M1 |
| `POST /projects/:id/phase` | Move one phase forward with a reason. 422 if it is not the next phase or a gate milestone is still open. An administrator may also move a project back (ADR-0014). | M1 |
| `POST /projects/:id/milestones`, `PATCH …/:mid` | Milestones. The baseline date is fixed at creation; 422 on an attempt to move it (R06). | M1 |
| `POST /projects/:id/risks`, `PATCH …/:rid` | The risk register, likelihood and impact on a 1–5 scale (R07). | M1 |
| `POST /projects/:id/issues`, `PATCH …/:iid` | The issue register. The issue is raised by the caller, never by a name in the body (R07). | M1 |
| `GET /portfolio` | S01: the KPI strip, one row per visible unit with its sparkline and RAG counts, and up to eight exception sentences in Greek and English. | M1 |

Who may write to the register: `admin`, `estates_head` and `project_engineer`, in units they belong to. `finance`, `technician` and `clinical_approver` read it; `executive_readonly` and `auditor_readonly` read everything and write nothing. All of that is in the policies, not in the controllers (ADR-0010).

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @ecapital/api dev` | Run with reload. |
| `pnpm --filter @ecapital/api test` | The full suite against a throwaway PostgreSQL 16 cluster (ADR-0012). |
| `pnpm --filter @ecapital/api migrate` | Apply pending migrations. Safe to run twice. |
| `pnpm --filter @ecapital/api seed` | Load or refresh the seed data. Safe to run twice. |
| `pnpm --filter @ecapital/api openapi` | Rewrite `openapi.json` from the controllers. |
| `./scripts/test-db.sh start` / `stop` | The throwaway cluster, by hand, if you want to poke at it. |

## Three rules that are not negotiable

**No patient data.** CAPEX-01 §12: no patient data enters this system and the schema must make that impossible by design. `area.beds` is a count of beds in a room. `area.patient_risk_group` is the ICRA 2.0 band of the room. Neither describes a person, and no column anywhere holds a name, an identifier, a diagnosis, an episode or an appointment. A column that could is rejected in review.

**Access is decided by Postgres, not by this code.** A service method with no permission check in it is correct (ADR-0010). A unit you may not see answers 404, not 403, because a 403 would confirm it exists.

**The audit log is written by a trigger and cannot be edited by anyone**, including the table owner and a superuser (ADR-0011). Correcting a wrong row is impossible by design; you add a row describing the correction.

## Notes

- All timestamps are `timestamptz` and stored UTC. Europe/Nicosia is a display concern, and it belongs to the web app.
- Logs are JSON, one line per request, with a request id. Bodies and the `authorization` header are never logged.
- `pnpm build` type-checks and emits to `dist/`. The API runs from source through `@swc-node/register`, which keeps the decorator metadata Nest needs (esbuild-based runners such as tsx drop it); packaging it for the ΟΚΥπΥ server — `@ecapital/shared` ships as TypeScript — is part of the deploy work in M1.
