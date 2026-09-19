# ADR-0017 — The site log: an SLA that is a state, an instruction that becomes a variation, and a defect that always has a unit

**Status:** accepted · 19/09/2026

## Context

R09 asks for "RFI and site instruction logs with SLA timers". R12 asks for a "defects list at handover, tracked to close within defects liability". R35 asks for the maintenance backlog "costed and banded by risk". CAPEX-01 §4 gives the three tables their columns, §2 takes the risk bands from NHS ERIC backlog reporting and the field-first capture from Procore, §7 says warn and flag, and §1 says nothing about money or time blocks anything.

Three of the four rules in this slice are therefore rules about *what a record is*, not about who may touch it. The fourth — who writes a defect — is the first access rule in the system that depends on a column of the row rather than on the unit alone.

## Decision

### The SLA is a state, and it is computed, not stored

`rfi.sla_due_at` is `raised_at + slaDays × 24h` and `rfi.sla_hours` is that promise's length. The band — `GREEN | AMBER | RED | BREACHED` — is **not a column**. It is worked out on the way out by `src/rfis/rfi-rows.ts` `slaState()`, from the two stored facts and a clock.

A stored band would be wrong the minute after it was written, and would need a scheduled job to keep it honest — a job that is a second source of truth for a figure that is already a subtraction. The brief's own data model lists `sla_state` as a column on `work_order` (CAPEX-01 §4); when M7 builds work orders it should read this decision first, because the same argument applies there.

The thresholds are the ones the chip already draws (`apps/web/src/components/sla-chip/SlaChip.tsx`): above half GREEN, half down to a tenth AMBER, below a tenth RED, past due BREACHED. **The boundaries belong to the worse band** — exactly half is AMBER and exactly a tenth is RED — because a clock that still says GREEN at the halfway mark is a clock nobody chases. Both implementations are unit-tested against the same five boundary cases, and the API's are tested again through HTTP with the due moment moved by hand.

**The clock stops at the answer.** An RFI answered with six hours to spare keeps the band it was answered in rather than drifting to BREACHED while it waits to be closed. The SLA is a promise about the answer, not about the paperwork after it. `slaState` takes `answeredAt ?? now` as its moment.

**A breach never blocks.** A breached RFI is answered and closed exactly like any other; the breach is a line on the portfolio and a count on the contract screen (R31's pattern, and R33's when work orders arrive). Nothing in `RfisService` consults the band before it writes.

### An RFI has no approver

A variation is decided by someone other than the person who raised it, three times over (ADR-0015). An RFI deliberately has no such rule, and the answerer may be the raiser.

CAPEX-01 §1 describes the RFI as a question put to the ΟΚΥπΥ side: the contractor asks, ΟΚΥπΥ answers, and in this system it is ΟΚΥπΥ staff who raise the record and later attach the designer's or the contractor's reply to it. Requiring a second person would mean an engineer who receives the architect's answer by email cannot record it, which is how a log stops being kept. The variation's segregation exists because a variation moves a commitment; answering a question does not.

The one state rule is that an RFI is **closed after it is answered and not before** — closing is what says the answer was good enough, so there has to be one. It is a service rule (`errors.rfiNotAnswered`, 422) and a CHECK constraint, `rfi_answered_before_closed`, for the reason ADR-0015 gives.

### A cost-impact instruction becomes a variation, once

CAPEX-01 §4 carries `cost_impact_flag` on `site_instruction` and nothing that says what happens next. The answer is that it becomes a variation, because otherwise the works grow and the commitment does not (CAPEX-01 §7).

`POST /contracts/:id/site-instructions/:sid/variation` creates a DRAFT variation carrying the instruction's own words, reason `CLIENT_CHANGE` — an instruction is the client telling the contractor to do something — and a value of **zero for the engineer to price**. Nothing is committed until somebody approves it, so the honest starting figure is the one nobody has argued for yet.

Two rules, each said twice:

- **Only with cost impact** — 422 `errors.noCostImpact`, and `site_instruction_variation_needs_cost_impact`. An instruction that costs nothing has nothing to turn into; if it turns out it did cost something, the flag is what gets corrected and the correction is in the audit trail.
- **Only once** — 422 `errors.alreadyLinked`, and a unique index on `variation_id`. A second variation from one instruction charges the same change twice.

The link is never unset. `variation_id` going back to null would erase the record that the instruction was paid for.

The gap it leaves is a **fourth contract warning**, `instructionsWithoutVariation`, alongside R31's three: how many cost-impact instructions on this contract nobody has priced. Warn and flag — the instruction stands, the contractor keeps working, and somebody has to go and price it. It is computed by the same `warningFacts()` the contract screen and the portfolio already share, so there is one implementation and not two.

### A defect always belongs to a unit

`defect` is the only table in the site log that needs no contract. CAPEX-01 §2 wants Procore's field-first capture and §8 puts defect capture on the offline surfaces, so a technician's note from a plant room that belongs to no project at all has to be a first-class record.

So the one thing a defect can never be without is `org_unit_id`: it decides who may see it, and it is what R35's backlog is grouped by. It comes from the contract, or from the project, or from the body — and a request with none of the three is refused with `errors.defectUnitNeeded`. Where a contract is named and no project is, the project is taken from the contract too, so a handover snag counts towards the project's open defects without anybody typing the link twice.

**The due date (R12).** For `source = HANDOVER` it is `completion_date + extension_days + defects_liability_months`, worked out when the defect is raised. Extensions come first because they move completion itself: a contract finished thirty days late starts its liability period thirty days late. Months are calendar months with the day clamped to the end of the month it lands in, because a twelve-month liability ending on the 30th of February is a liability nobody can point at. Every other source has no liability period, so it has no due date and the field is null rather than invented.

A handover defect still open past that date is a **red** exception on the portfolio: past the liability period the contractor is off the hook and ΟΚΥπΥ pays to fix it.

**Funded needs a project (R35).** `funded` means a capital project is paying. Funded with nothing to pay for it is a figure in next year's backlog that nobody owns, so it is 422 `errors.fundedNeedsProject` and `defect_funded_needs_project`, checked against the row as it will be rather than as it was.

**The backlog.** One row per unit per NHS ERIC band over OPEN and IN_PROGRESS, with `funded + unfunded = estimatedCost` always. A defect nobody has priced counts in `count` and adds nothing to the money: calling it zero would understate the backlog, leaving it out would hide it. The grouping is a pure function (`backlogRows`) so the rule is unit-tested; the query is only the filter. S21 draws it in M7.

### Who writes a defect: the first policy that reads a second column

Everything else in the site log follows the project register — `can_read_unit` to read, `can_manage_project` to write. A defect adds one clause:

```sql
create or replace function ecapital.can_manage_defect(
  p_org_unit_id text, p_source ecapital.defect_source) returns boolean ...
  select ecapital.can_manage_project(p_org_unit_id)
      or (ecapital.has_role('technician')
          and ecapital.can_write_unit(p_org_unit_id)
          and p_source in ('INSPECTION', 'WORK_ORDER'))
```

**The field persona.** A technician raises and works what they found on an inspection round or what a work order turned up, in their own unit. They do not raise a HANDOVER defect, because that is a contractual position on somebody else's work and belongs to the people who run the contract; nor a CONDITION_SURVEY one, which is an estates exercise and will drive the programme in M7.

This is a row policy and not a role check on the route, because it is a rule about which rows exist for whom, and because the offline replay of §8 is a second code path into the same table. A technician's HANDOVER insert is refused by Postgres with 42501, which the service turns into 403 `errors.readOnlyAccount` — the same sentence a read-only account gets, and the right one: this is not yours to write.

### Reading is `can_read_unit`, for everybody

Finance, clinical approvers and the board read the site log the way they read the project and contract registers. CAPEX-01 §10 names no narrower rule and there is no case for inventing one: a defect is a building fact, a defect's cost lands in next year's programme, and finance is the directorate that argues that programme. **Flagged with the owner** rather than decided here; if the answer is narrower, it is one clause in `defect_read` and not a change anywhere else.

## Consequences

- The SLA band is never stale and never needs a job, at the cost of computing it per row on the way out. It is a subtraction; the RFI list of one contract is tens of rows.
- Two clocks exist — the API's and the chip's — with the same five boundary cases pinned in both test suites. They are duplicated deliberately: the chip has to tick without a round trip, and the server has to sort and count without the browser. If they ever disagree, a list that says AMBER will be drawing a red chip.
- `ContractDetail` gains `defects`, `rfisOpen` and `rfisBreached`, `ProjectDetail` gains `openDefects`, `ContractWarning.key` gains a fourth value and `Rfi` gains `slaState`. The three added to existing screens are optional in `packages/shared` for the same reason `UnitRow.committed` is — those screens and their fixtures shipped first, and the API always sends them.
- The portfolio's eight places are now contested by five kinds of exception. Red still beats amber and the biggest slip still wins inside a band, so the overdue handover defect outranks the breached RFI, which is the right way round.
- `ecapital.can_manage_defect` is the first policy in the schema that reads a column other than `org_unit_id`. M5's permits and M7's work orders will want the same shape; they should use this one as the pattern rather than moving the rule into a controller.
