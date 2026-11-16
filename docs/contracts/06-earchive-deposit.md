# 06 – Depositing requests in eArchive

Status: built (16/11/2026). eArchive's side is specified in `docs/external/earchive-ingest-2026-11-16.md` (the eArchive session's note, relayed by Marios). That note is the specification of the HTTP call. This page describes what eHR does with it.

## What is deposited, and when

Two deposits per request (decided by Marios with eArchive, 16/11/2026):

- `submitted`: at the first submission. A resubmission after a return makes no new deposit.
- `decided`: when the request ends: approved, rejected or withdrawn, by the requester or by the system (after the timeout). It replaces the earlier eHR rule that rejected and withdrawn requests are not deposited.

A request decided without ever having a `submitted` deposit (an old one) sends just the decided one. Both rows are written in the same transaction as the action, so a rolled-back action leaves none. The user's action never waits for eArchive and never fails because of it.

Each deposit is one MAIN file (the PDF of the request with its checks and history, made on the eHR server, Greek, A4) and the requester's supporting documents as ATTACHMENT files. The PDF is kept with its SHA-256, so a retry sends the same bytes. Nothing is deleted after submission.

## The call

`POST {EHR_ARCHIVE_URL}/api/v1/ingest/documents` (default `http://127.0.0.1:5011`), multipart: a text part `meta` with JSON and one binary part per file, the part name equal to the file's `part_name`.

- Headers: `Authorization: Bearer <EHR_ARCHIVE_TOKEN>` and `Idempotency-Key: ehr:<deposit id>`. No forwarding headers.
- The URL must be plain http on this machine (127.0.0.1, ::1, localhost). Anything else stops eHR from starting and from being switched on. No proxy (environment proxy variables are ignored), no redirects, 60 seconds timeout, standard library only.
- The token is read from the environment file (`EHR_ARCHIVE_TOKEN`). It is never stored in the database and never written to a log, an audit row, an error text or a page.
- Without a token, or when the `archive_transport` setting is not `http`, nothing is sent and rows wait.
- One deposit at a time, in order.

`meta` (schema v1, strict) carries exactly these fields: schema_version, outbox_id, sent_at, source_system, source_module, source_ref, sender_ref, doc_type, subject, direction, sender_name, letter_date, event_date (decided only), category, classification, personal_data, personal_data_category, folder_hints, attributes (cost_centre, staff_category, position_title, posts), amount and currency (decided only, when central HR recorded the annual employer cost of the new hires), related (decided only, when a submitted deposit exists: SUPERSEDES), approvals, files (part_name, filename, size, sha256 and the MAIN or ATTACHMENT field).

- All text is Greek, from the Greek string file, whatever language the user reads. The subject has the position and cost centre, no personal names.
- Fixed values: `eHR`, `position_request`, `INTERNAL`, classification `HIGHLY_SENSITIVE` (the long-absence text can describe sick leave, which is health data; the note says that level also keeps files away from automatic reading), personal data true.
- `outbox_id` is the deposit id as a number. `sent_at` and every time are Cyprus time with offset. `letter_date` is the Cyprus date of submission, `event_date` the date of the decision.
- `approvals`: the requester first, then every recorded action in order, replaced answers included and marked as the PDF marks them. The system's automatic withdrawal is shown as «Σύστημα».
- The meta part is built once and stored, so a retry sends identical content under the same key.

## Where it is filed

eArchive files by site. Each facility has an eArchive site code (Settings, facilities; one of the twelve in the note, section 2; audited). A facility without a code makes its deposits `blocked`. They go out by themselves at the next run after the code is set.

## Limits, checked before sending

At most 20 files (1 MAIN and 19 ATTACHMENT), 50 MB per file, 200 MB per deposit, and the file types the note lists. A deposit over a limit is not sent and nothing is dropped silently: it is `blocked` with a readable reason, shown to administrators.

## Answers and states

| Answer | State |
|---|---|
| 201, or 200 with `Idempotency-Replayed: true` | `stored`: protocol_id, protocol_number and url kept on the deposit |
| 409 DUPLICATE_SOURCE_REF | `stored`: the number is taken from the message when it is there; audited as a duplicate |
| no answer, timeout, 5xx (also 408 and 429) | stays `queued`, tried again with the same key after 5 min, 15 min, 1 h, 6 h, then daily; no limit, never dropped |
| 409 IDEMPOTENCY_MISMATCH, 400 SCHEMA_INVALID, SHA256_MISMATCH, UNKNOWN_REGISTRY, ARCHIVE_*, 401, 403, 413, 415, a redirect, any other answer | `blocked`: the machine code and message are kept as the error, audited; not sent again until an administrator presses the retry button after the cause is fixed |

Other problems on eHR's side (a stored file missing or changed, no PDF converter) make the row `failed` and are retried up to 10 times, then wait for the button. Settings shows a count of blocked deposits on its index page. No email is sent.

## Notices from eArchive

`POST http://127.0.0.1:5008/api/v1/archive-events` (the port follows `EHR_BIND`) is the address to give eArchive for its `EHR_EVENTS_URL`. It accepts only connections from this machine, refuses any request with a forwarding header, and checks the same bearer token in constant time. It is exempt from CSRF because it is not a browser form: it has no session, and the checks above stand in for the token. Body: `{event, protocol_id, protocol_number, source_ref, at}`.

- `protocol.deleted`: the deposit is marked as disposed with the date.
- `legal_hold.set` / `legal_hold.cleared`: the deposit's legal-hold flag is set or cleared.
- Anything else, and records eHR does not know, answer 200 and are audited, so later notices are not held up.

Repeats change nothing. Both marks show on the deposits page and on the request page. eHR deletes nothing of its own because of a notice.

## The request page

For each deposit: its state, and once stored the eArchive protocol number as plain text with the returned `url` as a link (new tab, `rel="noopener"`). The note says the link works only once eArchive's web app is published, so the number is always shown as text.

## Needs eArchive's confirmation

1. The per-file field that says MAIN or ATTACHMENT. The note names the values but not the field. eHR sends `role` (one constant, `FILE_ROLE_FIELD` in `ehr/archive/transports.py`).
2. Whether `outbox_id` is a number or text. The note does not say. eHR sends a number.
3. The shape of error bodies: eHR reads `code` and `message` at the top level, and also inside an `error` object.
4. Whether `sent_at` counts as content for the idempotency check. eHR never changes it between retries.
5. Whether 408 and 429 can occur (eHR waits and retries on them) and whether any other per-file or per-meta field is allowed (eHR sends only the fields listed above).
6. The classification `HIGHLY_SENSITIVE` for every request (the note allows it for health data) and the file name of the MAIN file (`<number>-<kind>.pdf`, number in plain ASCII).
7. Whether `approvals[].role` and `actor_name` may be empty strings (eHR never sends them empty).
