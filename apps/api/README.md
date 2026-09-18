# @ecapital/api

The eCapital backend: NestJS 11, PostgreSQL 16, Drizzle, OpenAPI 3.1.

M0 is the foundation and nothing more — sign in, see your own org units, see their building → floor → area tree, read the audit log. It serves R01 (Entra ID sign-in, role and unit-scoped access), R42 (audit log on every mutation, immutable to admin) and R43 (Greek first, English second). Projects, contracts, cost, permits, assets and maintenance are M1 and later.

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
| `src/db/seed-data.ts` | The eleven units and their source spellings, one seeded building, six users, the group→role mappings. |
| `src/auth/` | The OIDC guard, the development stub, `GET /me` (ADR-0009). |
| `src/common/rls.interceptor.ts` | Opens the transaction that carries the caller's identity into Postgres (ADR-0010). |
| `src/i18n/{el,en}.json` | Every error sentence, keyed, Greek and English. |
| `openapi.json` | Checked in, generated from the controllers, and a test fails when it is stale. |

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
- `pnpm build` type-checks and emits to `dist/`. The API runs from source through `tsx`; packaging it for the ΟΚΥπΥ server — `@ecapital/shared` ships as TypeScript — is part of the deploy work in M1.
