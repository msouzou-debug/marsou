# ADR-0029 — The eFinance client: push first, read into the ledger, never write eFinance's numbers

**Status:** accepted · 02/10/2026

## Context

eFinance published its integration record on 21/09/2026
(`docs/integration/eFinance-integration-record.md`). All seven read routes
answer on `http://127.0.0.1:5004` since that day, and the one write,
`PUT /api/v1/capital/contracts/{cap_ref}`, feeds the contract picker on
eFinance's invoice coding screen and requisition form. Until eCapital pushes a
contract, nothing in eFinance can be tagged with it, and every read answers an
empty list (record §6; INTEGRATION §5, updated 02/10/2026). ADR-0022 fixed the
transport and the ownership split while the contract was a draft; this ADR
records what was built against the record now that it is not.

The only eFinance call before this was `EFinanceBudgetCodeReader` (ADR-0025),
written against a draft that promised `description_el`/`description_en`. The
live route answers `description`, `category`, `kind`, `active` and, since
02/10/2026, `name`.

This system starts as a simple capital register. The decisions below are the
smallest set that makes the push, the reads and the budget position useful
without eCapital becoming a second finance system.

## Decision

### 1. One typed client, `EFinanceClient`, for every route in the record

`apps/api/src/efinance/efinance-client.ts`. Plain `fetch`, built from scratch
on every call: the bearer token from `EFINANCE_TOKEN`, the base URL from
`EFINANCE_API_URL` (default `http://127.0.0.1:5004`), and no other header —
so nothing an inbound request carried, a forwarded-edge header least of all,
can reach eFinance (which refuses those with 403 even from loopback). Five
seconds for a read, ten for the write.

- **One error type.** eFinance's envelope `{"error":{"code","message"}}`
  becomes an `EFinanceError` — an `AppError`, `errors.efinanceFailed`, 502 —
  that carries eFinance's own code (`UNAUTHENTICATED`, `LOOPBACK_ONLY`,
  `NOT_FOUND`, `SCHEMA_INVALID`, `CONFLICT`). A call that never got an answer
  has a code of its own: `TIMEOUT`, `NETWORK`, `BAD_RESPONSE`, or `HTTP_<n>`
  for a non-envelope answer such as a proxy's 503. "eFinance said no" and
  "eFinance did not answer" are different facts and are stored differently.
- **Two layers of shape.** The raw zod schemas in
  `packages/shared/src/efinance.ts` spell every field as the record does and
  validate every answer. Money stays a 2-decimal string there and an unknown
  amount stays `null`; `toAmount` turns it into a number once, at the edge, and
  never turns `null` into `0`. Lists follow `next_cursor` until it is `null`.
  The two spellings eFinance added on 02/10/2026 (`code`/`vat_no` on vendors,
  `name` on budget codes) are accepted beside the record's own.
- **Not configured is a state, not an error.** With `EFINANCE_TOKEN` unset,
  blank or the template's `CHANGE-ME`, the client reports `configured: false`
  and every caller checks that first: nothing is pushed, nothing is read, the
  DTOs answer `null` figures and `configured: false`, and nothing throws. It is
  the eArchive sender's hold (ADR-0023 §4) applied to a second neighbour, and
  it is chosen at boot for the same reason: a restart after the token is placed
  is the moment somebody is watching.

`EFinanceBudgetCodeReader` keeps its job and its error
(`errors.budgetCodeSyncFailed`, 422) but calls the client. Its display name is
`name` when eFinance sends one and `description` otherwise (owner decision,
02/10/2026), written into both languages because eFinance holds one text;
`category` is kept as eFinance spells it; an inactive row is left out so the
sync deactivates it. The sync now picks eFinance whenever the client is
configured — the token, not `EFINANCE_URL`, is what makes a loopback call
possible; `EFINANCE_URL` stays the human link-out of ADR-0019.

### 2. The contract push comes first, and a failed push never fails the change

Migration 0020 adds `contract.efinance_pushed_at`, `efinance_last_error` and
`efinance_spend` (eFinance's own figures from the PUT or the GET:
`current_value`, `booked`, `in_flight`, `requisitions`, `remaining`, and
`fetched_at`). `ContractPushService` builds the body:

| Field | From |
|---|---|
| `cap_ref` | `contract.ref` (ADR-0019) |
| `project_ref` | `project.code` |
| `title` | `project.title_el` — a contract has no title of its own |
| `entity_code` | `org_unit.code`, eArchive's form; eFinance translates (ADR-0022 addendum) |
| `budget_code` | `contract.budget_code` (ADR-0025) |
| `vendor_code` | `contractor.sap_vendor_id` |
| `current_value` | `contract.current_value` as a 2-decimal string (ADR-0015) |
| `status` | `closed` when the project is `CLOSED`, `active` otherwise |
| `updated_at` | the newest of the contract's, the project's and the contractor's `updated_at`, ISO with `+00:00` |

It pushes on contract create, on any contract update, on a variation approved
(the only thing that moves the value), on a project's move into or out of
`CLOSED` or a new Greek title, and on a contractor's new SAP vendor code. Each
is one synchronous attempt inside the caller's transaction, wrapped in a
savepoint, and nothing it does fails the change that called it: the outcome is
written on the contract through `ecapital.efinance_record_push` (SECURITY
DEFINER, as `dms_queue` is for the eArchive queue). A `@nestjs/schedule`
interval retries every ten minutes whatever has not gone — never accepted,
accepted before its last change, or failed last time.

Two answers are not retried:

- **409 CONFLICT** — the reference already exists in eFinance under another
  hospital or budget code. A retry would never succeed and a silent overwrite
  is exactly what eFinance refuses in order to stop spend moving between
  hospitals. It is stored as the error and becomes the contract warning
  `efinanceConflict`; a person puts it right and presses
  `POST /contracts/:id/efinance/push` (administrator).
- **A contract that cannot be built** — no budget code, or a contractor with no
  SAP vendor code — is not sent at all and carries `efinanceNotPushable`,
  naming which field is missing. Both warnings are warn-and-flag like the
  rest of R31, and both appear only when eFinance is configured.

### 3. eFinance's booked lines become actuals in eCapital's own ledger

`efinance_invoice` (+ `efinance_invoice_line`) and `efinance_requisition` hold
eFinance's answers keyed by eFinance's id, with the raw JSON kept beside the
columns; `efinance_sync_state` holds each feed's cursor. `EFinanceSyncService`
polls every fifteen minutes and on `POST /admin/efinance/sync`, with
`updated_since` set to the highest `updated_at` seen; the first run, with
nothing seen yet, asks by reference for every contract eFinance has accepted.

- **Booked** invoices project one ACTUAL `cost_txn` per line: source
  `EFINANCE` (added to `CostSource`), `sourceRef`
  `efinance:invoice:<id>:<line index>`, posting date `sap_batch_date` (the
  cash-flow month; `invoice_date` is never a posting date), amount
  `line_total` — spend from the lines, never the header — vendor, cost centre,
  GL account, `sapWbs` from `wbs_code`, the contract from `cap_ref`, and
  `matchedBy = RULE`. The upsert is on 0005's unique index
  `(project_id, source, source_ref)`, so running the sync twice never adds a
  row; an invoice whose stored `updated_at` has not moved is not touched at
  all.
- **In flight** invoices are stored and shown as their own figure on the
  contract, never as actuals: they are not spend, and the requisition behind
  them already reserved the money.
- **Reversed** invoices re-project to nothing, which deletes what they booked
  (the audit log keeps the rows' before-images); the invoice stays in
  `efinance_invoice` with `reversed_at`, `reversal_sap_doc_no` and its reason.
  **Rejected** ones never reach the ledger.
- **Requisitions** are stored and shown per contract as eFinance's
  commitments. They are never added to eCapital's committed ledger, which is
  contract-level and stays `contract.current_value` (ADR-0015).
- A line with no amount, and an invoice in a currency other than euro, are kept
  in the history and not posted: the ledger is EUR and a missing amount is not
  guessed (ADR-0016's rule).

**How the EFINANCE and the SAP_EXTRACT actuals coexist.** For a contract
eFinance has accepted (`efinance_pushed_at` set), eFinance's booked lines are
the spent source, and the SAP extract's ACTUAL rows on that same contract stay
in the table for reconciliation but are not added on top — otherwise the same
invoice is spent twice. A SAP actual on a contract eFinance does not know, or
on no contract (matched by WBS or cost centre at project level), counts exactly
as before; the M2 import is unchanged and remains the source for everything
eFinance cannot tag. The rule is one SQL function,
`ecapital.cost_txn_counts_as_spent(source, contract_id)`, asked by every query
that sums actuals (the project ledgers, the category table, the cash flow and
the accruals). An eFinance row is never in the unmatched queue and is never
matched by hand: it has no import batch, and the allocator only works a
batch's rows.

The contract detail and the project cost DTOs gain
`efinance: { pushedAt, lastError, booked, inFlight, requisitions, remaining,
lastSyncAt } | null` — eFinance's own figures from `efinance_spend`, summed over
a project's contracts where any has one, `null` where none has, and `null`
altogether when eFinance is not configured. The four ledgers keep their
null-never-zero rule and are not changed by this object; it sits beside them.

### 4. The budget position, cached for a minute

`GET /contracts/:id/budget-position` and `GET /projects/:id/budget-position`
ask eFinance's `GET /api/v1/budget/position` for the contract's unit (eArchive
form), budget code and award year — `?year=` overrides the year — and map it
as INTEGRATION §5 says: `allocated`, `booked` (spent), `requisitions`
(eFinance's commitment), `inFlight` (forecast only, never committed),
`available` (eFinance's own `allocated − booked − requisitions`, passed through,
not recomputed), `asOf`. The project route answers one row per (budget code,
year) its contracts carry and never sums across codes. Answers are cached in
memory for 60 seconds per (unit, code, year), so a screen refresh does not
become a call; a failed answer is not cached.

### 5. Master data once a day

`POST /admin/efinance/sync-master`, and the fifteen-minute timer once a day:
`entities` fills `org_unit.efinance_code` by `archive_code`; `vendors` (6,148,
paged) fill `efinance_vendor`, marking any vendor eFinance no longer lists
inactive rather than deleting it. `GET /efinance/vendors?q=` searches that
table by folded name or code prefix, twenty at most, for the contractor form.
Budget codes keep going through `POST /budget-codes/sync`.

### 6. The timers run as a named service identity, inside row-level security

The push retry and the sync have no caller. They run inside the same
row-level-security transaction a request gets, as `system:efinance` with the
administrator's role (`efinance-context.ts`): the policies decide what they may
touch exactly as for a person, and the audit trigger records
`system:efinance` as the actor, which is the truth. ADR-0023's sender used
SECURITY DEFINER functions instead because it touches one table; this one
touches six, and a function per write would be a second schema to keep in
step. Both timers return at once under `NODE_ENV=test`.

## Consequences

- **The token is the switch.** Until it is placed (RUNBOOK §3), every contract
  waits with `efinance_pushed_at` null; the first timer pass after the restart
  pushes every pushable one, oldest change first, a hundred per pass.
- **A pushed contract's spend changes source.** Once `efinance_pushed_at` is
  set, SAP extract actuals on that contract stop counting. An invoice booked in
  eFinance before the contract picker existed carries no `cap_ref` and reaches
  eCapital only through the extract — on a pushed contract it is then in the
  table and not in `spent`. That is the price of never counting an invoice
  twice; the reconciliation is the place it shows, and the rule is one function
  to change if the owner decides otherwise.
- **Project-level SAP actuals still count beside eFinance's lines.** A SAP row
  matched to the project by WBS or cost centre, with no contract, is not
  excluded. If the extract keeps being imported for projects whose contracts
  eFinance holds, a person allocating it should put it on the contract.
- **The figures are eFinance's.** `booked`, `inFlight`, `requisitions` and
  `remaining` on a contract are what eFinance answered, refreshed after a push
  and for every contract a sync touched — not sums eCapital recomputes from the
  lines it stored. eFinance owns execution against budget codes (ADR-0022).
- **Mirror tables are not all audited.** `efinance_invoice` and
  `efinance_requisition` carry the audit trigger; the lines (whose content is in
  the header's `raw`), the vendor list and the sync state do not, because six
  thousand audit rows a day for a vendor batch would bury the trail.
- **Nothing here writes to an eFinance table**, and nothing here reads or
  writes `budget_allocations`. The one write is the record's PUT.
- **Tested against a fake.** `test/efinance-fake.ts` answers the record's
  routes on a loopback port — 401 on a wrong token, 409 on a moved contract,
  paging, a reversed invoice. The first push and the first sync on the server
  are things somebody watches.

## Addendum, 02/10/2026 — the push has its own switch

`EFINANCE_PUSH_ENABLED` (off unless `1`/`true`) gates the write direction
only. With the token placed and the switch off, the client reads invoices,
requisitions, vendors, entities and the budget position exactly as above,
and `ContractPushService` reports `configured: false`: no push on create or
change, no ten-minute retry, and the manual push answers `409
errors.efinancePushDisabled` so the person sees why. Reason: the first
deployment is a UAT server seeded with 41 sample contracts, and the retry
sweep as written would have sent every one of them to eFinance's contract
picker within ten minutes of the token being placed. eFinance's picker is a
list people code real invoices against; fiction in it is worse than an
empty picker. Production turns the switch on once, deliberately, after the
Capex import has replaced the seed.
