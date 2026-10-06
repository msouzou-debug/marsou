# ADR-0031 — Maintenance is built from the contract: timers from the call, PM from the programme, penalties the scorecard can prove

**Status:** accepted · 06/10/2026

## Context

M5 is maintenance: R32 (PM schedules from uploaded SLAs), R33 (work orders
with SLA timers and escalation), R34 (failure / cause / remedy coding),
R35 (backlog costed and banded by risk), R36 (backlog-to-capital
auto-draft), R37 (contractor scorecard). The brief's definition of done:
**a month of PM work orders generate, dispatch and close without a
spreadsheet.** The brief also says (§1) that the SLAs exist and will be
uploaded, so the job is an importer and a timer, not a scheduling theory.

The owner gave us the real thing on 06/10/2026: the Nicosia General
Hospital electromechanical maintenance contract (Α.Ο 42/24, six years),
its special conditions with the penalty framework, and appendix II with
the equipment tables. He also answered three questions:

- Corrective orders are raised by the vendor's on-site team, or the
  nursing team alerts them on site. The call is the clock.
- It is a 24/7 umbrella agreement.
- Phones have reception on site, so the offline execution surface (R40)
  can wait.

What the contract says, and what each clause turns into:

| Contract | eCapital |
|---|---|
| Every system is in a band: «Κρίσιμης Λειτουργίας», «Προτεραιότητας 1», «Προτεραιότητας 2» | `sla_system.band` CRITICAL / P1 / P2 |
| Three times per system: response from the call, restore from the call, written report with cost estimate (½h/2h/24h critical; ½h/24h/48h P1; ½h or 1h/48h/72h P2) | `response_hours`, `restore_hours`, `report_hours`; three deadlines stamped on the order at creation, **all from `called_at`** (contract note: «ο χρόνος ανταπόκρισης αρχίζει να μετρά από το χρόνο αποστολής της κλήσης») |
| Note 2: an imported spare extends the restore time by five working days, fifteen for chiller compressors, if proven | `extension_days` + reason, granted by the coordinator; moves the restore deadline only |
| PM to a monthly programme per equipment type (daily to annual), inside normal hours 07:30–15:00, five working days' notice | `pm_schedule` with a frequency and `next_due`; the hourly sweep issues the order `lead_days` ahead and moves `next_due` on |
| Written PM report within one week of the visit | the PM order's `due_report_at` = due date + 7 days |
| Penalty table: per system, per hour or per day late, for PM not kept, response late, restore late | three nullable rates on `sla_system`; the scorecard multiplies hours or days late by them |
| Availability 8600 h/year per system; 5 €/h critical, 1 €/h other below it | `maintenance_contract.availability_*`; the scorecard sums downtime (called to restored) per band against a pro-rata allowance |
| Penalties withheld from the next payment; 10% of contract value allows termination | `penalty_cap_pct` and `cap_used_pct` on the scorecard |
| Daily problem report; failure to inform 100 €/day; lost register file 1.000 € | out of scope for the timers; recorded in the manual as the coordinator's checks |
| Equipment register as .xlsx within six months, PM checklists, data entry into the authority's software | the asset register (M4) and `pm_schedule.checklist_el`; the SLA importer takes the catalogue sheet |

## Decisions

1. **A maintenance agreement is its own record, not a capital `contract`.**
   `maintenance_contract` carries the contractor, the dates, cover, normal
   hours and the availability clause. A CAP- contract may be linked when
   finance registers one, and the push to eFinance stays with that record.
   A six-year service agreement has no project, no BOQ and no payment
   certificate chain; forcing it into `contract` would have put four
   timers on a table built for variations.

2. **The SLA catalogue is data, loaded from the contract, never typed into
   code.** `sla_system` rows are what the importer writes (R32) and what
   the Nicosia seed carries: the 48 systems of the response-time table,
   with bands and hours exactly as printed, and the PM frequencies from
   the programme tables. The penalty amounts of the Nicosia table did not
   survive the copy we were given, so those three rates are **null** in
   the seed and the scorecard says «rates missing» rather than guess.
   When the owner confirms the amounts, they are typed on the catalogue
   screen or re-imported; nothing else changes.

3. **Every timer counts from the call.** `called_at` is the one input;
   the three deadlines are computed and stored on the order so a later
   change to the catalogue never rewrites history. The timer state is the
   RFI's (ADR-0017): GREEN, AMBER in the last quarter, RED overdue,
   BREACHED when met late. Response is met by `ACKNOWLEDGE`, restore by
   `RESTORE`, report by `reportReceivedAt` on `COMPLETE`. A PM order has
   one deadline, its programme date, shown in the restore slot.

4. **Escalation is a flag, not a message.** The hourly sweep stamps
   `escalated_at` once when the response time passes unanswered, writes
   an ESCALATED event, and the list and the tiles show it in red. There
   is no mail or push in the system yet (M10, R47 lists the preferences);
   when there is, this is the hook.

5. **Work order references** are `<UNITCODE>-WO-<YEAR>-<NNNN>`, allocated
   by `ecapital.allocate_work_order_ref` with ADR-0014's counter and
   advisory lock, immutable after. The contractor's technician is a name
   typed on the order (`assigned_to_el`), not a user: the vendor's staff
   have no account and the owner has not asked for one.

6. **Coding is three short lists** (R34): failure, cause, remedy. A
   corrective order cannot complete without all three. `LACK_OF_PM` as a
   cause is what the scorecard counts against the contractor's own
   programme; the lists are enums, so the next value is a release, which
   is the right weight for a code the scorecard reads.

7. **Backlog is its own table** (R35), banded with the defect's four NHS
   ERIC bands. A defect (ADR-0017) is a handover snag on a capital
   contract; a backlog item is maintenance work the agreement will not
   absorb. `funded` is the `FUNDED` status with a `target_project_id`;
   «Σε έργο» drafts a project at the Idea phase with the item's title and
   cost as the budget and funds the item in one transaction.

8. **The replacement rule runs on completion** (R36): when a corrective
   order on an asset completes and that asset now has three or more
   corrective orders in twelve months, or its repair cost in those months
   exceeds 50% of `replacement_cost_est`, one REPLACEMENT item is drafted
   with the order history as text, once per asset while an OPEN auto
   item exists. The brief leaves the percentage as «X%»; **fifty is an
   assumption** written as `BACKLOG_REPAIR_COST_PCT` and changed in one
   place.

9. **The scorecard is computed on read** (R37), per agreement and period
   (the contract pays quarterly), from the orders themselves: counts, the
   three on-time ratios, PM on time, downtime by band against the pro
   rata allowance, penalties where the rates exist, repeat failures, a
   by-band table. The Excel export carries the counts as values and the
   ratios, penalties and totals as **live formulas**, so finance can
   audit the number it withholds.

10. **Roles.** A corrective call may be raised by the technician, the
    engineer, the head of estates, the administrator and — because the
    nursing team is who notices — the clinical approver. Transitions,
    codes, costs and extensions: technician, engineer, head of estates,
    admin. The agreement and the catalogue: head of estates and admin.
    Backlog: engineer, head of estates, admin write; «Σε έργο» is the
    head of estates and admin. Everyone who reads the unit reads all of
    it; auditor and executive read everything and write nothing. All of
    it as row policies (ADR-0010), with `@Roles` as the second lock.

11. **Photos and the contractor's report** are documents filed with
    eArchive through the outbox (ADR-0023), `source_module:
    work_order_document`, linked from a PHOTO event. No file lives in
    eCapital.

12. **Deferred, each a new ADR if wanted:** the offline PWA (R40; owner:
    phones have reception), a contractor login, e-mail or push on
    escalation, spares and stores, the daily problem-report ingestion,
    penalties for staffing shortfalls and for the register file.

## Consequences

- The seed gives Nicosia a working agreement with the real catalogue,
  twelve schedules on seeded assets, three months of orders in every
  state and a backlog with two auto-drafted items, so the scorecard shows
  figures on day one and the UAT can breach a timer on purpose.
- Changing the Nicosia hours or bands is a catalogue edit. Changing what
  a timer means is a code change here and in `slaStateOf`.
- The «month of PM orders without a spreadsheet» test is the hourly sweep
  plus «Έκδοση τώρα» on the programme screen; both are idempotent.
- The penalty amounts are the one open fact. Until they are typed in, the
  scorecard's € figures cover availability only and say so.
