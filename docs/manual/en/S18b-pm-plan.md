# Preventive maintenance

The screen opens on the "All agreements" view: every maintenance agreement you can see, in one table. The "By unit" view shows, for each unit, the maintenance agreement, the catalogue of systems with the contract's times and penalties, and the programme that issues the preventive orders. The head of estates and the administrator keep them; everyone else reads them.

## All agreements

1. The tiles at the top count the agreements in the table: how many are in force, how many end within 90 days, how many have expired, the total value of those in force, and this month's preventive orders with the overdue ones.
2. Filter by "Hospital", "Equipment type", "Contractor" and "Expiry". Each filter takes more than one value. In "Search" type an agreement number, its subject or the contractor.
3. The equipment type is the asset class the active systems of the agreement's catalogue are mapped to.
4. The filters stay in the page address. Copy the address to send a colleague the same filtered list. To remove a filter, press the "x" next to it.
5. Press an agreement's number, or Enter on its row, to open it in the "By unit" view.

## By unit

1. Pick a unit. The agreement shows with its contractor, number, term, 24/7 cover, normal hours and availability clause.
2. To change the agreement, press "Edit". If the unit has none, press "Add".
3. In the systems catalogue, double-click an hour or a rate to correct it. Enter saves, Esc cancels.
4. To import from Excel, press "Download template", fill one row per system, pick the file and press "Submit". The result table says how many were added, how many were updated and which rows were not imported.
5. Under "Programme" press "Add" for a new line: system, asset if it covers only one, frequency, next date, how many days ahead the order is issued, and the checklist.
6. Press "Issue now" to issue straight away the orders that are close to their date. The system also does it by itself every hour.

## What can go wrong

- **An agreement shows "Expired" though its end date has not passed.** Its status is "Ended". Change the status in the "By unit" view.
- **The value is missing.** The agreement has no value recorded. The value tile says how many have none. The value is the whole agreement's, not an annual one.
- **An agreement does not show under an equipment type.** None of its active catalogue systems is mapped to that asset class.

- **You see "Penalty rates to be confirmed".** The catalogue is missing penalty amounts. The scorecard counts late items but does not price them until they are filled in.
- **An Excel row was not imported.** The result table names the row and what is missing. Fix the file and upload it again; systems match on their number and are never doubled.
- **"Issue now" issued nothing for a line.** The line already has an open order. Close that one first.
- **You do not see "Edit" or "Issue now".** Only the head of estates and the administrator change them.
