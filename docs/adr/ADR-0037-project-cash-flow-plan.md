# ADR-0037 — A project's cash flow is planned by month, and the budget spread stays as the fallback

**Status:** accepted · 25/11/2026

## Context

R17 gave S04 a cash flow whose «planned» column is each year's budget line
spread evenly over twelve months. That was honest while nobody profiled a
capital budget by month, but it says nothing about when a project will
actually pay: a mobilisation in March and a large delivery in October read
as twelve equal twelfths. The owner decided on 25/11/2026: «Projects need a
cash-flow schedule», an editable monthly plan, with an Excel round trip
whose formulas stay live and auditable.

## Decisions

1. **One table, `project_cashflow_plan`** (migration 0028): project, month
   (`YYYY-MM`), amount (never negative), an optional note, who changed it
   and when, unique per project and month. The unit is copied from the
   project by trigger; row-level security and the audit trigger are the
   same as every other project child.

2. **The plan replaces the spread, it does not add to it.** A project with
   at least one plan month reads «planned» from the plan only. A project
   without one keeps the R17 twelfths. Each cash-flow row says which
   (`plannedSource`: `PLAN`, `BUDGET`, or `MIXED` for a unit month that has
   both); S04 shows a line saying which source is in use.

3. **The unit's cash flow follows the same rule per project.**
   `GET /org-units/:id/cost/cashflow` sums each project's plan where it has
   one and its budget spread where it does not. There is no other
   portfolio-level cash flow to change.

4. **The plan is not the budget.** Its total may differ from the approved
   budget (the latest vintage's BUDGET lines, the figure S04's cost bar
   shows). The API returns the difference (plan − approved) and the screen
   shows it, red when the plan spends more. Nothing is blocked.

5. **Who writes it.** The same people who write the budget lines:
   `@Needs("budgetLines", "WRITE")`, finance and the administrator by
   default, with `ecapital.can_manage_budget_line` as the row policy.
   Everyone who reads the project reads the plan.

6. **API.** `GET` and `PUT /projects/:id/cost/cashflow-plan`. `PUT` takes
   `mode: "replace"` (the months given are the whole plan; an empty list
   removes it and the spread comes back) or `"upsert"` (the months given are
   written, the rest left). A month that did not change is not rewritten, so
   the audit trail shows only what moved.

7. **Excel round trip.** `GET …/cashflow-plan/template.xlsx` gives months as
   rows (A month as text `mm/yyyy`, B amount, C note), prefilled with what
   the cash flow plans today, and beside them `=SUM(B:B)`, the approved
   budget and `=F3-F4`. `POST …/cashflow-plan/import` reads A:C only. It is
   all or nothing: any bad row (month not a month or repeated, amount
   missing, not a number or negative, note too long) comes back with its
   sheet row number and nothing is saved; a clean file replaces the plan.

## Consequences

- S04's «Ταμειακή ροή» gains «Επεξεργασία πλάνου» (a list of months between
  two pickers, with totals and the difference), «Λήψη προτύπου» and
  «Εισαγωγή από Excel». Months show as `mm/yyyy`.
- The seed gives three projects a plan, one of them 5% short of its
  budget, so both sources and a non-zero difference are visible.
- Changing who writes the plan is a cell of the role matrix (`budgetLines`)
  and changes the budget lines too. If the owner later wants engineers to
  keep the plan while finance keeps the budget, the plan needs its own row
  in the matrix.
