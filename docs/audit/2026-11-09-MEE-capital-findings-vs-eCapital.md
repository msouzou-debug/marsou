# Internal Audit (ΜΕΕ) report on capital investments, November 2026, read against eCapital

Source: ΜΕΕ «Ενημερωτική Έκθεση προς την Επιτροπή Ελέγχου, Οικονομικών και
Διαχείρισης Κινδύνων — Κεφαλαιουχικές Επενδύσεις Οργανισμού», reporting
period March 2026, issued November 2026. Read on 09/11/2026 against the
eCapital build on branch `claude/ecstatic-cray-g0zhkx` (release of
05/11/2026 on the UAT server).

Verdict in one line: **the structural finding (no single system, Excel per
hospital, no audit trail, no reconciliation with finance) is answered by
what is built; the contract-level findings (delay penalties, extensions of
time, claims, section and phase decisions) are only partly answered and
need four small additions; automated delivery of reports and alerts is not
built (M10).**

«Covered» means the control exists in the software and is tested.
«Partly» means the data is there but the control the ΜΕΕ asks for is not
computed or not enforced. «Gap» means nothing in eCapital answers it.

| # | ΜΕΕ finding or recommendation | eCapital today | Status |
|---|---|---|---|
| 1 | No single organisational unit and no single system for centralised monitoring; responsibility split by investment category; no named persons (§3.1, Παρ. 2) | One register for the twelve units and HQ, with row-level security by unit (ADR-0010). Every project names a sponsor and a project manager; every unit has a head of estates. Which unit owns the oversight is an organisational decision, not a software one. | Covered for the system; the ΜΕΕ's point about a single accountable unit is for the Board |
| 2 | Independent Excel files per hospital sent on request; the Technical Department's «check» is undocumented; no audit trail; no reconciliation with accounting data (§3.2) | One database. Every change on every table is in `audit_log` with actor, time and before/after (migration 0004). SAP extracts (ME2N, KSB1, FBL1N) are matched to contracts with an unmatched queue and remembered rules (M2); eFinance invoices, requisitions and the budget position are read live (ADR-0029). The Excel importer validates with rules V01–V15 and writes a reconciliation report (CAPEX-03). | Covered |
| 3 | Standardise submission and update: templates, update timetables, minimum required fields, systematic update of cash flows (§3.3, action 1) | Forms with required fields and phase rules (R04); cash flow by month with forecast inputs; committed and spent ledgers. There is no reminder when a project has not been updated for a month and no «stale» mark. | Partly: a freshness flag on the portfolio and in the exceptions report is a small addition |
| 4 | Master file shows a project complete while rooms of it are pending in another section; phasing decided orally (§3.4) | Milestones with gates and actual dates, phases, project notes, documents filed to eArchive. A contract has one completion date; «Τμήμα Α / Τμήμα Β» with separate dates and separate penalty clocks cannot be recorded. Decisions are free-text notes, not a typed decision with approver and date. | Partly: contract sections and a decision record are needed |
| 5 | Delay penalties: when activated, how calculated, withheld from payment; ΜΕΕ to monitor Section B (§4.1) | The contract carries completion date, extension days and `liquidatedDamagesPerDay`. The contractor scorecard counts overdue contracts. Nothing computes the accrued «ρήτρα καθυστέρησης» (days late × rate), records its activation, or carries it as a deduction on «Πιστοποίηση πληρωμής». The maintenance side already does this for SLA penalties (ADR-0031). | Partly: compute and show the accrual, link it to the payment certificate |
| 6 | Terminated contract (NICU NAM III): no penalties before termination, guarantees forfeited, claim and counterclaim, possible contingent liability (§4.2) | Performance bond value and expiry are on the contract; risks have an owner and a mitigation. There is no claim record with amounts claimed and counterclaimed, status and legal advisor, and no contingent-liability flag for finance. | Gap: a claims record per contract |
| 7 | Extensions of time approved by ΤΕΑΑ/ΚΕΑΑ without the ΜΕΕ seeing the documentation; culpability must be judged explicitly; penalty applies if no extension is approved (§4.3) | `extensionDays` is one number. No record of who approved, when, for what reason, or whether the delay is the contractor's fault. | Gap: an extension-of-time record with approver, date, reason, culpability |
| 8 | A feasibility study with cost, staffing, timetable and funding before a project enters the budget (general remark) | Funding source, approved budget and budget years are on the project; the business case is a document kind filed to eArchive. Nothing prevents a project from leaving «Ιδέα» without one. | Partly: a gate on the business case is one rule |
| 9 | Budget 2026: projects removed from the budget proceeding on a decision while written approval is pending; commitments before approval (page 2) | Flags on the project for in-budget-2026, commitment and contractual commitment; one CAPEX budget code per contract from eFinance; warning when commitments exceed the year's budget (R31). No state for «proceeding pending written approval». | Covered for the warning; a note or flag for the pending approval is small |
| 10 | Single digital platform; control dashboard with every active project, percentage of construction cost spent and cash outflows; automated weekly or monthly reports to HQ with alerts on overrun or delay; pilot in one or two hospitals (Παρ. 2) | Portfolio dashboard by unit with approved, committed, spent, forecast, spent percentage and RAG; seven reports with Excel and PDF, including the exceptions report sorted red first. Reports are on demand; nothing is e-mailed on a schedule and no alert leaves the application (M10). The UAT server is live with sample data; the pilot has not started with a real register. | Partly: scheduled delivery and alerts are M10; the pilot needs the real register loaded |

## What the ΜΕΕ findings add to the backlog

In the order that answers the report fastest.

1. **Delay penalty accrual on capital contracts.** Days past completion date
   plus approved extensions, times the daily rate, shown on the contract,
   in the exceptions report and the contractor scorecard; an «activation»
   date and a deduction line on the payment certificate. The Larnaca case
   (€282.000 on Section A, €1.000 a day running on Section B) is exactly
   this calculation.
2. **Extension of time as a record.** Date, days, approver (ΤΕΑΑ or ΚΕΑΑ),
   reason, contractor culpable yes or no, document filed. `extensionDays`
   becomes the sum of approved records. Answers §4.3 directly.
3. **Contract sections.** «Τμήμα Α», «Τμήμα Β» with their own completion
   dates, handover dates and penalty clocks. Answers §3.4 and the Section
   B monitoring the ΜΕΕ has taken on.
4. **Claims record.** Per contract: claimant, amount claimed, counterclaim,
   stage, legal advisor, contingent-liability flag for finance. Answers
   §4.2.
5. **Freshness.** «Last updated» on every project in the portfolio and a
   «not updated for 30 days» line in the exceptions report. Answers the
   update-timetable commitment of §3.3 without waiting for e-mail.
6. **Business case gate.** A project cannot leave «Ιδέα» without a business
   case filed. One rule.
7. **Scheduled reports and alerts (M10).** Monthly exceptions report to HQ
   by e-mail, alert on red RAG or penalty accrual. Needs an SMTP relay from
   IT; the outbox table exists.

Items 1 to 6 are small; none needs a new screen beyond a tab on the
contract. Item 7 depends on IT.

## What eCapital cannot answer

- Which unit holds the single accountability the ΜΕΕ asks for (§3.1).
- Whether the Procurement platform for medical equipment is reused or
  replaced (§3.3, action 2). eCapital's register takes biomedical assets
  (R45) but does not read that platform.
- The content of the Ministries' written approval for projects outside the
  2026 budget.
