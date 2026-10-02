<!-- Reference copy of eFinance's integration record, handed to the owner on 21/09/2026 and uploaded here on 02/10/2026. Authored by the eFinance build session; eCapital does not edit it. The eCapital-side view is docs/INTEGRATION-eFinance-eMAP-eCapital.md. -->

# eFinance ↔ eCapital — the integration record

**Status:** the read endpoints are live on the server, 21 Sep 2026. Agreed between the two build sessions, 19–20 Sep 2026, and decided by Marios where noted.

## 1. Who owns which number

- **eCapital owns planning**: projects, phasing, business cases, contracts, the contract-level commitment (award plus approved variations), the forecast final cost, and certification (payment certificates, retention, work certified but not yet invoiced).
- **eFinance owns execution against budget codes**: requisitions, invoices, what is booked, what is in flight.
- **eCapital reads execution from eFinance and never writes to an eFinance table.** It never touches `budget_allocations`.

Both systems hold a figure called "committed". They measure different things — one per contract, one per budget code — and neither is derived from the other. That is the whole reason this split works.

## 2. The connection

- **Address:** `http://127.0.0.1:5004`, loopback only, on the shared server.
- **Auth:** `Authorization: Bearer <token>`. eFinance keeps it as `ecapital_token` in its mode-600 settings file. It was generated on the server and never written into a chat.
- **Refused, deliberately:**
  - a call from any other host → `403 LOOPBACK_ONLY`
  - a call carrying `CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`, `Forwarded` or `CF-Ray`, **even from 127.0.0.1** → `403`. Behind Cloudflare → cloudflared → nginx every request from the internet looks local, so the address alone proves nothing.
  - a wrong or missing token → `401 UNAUTHENTICATED`
- **Errors:** `{"error": {"code": "...", "message": "..."}}`, with `UNAUTHENTICATED` 401, `LOOPBACK_ONLY` 403, `NOT_FOUND` 404, `SCHEMA_INVALID` 400, `CONFLICT` 409.
- **Money:** strings, always 2 decimals, `.` as the decimal separator. Never a float, never null-as-zero: an unknown amount is `null`.
- **Timestamps:** ISO 8601 with an explicit offset, `+00:00`. eFinance stores UTC.
- **Paging:** `limit` (default 200, max 500) and `cursor`. The response carries `next_cursor`, `null` at the end.
- **Hospital codes:** eCapital speaks eArchive's codes. eFinance translates at the boundary, in both directions. eFinance's own keys never change. `entities` returns both forms.

## 3. Reads

### `GET /api/v1/master/entities`
`code` (eFinance), `archive_code` (eArchive/eCapital), `name`, `type`, `active`.

### `GET /api/v1/master/cost-centres?entity=PAF`
`code`, `name`, `entity_code`, `active`. The `entity` parameter accepts either code form.

### `GET /api/v1/master/budget-codes?kind=capex`
`code`, `description`, `category`, `kind` (`capex`/`opex`), `active`. Without `kind` you get all 207; with `kind=capex` the 20 capital ones.

### `GET /api/v1/master/vendors`
`vendor_code`, `name`, `vat`, `blocked`, `active`, `sap_batch`. Latest SAP batch only, paged; 6,148 today.

### `GET /api/v1/budget/position?year=2026[&entity=][&code=]`
Capital codes only. Per `(budget_code, entity_code)`: `archive_code`, `year`, `allocated`, `booked`, `in_flight`, `requisitions`, `available`, plus `as_of` on the response.

`available = allocated − booked − requisitions`. In-flight invoices are shown but do not reduce it, because they are not yet a commitment.

### `GET /api/v1/capital/invoices?ref=CAP-2026-0001` or `?updated_since=<iso>`
Header: `id`, `invoice_no`, `invoice_date`, **`sap_batch_date`**, `vendor_code`, `vendor_name`, `entity_code`, `currency`, `net`, `vat`, `gross`, `status`, `ledger`, `cap_ref`, `reversed_at`, `reversal_sap_doc_no`, `reversal_reason`, `updated_at`.

`lines[]`: `descr`, `qty`, `unit_price`, `line_total`, `vat_rate`, `gl_account`, `cost_centre`, `budget_code`, `wbs_code`.

**Take spend from the lines, never the header.** One invoice can split across several cost centres and budget codes.

`ledger` is one of:
- `booked` — approved or parked in SAP; this is spend
- `in_flight` — in the approval chain; not spend
- `reversed` — reversed after booking; **not** spend, stays in the history with its reason
- `rejected` — refused before booking

`sap_batch_date` is the day the invoice went into the SAP batch file. It is `null` while the invoice is in flight. It is the month to use for cash flow; `invoice_date` can be months earlier and is never a posting date.

### `GET /api/v1/capital/requisitions?ref=…` or `?updated_since=…`
`id`, `number` (`R-ENT-BUDGET-DDMMYY-NN`), `description`, `justification`, `entity_code`, `cost_centre`, `budget_code`, `gl_account`, `amount`, `currency`, `status`, `cap_ref`, `po_number`, `created_at`, `updated_at`.

No `vendor_code`: a requisition precedes the order and the supplier is usually unknown.

### Incremental sync
Poll with `updated_since` set to the highest `updated_at` you have seen. A reversal changes `updated_at`, so it arrives through the same poll as any other change.

## 4. Writes — one, and only one

### `PUT /api/v1/capital/contracts/{cap_ref}`
```json
{"project_ref": "...", "title": "...", "entity_code": "PAF",
 "budget_code": "7402", "vendor_code": "100123",
 "current_value": "1250000.00", "status": "active",
 "updated_at": "2026-09-20T08:00:00+00:00"}
```
- `cap_ref` must match `^CAP-\d{4}-\d{4,}$` — award year, restarting each year, allocated by eCapital, never edited.
- `entity_code` in eArchive's form; eFinance translates.
- **`409 CONFLICT`** if the reference already exists with a different hospital or budget code. One contract belongs to one project and one project to one unit, so a change there means a different contract arrived under the same key. A silent overwrite would move spend from one hospital to another.
- Response: `current_value`, `spend` (`booked`, `in_flight`, `requisitions`) and `remaining`.

### `GET /api/v1/capital/contracts/{cap_ref}`
The stored copy plus the same spend figures.

eFinance keeps this copy only to offer the picker during coding and to show what is left on a contract. The contract itself belongs to eCapital.

## 5. What eFinance does not have

- **No credit notes.** Marios confirmed none reach eFinance. Nothing is modelled and no `kind` field exists.
- **No invoice description on the header.** The text lives on the lines.
- **No automatic detection of a SAP reversal — yet.** Today a person records it (option A, live since 20 Sep). A request has gone to the SAP team for reversal fields and the supplier invoice number in the postings extract; when that arrives, the same fields fill automatically (option B) and nothing changes on your side.
- **AMB is out.** The Ambulance Service left ΟΚΥπΥ; the entity is inactive in eFinance and its history stays.
- **A naming difference, harmless:** eFinance's `CNS` is named «Κοινοτική Νοσηλευτική Υπηρεσία»; eArchive and eCapital use «Κοινοτική Νοσηλευτική». Same code, same unit.

## 6. The one thing still missing

**Nothing can be tagged with a contract yet.** `cap_ref` exists on invoices and requisitions, but there is no field on the invoice coding screen or the requisition form to choose one. Until that is built, every endpoint above answers correctly with an **empty list**.

Next on eFinance's side: a picker of active contracts on both screens — chosen from the list, never typed — with the remaining contract value shown while coding, and a warning when the chosen contract's hospital or budget code does not match the document's.

So: build against the shapes now, and expect real rows once the picker ships.

## 7. Tested

24 tests cover this integration, inside a suite of 2,711. Among them: the door refuses another host and refuses proxy headers from loopback; a contract cannot be moved to another hospital or budget code; amounts are two-decimal strings; timestamps carry `+00:00`; an untagged invoice is never exposed; and a reversal removes an invoice from the budget position while staying visible with its reason.
