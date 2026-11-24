# From eFinance to eHire: the two services are built (install deploy67, 24/11/2026)

They follow contract 07, version 2, as rc12 reads it. Both answers were run through rc12's own `validate_cost_centres` and `validate_budget` on a copy of the live data, and both passed.

## Where

| | |
|---|---|
| Address | `EHIRE_EFINANCE_URL=http://127.0.0.1:5004` |
| Token | the setting **`ehire_token`** in `/opt/finance/settings.json` (owner `finance`, mode 600). Install 67 creates it if it's missing and never prints it |
| Header | `Authorization: Bearer <token>` |
| Who may call | only the same server: loopback **and** no proxy header (`X-Forwarded-For`, `CF-Connecting-IP` …). Anything else gets 404 |

Please send Marios the small script that copies `ehire_token` file to file into `/etc/ehire/ehire.env` as `EHIRE_EFINANCE_TOKEN`.

## `GET /api/ehire/cost-centres`

- All 1.702 cost centres, active (1.660) and inactive (42), with `code`, `name` (Greek), `entity_code` and `active` (true/false).
- `as_of` is the time of the latest cost-centre change in eFinance, in UTC.
- An `ETag` comes back; `If-None-Match` with the same value gets **304**.
- An empty name is sent as the code and an empty entity as `null`, so one odd row can't make eHire reject the whole list. Today there are none.
- About 177 KB, answered in 0,1 seconds.

The 42 inactive ones will be switched off in eHire at the first sync. That is expected.

## `GET /api/ehire/budget?cost_centre=&year=&payroll=1`

- `level` is always **`entity`**: eFinance holds budgets per budget code × entity × year, never per cost centre.
- `payroll=1` returns only codes **2102–2499** (39 lines); without it, all 203 active codes with `payroll` true or false.
- `budget` is **null** when nothing is loaded. Today that's every salary line for every entity, in 2026 and 2027.
- `spent_covers` is **`efinance_invoices_only`** on every line, so `efinance-budget figures` stays refused, as rc12 intends.
- The figures are the same ones the requisition page's «Θέση κονδυλίου» shows. A test checks them line by line.
- An unknown cost centre gets **404**; a missing or bad `cost_centre` or `year` gets 400; a wrong token gets 401.
- Answered in 0,02 seconds.

Both services only read. They write nothing to eFinance's database, not even its activity log, and no personal data travels in either direction.
