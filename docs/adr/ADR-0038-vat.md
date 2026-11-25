# ADR-0038 — Commitments carry a net amount and a VAT rate; budget control runs on gross

**Status:** accepted · 25/11/2026

## Context

Until now every amount in eCapital was one figure with no word about VAT.
Contracts, variations and payment certificates were typed as signed, which
in Cypriot public works means excl. VAT; budgets were typed as approved,
which means incl. VAT; SAP and eFinance actuals were posted as they came.
The cost screens compared all of them as if they were the same kind of
number.

The owner decided (item 23, 25/11/2026): «amounts should be with VAT across
the tool». ΟΚΥπΥ provides VAT-exempt health services and cannot recover
input VAT, so the VAT on a contract is a real cost to the project and has
to be inside every comparison with a budget.

## Decisions

1. **A rate, in packages/shared.** `VatRate`: `STANDARD_19`, `REDUCED_9`,
   `REDUCED_5`, `ZERO`, `EXEMPT` (0,19 / 0,09 / 0,05 / 0 / 0). `vatOf(net,
   rate)` and `grossOf(net, rate)` round to the cent, half away from zero,
   in integer cents × basis points, which is what PostgreSQL's
   `round(numeric, 2)` does; the screen's live figure is the stored one.
   ZERO and EXEMPT charge the same nothing and differ in law, so both are
   kept and the screen says «Απαλλαγή» for the second.

2. **Commitments signed excl. VAT store the net and a rate** (migration
   `0031_vat.sql`):
   - `contract.vat_rate`, default 19 %, editable as a correction;
   - `variation.vat_rate` and `payment_cert.vat_rate`, taken from the
     contract by a BEFORE INSERT trigger when none is written, overridable
     on the form, and kept as their own afterwards: correcting the
     contract's rate never re-rates an approved variation;
   - the bill of quantities stays net, at the contract's rate (no rate of
     its own);
   - site instructions carry no money (a cost-impact flag only), so nothing
     changes there; accruals derive from certificates and follow them.

3. **Generated columns, not computed on read.** `original_vat`,
   `original_gross` on the contract, `vat_amount` and `gross_value` on the
   variation, `vat_amount` and `gross_payable` on the certificate are
   `GENERATED ALWAYS … STORED` over `ecapital.vat_of(net, rate)`, an
   IMMUTABLE SQL function. Every SQL sum in the portfolio, the reports and
   the warnings can add gross directly, the rounding is per row and in one
   place, and nothing typed can disagree with it. `contract.current_gross`
   depends on other rows, so the trigger that keeps `current_value` (0003)
   now keeps both: the original gross plus each APPROVED variation's gross
   at its own rate. `currentVat` on the API is `currentGross −
   currentValue`, because the variations may carry other rates.

4. **Budgets are gross and carry no rate.** The approved budget, the budget
   lines and the cash-flow plan (0028) are amounts incl. VAT. Their labels
   say «με ΦΠΑ»; nothing is stored differently.

5. **Every budget comparison is gross with gross.** Committed = Σ
   `current_gross`; the forecast adds the SUBMITTED variations' gross at the
   weight and a contingency written with VAT; spent is the actuals, posted
   gross; the cost bar, S04's categories, the portfolio, S02, the
   capital-programme and exceptions reports, the cash flow, the R31 rules
   «commitment over the year's budget» and «forecast over approved» all
   read gross. The contractor scorecard's money column is gross.
   **Contractual comparisons stay net with net**: the 10 % variation limit
   is of the value as signed, a certificate certifies work at contract
   rates, the scorecard's variation rate and defect rate per 100.000 € are
   ratios of contract figures. Mixing would make a 5 % contract look as if
   its variations were bigger than they are.

6. **Not VAT-bearing, single amounts:** the delay penalty (ρήτρα), claims
   as claimed, bonds and guarantees, retention (held on the net work).

7. **Actuals.** An eFinance invoice line gives its net (`line_total`, qty ×
   unit price) and its own `vat_rate`; the ledger row now posts net + VAT
   as `amount` and keeps both halves in the new `cost_txn.net_amount` and
   `vat_amount`. The rate has been seen as «19» and «19.00»; a value of 1 or
   less is read as a fraction already (`efinance_vat_fraction`). A line with
   no rate posts its total as it is. **A SAP line is one figure and is taken
   as gross** (FLAGGED: Finance has not said whether the capital GL lines of
   a non-recovering entity carry VAT; for an organisation that cannot
   deduct, the VAT normally lands on the expense account, which makes the
   line gross). The ADR-0036 match by vendor and amount accepts the invoice's
   net or its gross to the cent, and the SAP reconciliation report compares
   SAP with eFinance's gross, until Finance confirms.

8. **Existing data.** Every contract, variation and certificate already
   recorded is taken as NET at 19 %. The migration fills the rate, the
   generated columns fill themselves and one guarded UPDATE works out each
   contract's `current_gross`. eFinance's booked lines, posted net until
   now, are made gross from their own line's rate. **Committed totals rise
   by about 19 % on every screen the day this ships**; budgets do not move,
   so projects whose net commitment was close to the budget will now show
   as over it. That is the point of the decision, and it is said here so
   nobody reads it as a fault.

9. **eFinance contract push unchanged.** Record §4 carries one figure,
   `current_value`, and has no field for a rate. eCapital keeps sending the
   NET current value it always sent. FLAGGED: whether eFinance's own
   `remaining` (current value − booked) then compares net with net is
   eFinance's to confirm.

10. **Screens and workbooks.** Wherever a net amount is typed (S07a, S08,
    S09) a «Συντελεστής ΦΠΑ» select sits beside it, defaulting to the
    contract's, and «Ποσό ΦΠΑ» and «Σύνολο με ΦΠΑ» show live under it.
    Tables of commitments (S08, S09, S09a) show «Καθαρό ποσό», «Συντελεστής
    ΦΠΑ», «Ποσό ΦΠΑ» and «Σύνολο με ΦΠΑ»; lists and cards (S07, S07e, S03)
    show the gross with the net and the VAT in the tooltip. Every Excel
    stays live: the generic table export writes the rate as a percentage,
    VAT as `=ROUND(net*rate,2)` and gross as `=net+vat` (a new optional
    `formula` on `TableExportColumn`); the accruals workbook does the same
    and its accrual is `=MAX(0,gross−invoiced)`; the scorecard writes net
    and VAT as inputs (mixed rates) and gross as `=net+vat`; totals stay
    `SUBTOTAL`/`SUM`.

## Consequences

- Migration 0031 adds the type `ecapital.vat_rate`, three functions, ten
  columns and two triggers, and replaces 0003's two commitment functions.
  It adds, drops and loosens no policy: row-level security is unchanged.
- `Contract`, `Variation`, `PaymentCert`, `AccrualRow`, `CostTxn` and
  `CapitalContractorRow` gain fields; `ContractCreate`, `VariationCreate`
  and `PaymentCertCreate` take an optional `vatRate`.
- The approvals inbox keeps its three facts and words the money one as
  «gross (καθαρό net)».
- Maintenance agreements, backlog estimates and asset costs are untouched:
  the decision was about capital commitments and budgets, and those
  modules have their own owners.
