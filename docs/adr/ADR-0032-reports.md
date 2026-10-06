# ADR-0032 — Reports are computed on read, exported with formulas, printed from the browser

**Status:** accepted · 06/10/2026

## Context

M6 is R39: the reporting set of CAPEX-01 §11 — capital programme by
hospital, exceptions, contractor scorecard, maintenance backlog by risk
band, asset lifecycle, clinical disruption, statutory compliance — «all
exportable to Excel with live formulas and to PDF», in the house
convention (blue inputs, black formulas, green cross-sheet links, amber
assumptions). The owner's own standing rule: any Excel output has live,
dynamic, auditable formulas.

Everything the seven reports need already exists as a service: the
portfolio (M1/M2), projects with RAG and reasons, contracts, variations,
defects and RFIs (M1/M3), the disruption hours (M3), the asset register
(M4), the backlog summary and the scorecard (M5). M6 adds no table.

## Decisions

1. **One contract, one query per report, nothing stored.**
   `packages/shared/src/reports.ts` fixes seven shapes and one filter.
   `GET /reports/<slug>` answers the JSON the screen shows and
   `GET /reports/<slug>.xlsx` the workbook; both come from the same
   service call, so a figure on the screen is the figure in the file.
   `meta` stamps when and for which unit and period.

2. **Excel carries the inputs as values and every derived figure as a
   formula**: totals, percentages, slippage, rates, ratios. Inputs in
   blue, formulas in black, links across sheets in green, assumptions
   (the year elapsed, a threshold) in amber with a note. Where a figure
   has no source the cell is blank, never 0, as on the screen.

3. **PDF is the browser's print.** The API runs no browser on the ΟΚΥπΥ
   server, and the guides already prove that a print stylesheet on an
   A4 page is enough. Each report has a print view with the S13 permit
   print's rules — big type, no light grey, the meta line, page
   numbers — and «Εκτύπωση / PDF» opens the browser's dialog. If a
   scheduled, unattended PDF is ever wanted, that is a job on the
   server with the guide builder's Chromium, and a new ADR.

4. **Statutory categories** map from the catalogue and the register:
   LIFTS = asset class LIFT; PRESSURE_VESSELS = systems whose name has
   «ατμ» (steam) or «λέβητ» (boilers) or permit system STEAM;
   MEDICAL_GAS = asset class or permit system MEDICAL_GAS; FIRE_SYSTEMS =
   FIRE. «Due» is a programme order with its date in the year plus a
   STATUTORY order called in the year; «done» completed by its date;
   «overdue» past its date and not completed. The mapping is a function
   in the API with a test, and a system that matches none is not counted.

5. **The capital contractor rows** compute from what the register holds:
   on time = contracts past completion date plus extension and still not
   practically complete, against all with a date; variation rate =
   approved variations over original value; defect rate per 100.000 €;
   RFI breach share; claim accuracy from certificates where any exist,
   null otherwise. Null is shown as «—»; a rate the register cannot
   support is not invented.

6. **Roles.** The reports read what the caller may read (row policies,
   ADR-0010); the nav item and the screen are for the head of estates,
   finance, executive, auditor and admin, as the help map already says.
   An engineer's call to a report route answers 403 by `@Roles`.

## Consequences

- No migration, no seed. The figures come from the M1–M5 sample data.
- A report is as fast as its underlying query; the asset lifecycle and
  the contractor rows read work orders and certificates across units and
  are indexed by those modules already.
- Deferred: scheduled exports and e-mail distribution (R47 preferences
  first), a board-pack PDF assembled server-side.
