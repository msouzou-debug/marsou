# ADR-0012 — Tests run against a throwaway PostgreSQL cluster, driven by vitest

**Status:** accepted · 18/09/2026

## Context
What M0 has to prove is that row-level security and an audit trigger behave. Neither can be tested against a fake: an in-memory stand-in has no policies, and the whole point is what Postgres does. There is also no Docker daemon in the build environment, so Testcontainers is not available. The PostgreSQL 16 binaries are.

## Decision
**The database.** `apps/api/scripts/test-db.sh start` runs `initdb` into a temp directory, picks a free port, starts the server with `fsync=off` and trust authentication on the loopback interface, and prints the two connection strings. `stop` stops it and deletes the directory. The vitest global setup calls `start`, applies the migrations, seeds, and calls `stop` at the end. Nothing survives the run. Where the process is root — containers often are — the script drops to an unprivileged account, because Postgres refuses to run as root.

`docker-compose.yml` at the repo root gives the ops team the ordinary stack (postgres 16, minio, redis, api, web). It has not been run here, and its header says so.

**The runner.** vitest, not jest. Two reasons and one caveat:
- It is what `apps/web` and `packages/shared` already use, so the repo has one runner, one config style and one watch mode.
- On this suite it is roughly three times faster to start than ts-jest, which matters when every test file talks to a real database.
- The caveat: vitest transforms with esbuild, which drops `emitDecoratorMetadata`, and Nest's injector needs it. `unplugin-swc` does the transform instead. That is one line of config, and SWC is also what `@nestjs/cli` uses in its fast build mode.

`fileParallelism` is off: the suites share one cluster and one seeded schema, and the alternative — a database per file — costs more than it saves at this size.

## Consequences
- `pnpm --filter @ecapital/api test` needs the PostgreSQL 16 binaries on the path or at `/usr/lib/postgresql/16/bin`; CI installs `postgresql-16`. It needs no daemon, no network and no privileges beyond a temp directory.
- The tests prove the policies rather than a model of them: the auditor's `POST` is refused by Postgres, and the test asserts the 403 that produces.
- A developer who wants a database to keep can point `DATABASE_URL` at their own and run the migrations by hand; the script is for the test run, not for development.

## Addendum, 02/10/2026 — one cluster per run, never reused

A full run failed fourteen tests and passed on the rerun with no code change.
`test-db.sh start` used to hand back any cluster already running in its state
directory, so a run that started after one was killed before its teardown —
or alongside one still going in the same tree — got a database holding the
other run's rows: two runs' worth of projects and permits, an eFinance sync
cursor already past the fake's invoices, permits from minutes earlier in the
same windows. The rerun passed because the failed run's teardown deleted
that cluster. Now:

- `start` always initdb's a fresh cluster. The global setup passes its pid as
  the owner (`ECAPITAL_TEST_DB_OWNER`); a cluster whose owner has gone is
  stopped and thrown away, and one whose owner is alive is refused with a
  message to set `ECAPITAL_TEST_DB_DIR`. `stop` from a refused run leaves the
  owner's cluster alone.
- The suites still share the one database, so a test asserts on rows it
  created, or on seeded rows picked by a stable key (a source row reference,
  a title the seed alone uses), never on a global count or on one page of a
  list other files add to — `listAll` in `test/app.ts` walks every page.
- The `@Interval` timers return at once under `NODE_ENV=test`, and the test
  app factories also delete them from the `SchedulerRegistry`; a test that
  wants a pass calls the service for its own rows.
- The eFinance suite pushes only its own contracts and checks, in its
  `afterAll`, that the ledger and the eFinance tables are exactly as it found
  them.
