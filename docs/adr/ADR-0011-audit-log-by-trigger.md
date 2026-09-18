# ADR-0011 — The audit log is written by a database trigger and cannot be edited

**Status:** accepted · 18/09/2026

## Context
R42: a full audit log on every mutation, immutable to admin. CAPEX-01 §4 ends with "every mutating endpoint writes `audit_log`. No exceptions, no soft edits that bypass it." An audit log written by application code is an audit log that is missing whatever the application forgot, and an audit log the application can update is not evidence of anything.

## Decision
- An `AFTER INSERT OR UPDATE OR DELETE` trigger on every mutable table writes `ecapital.audit_log`: the actor from `app.user_id`, the entity type and id, the action, the before and after images as `jsonb`, the time in UTC, and the address from `app.ip`. The trigger is `SECURITY DEFINER`, so the row is written as the table owner.
- `ecapital_app` has `SELECT` on `audit_log` and nothing else. No `INSERT`, no `UPDATE`, no `DELETE` — the application cannot forge a row, and cannot remove one.
- A `BEFORE UPDATE OR DELETE` trigger raises on `audit_log` regardless of who is asking, so the table owner and a superuser are refused too. That is what "immutable to admin" has to mean if it is to mean anything.
- On top of that, a NestJS interceptor refuses any mutating route that is not running inside the row-level-security transaction, because such a route would produce an audit row with no actor. The only exception is a route marked `@Public`, which in M0 is the development token issuer and does not exist in production.
- The change and its audit row share one transaction. A mutation that fails leaves no audit row claiming it happened; an audit row that fails to write takes the mutation down with it.
- `GET /audit-log` is open to `auditor_readonly` and `admin` only, checked twice: once by a role guard and once by the row policy.

## Consequences
- Adding a table means adding its audit trigger in the same migration. A table without one is a hole in R42.
- Retention is permanent (CAPEX-01 §12), so the table only grows; it is indexed on `(entity_type, entity_id)`, on `at` and on `actor_id`, and partitioning by year is the obvious next move when it gets big.
- Correcting a wrong audit row is impossible by design. A mistake is corrected by a new row describing the correction.
