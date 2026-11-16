# eArchive → eHR: answers to your six points

From the eArchive session, 16/11/2026, through Marios. These answers come from the eArchive code (commit a70a3f2).
eArchive is live on the server at database version 30, with ΑΔ, `svc-ehr` and the access rule in place.
**The samples zip hasn't reached me yet.** Marios will pass it on, and I'll run all three samples through eArchive's own test and report back.

## 1. Main or attachment: the field is `kind`, not `role`

Each entry of `files[]` is exactly:

```json
{ "kind": "MAIN", "part_name": "main", "filename": "…", "mime": "application/pdf", "size": 12345, "sha256": "…" }
```

All six fields are required, and nothing else is allowed. A `files[]` entry carrying `role` gets
`400 SCHEMA_INVALID` today, so this has to change on your side. My note named the values but not the field. That was my omission.

## 2. `outbox_id`: a number is right

A number or a string is accepted, and eArchive stores it as text. `Idempotency-Key: ehr:<outbox_id>` is right as it is.

## 3. Error answers sit inside `error`

```json
{ "error": { "code": "DUPLICATE_SOURCE_REF", "message": "…", "details": { … } } }
```

Read `error.code` and `error.message`. There is never a top-level `code`. `details` is present only when there is something to add,
e.g. the field-by-field reasons on `SCHEMA_INVALID`.

**For `409 DUPLICATE_SOURCE_REF`, the number is now a field of its own** (added today at your request, commit a70a3f2):
`error.details = { "protocol_id": "…", "protocol_number": "ΑΔ/2026/00001" }`. Use that, not the message text.

## 4. `sent_at` counts: identical content is required, not just safe

A retry is compared on the **whole parsed `meta`** plus the hashes of the files. Key order and whitespace don't matter,
because it is compared as canonical JSON. Any changed value, `sent_at` included, gets `409 IDEMPOTENCY_MISMATCH`.
Building `meta` once and resending the same bytes is exactly right. Keep it that way.

## 5. Retries and strictness

- **408 / 429:** eArchive itself never sends 429. Node can send 408 if a request takes longer than its timeout (5 minutes).
  Treating both as "wait and retry with the same key" is correct.
- **No hidden required fields.** Besides the six per file (point 1), `meta` needs exactly what my note lists as required.
  The schema is strict, so a field it doesn't know is refused rather than ignored.
- **`approvals[]`:** `actor_name` and `action` must not be empty. `role` may be empty, and it then shows as «system».
  «Σύστημα» in both is fine. `at` needs an offset, and `comment` is optional (≤ 2000).

## 6. Classification and file names

- **`HIGHLY_SENSITIVE` for every request is fine.** Here is what it means in eArchive, so nothing surprises you:
  files are never read by machine, so their contents can't be searched (`subject` and `attributes` still are).
  Such a record cannot be emailed from eArchive, version comparison is off, and printouts carry a watermark.
  Together with the closed ΑΔ registry, that is the right level for requests that may mention sick leave.
- **Yes, staff see the file name.** `meta.files[].filename` becomes the document's title on the record. Send it in Greek, in UTF-8,
  e.g. `ΑΕΘ-2026-0005 — απόφαση.pdf`. The Latin name in the multipart part itself doesn't matter. eArchive uses the name in `meta`.

## Your three items

- **Notices:** set to `http://127.0.0.1:5008/api/v1/archive-events` on our side (with today's install).
  eArchive sends `{ event, protocol_id, protocol_number, source_ref, at }` with the same bearer token.
  If it gets anything but a 2xx, it retries after 1, 2, 4… minutes, up to 6 hours apart, in order.
- **Token:** Marios copies it from our `EHR_INGEST_TOKEN` into your `EHR_ARCHIVE_TOKEN` in `/etc/ehr/ehr.env`
  once eHR is installed on the server. `/etc/ehr` doesn't exist yet.
- **More than 19 attachments: yes, send them as one `.zip`.** Use a single `ATTACHMENT` with `mime: "application/zip"`
  (e.g. `Συνημμένα.zip`). eArchive opens it and stores each file as its own attachment, and the record notes that they arrived in an archive.
  Limits: up to 200 files inside, 50 MB each, 200 MB in all. Every file inside must be an accepted type, otherwise
  the whole deposit gets `415 MIME_REJECTED` naming the file. Only use the zip past 19; up to 19, send the files individually.

## Two smaller questions

- **`url` is absolute:** `<eArchive web address>/protocols/<protocol_id>`. It opens for staff only once the eArchive web app is
  published with sign-in, which waits on IT. Store it, but show only the number for now.
- **Site codes for facilities outside the twelve:** please send the list of eHR's facilities that have no code, with the
  Directorate each belongs to. Marios decides where each is filed, and I add the codes. It's one line each on our side.
  Until a facility has a code, eArchive answers `400 UNKNOWN_REGISTRY`. Hold such a request in your outbox (eFinance does the same)
  and send it once the code exists. Don't file it under another site's code in the meantime.
