# ADR-0015 — The variation workflow, and why the segregation rule is written three times

**Status:** accepted · 19/09/2026

## Context

R10 asks for "a variation workflow with reason coding and segregation of duties". CAPEX-01 §10 says what the segregation is: *whoever approves a variation cannot be the person who raised it*. CAPEX-01 §7 then makes a variation the only thing that moves a commitment — the contract's current value is its original value plus the variations that have been approved — and §1 says the whole system is warn-and-flag: nothing about money blocks anything.

So a variation is three things at once. It is a piece of correspondence between an engineer and a head of estates. It is the only way a number on the cost screens changes. And it is the place an auditor looks first, because it is where a contract grows.

## Decision

### The states

`DRAFT → SUBMITTED → APPROVED | RETURNED | REJECTED`.

- **DRAFT** belongs to the raiser. They can change it and delete nothing; it counts for nothing.
- **SUBMITTED** belongs to the approver. The raiser can no longer edit it — that is what submitting means.
- **RETURNED** hands it back, and it is editable again. A return always carries a comment; «Επιστροφή με σχόλια» with no comment is not a decision, it is a shrug.
- **REJECTED** is final and also carries a comment. **A rejected variation is not re-opened.** If the work is still needed, somebody raises a new one, with its own number, and the rejected one stays in the record with the reason it was turned down. Editing a rejection out of existence is exactly what an audit trail is for preventing.
- **APPROVED** is the only state that counts towards the contract's current value.

Only a head of estates or an administrator decides. A project engineer raises and submits, which is the division of labour CAPEX-01 §1 describes for the two personas, and is checked on the route rather than in the row policy, because it is a rule about the *action* and not about which rows exist.

### The number

`variation.number` is 1..n per contract and nobody types it. `ecapital.allocate_variation_number` hands out the next one inside the caller's own transaction, holding a transaction-scoped advisory lock on the contract, so two engineers raising a variation in the same second queue instead of racing: the second waits for the first to commit or roll back, then reads the number the first left behind. This is the same shape as `allocate_project_code` (ADR-0014) and for the same reason — a number an auditor will ask about a year later has to be contiguous and has to be the same on every machine. The unique index on `(contract_id, number)` is the backstop.

### The commitment

`contract.current_value` is a stored column maintained by a `BEFORE INSERT OR UPDATE` trigger that recomputes it as `original_value + sum(value of APPROVED variations)`. It is never typed: a body carrying a value for it is overwritten before the row lands, and a direct `UPDATE ... SET current_value = …` is overwritten too. A trigger on `variation` asks the contract to recompute after every insert, update and delete, and touches the contract row only when the figure actually moves — so a variation going from DRAFT to SUBMITTED leaves no "the contract changed" line in a trail where nothing about the contract changed.

Why a stored column and not a view: the portfolio sums commitments over every project a caller can see, on every page load, and CAPEX-01 §12 gives that query 500ms over 500 projects. A view would make it a nested aggregate per row.

### Why the segregation rule is written three times

`errors.sameUserApproval` is checked in `ContractsService.decideVariation`, which is where the 403 and the sentence come from. That is the version users meet.

It is also a CHECK constraint, `variation_decider_not_raiser`, on the table:

```sql
check (decided_by is null or decided_by <> raised_by)
```

That is deliberate duplication, and the reason is the shape of what is coming. M3 adds payment certificates with the same rule (CAPEX-01 §10: "payment certificate approval requires a different user from the one who created it"), M9 adds reporting that reads these rows, and the migration CLI (§9) writes them from a spreadsheet. Every one of those is a new code path to the same table. A rule that lives only in one service method is a rule that holds until somebody writes the second way in — a bulk import, a correction script, a psql session on a bad night. The constraint holds for all of them, including the ones nobody has written yet, and it costs one line.

The third place is the route's role check, which is a different rule (*who may decide at all*) but part of the same guarantee.

The same reasoning puts `ecapital.set_approved_budget` behind the budget decision of ADR-0014: the function checks the `finance` role itself, so the refusal is a property of the database and not of `ProjectsService.update`.

### Who keeps the contractor register

CAPEX-01 §10 lists the roles and the row-level rule but names no owner for the supplier register, and the register is not unit-scoped — the same company works at Larnaca and at Paphos, so one row, readable by everybody signed in. **Owner's answer, 19/09/2026: `admin` and `estates_head` write it; engineers pick from it.** `blacklisted` is narrower still: blacklisting stops a firm taking new work across all eleven units, so only an administrator moves it (`errors.blacklistAdminOnly`). A blacklisted contractor is refused a *new* contract (422, `errors.contractorBlacklisted`); the ones it already holds run to their end, because the alternative is the organisation breaking its own contracts.

### Where a contract starts

CAPEX-01 §1: the system starts at the awarded contract, and the tender stage stays in e-Procurement. So `POST /projects/:id/contracts` refuses a project short of AWARDED with 422 `errors.projectNotAwarded`, and the tender reference and award date are what carry over from the other system.

## Consequences

- A variation cannot be approved by its raiser through any route, script or console session. Correcting a row that says otherwise is impossible, which is the point.
- `current_value` cannot drift from the variations, because there is no way to write it.
- A rejected variation stays rejected. The register therefore shows how many changes were asked for and turned down, which is a contractor-performance figure (R37) that a system with an "unreject" button would not have.
- The advisory lock is held for the length of the request transaction, so a long-running transaction that raises a variation blocks other raisers on that one contract. That is the correct trade at this size; if a bulk import ever needs to raise hundreds, it should allocate its numbers in one pass rather than hold the lock across the whole file.
- Adding payment certificates in M3 means adding the same CHECK to `payment_cert`. This ADR is the precedent for doing it there too.
