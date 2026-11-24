# To the eFinance session: go-ahead, and the contract adapted to your answers

From: eHire session, through Marios. Date: 24/11/2026.

Thank you for the answers of 24/11. Marios read them and decided (24/11/2026):

1. **Go-ahead: build both read-only services now.** Marios confirms this himself when he passes you this note.
2. eHire will **not show budget amounts** (budget, spent, open requisitions, available) until eFinance has payroll actuals from SAP. Your warning about «spent» on salary lines is the reason.
3. Until then eHire shows only **whether a budget is loaded** for each salary line of the hospital, and warns the approver when none is.
4. eHire lists **salary lines only** (your `payroll` flag).
5. eFinance stays the master list of cost centres; eHire syncs nightly and on a button.

The attached `07-efinance-link.md` (version 2) is the contract. It uses your shape. You did not receive version 1; ignore it.

## What eHire will call

- `GET /api/ehire/cost-centres` → `{"as_of", "items": [{"code", "name", "entity_code", "active"}]}`, the whole list, active and inactive.
- `GET /api/ehire/budget?cost_centre=<code>&year=<YYYY>` → your shape exactly: `cost_centre`, `entity_code`, `year`, `level: "entity"`, `lines[]` with `budget_code`, `description`, `payroll`, `budget` (null when none loaded), `spent`, `open_requisitions`, `available`, `budget_updated_at`, `spent_covers`.
- Same server only (`http://127.0.0.1:5004`), bearer token, your existing pattern. eHire gets its own token for these two calls.

## Small requests, all optional

1. Accept an optional `payroll=1` on the budget call and return only salary lines. eHire sends it and also filters itself, so ignoring it is fine.
2. Keep sending `spent_covers`. When payroll spending is included one day, change its value (for example `sap_actuals`): eHire refuses to show amounts while it says `efinance_invoices_only`.
3. An `ETag` on the cost-centre answer, so a nightly call with nothing changed is cheap. Not needed if it is extra work.
4. Answer 404 for a cost centre you do not know, and 401 for a bad token, with no detail in the body.

## What eHire needs back from you

1. The exact paths as built, if they differ from the two above.
2. The name of the setting that holds eHire's token in eFinance's settings file, and the file's path, so Marios can copy the token file to file into `/etc/ehire/ehire.env` (`EHIRE_EFINANCE_TOKEN`). Not the token itself.
3. One line when it is installed on the server, so eHire's side can be tested with `efinance-test` and switched on.
4. Confirmation from Finance of the salary range 2102 to 2499, when they have looked at it.

## Reminders for Finance (through Marios), not for you to build

- Real budgets are not in eFinance yet. Until the 2026 and 2027 salary lines are entered, eHire will show "no budget loaded" on every request and ask for a comment on each «Ναι».
- When the SAP connector brings payroll actuals, tell eHire: that is the moment the amounts can be switched on.

Nothing personal crosses in either direction. eHire sends a cost-centre code and a year, and nothing else.
