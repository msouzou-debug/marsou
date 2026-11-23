# Request to the eFinance session: two read-only endpoints for eHire

From: eHire session, through Marios. Date: 23/11/2026.

Marios decided on 23/11/2026 that eFinance is the master list of cost centres for eHire, and that every position request in eHire is checked against eFinance's budget for its budget line. He asked for a live link. The attached file `07-efinance-link.md` is the proposed contract. Please read it against eFinance's code and data, then answer the questions below. Do not build anything before Marios says so.

Limits Marios set earlier still hold: the link is narrow and read-only, eFinance holds no HR information, and nothing personal crosses. eHire sends only a cost-centre code, a year and an article code. It never sends request numbers, names, positions or costs.

## What eHire asks eFinance to add

1. `GET /api/v1/ehire/cost-centres`: the full cost-centre list (code, Greek name, entity code, active), as in section 1 of the contract.
2. `GET /api/v1/ehire/budget?cost_centre=&year=[&article=]`: the budget lines of one cost centre for one year (article code and name, budget, spent, committed, available), as in section 2.
3. One bearer token for these two endpoints, accepted only from 127.0.0.1, stored as a hash. Marios copies it file to file into `/etc/ehire/ehire.env`.

eHire calls `http://127.0.0.1:5004` on the same server. Load: one cost-centre call a night, and a few dozen budget calls a day.

## Questions

1. **Budget lines.** Which table and columns hold the budget that the requisition page shows as «Θέση κονδυλίου» (budget, spent, committed, available)? What identifies one line: cost centre, entity, article or account code, year? Give the real column names and one invented example row.
2. **Article.** What does eFinance call the code of a budget line (άρθρο, GL account, commitment item)? Its format and an invented example. Is there a Greek name for each?
3. **Payroll lines.** Can the lines that pay salaries be told apart from the others (a range of codes, a flag, a category)? eHire would like to list them first.
4. **Available.** How does eFinance compute "available"? Does "committed" include requisitions that are still in approval?
5. **Freshness.** How often are budget and actual figures loaded from SAP, and is there a timestamp eHire can show as "figures as of"?
6. **Level.** Is the budget held per cost centre, or only per entity or per article across cost centres? If a cost centre has no budget of its own, which level should eHire be shown?
7. **Year.** Is the budget by calendar year? Is next year's budget loaded before January?
8. **Cost centres.** Does the `active` flag change in eFinance when SAP closes a cost centre, or only by hand? Are cost centres ever deleted or renamed?
9. **Shape.** Is anything in the two answers in the contract hard or unnatural for eFinance to produce? Propose the shape that fits your data; eHire will adapt.
10. **Token.** Does eFinance already have a pattern for a service token (for eArchive or another tool)? eHire will follow the same one.
11. **Effort and risk.** Roughly how large is this change in eFinance, and does anything in it touch the live approval or payment code?

Answer in a markdown file for Marios to pass back, as before. No staff names, usernames, emails, tokens or keys in the answer.
