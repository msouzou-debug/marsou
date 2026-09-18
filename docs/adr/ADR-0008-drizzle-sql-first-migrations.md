# ADR-0008 — Drizzle ORM with hand-written SQL migrations

**Status:** accepted · 18/09/2026

## Context
M0 is row-level security, an audit trigger and grants. None of those are rows or queries; they are DDL that a DBA at ΟΚΥπΥ has to be able to read, review and, on a bad night, apply by hand. A full ORM with generated migrations puts a layer between that DDL and the person responsible for it, and most of them cannot express a policy at all.

## Decision
Drizzle ORM for queries and types, `drizzle-kit` in the repo for `check` and for drafting a diff when the schema changes. The migrations that ship are plain `.sql` files in `apps/api/src/db/migrations`, applied in file-name order by a 90-line runner that records each id and its checksum in `ecapital.schema_migration`. `src/db/schema.ts` is the typed view of the same tables, not the source of truth; when the two disagree the SQL wins and the schema file is wrong.

The runner refuses to run a migration whose checksum has changed since it was applied. Editing an applied migration is how a staging database and a production database quietly stop being the same shape.

## Consequences
- Policies, grants and triggers sit in one readable file next to the tables they protect.
- `drizzle-kit generate` will report drift for things it cannot model (the partial unique index on `role_mapping`, every policy). That is expected; do not "fix" it by deleting the SQL.
- Whoever adds a table adds its RLS policy and its audit trigger in the same migration, or the next reviewer sends it back.
- `GET /health` reports the last applied migration id, so an operator can tell at a glance whether a deploy finished.
