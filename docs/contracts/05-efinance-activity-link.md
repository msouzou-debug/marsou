# Contract 05: ΟΑΥ activity link (proposal for Marios)

> **Status, 14/11/2026: not viable against eFinance.** The eFinance session checked the code: eFinance does not hold ΟΑΥ visits, procedures or revenue by facility and specialty, so it cannot serve this endpoint. The proposal is kept as the shape any future source should follow (same machine only, totals only, data month in every answer, hashed token with two-token rotation). eHR's client and the Settings choice stay in place but unused; the figures are typed by hand until Marios names the source.

Status: proposal. The endpoint does not exist in eFinance yet. eHR is built and tested against this text with a fake server.
Decision of 14/11/2026 (owner): both sources stay available. A setting in eHR chooses between typing the figures and reading them from eFinance.

## Purpose

Step 2 of a request needs visits, procedures and revenue for a facility and an ΟΑΥ specialty, for the previous year and the current year to date. eFinance already holds the loaded ΟΑΥ files. This endpoint gives eHR those totals, so the Directorate Accountant does not retype them.

## Who calls whom

eHR calls eFinance. eFinance never calls eHR. One request per card view or refresh, plus a ten minute cache in eHR. Expected load: a few calls a day. Suggested limit on the eFinance side: 30 per minute per token.

## Request

`GET {EHR_EFINANCE_URL}/api/oay-activity?facility_code=<code>&specialty=<name>`

- `facility_code`: the facility code both systems already share (a short code, for example `NIC01`).
- `specialty`: the ΟΑΥ specialty name as eFinance spells it. eHR tries its own name first, then each alias held for that specialty, one call per name, until one returns data.
- Header `Authorization: Bearer <token>`. Header `Accept: application/json`.
- HTTPS only, certificate checked. eHR does not follow redirects. Timeout 5 seconds.

## Response 200

```
{"facility_code": "NIC01", "specialty": "Cardiology", "data_month": "2026-09",
 "prev_year": {"year": 2025, "visits": 48200, "procedures": 9350, "revenue": "1254300.50"},
 "ytd":       {"year": 2026, "visits": 37900, "procedures": 7120, "revenue": "988250.00"}}
```

- `facility_code` and `specialty` repeat the request exactly. A different value is treated as an error.
- `data_month`: last month loaded, `YYYY-MM`. `ytd.year` must equal its year and `prev_year.year` the year before.
- `visits`, `procedures`: whole numbers, 0 to 100,000,000.
- `revenue`: a decimal string (preferred) or a number, 0 to 9,999,999,999.99, at most two decimals kept.
- Body under 64 KB. No other fields are read.

## Other answers

| Answer | Meaning | What eHR does |
|---|---|---|
| 404, or 200 with `prev_year` or `ytd` null or missing | eFinance holds nothing for this facility and specialty | Tries the next alias, then shows `card.fin.no_data` and lets the Accountant type all lines |
| 401, 403 | Token refused | Shows `card.fin.unavailable`, Accountant types. Logs the status only |
| 5xx, timeout, network error, bad JSON, value out of range, redirect | eFinance can't answer | Same as above |

In every fallback the request is stored with source `manual` and the reason in its snapshot. Nothing blocks the request.

## Authentication

A long random token issued by Marios, one per environment. eHR reads it from the environment variable `EHR_EFINANCE_TOKEN` and the base address from `EHR_EFINANCE_URL`. It is never in the database, a log, an audit row or a page. Optional `EHR_EFINANCE_CA_FILE` for a private certificate authority. The token should be read-only and valid for this one endpoint.

## What crosses and what never does

Crosses from eHR to eFinance: a facility code and an ΟΑΥ specialty name.
Crosses from eFinance to eHR: five totals per period and the data month. They are totals for a facility and specialty, not per patient, per doctor or per invoice.
Never crosses: request numbers, requester or approver names, leaver names, positions, costs, comments, or anything from eHR's database. eFinance learns nothing about HR requests from these calls beyond the fact that someone asked for a specialty.

## What eHR stores

The validated response and the time it was fetched go to `request_financials.source_snapshot_json` with source `provider`. The request page shows that copy later, whatever eFinance holds afterwards.

## How to test with curl

```
curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
  "$EHR_EFINANCE_URL/api/oay-activity?facility_code=NIC01&specialty=Cardiology"
```

Expect the JSON above. Try an unknown specialty (expect 404), a wrong token (401) and a missing parameter (400 or 404).

## Open for Marios

1. Is the facility code the right key, and is it the same in both systems?
2. Does eFinance hold revenue and procedures per specialty, and what spelling does it use? eHR can hold several aliases per specialty.
3. Token issue and rotation.
4. Is the month the data runs to available per facility, or is it one month for everything?
