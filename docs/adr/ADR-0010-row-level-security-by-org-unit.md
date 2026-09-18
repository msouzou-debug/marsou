# ADR-0010 — Access by org unit is enforced by Postgres, not by the API

**Status:** accepted · 18/09/2026

## Context
CAPEX-01 §10: access is row-level by org unit, Central Administration sees all, the auditor sees everything and writes nothing. The M0 definition of done is "a user can log in and see their own unit's area tree and nothing else". Enforcing that in service code means every future query is one forgotten `where` clause away from a leak, and there will be a lot of future queries.

## Decision
The database decides.

- Every request that carries a token runs inside one transaction. Before the handler runs, the interceptor sets `app.user_id`, `app.roles`, `app.org_unit_ids` and `app.ip` with `SET LOCAL`, so the settings die with the transaction and a pooled connection cannot be handed on wearing somebody else's units.
- Every table with an `org_unit_id` has a policy comparing it to `ecapital.current_org_unit_ids()`. `floor` and `area` carry a copy of `org_unit_id`, filled by a trigger from the parent row, so the policy is a column comparison and not a walk up the tree.
- `admin`, `executive_readonly` and `auditor_readonly` see every unit. A Central Administration user sees every unit because the token carries all eleven ids, which is also how it will arrive from Entra.
- `auditor_readonly` fails the write predicate on every table, so a mutation by an auditor is refused by Postgres and never reaches a service.
- The API connects as `ecapital_app`, which does not own the tables. Ownership stays with the migration role, so the application cannot disable a policy on itself.

A row the caller may not see does not exist for them. The API therefore answers **404** and not 403 for a unit outside their access — a 403 would confirm the unit exists, which is the one fact somebody outside it should not be able to learn.

## Consequences
- A service method with no permission check in it is correct, not suspicious. `AreasService.treeFor` has none on purpose.
- A query outside the transaction returns nothing, which fails loudly in tests rather than leaking quietly.
- Every new table needs `enable row level security` and its policies in the same migration; without them it is readable by nobody, so the omission shows up immediately.
- **Decided 18/09/2026:** `executive_readonly` is read-only at the policy level, like `auditor_readonly`. `ecapital.can_write_unit` refuses both. The difference between the two is the audit log, which only admin and the auditor can read.
