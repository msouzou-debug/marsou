# ADR-0036 — SAP capital lines replace the ME2N and KSB1 extracts; reconciliation against eFinance, never a second spent figure

**Status:** accepted · 23/11/2026

## Context

CAPEX-01 §7 assumed SAP carried WBS elements and account-assigned purchase
orders for capital works, and the cost import (ADR-0021) was built for three
extracts: ME2N, KSB1 and FBL1N, matched by WBS, then PO, then cost centre.
SAP administration checked production on 20/11/2026: there are no WBS
elements or projects, no capital internal orders, and purchase orders are
stock-only with no account assignment. eCapital had never received a real
extract; the profiles were built and tested on synthetic files.

SAP administration built one read instead, `sap_capex_lineitem_export` (also
as a CSV or Excel file): lines from vendor documents only, on the capital GL
accounts Finance names, for a fiscal year and period range, with the
vendor number and the contract's `CAP-` reference read from the vendor line.
Payroll cannot come through. Until Finance names the GL accounts and the
field that carries `CAP-`, it returns nothing.

eFinance already books invoices per `CAP-` reference into eCapital's spent
ledger (ADR-0029 §3), and migration 0020's `cost_txn_counts_as_spent` keeps
SAP actuals on a contract eFinance knows out of the spent figure.

## Decisions

1. **New report `CAPEX_LINES`**, profile `capexlines.yaml`, ledger ACTUAL,
   sign as delivered (debit positive, credit negative, no inversion), dates
   ISO or dd.mm.yyyy. New columns: `vendorNo`, `contractRef`, `invoiceRef`.
   The file reader takes the connector's CSV or Excel today; `SapMcpReader`
   calls the connector once its key is on the server, with the same rows.

2. **Matching order for CAPEX_LINES**: the line's `CAP-` reference to the
   contract (`CONTRACT_REF`); else vendor number plus amount (net, to the
   cent) plus document date (±3 days) to an eFinance invoice on a contract
   whose contractor carries that SAP vendor number (`EFINANCE_INVOICE`,
   linking `efinanceInvoiceId`); else the remembered rules, keyed by vendor
   number and text; else the queue a person decides on S10. WBS, PO and
   cost-centre matching stay in the code for the batches already imported
   and do not run for CAPEX_LINES.

3. **No second spent figure.** CAPEX_LINES rows are `SAP_EXTRACT` (file) or
   `SAP_MCP` (connector) and fall under `cost_txn_counts_as_spent` unchanged:
   on a contract eFinance knows they are reconciliation only; on a contract
   eFinance does not know they count, as any SAP actual did.

4. **Reconciliation report** `sap-reconciliation`, the eighth report: per
   contract, or per vendor where no contract was found, SAP's total (by
   posting date) against eFinance's booked total (by invoice date) for the
   period, the difference, and a status: MATCHED, DIFFERENCE, SAP_ONLY,
   EFINANCE_ONLY. Excel with live formulas like the other seven. Read by
   finance, head of estates, admin, executive and auditor.

5. **ME2N and KSB1 are retired for new uploads** (`errors.sapReportRetired`).
   Their batches and rows stay. FBL1N stays as a file form of vendor items
   until the connector is live.

6. **The vendor name** shown on a CAPEX_LINES row comes from eFinance's
   vendor list (`efinance_vendor`) by vendor number; SAP sends the number
   only, by design.

## Consequences

- Migration 0026: `sap_report` gains CAPEX_LINES, `cost_matched_by` gains
  CONTRACT_REF and EFINANCE_INVOICE, `cost_txn` gains `vendor_no`,
  `contract_ref`, `invoice_ref`, `efinance_invoice_id`; the remembered rules
  accept a vendor number as key.
- Until Finance answers (GL accounts, `CAP-` field), real files will match
  by vendor and amount, and the queue holds the rest.
- The connector key is placed file to file on the server like the eArchive
  token; nothing in the repository holds it.
