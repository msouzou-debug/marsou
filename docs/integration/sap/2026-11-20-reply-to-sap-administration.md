# To SAP administration: eCapital's answers after your findings of 20/11/2026

20 November 2026. Your findings change our plan more than they change
yours, and the honest starting point is this: **eCapital has never received
a real ME2N, KSB1 or FBL1N file.** The three import profiles were built from
the project brief (CAPEX-01 §7 and §12), which assumed SAP carried WBS
elements and account-assigned purchase orders for capital works, and they
were tested with synthetic files. Nobody at ΟΚΥπΥ runs those reports for
eCapital today. So most of your five questions have one answer each, below,
and the plan is revised.

## Your five questions

1. **Example files.** None exist. The only ME2N, KSB1 and FBL1N files
   eCapital has seen are the synthetic ones its test suite generates
   (`apps/api/test/fixtures/build-sap-fixtures.ts`). We can send those so
   you see the column names the profiles expect, but they are not SAP's.
2. **How they are produced.** They are not. The question goes to Finance:
   whether anyone runs these reports today, with what selection, and for
   whom. We assumed a Finance routine that may not exist.
3. **Matching columns.** The importer matches, in order: WBS element to the
   project; purchase order number to the contract; cost centre to a
   project that carries it; then vendor name plus text against rules a
   person remembered last month; the rest goes to a queue a person decides.
   Capex was to be told by the file itself (a capex variant). With no WBS
   and no account-assigned POs, only the vendor-and-text rule and the
   queue survive, which is not a feed.
4. **Link to a project without WBS.** By the contract: every eCapital
   contract has a `CAP-YYYY-NNNN` reference, and eFinance stamps that
   reference on each invoice it books against the contract before the SAP
   batch file is made (ADR-0029). That is the capital key that already
   exists, document by document. The project is the contract's.
5. **Fixed assets.** Later. When the reconciliation to SAP asset classes
   starts we come back with section H of the workbook as it stands.

## The revised plan

- **Spent is eFinance's, not SAP's.** Booked invoices per `CAP-` reference
  already land in eCapital's ledger live. No SAP feed is needed for the
  primary figure.
- **Committed is eCapital's.** Its own contracts and approved variations,
  with eFinance's requisitions shown beside them. SAP purchase orders are
  stock-only, so no PO feed.
- **Drop WBS, purchase orders and CO line items** from the bridge. The
  workbook is revised (`ecapital-sap-fields.xlsx`, rows marked 20/11/2026).
- **Keep one SAP read for reconciliation**: vendor line items (FI-AP) for
  the twelve company codes, filtered to the capital G/L accounts or
  commitment items Finance names: document number and line, document and
  posting date, amount with sign, text and assignment, reference, vendor,
  cost centre, G/L account. eCapital compares them, per vendor and period,
  with what eFinance booked. Vendor items only, so payroll stays out by
  construction.
- **Take cost centres and company codes now**, for the unit and area
  pickers. Thank you.
- **The API key**: file to file on the server, the way the eArchive token
  is placed (runbook §11.2), never by e-mail or chat.

## Two questions back

1. **For eFinance and Finance together:** does the SAP document created from
   eFinance's batch file carry the invoice's `CAP-` reference in a field we
   can read back (reference `XBLNR`, assignment `ZUONR`, or header text)?
   If yes, the reconciliation matches by key. If not, it matches by vendor,
   amount and date, which works but needs a person for the leftovers.
2. **For Finance:** which G/L accounts or commitment items mark a posting
   as capital in the twelve company codes? eCapital holds eFinance's CAPEX
   code list (five real codes, fifteen placeholders) and needs the real
   list.

Your suggestion to carry the project key into SAP on each document is the
right one, and eFinance already does half of it with the `CAP-` reference.
Whether Finance also wants the eCapital project code in the header text is
their call; eCapital needs only the contract reference.
