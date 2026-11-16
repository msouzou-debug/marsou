# 06 – Depositing requests in eArchive

Status: built (16/11/2026). eArchive's side is specified in `docs/external/earchive-ingest-2026-11-16.md` (the eArchive session's note, relayed by Marios). That note is the specification of the HTTP call. This page describes what eHR does with it.

## What is deposited, and when

Two deposits per request (decided by Marios with eArchive, 16/11/2026):

- `submitted`: at the first submission. A resubmission after a return makes no new deposit.
- `decided`: when the request ends: approved, rejected or withdrawn, by the requester or by the system (after the timeout). It replaces the earlier eHR rule that rejected and withdrawn requests are not deposited.

A request decided without ever having a `submitted` deposit (an old one) sends just the decided one. Both rows are written in the same transaction as the action, so a rolled-back action leaves none. The user's action never waits for eArchive and never fails because of it.

Each deposit is one MAIN file (the PDF of the request with its checks and history, made on the eHR server, Greek, A4) and the requester's supporting documents as ATTACHMENT files. The PDF is kept with its SHA-256, so a retry sends the same bytes. More than 19 attachments go as one zip (see Limits). Nothing is deleted after submission.

## The call

`POST {EHR_ARCHIVE_URL}/api/v1/ingest/documents` (default `http://127.0.0.1:5011`), multipart: a text part `meta` with JSON and one binary part per file, the part name equal to the file's `part_name`.

- Headers: `Authorization: Bearer <EHR_ARCHIVE_TOKEN>` and `Idempotency-Key: ehr:<deposit id>`. No forwarding headers.
- The URL must be plain http on this machine (127.0.0.1, ::1, localhost). Anything else stops eHR from starting and from being switched on. No proxy (environment proxy variables are ignored), no redirects, 60 seconds timeout, standard library only.
- The token is read from the environment file (`EHR_ARCHIVE_TOKEN`). It is never stored in the database and never written to a log, an audit row, an error text or a page.
- Without a token, or when the `archive_transport` setting is not `http`, nothing is sent and rows wait.
- One deposit at a time, in order.

`meta` (schema v1, strict) carries exactly these fields: schema_version, outbox_id, sent_at, source_system, source_module, source_ref, sender_ref, doc_type, subject, direction, sender_name, letter_date, event_date (decided only), category, classification, personal_data, personal_data_category, folder_hints, attributes (cost_centre, staff_category, position_title, posts), amount and currency (decided only, when central HR recorded the annual employer cost of the new hires), related (decided only, when a submitted deposit exists: SUPERSEDES), approvals, files (exactly kind, part_name, filename, mime, size, sha256 per entry).

- All text is Greek, from the Greek string file, whatever language the user reads. The subject has the position and cost centre, no personal names.
- Fixed values: `eHR`, `position_request`, `INTERNAL`, classification `HIGHLY_SENSITIVE` (the long-absence text can describe sick leave, which is health data; the note says that level also keeps files away from automatic reading), personal data true.
- `outbox_id` is the deposit id as a number. `sent_at` and every time are Cyprus time with offset. `letter_date` is the Cyprus date of submission, `event_date` the date of the decision.
- `approvals`: the requester first, then every recorded action in order, replaced answers included and marked as the PDF marks them. The system's automatic withdrawal is shown as «Σύστημα».
- The meta part is built once and stored, so a retry sends identical content under the same key. eArchive compares the whole parsed meta (`sent_at` included) and the file hashes; any change is `409 IDEMPOTENCY_MISMATCH`.
- `files[].filename` is the document's title in eArchive, so staff read it. The request PDF is named in Greek from the string keys `archive.filename.submitted` and `.decided` with the real number (for example «ΑΕΘ-2026-0005 — απόφαση.pdf»); attachments keep their own names. Names are unique inside a deposit (" (2)" before the extension on a clash) and carry no path separators or control characters. The Latin name in the multipart part itself is only a fallback.
- `kind` is MAIN for the PDF and ATTACHMENT for the rest; `mime` is the type eHR sniffed when the file was uploaded (application/pdf for the PDF). `approvals[].actor_name` and `action` are never empty; `role` may be.

## Where it is filed

eArchive files by site. Each facility has an eArchive site code (Settings, facilities; one of the twelve in the note, section 2; audited). A facility without a code makes its deposits `blocked` (`NO_SITE`) and eArchive is not called. They go out by themselves at the next run after the code is set. A code eArchive does not have yet answers `400 UNKNOWN_REGISTRY`: that is not a block. The deposit stays `queued` with the reason (`archive.error.site_unknown`), is tried once a day, and is never filed under another code. `flask archive-sites` lists every active facility with its Directorate and code (or "none") and counts the ones without, for the list sent to eArchive.

## Limits, checked before sending

Up to 19 attachments go one by one (1 MAIN and 19 ATTACHMENT). From 20 to 200 they go as ONE ATTACHMENT, `mime: application/zip`, named «Συνημμένα.zip» (`archive.zip_name`); eArchive opens it and files each member. The zip is built by eHR with the standard library, deterministic (members in the order of the request's documents, a fixed 1980 timestamp, stored, fixed attributes), so the bytes and sha256 are the same on every rebuild, which retries need. It is kept in the storage folder (`archive/<request id>/<kind>-attachments-<sha16>.zip`) beside the PDF. Never a zip up to 19 attachments.

Limits: 50 MB per file (inside the zip too), 200 MB in all, at most 200 files inside, every file an accepted type, names unique inside. A deposit over a limit is not sent and nothing is dropped silently: it is `blocked` with a readable reason in Greek, from the keys `archive.error.file_too_big`, `file_type`, `deposit_too_big`, `too_many_files` (past 200 files), shown to administrators.

## Answers and states

| Answer | State |
|---|---|
| 201, or 200 with `Idempotency-Replayed: true` | `stored`: protocol_id, protocol_number and url kept on the deposit |
| 409 DUPLICATE_SOURCE_REF | `stored`: protocol_id and protocol_number from `error.details` (the message text is only a fallback); audited as a duplicate |
| 409 IDEMPOTENCY_MISMATCH | `stored` when `error.details` names the record; otherwise `blocked` with the reason (see below) |
| 400 UNKNOWN_REGISTRY | stays `queued` with the reason, tried again once a day; attempts are not counted |
| no answer, timeout, 5xx (also 408 and 429) | stays `queued`, tried again with the same key after 5 min, 15 min, 1 h, 6 h, then daily; no limit, never dropped |
| 400 SCHEMA_INVALID (the first `error.details` reasons are kept, shortened, token scrubbed), SHA256_MISMATCH, ARCHIVE_*, 401, 403, 413, 415, a redirect, any other answer | `blocked`: the machine code and message are kept as the error, audited; not sent again until an administrator presses the retry button after the cause is fixed |

Errors are read only from `error.code`, `error.message` and `error.details`; there is never a top-level code.

The administrator's retry button builds the meta again (a fixed site code or name is picked up), which changes `sent_at`. If the first attempt had already been filed, the rebuilt meta meets `IDEMPOTENCY_MISMATCH` or `DUPLICATE_SOURCE_REF`; both resolve to the stored record when `details` name it, and otherwise the row stays blocked with the reason. This rests on an assumption listed below.

Other problems on eHR's side (a stored file missing or changed, no PDF converter) make the row `failed` and are retried up to 10 times, then wait for the button. Settings shows a count of blocked deposits on its index page. No email is sent.

## Notices from eArchive

`POST http://127.0.0.1:5008/api/v1/archive-events` (the port follows `EHR_BIND`) is the address to give eArchive for its `EHR_EVENTS_URL`. It accepts only connections from this machine, refuses any request with a forwarding header, and checks the same bearer token in constant time. It is exempt from CSRF because it is not a browser form: it has no session, and the checks above stand in for the token. Body: `{event, protocol_id, protocol_number, source_ref, at}`.

- `protocol.deleted`: the deposit is marked as disposed with the date.
- `legal_hold.set` / `legal_hold.cleared`: the deposit's legal-hold flag is set or cleared.
- Anything else, and records eHR does not know, answer 200 and are audited, so later notices are not held up.

Repeats change nothing. Both marks show on the deposits page and on the request page. eHR deletes nothing of its own because of a notice.

## The request page

For each deposit: its state, and once stored the eArchive protocol number as plain text. The returned `url` (absolute) is stored but not shown: it opens for staff only once eArchive's web app is published. The setting `archive_show_link` (default off; `flask archive-link on|off`) turns the number into a link (new tab, `rel="noopener"`, http or https only) on the request page and the deposits page.

## Confirmed by eArchive on 16/11/2026

From eArchive's code (commit a70a3f2), `docs/external/earchive-answers-2026-11-16.md`:

- The per-file field is `kind` (MAIN or ATTACHMENT); each entry is exactly kind, part_name, filename, mime, size, sha256, all required, nothing else. `role` is refused with 400 SCHEMA_INVALID.
- `outbox_id`: a number is right (stored as text). `Idempotency-Key: ehr:<outbox_id>` stands.
- Errors are `{"error": {code, message, details?}}`. A 409 DUPLICATE_SOURCE_REF carries `details.protocol_id` and `details.protocol_number`.
- A retry is compared on the whole parsed meta (canonical JSON, `sent_at` included) plus the file hashes. Identical content is required.
- 408 can come from eArchive's 5 minute timeout, 429 never; waiting and retrying with the same key is right. No hidden required fields; `approvals[].role` may be empty (shown as «system»).
- `HIGHLY_SENSITIVE` for every request is fine (files are not read by machine, no email from eArchive, no version comparison, watermark on printouts).
- `meta.files[].filename` is the document's title; send it in Greek.
- More than 19 attachments: one ATTACHMENT zip, up to 200 files, 50 MB each, 200 MB in all, 415 naming the file for a refused type.
- `url` is absolute and opens for staff only once the web app is published. A site without a code answers 400 UNKNOWN_REGISTRY; hold the deposit and never use another code.
- Notices go to `http://127.0.0.1:5008/api/v1/archive-events` with the same bearer token; eArchive retries after 1, 2, 4 minutes up to 6 hours apart.

## Still open (eHR's assumptions, to confirm with eArchive)

1. When eArchive records an Idempotency-Key: eHR assumes only once a request has passed validation and been filed. So a deposit refused as invalid can be sent again, rebuilt, under the same key, and one already filed answers IDEMPOTENCY_MISMATCH or DUPLICATE_SOURCE_REF. Does IDEMPOTENCY_MISMATCH carry `details.protocol_number` too?
2. Whether the 50 MB per-file limit applies to the zip itself (eHR applies only the 200 MB total to the zip, and 50 MB to each file inside).
3. The shape of `error.details` for SCHEMA_INVALID. eHR reads a dict, a list or text and shows it shortened.
4. The site codes of facilities outside the twelve (`flask archive-sites` gives the list); until then those deposits wait.
5. The real `url` path and the date the web app is open to staff, to switch `archive_show_link` on.
