# Capitation Fees ΠΦΥ

Builds the monthly capitation fees workbook (`CAPITATION_FEES_MM_YYYY_PAYABLE_MM_YYYY.xlsx`) from:

1. HIO Capitation Reimbursement Reports (zip or PDFs)
2. HIO Remittance Advices / SRA (zip or PDFs)
3. The doctor roster (`ROSTER_capitation.xlsx`: category, ΑΚΑ, ΑΔΤ, allowances)
4. Optional: last month's output, to carry the ΣΥΝΟΛΙΚΑ history forward

Everything runs in the browser. No files leave the PC.

## Use
Open `dist/capitation_tool.html` in Chrome or Edge (needs internet for the pinned cdnjs libraries), add the files and click **Υπολογισμός**.

## Output tabs
CHECKS, ALL, ΠΙΠ ΝΑΜ ΙΙΙ, ΠΙΠ ΑΛΛΟΙ, ΠΙ ΕΝΗΛΙΚΩΝ, ΣΥΝΟΛΙΚΑ, ΟΝΟΜΑΣΤΙΚΑ, ΔΥ, ΟΚΥΠΥ, ΑΓΟΡΑ ΥΠΗΡΕΣΙΩΝ, ΠΑΡΑΙΤΗΣΕΙΣ_ΑΦΥΠΗ, SRA_PD, ROSTER.
All calculated cells are live formulas. Band limits and rates are the yellow cells at the top of each calculation tab.

## Rules (taken from the July 2026 workbook)
- A list with any 18+ age band is an adult list, otherwise a child list. Child lists billed by F1050 go to ΠΙΠ ΝΑΜ ΙΙΙ.
- KPI = SRA line `PD-KPIs-…-ADULT|CHILD-Dxxxx`, matched on doctor code and list type.
- Average list = total list days / days in month. Average fee = (HIO fee + KPI) / average list.
- Doctor fee = sum over bands of (list size inside the band × average fee × band rate).

## Develop
`python3 build.py` builds `dist/`. Tests: `test/run_july.js` (Node) and `test/browser_e2e.js` (Playwright). Validated against July 2026: all 103 doctors match to the cent.
The roster holds personal data (ΑΚΑ, ΑΔΤ). Keep it out of the repository.
