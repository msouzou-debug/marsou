# Contract 07: eFinance link (cost centres and budget check)

Status: proposal of 23/11/2026, asked for by Marios. The two endpoints do not exist in eFinance yet. eHire is built and tested against this text with a stand-in server, and the link stays off (`efinance_link` = `none`) until eFinance has built its side and Marios has copied the token. Where eFinance's real names or keys differ, eFinance says so and this text changes; eHire adapts.

Decisions (Marios, 23/11/2026): entities, Directorates and hospitals are the same thing; eFinance is the master list of cost centres; a change there must reach eHire; every request is checked against eFinance's budget for its budget line at steps 2 and 4; eHire warns and a person decides; a cost centre switched off or gone in eFinance is switched off in eHire; sync runs nightly and on a button.

## Who calls whom

eHire calls eFinance. eFinance never calls eHire. Same server: eHire uses `http://127.0.0.1:5004` (eFinance's own port), never the public address. Read-only. Expected load: one cost-centre call a night, and a budget call each time a step 2 or step 4 card is opened or refreshed (a few dozen a day), cached for 5 minutes in eHire.

## Authentication

`Authorization: Bearer <token>`. One long random token, made on the server and stored by eFinance as a hash; eHire reads it from `EHIRE_EFINANCE_TOKEN` in `/etc/ehire/ehire.env`. Marios copies it file to file. It is never in a database, log, audit row, page or chat. eFinance accepts it only on these two endpoints and only from 127.0.0.1. A wrong or missing token answers 401.

## 1. Cost centres

`GET /api/v1/ehire/cost-centres`

Answer 200:

```
{"as_of": "2026-11-23T02:10:00Z",
 "cost_centres": [
   {"code": "1000000200", "name_el": "ΓΡΑΦΕΙΟ CEO", "name_en": null, "entity_code": "HQ", "active": true},
   ...]}
```

- The whole list in one answer (about 1,700 rows, well under 1 MB), active and inactive.
- `code`: the SAP code as text, exactly as eFinance stores it. `entity_code`: one of eFinance's entity codes. `name_en` may be null.
- Optional header `ETag`; eHire sends `If-None-Match` and treats 304 as "nothing changed".

What eHire does with it (one transaction, one audit row with counts and the changed codes):

| In eFinance | In eHire |
|---|---|
| New code | Added, tied to the Directorate with that entity code. Unknown entity code: added with no Directorate and reported |
| Name, entity or active flag changed | Updated to match |
| Present and inactive | Switched off |
| Missing from the list | Switched off (never deleted) |
| Switched off in eHire by hand but active in eFinance | Switched on again: eFinance wins |

A cost centre that is switched off can no longer be chosen on a new request; requests that use it keep it and carry on. Cost centres typed in eHire that eFinance does not know (test data) are switched off by the first sync unless their code starts with `T-`. Safety stop: if the answer holds fewer than half the active cost centres eHire has, or none, eHire changes nothing, reports the sync as failed and keeps the last good list.

## 2. Budget lines of a cost centre

`GET /api/v1/ehire/budget?cost_centre=<code>&year=<YYYY>[&article=<code>]`

Answer 200:

```
{"cost_centre": "1000000200", "entity_code": "HQ", "year": 2026, "as_of": "2026-11-23T06:30:00Z", "currency": "EUR",
 "lines": [
   {"article": "02101", "name_el": "Μισθοί μόνιμου προσωπικού", "name_en": null,
    "budget": "250000.00", "spent": "180340.12", "committed": "20000.00", "available": "49659.88"},
   ...]}
```

- A budget line is one article of one cost centre for one year. `article` is whatever code eFinance uses for a budget line (budget article, GL account or commitment item); eHire shows it and sends it back unchanged.
- Without `article`: every line of that cost centre for the year, payroll lines first if eFinance can tell them apart. With `article`: that one line, or an empty `lines` list.
- Amounts are decimal strings with two decimals; `available` is eFinance's own figure (budget minus spent minus committed, or however eFinance defines it). eHire does not recompute it.
- 404: eFinance does not know the cost centre. An empty `lines` list: it knows it but holds no budget for that year.

## How eHire uses the budget answer

- Step 2, Directorate Accountant, «Υπάρχει διαθέσιμο κονδύλι;»: the card shows the cost centre's lines for the current year. The Accountant picks the line the post will be paid from; eHire shows its budget, spent, committed and available.
- Step 4, Head of Financial Management, «Υπάρχει πίστωση;»: the same panel, opening on the line chosen at step 2. The line picked here fills «Άρθρο δέσμευσης» (the field stays free text when the link is off or eFinance cannot answer).
- Warning, never a block: when the picked line has `available` of zero or less, or less than the annual employer cost of the new posts when that cost is already recorded, or when eFinance holds no budget line for the cost centre, the card says so. Answering «Ναι» against a warning needs a comment (error code `budget_comment_required`). «Όχι» already needs one.
- The figures seen when the answer was given are stored with the action (article, name, the four amounts, year, `as_of`, and whether a warning was shown) and appear in «Έλεγχοι και γνωμοδοτήσεις», the request PDF and the eArchive record. They are a snapshot: later changes in eFinance do not alter them.
- eFinance cannot answer (off, timeout, 401, 5xx, bad JSON, redirect): the card says the figures are unavailable and the person answers as today. Nothing blocks a request.

## What crosses and what never does

To eFinance: a cost-centre code, a year and optionally an article code. From eFinance: cost-centre rows, and budget totals per article. Never: request numbers, positions, names of requesters, approvers or leavers, costs, comments, or anything else from eHire's database. eFinance holds no HR information because of these calls.

## Settings in eHire

- `efinance_link` setting: `none` (default) or `http`. CLI `flask efinance-link none|http`, refused for `http` until `flask efinance-test` gets a good answer from both endpoints.
- `EHIRE_EFINANCE_URL` (default empty; on the server `http://127.0.0.1:5004`), `EHIRE_EFINANCE_TOKEN`, `EHIRE_EFINANCE_TIMEOUT` (5 s). Plain HTTP is accepted only for a loopback address; any other host needs HTTPS with the certificate checked. Redirects are never followed; system proxy settings are ignored.
- `flask sync-cost-centres` (nightly from cron, and the «Συγχρονισμός τώρα» button on the cost-centres page in Settings, which also shows when the last sync ran and what it changed).

## Open with eFinance

1. What identifies a budget line in eFinance (table and columns), and is it per cost centre, per entity, or both?
2. Can payroll lines be told apart from the rest?
3. How eFinance defines "available", and how fresh the figures are (posted from SAP how often).
4. Whether commitments made in eHire should later be written back to eFinance. Not in this contract: eHire only reads.
