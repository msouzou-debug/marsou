# To SAP administration: the SAP data eCapital needs from the MCP bridge

19 November 2026. Answer to the vendor-fields request of the same date,
widened to everything eCapital reads from SAP. The field list is in
`ecapital-sap-fields.xlsx`, same layout as yours: sheet «Fields», column I
is eCapital's answer, column J the reason and the eCapital field it feeds.

## The short version

eCapital needs four kinds of SAP data. Vendors are not one of them.

1. **Vendors: nothing directly.** eCapital reads the vendor number, name and
   the one «active» flag through eFinance's vendor list and keys its
   contractors on the vendor number. Keep one source. Bank accounts, IBAN,
   VAT and tax numbers must never reach eCapital; it pays nobody.
2. **Master data to pick from instead of typing**: cost centres (code, text,
   company code, validity), WBS elements (code, text, project definition,
   status, company code), company codes. Budget codes and the budget
   position stay with eFinance, which already serves them.
3. **Actuals, to replace the three Excel extracts a person uploads today**:
   purchase orders (ME2N fields), CO line items (KSB1 fields), vendor line
   items (FBL1N fields). The exact columns are in sections E to G; they are
   the ones eCapital's import profiles read now, so the matching rules do
   not change. Invoice references, clearing and payment blocks are
   eFinance's, not ours.
4. **Fixed assets, planned**: asset classes with texts, asset number, class,
   capitalisation and deactivation dates, cost centre, and acquisition value,
   accumulated depreciation and net book value per class and company code.
   This feeds the reconciliation of eCapital's item register to SAP's
   categories (owner decision of 19/10/2026), designed and not yet built.

Counts from the workbook: 36 fields Yes, 8 via eFinance, 5 planned, 9 no.

## How the bridge should answer

- Scope: the twelve ΟΚΥπΥ company codes only, same as the vendor feed.
- Incremental where SAP keeps change pointers (master data); by posting
  date range for the actuals, so a nightly pull replaces the manual upload.
- Read-only. eCapital writes nothing to SAP; contracts go to eFinance.
- No employee, patient or payroll data on any call.

## What eCapital does with it

Cost centres, WBS and company codes become pickers on the unit, area and
project screens. The actuals land in the same import pipeline as the files
(screen S10: matched by WBS, PO, vendor and text, unmatched queue, remembered
rules), so finance keeps the control it has today. The asset fields wait for
the fixed-asset reconciliation work.
