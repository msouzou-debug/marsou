# Cost

The screen shows a project's cost: the four figures (approved budget, commitments, spend, forecast final cost), by category and in total. Engineers, Estates and Finance use it to track whether a project is moving within its budget.

## Steps

1. Open the «Cost» tab on the project page.
2. Read the cost bar at the top: the grey part is the approved budget, the blue parts show commitments and spend, the circle marks the forecast.
3. Read any warnings below the bar — they never block anything, they only inform you. Click «Dismiss» to acknowledge one.
4. In the table, read cost by category, with the variance (forecast minus approved budget) in the last column.
5. Click «Export to Excel» top right to download the table.
6. If you have the right role, change the «Forecast inputs» (contingency, pending-variation weight) and click «Save» to recalculate the forecast.
7. In the «Cash flow» section, pick the month range you want to see. The month picker is a browser control, so month names follow your browser's language, not necessarily the application's.
8. Finance additionally sees the «Budget lines» by year and can edit them.

## What can go wrong

- **A value shows «—» instead of an amount.** No SAP import has been recorded for the project yet — it does not mean zero.
- **The variance is red.** It is negative.
- **You cannot edit the «Forecast inputs».** Only the project engineer, the head of estates and the administrator can change them; you see the values read-only.
- **You cannot see «Budget lines».** Only Finance and the administrator see them.
- **"Data did not load".** The API did not respond. Click "Try again".
