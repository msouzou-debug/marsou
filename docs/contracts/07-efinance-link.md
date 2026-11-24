# Contract 07: eFinance link (cost centres and budget check)

Status: version 2 of 24/11/2026. It replaces the proposal of 23/11, which eFinance never received. This version uses the shape eFinance proposed in its answers of 24/11 (`docs/external/efinance-answers-budget-2026-11-24.md`). Marios gave the go-ahead on 24/11 for eFinance to build its side. Until that is installed and Marios has copied the token, the link stays off in eHire (`efinance_link` = `none`) and nothing is called.

## Decisions (Marios)

23/11/2026: entities, Directorates and hospitals are the same thing; eFinance is the master list of cost centres; a change there must reach eHire; a cost centre switched off or gone in eFinance is switched off in eHire; sync runs nightly and on a button; the budget is checked at steps 2 and 4; eHire warns and a person decides; picking a budget line is optional.

24/11/2026, after eFinance's answers:

- eFinance does not hold payroll spending, so eHire shows **no budget amounts** (no budget, spent, open requisitions or available) until eFinance has payroll actuals from SAP. The amounts panel built for rc11 stays in the code behind a setting, switched off.
- Until then the check is **whether a budget is loaded**: eHire lists the hospital's salary lines and says for each whether eFinance holds a budget for the year. It warns when none is loaded.
- Only salary lines are listed (eFinance's `payroll` flag, today the codes 2102 to 2499; Finance confirms the range in eFinance).
- The budget is the hospital's (entity level), not the cost centre's. The card says so.

## Who calls whom

eHire calls eFinance. eFinance never calls eHire. Same server: eHire uses `http://127.0.0.1:5004`, never the public address. Read-only. Load: one cost-centre call a night, and a budget call when a step 2 or step 4 card is opened (a few dozen a day), cached for 5 minutes in eHire.

## Authentication

eFinance's existing pattern (as for eArchive's callback): the call is accepted only from the same server; `Authorization: Bearer <token>` compared in constant time; eHire has its own token, used only for these two calls. Each side reads it from its own protected file (`EHIRE_EFINANCE_TOKEN` in `/etc/ehire/ehire.env`). Marios copies it file to file. It is never in a database, log, audit row, page, email or chat. A wrong or missing token answers 401.

## 1. Cost centres

`GET /api/ehire/cost-centres`

```
{"as_of": "2026-11-24T09:00:00Z",
 "items": [{"code": "1000000100", "name": "ΔΙΟΙΚΗΤΙΚΟ ΣΥΜΒΟΥΛΙΟ", "entity_code": "HQ", "active": true}, ...]}
```

- The whole list in one answer (about 1,700 rows), active and inactive. `code` is the SAP code as text. `name` is the Greek name; eFinance holds no English name, so eHire stores it as both.
- eHire also accepts the list under the key `cost_centres` and the name under `name_el`, so either spelling works.
- Optional `ETag`; eHire sends `If-None-Match` and treats 304 as "nothing changed".

What eHire does with it (one transaction, one audit row with counts and the changed codes):

| In eFinance | In eHire |
|---|---|
| New code | Added, tied to the Directorate with that entity code. Unknown entity code: added with no Directorate and reported |
| Name, entity or active flag changed | Updated to match |
| Present and inactive | Switched off |
| Missing from the list | Switched off (never deleted). eFinance says it never deletes, so this is a safeguard |
| Switched off in eHire by hand but active in eFinance | Switched on again: eFinance wins |

A cost centre that is switched off can no longer be chosen on a new request; requests that use it keep it. Codes starting `T-` (test data) are left alone. Safety stop: if the answer holds fewer than half the active cost centres eHire has, or none, eHire changes nothing, reports the sync as failed and keeps the last good list.

## 2. Budget lines of a cost centre's hospital

`GET /api/ehire/budget?cost_centre=<code>&year=<YYYY>`

```
{"cost_centre": "1000000100", "entity_code": "HQ", "year": 2027, "level": "entity",
 "lines": [{"budget_code": "2102", "description": "BASIC PAY", "payroll": true,
            "budget": 4250000.00, "spent": 0.00, "open_requisitions": 0.00, "available": 4250000.00,
            "budget_updated_at": "2026-12-15T10:00:00Z", "spent_covers": "efinance_invoices_only"}]}
```

- A budget line is budget code + entity + year. eFinance finds the entity from the cost centre. `level` is `entity`.
- `budget_code`: 4 digits, the SAP commitment item. `description`: the SAP short text, in English.
- `payroll`: true for salary lines. eHire reads only those and ignores the rest. eFinance may add an optional `payroll=1` parameter that returns only salary lines; eHire sends it and filters again itself.
- `budget`: a number, or `null` when no budget is loaded for that line and year. `spent`, `open_requisitions`, `available`: numbers or `null`. Amounts may arrive as numbers or as decimal strings; eHire accepts both.
- 404: eFinance does not know the cost centre. An empty `lines` list: no budget code applies.

## How eHire uses the budget answer

Setting `efinance_budget`: `off`, `exists` (default once the link is on) or `figures`.

**`exists`** (the mode in use until SAP actuals arrive):

- Step 2, Directorate Accountant, «Υπάρχει διαθέσιμο κονδύλι;» and step 4, Head of Financial Management, «Υπάρχει πίστωση;»: the card shows a panel «Στοιχεία από το eFinance» for the request's cost centre and the current year (Cyprus time). It lists the hospital's salary lines: code, description, and whether a budget is loaded («Υπάρχει προϋπολογισμός» / «Δεν έχει καταχωριστεί»). No amounts.
- Two fixed notes on the panel: the budget is the whole hospital's, not the department's; eFinance does not hold spending on salaries, so no balance is shown.
- The person may pick a line (optional). At step 4 the picked line's code fills «Άρθρο δέσμευσης», which stays a free-text field.
- Warning, never a block: no salary line of the hospital has a budget loaded for the year; or the picked line has none; or eFinance does not know the cost centre. Answering «Ναι» against a warning needs a comment (engine rule B1, error `budget_comment_required`).
- Stored with the answer and shown under «Έλεγχοι και γνωμοδοτήσεις», in the request PDF and in the eArchive approval comment: cost centre, entity, year, the picked code and description if any, whether a budget was loaded, how many salary lines had one, and whether a warning was shown. No amounts are stored in this mode.

**`figures`**: the rc11 panel with budget, spent, open requisitions and available, and the extra warnings on the available balance. Not to be switched on until eFinance's `spent_covers` says payroll spending is included; `flask efinance-budget figures` refuses otherwise unless forced with `--i-know-salaries-are-missing`.

**`off`**: no panel, no call. Cost centres still sync.

eFinance cannot answer (timeout, 401, 5xx, bad JSON, redirect): the card says the figures are unavailable and the person answers as today. Nothing blocks a request.

## What crosses and what never does

To eFinance: a cost-centre code and a year. From eFinance: cost-centre rows, and budget lines of a hospital. Never: request numbers, positions, names of requesters, approvers or leavers, costs, comments, or anything else from eHire's database. eFinance holds no HR information because of these calls.

## Settings and commands in eHire

- `efinance_link`: `none` (default) or `http`. `flask efinance-link none|http`, refused for `http` until `flask efinance-test` gets a good answer from both services.
- `efinance_budget`: `off|exists|figures`, set with `flask efinance-budget`.
- `EHIRE_EFINANCE_URL` (on the server `http://127.0.0.1:5004`), `EHIRE_EFINANCE_TOKEN`, `EHIRE_EFINANCE_TIMEOUT` (5 s). Plain HTTP only to a loopback address; redirects never followed; system proxy settings ignored.
- `flask sync-cost-centres` (cron, 02:40) and the «Συγχρονισμός τώρα» button on the cost-centres page.

## Known limits (from eFinance's answers)

- Real budgets are not entered in eFinance yet (3 test lines on 24/11/2026, none for 2027). Until Finance enters them, the panel says no budget is loaded and every «Ναι» needs a comment.
- Budgets are typed by hand in eFinance; nothing loads next year's before January.
- eFinance switches a cost centre off only by hand until SAP's "expired" notice is connected.
- Budget descriptions are English SAP short texts; eFinance has no Greek names for the codes.
