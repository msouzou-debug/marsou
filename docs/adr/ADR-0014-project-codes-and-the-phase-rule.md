# ADR-0014 — Project codes are allocated by the database, and a phase moves one step

**Status:** accepted · 18/09/2026

## Context

M1 turns the capital register into a system of record. Two things in it are decisions rather than data entry, and both have to be the same on every machine and for every user.

The first is the project number. The capex plan has no stable key — column B is blank on four rows and holds text on seven (CAPEX-03 §2) — so the register has to issue its own. Whatever it issues has to survive two engineers pressing "create" in the same second, and an auditor asking a year later why there is no project 14.

The second is the phase. CAPEX-01 §4 lists eight phases and CAPEX-03 §4 says the target model has nine; `packages/shared/src/project.ts` reconciles them by putting PREPARATION between IDEA and APPROVED, which is where 70 of the 113 migrated rows sit. R04 then asks for "phases and gate approvals" without saying what a gate does.

## Decision

### The code

`<unit code>-<year>-<seq>`, for example `NGH-2026-007`: the unit that owns the project, the year it was opened, and a three-digit number that starts again at 001 for each unit each year. Nobody types it and nothing accepts one in a request body — `ProjectCreate` types `code` as `undefined` for exactly that reason.

`ecapital.allocate_project_code(org_unit_id, year)` issues it, inside the caller's own transaction:

- a counter row per unit per year in `ecapital.project_code_seq`, not a Postgres sequence. A sequence per unit per year is eleven DDL statements a year, and a sequence does not roll back — a create that fails would burn a number and leave a hole that somebody has to explain;
- a transaction-scoped advisory lock on the unit, so a second caller waits for the first to commit or roll back rather than reading the same counter. The `update … returning` would serialise on its own through the row lock; the advisory lock is what also covers two transactions both inserting a unit's first row of a year;
- `SECURITY DEFINER`, because the counter table has row-level security on and no policy at all. The application role cannot read a counter, cannot move one, and cannot do anything with it except ask for the next number.

The seed uses the same function, so a register that was imported and a register somebody typed are numbered identically.

### The phase

The nine phases are an ordered list and the order is the rule.

- A project moves **exactly one step forward**. Backwards or skipping answers 422 with `errors.phaseNotNext`. There is no "correct the phase" edit; `PATCH /projects/:id` cannot touch it.
- Every move carries a reason, which is stored on the project (`phase_reason_el`) so the audit trigger's after-image carries it too. That is what lets the project timeline say **IDEA → PREPARATION: ‹reason›** rather than just "phase changed".
- A **gate** is a milestone with `is_gate`. While a gate on the project has no actual date the project cannot move on: 422 with `errors.gateOpen`, naming the milestone. The gate is the approval, so an unticked gate means the approval has not happened.
- An **administrator may move a project backwards**, and it is recorded exactly like any other move: same endpoint, same reason, same audit row. Going back is a decision somebody takes — a withdrawn approval, a tender annulled — not a typo to fix quietly. Nobody else can, in either direction.

### Two policy changes this needs

The contract puts a project's own history and the names of its sponsor, manager, risk owner and issue raiser on the project page. The M0 policies do not allow either for an ordinary user, so M1 widens them, narrowly:

- **`ecapital.user_display_name(uuid)`** and its by-subject twin are `SECURITY DEFINER` and return a name and nothing else. The alternative — opening `app_user` to every signed-in user — would also hand out every colleague's work email, which CAPEX-01 §12 has no reason to do.
- **`audit_log_read_project`** is a second, additive policy on `audit_log`: rows whose `entity_type` is `project`, `milestone`, `risk` or `issue` are readable by whoever may read that unit. `GET /audit-log` stays closed to everyone but `admin` and `auditor_readonly` — the whole trail of the organisation is an auditor's document — but a project's own trail belongs to the people running the project.

## Consequences

- Project numbers are contiguous per unit per year. A gap means a project was deleted, not that a transaction failed, which is the question an auditor actually wants answered.
- The code cannot be changed after the fact. There is no endpoint for it and no column update in any service.
- A project whose current phase has an open gate is stuck until somebody records the gate's actual date. That is the intent, and the seeded register is deliberately in that state: every seeded project has the gate of its current phase open.
- Changing the order of `ProjectPhase` in `packages/shared` changes what "one step" means for every project already in the register. It needs its own ADR, and a migration that says what happens to the rows.
- Still open, and deliberately not decided here: **who may change `approvedBudget` after a project reaches APPROVED.** Today it is an ordinary field — anyone who may edit the project may edit it, and the audit log records who did and what it was before. If the owner wants a second pair of eyes on it, that is a segregation rule like the ones CAPEX-01 §10 already asks for on variations and payment certificates, and it belongs with them in M3.
