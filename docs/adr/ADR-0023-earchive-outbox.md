# ADR-0023 — The eArchive outbox: filing a document without becoming an archive

**Status:** accepted · 19/09/2026

## Context

eArchive — ΟΚΥπΥ's protocol and records system, called eMetroon until it was
renamed on the server — is where a document gets a protocol number. eCapital
produces three kinds of paper that belong in it: the award decision on a
contract, the business case behind a project, and an approved variation.
Permits come with M5 and payment certificates later.

The eArchive brief of 19/09/2026 settles the contract: a loopback ingest
route on `127.0.0.1:5011`, one bearer token, a strict `meta` part and one
binary part per file, an `Idempotency-Key`, a closed list of categories and
classifications in Greek, a MIME whitelist with no DWG and no ZIP, and a
callback the other way for deletes and legal holds.
`docs/INTEGRATION-eFinance-eMAP-eCapital.md` §6 carries the facts; this
records what was built out of them.

Three things about the situation shaped every decision below.

1. **eCapital is not a document management system.** It links out to eMAP
   for a tender and to eFinance for an invoice, and it files with eArchive
   for a document. The discipline is the same each time: eCapital owns its
   own records and points at everybody else's.
2. **The token is not in the repository and will not be.** Marios generates
   it on the server. Until he does, the code has to do something sensible,
   and «crash on boot» and «drop the documents» are both wrong answers.
3. **A protocol entry that never got made is invisible.** Nobody notices a
   document that was not filed. That is different from a screen that fails
   to load, and it is why the queue is written where it cannot be forgotten.

## Decision

### 1. The queue row is written in the same transaction as the document row

`POST /contracts/:id/documents` (and the project and variation routes)
writes the `document` row and the `dms_outbox` row in one transaction. If the
upload commits, the item is queued. If the queue row cannot be written, the
upload did not happen and the caller is told.

There is no code path that records a document and relies on something else
remembering to send it, because «relies on something else remembering» is how
an archive acquires a hole that nobody notices for a year. The outbox is the
oldest pattern for this and it is the right one here: the decision to file
and the record of the decision are one write.

The outbox row is written by `ecapital.dms_queue`, a SECURITY DEFINER
function, because the queue is the service's and not any unit's — the same
shape `ecapital.queue_email` already has for the R31 budget warnings.

### 2. eCapital keeps the bytes only for as long as it needs them to send

`DOCUMENT_STORE_DIR` holds an operational copy of every file: a multipart
upload needs bytes in hand, and a queue that retries for an hour needs them
still to be there on the fourth attempt. That is the entire reason it exists.

It is not a second archive. It is not browsable. It is not backed up as
though it were the record. The record is in eArchive, under the protocol
number, and `document.protocol_id` and `document.protocol_number` are what
eCapital keeps of eArchive's answer — not the url, not the registry, not the
received-at, because those are eArchive's to serve and a copy of them here
would be a copy that can go stale.

`ObjectStore` is an interface with one implementation, a directory on the
server, so that the one implementation is not the only one possible. The
sha256 is computed over the bytes actually written, because `size` and
`sha256` in `meta.files[]` have to match the bytes and a hash taken from
anywhere else is a hash of something else.

**The MIME whitelist is enforced at upload, not at send.** A DWG or a ZIP is
refused before a byte is stored, with a message in Greek and English, rather
than accepted now and refused by eArchive with a `415` an hour later when
nobody is watching.

### 3. A refusal is final; unavailability is not

- `201`, or `200` with `Idempotency-Replayed: true` — the same answer. SENT,
  the protocol on the outbox row and on the document row.
- Any `4xx` — FAILED, with eArchive's own code kept verbatim
  (`SCHEMA_INVALID`, `SHA256_MISMATCH`, `MIME_REJECTED`,
  `DUPLICATE_SOURCE_REF`, …), and an `email_outbox` line to every active
  administrator. **Never retried.** A `400` does not become a `201` by being
  sent again, and a queue that retries a refusal forever is a queue nobody
  reads. `POST /admin/dms/outbox/:id/retry` is how a person says try again,
  after the cause has been dealt with.
- Any `5xx`, a refused connection, a timeout, or a `2xx` whose body cannot be
  read — QUEUED again at 1 minute, then 5, 15, 60, then hourly. **Never
  dropped.** eArchive being down is not a reason to lose a protocol entry.

The email goes to `email_outbox` and not to an SMTP server because there is
still no SMTP server configured for eCapital (ADR-0021). The row is written;
a sender picks it up when there is one.

A claim is a lease: the row moves to SENDING with its next attempt fifteen
minutes out, so a process that dies mid-upload does not strand its items.
eArchive's `Idempotency-Key: ecapital:<outbox_id>` is what makes that second
attempt safe, and is also why a `2xx` we cannot parse is retried rather than
failed — we do not know whether it landed, and asking again is free.

### 4. With no token, the queue holds

`DmsClient` has two implementations. `EArchiveClient` is the real one.
`NullClient` is wired when `EARCHIVE_URL` or `ECAPITAL_INGEST_TOKEN` is
missing — and `CHANGE-ME`, or anything shorter than sixteen characters, counts
as missing rather than as a boot failure, because the server is meant to be
able to run in that state.

In that state the sender claims nothing at all. Not SENDING, not FAILED, no
attempt counted: the items sit at QUEUED with `attempts: 0`, and
`GET /admin/dms/outbox` reports `senderConfigured: false`. That is the
difference between «held» and «broken», and an administrator can see which
one they are looking at. When the token is placed and the unit restarted, the
queue drains in order.

The choice is made at boot rather than per send. A restart after the token
lands is a moment when somebody is watching, which is the right moment for
the system to start sending things.

### 5. The callback is loopback only, and it is idempotent at the table

`POST /api/v1/dms/events` takes `protocol.deleted`, `legal_hold.set` and
`legal_hold.cleared`, with the same bearer token, and answers quickly.

- A request carrying `X-Forwarded-For`, `X-Real-IP`, `Forwarded`,
  `CF-Connecting-IP` or `CF-Ray` is refused `403` before anything else is
  looked at. ADR-0022 wrote that rule for eFinance's side of a loopback
  contract; it points inwards here for exactly the same reason. A call from
  eArchive on the same host has no reason to carry one.
- A missing, malformed or wrong token is `401`, compared in constant time.
  With no token configured, nothing is accepted at all: an open route that
  writes legal holds is worse than one that is not there yet.
- `dms_event` is unique on `(event, protocol_id, at)`. The same event twice
  is `200` both times, and it is the index that decides, not the controller —
  so a repair script and a `psql` session get the same answer.

The route is `@Public`, because the caller is eArchive and not a person in the
directory: there is no session to open and no `app.user_id` to put on the
transaction. It writes through `ecapital.dms_record_event`, SECURITY DEFINER,
and the audit trigger records the change with no actor — which is the truth
about who made it.

**`protocol.deleted` leaves a tombstone, not a hole.** The document row
stays, keeping its `source_ref` and the `protocol_number` it was filed under,
and takes a `deleted_at`. There is nothing else to keep: eCapital holds no
copy of the archive by design, so what a delete can leave behind is the fact
that the thing existed and what it was called.

**`legal_hold.set` puts a marker on the document row** which blocks any local
action that would treat the record as disposable. It is a column and not a
convention so that a future clean-up job, written by somebody who has not
read this ADR, still has to get past it.

A callback is matched on the protocol id **or** on the `source_ref` when
eArchive sends one, because a hold can arrive before the `201` has been
written down, and a callback that cannot find its row must not be lost.

### 6. A correction is a new item, never an edit

The brief is explicit: a corrected document is a new item with a new
`source_ref` and a `SUPERSEDES` relation. So filing the same award twice
produces `award:<contract_id>` and then `award:<contract_id>:v2`, with
`related: [{source_ref: "award:<id>", relation: "SUPERSEDES"}]` and
`version: 2` on the document row. The first document is untouched; it has a
protocol number and a protocol number is not something eCapital may revise.

The `:vN` suffix is eCapital's extension of the brief's scheme. It keeps the
stem searchable and the whole string unique, which is what `source_ref` has
to be.

### 7. Site codes are unit codes, and nothing translates

`folder_hints[].hospital` is `org_unit.code`, sent as `GET /org-units`
returns it. Since ADR-0024 that string **is** eArchive's site code, so there
is no mapping table, no third column, and no place for the two to drift. A
unit whose code is not one of the eleven would fail the strict schema before
the item was queued, which is the right way to find out.

### 8. What is strict, and where

`meta` is validated against a **strict** zod schema — no unknown fields, the
closed vocabularies as enums, `amount` a number and not a string, timestamps
with offsets, exactly one `MAIN` file, unique part names, the size limits —
**before the item is queued**, not at send time. eArchive would answer `400
SCHEMA_INVALID` for any of these; finding out at the upload, in Greek, from
the person who is still sitting there, is better than finding out an hour
later from a log.

The same schema parses the samples in
`docs/integration/ecapital-dms-samples/` in the test suite, so the thing
eArchive is handed and the thing eCapital sends cannot drift apart.

### 9. Strings

Error messages are keys in `apps/api/src/i18n/{el,en}.json`, as every
user-visible string in the API is (R43, R46).

The Greek that goes **into eArchive** is not. `doc_type` («Απόφαση
κατακύρωσης»), `category` («Συμβάσεις», «Διοίκηση»), the approval actions
(«Καταχώριση», «Υποβολή», «Έγκριση») and the role labels are metadata on a
protocol in a Greek registry, read by a clerk searching that registry. A
document type that changed language with the caller's `Accept-Language`
header would be a document type nobody could search for. They are constants,
in one file each, with this paragraph as the reason.

Money inside free text — a subject line, an approval comment — is written
`1.234,56 €`, the format the errata of 19/09/2026 settled for everything.

### 10. NO PATIENT DATA

An award decision, a business case and an approved variation are about money,
dates, a unit and a company. `personal_data` is `false` on every item eCapital
files and no `personal_data_category` is ever set, which the schema enforces
in both directions: the flag without a category is refused, and a category
without the flag is refused too.

eArchive's vocabulary includes «Δεδομένα υγείας». Nothing in eCapital can
produce it. The value exists in the enum only so that the schema can refuse
anything that is not in eArchive's list at all, and the samples and the test
suite both say so out loud, because the samples are what somebody outside
eCapital reads first.

## Consequences

- **Every mutation is still audited.** `document`, `dms_outbox` and
  `dms_event` all carry the trigger (ADR-0011). A document's trail opens to
  whoever may read its unit; the queue's and the callbacks' trails are the
  administrator's and the auditor's, because they belong to no unit.
- **The queue is service-only.** There is a SELECT policy for the
  administrator and the auditor and no write policy at all. An engineer who
  may file a document cannot read the queue, which is the intended shape: the
  queue is an operational concern, not a view of their projects.
- **Only one file per item, today.** The three routes each take one MAIN
  file. The schema, the queue row's `files` list and the client all handle
  many — `part_name` per file, the 20-file and 200 MB limits, the
  exactly-one-MAIN rule — so attachments are a route change and not a
  migration. Nothing was built for a case nobody has asked for yet.
- **Permits and payment certificates are not sent.** Both have a
  `source_module` in the contract and a value on `document_kind`, so adding
  them is a route and a meta builder.
- **The deep link's origin is the first `CORS_ORIGINS` entry.** There is no
  separate `APP_ORIGIN` variable and one was not added: `CORS_ORIGINS`
  already names the web app, and a fourth place to write the same hostname is
  a fourth place to get it wrong. If a deployment ever needs them to differ,
  that is the moment to add the variable, not before.
- **Nothing has been tested against a real eArchive.** The client is exercised
  through a fake at the `DmsClient` port, which is the same limitation
  ADR-0018 records for LDAP and for the same reason. The samples directory
  exists so that eArchive can test their side before we point at it, and the
  first real send is a thing somebody watches.
- **If eArchive's published contract turns out to differ** from the brief of
  19/09/2026 in the route, the `meta` shape or the error codes, this ADR is
  superseded by one recording what was actually built against, rather than
  quietly edited.
