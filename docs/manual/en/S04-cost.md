# Cost

The screen shows a project's cost: the four figures (approved budget, commitments, spend, forecast final cost), by category and in total. Engineers, Estates and Finance use it to track whether a project is moving within its budget.

## Steps

1. Open the «Cost» tab on the project page.
2. Read the cost bar at the top: the grey part is the approved budget, the blue parts show commitments and spend, the circle marks the forecast.
3. Read any warnings below the bar — they never block anything, they only inform you. Click «Dismiss» to acknowledge one.
4. Below the warnings, read the «eFinance budget position»: one card for each budget code and year, with «Budget», «Actual spend», «eFinance commitments», «In flight» and «Available», and the time the figures are as of.
5. In the table, read cost by category, with the variance (forecast minus approved budget) in the last column.
6. Click «Export to Excel» top right to download the table.
7. If you have the right role, change the «Forecast inputs» (contingency, pending-variation weight) and click «Save» to recalculate the forecast.
8. In the «Cash flow» section, pick the month range you want to see. The month picker is a browser control, so month names follow your browser's language, not necessarily the application's.
9. Finance additionally sees the «Budget lines» by year and can edit them.

**Why eFinance's position is kept apart from the cost bar.** The budget position is eFinance's view by budget code, and the same code can also carry other projects' contracts. So it is not added to the project's four cost ledgers, and it is never summed across codes. «eFinance commitments» are eFinance's own commitments, not eCapital's «Commitments». «In flight» is invoices that are not booked yet; it says «Not counted» and is in neither «Actual spend» nor «Available».

## What can go wrong

- **A value shows «—» instead of an amount.** No SAP import has been recorded for the project yet — it does not mean zero.
- **The variance is red.** It is negative.
- **You cannot edit the «Forecast inputs».** Only the project engineer, the head of estates and the administrator can change them; you see the values read-only.
- **You cannot see «Budget lines».** Only Finance and the administrator see them.
- **"Data did not load".** The API did not respond. Click "Try again".
- **The «eFinance budget position» says «eFinance link not configured».** This server has no eFinance link set up yet. The rest of the screen is unaffected; ask the system administrator to set the link up.
- **It says the project's contracts have no budget code.** eFinance is asked by budget code, so without one it has no position to show. Open the contracts and pick a budget code.
- **It says «eFinance did not answer».** eFinance was unavailable at that moment. Click «Try again» in the panel; the rest of the screen works as normal.
- **An eFinance figure shows «—».** eFinance has no figure for that budget code and year. It does not mean zero.
- **«Available» is red.** It is negative: eFinance already has spend and commitments above the budget code's allocation.
