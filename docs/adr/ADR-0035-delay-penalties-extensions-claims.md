# ADR-0035 — Delay penalties shown and never deducted, extensions of time as records, sections with their own clock, claims, freshness, and a business case before a project leaves «Ιδέα»

**Status:** accepted · 09/11/2026

## Context

The Internal Audit Unit (ΜΕΕ) reported to the Audit Committee in November
2026 on the Organisation's capital investments (`docs/audit/2026-11-09-MEE-capital-findings-vs-eCapital.md`).
The structural finding, one system instead of Excel per hospital, is what
eCapital is. Six contract-level findings were not answered, or only half:

1. Delay penalties («ρήτρες καθυστέρησης») are calculated by hand and
   activated late: Larnaca Section A, €1.000 a day, activated seven months
   after the deadline; Section B still running at €1.000 a day.
2. Extensions of time are approved by ΤΕΑΑ or ΚΕΑΑ without the ΜΕΕ seeing
   who approved what, when, why, or whether the delay was the contractor's
   fault. eCapital held one integer.
3. A contract has sections («Τμήμα Α», «Τμήμα Β») with separate deadlines,
   and the master file showed a project complete while rooms of it were
   pending in another section. eCapital held one completion date.
4. A terminated contract (NICU NAM III) carries a claim of €2,5 million and
   a counterclaim, and finance may have to disclose a contingent liability.
   eCapital had no place for a claim.
5. Management committed to update timetables. Nothing marked a project
   nobody had touched.
6. The ΜΕΕ recommends a feasibility study before a project enters the
   budget. The business case was a document kind, not a gate.

The owner's decisions, 09/11/2026: build all six; **the penalty is shown,
finance deducts it.**

## Decisions

1. **The penalty is computed on read and never posted.** A delay clock runs
   from the due date (contractual completion plus the approved extensions
   on that clock) to the handover date, or to today while the works are
   open. Days late × the daily rate is the accrued amount; null without a
   rate. It appears on the contract, on the payment certificate screen as
   a notice to finance, in the exceptions report and in the contractor
   scorecard. **No deduction line is created**: finance withholds it on
   the certificate as it does today, with the figure in front of it. The
   head of estates records the **activation** (date and note) on a clock;
   the accrual runs regardless, because the contract's clause does not
   wait for anyone.

2. **An extension of time is a record, not a number.** `contract_extension`:
   days, date approved, approver (ΤΕΑΑ, ΚΕΑΑ, the engineer, other), the
   approver's name, the reason, **contractor culpable yes or no**, and an
   optional filed document. `contract.extension_days` stays as the sum,
   kept by a trigger, so nothing that read it changes. A legacy value is
   migrated into one record marked as carried over. The form no longer
   takes the number.

3. **Sections are rows.** `contract_section`: code, title, contractual
   completion date, handover date, an optional rate that overrides the
   contract's, and the activation fields. A contract with sections has one
   clock per section and none of its own; a contract without sections has
   one clock, its own. An extension names its section or none.

4. **A claim is a row.** `contract_claim`: direction (by the contractor, by
   the Organisation, a counterclaim being the latter), title, amount,
   stage (notified, under review, negotiation, arbitration, court,
   settled, withdrawn), date notified, legal advisor, **contingent
   liability** for finance, notes, an optional document. Open stages
   count on the contract and in the exceptions report.

5. **Freshness is a computed column.** `lastActivityAt` on a project is the
   newest `updated_at` of the project and everything under it: milestones,
   risks, issues, notes, contracts, variations, payment certificates. The
   list shows the date; the exceptions report marks a project stale after
   `STALE_AFTER_DAYS` = 30 and sorts it with the exceptions. No e-mail
   (M10).

6. **A business case before the project leaves «Ιδέα».** `changePhase`
   forward out of IDEA is refused with `errors.businessCaseMissing` unless
   a `BUSINESS_CASE` document is filed on the project. An administrator
   moving a project backwards is unaffected. Seeded projects already past
   IDEA are not touched.

7. **Permissions.** Sections, extensions and claims are `contractRecords`
   WRITE (admin, head of estates, project engineer). Activating a penalty
   is `contractRecords` APPROVE, granted to admin and head of estates in
   the default matrix (ADR-0033 lets the administrator change it). Finance
   reads everything.

8. **Glossary.** «Ρήτρα καθυστέρησης», never «Ποινή». «Παράταση» for an
   extension of time. «Τμήμα» for a section. «Αξίωση» for a claim,
   «Αξίωση Οργανισμού» for one by the Organisation. «Ενεργοποίηση ρήτρας».
   «Ενδεχόμενη υποχρέωση» for a contingent liability.

## Consequences

- Migration 0025 adds three tables, two columns on `contract`, the sum
  trigger and the legacy carry-over. No seed change is required; the seed
  gains a Larnaca-shaped example (two sections, one activated, one
  extension judged not culpable, one claim) so the UAT can see the figures.
- The capital contractor row gains the accrued penalty and the culpable
  extension days; the exceptions row gains staleness, penalty and open
  claims. Excel exports carry them as values with the totals as formulas.
- The contract screen gains two tabs, «Προθεσμίες και ρήτρες» and
  «Αξιώσεις». The certificate form shows the accrual as a notice.
- Deferred: e-mail on activation or on a stale project (M10); a penalty
  cap per contract; interest on claims.
