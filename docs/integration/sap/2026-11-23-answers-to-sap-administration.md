# To SAP administration: answers of 23/11/2026, and what eCapital does next

Thank you. The capital spending lines call is exactly the one read eCapital
asked for. The three answers are in the Questions sheet of the attached
copy of your workbook (`ecapital-status-2026-11-23-answered.xlsx`) and here:

1. **Vendor number is enough.** eCapital keys contractors on the SAP vendor
   number and takes name and status from eFinance. Nothing else is needed,
   and nothing else should come.
2. **`CAP-YYYY-NNNN`, 13 characters, always.** Validated the same way in the
   form, the API and the database. It never changes once issued and carries
   no unit code.
3. **Per period.** One call a month for the closed period, all twelve company
   codes in one call, run by eCapital's nightly job. Once a year, after the
   special periods, one call for the whole year as the year-end check.

## On the field for the CAP- reference

The choice is Finance's, but one caution from our side: the Assignment field
(`ZUONR`) is filled automatically by the sort key set on the GL account and
can be overwritten by it, so a value eFinance writes there may not survive.
Reference key 3 (`XREF3`) is free text on the line, 20 characters, and nothing
in standard SAP overwrites it. If Finance has no other reason, Reference key 3
is the safer field. Whichever is chosen, eCapital reads only your
`contractReference` column and does not care which SAP field it came from.

## Open items, from our side

- Item 3, a recent capex invoice: Finance's to give; eCapital has no real
  invoice yet because the real register is not loaded.
- Item 5, fixed assets: we come back when the reconciliation work starts.
- Cost centre expiry (item 4): when you test it, tell us the shape of the
  "expired" change so the pickers hide it from that date.

## What eCapital builds now

- A new import source «Γραμμές SAP» for the capital spending lines, from the
  file or the call, with these matching rules in order: `contractReference`
  to the contract; vendor number plus amount plus document date to an
  eFinance-booked invoice on a contract of that vendor; then the queue a
  person decides, with remembered rules. Each line is marked as matched to
  the eFinance figure, or as a difference, so the reconciliation report
  shows per vendor and period what SAP has that eFinance does not, and the
  reverse.
- The ME2N and KSB1 profiles are retired. FBL1N stays as the file form of
  the same lines until the API key is on the server.

Nothing on your side changes for this.
