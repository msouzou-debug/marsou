# eCapital → eArchive: sample requests

Three sample `meta` parts, one per kind of document eCapital files, plus the
`curl` that sends one. They are here so eArchive can test the ingest route
against something real before eCapital points at the live one, the same way
the eFinance contract was handed over.

**Nothing in this directory is a secret.** There is no token, no real
document and no real contractor — the company, the VAT number, the SAP vendor
id, the protocol numbers and the sha256 values are all obviously made up. The
token is generated on the server by Marios and written straight into
`/etc/ecapital/api.env` and into eArchive's own configuration; it never
travels by email, by chat or through this repository
(`docs/deploy/RUNBOOK-10.227.56.22.md` §11.2).

**No patient data.** An award decision, a business case and an approved
variation are about money, dates, a unit and a company. `personal_data` is
`false` on every item eCapital sends, and no `personal_data_category` is ever
set. Nothing in eCapital can produce one — see ADR-0023 and the migration's
own header.

## The files

| File | Item | `source_module` | `category` |
|---|---|---|---|
| `award.meta.json` | Απόφαση κατακύρωσης on a contract | `award` | Συμβάσεις |
| `business_case.meta.json` | Μελέτη σκοπιμότητας behind a project | `business_case` | Διοίκηση |
| `variation.meta.json` | Εγκεκριμένη τροποποίηση σύμβασης | `variation` | Συμβάσεις |

Permits arrive with M5 (`source_module: "permit"`) and payment certificates
later (`payment_cert`); neither is sent yet.

## The multipart layout

`POST http://127.0.0.1:5011/api/v1/ingest/documents`, `multipart/form-data`,
with:

- exactly **one text part named `meta`**, carrying the JSON below,
- **one binary part per entry in `meta.files[]`**, whose multipart field name
  is that entry's `part_name`.

So a request built from `award.meta.json` has two parts: `meta`, and a part
named `file_main` carrying `apofasi-katakyrosis.pdf`. eCapital names the main
part `file_main` today; a reader should follow `part_name` rather than that
constant, because attachments will bring more parts with names of their own.

```
--boundary
Content-Disposition: form-data; name="meta"
Content-Type: application/json

{ … the JSON …}
--boundary
Content-Disposition: form-data; name="file_main"; filename="apofasi-katakyrosis.pdf"
Content-Type: application/pdf

%PDF-1.7 …
--boundary--
```

Rules eCapital holds itself to, so eArchive should never see them broken:

- exactly one file has `kind: "MAIN"`; any others are `"ATTACHMENT"`;
- `size` and `sha256` describe the bytes in that part, and `sha256` is
  lowercase hex;
- at most 50 MB per file, 200 MB per request, 20 files;
- the MIME is on eArchive's whitelist — PDF, office documents, images, text,
  email. No DWG and no ZIP;
- `meta` is **strict**: eCapital sends no field that is not in the schema,
  and validates its own `meta` against that schema before the item is even
  queued;
- `amount` is a JSON **number**, not a string. Money written inside free text
  — the subject line, an approval comment — is written `1.234,56 €`;
- `sent_at` is ISO 8601 **with an offset**, and so is every `approvals[].at`;
- `folder_hints[].hospital` is the site code, which since 19/09/2026 is
  exactly eCapital's `org_unit.code` with no translation in between
  (ADR-0024): `HQ`, `NGH`, `NAM`, `LGH`, `LAR`, `PAF`, `FAM`, `KYP`, `POL`,
  `MHS`, `PHC`.

`Idempotency-Key` is always `ecapital:<outbox_id>`, and `outbox_id` is the
same value in the header and in `meta`. A retry after a dropped connection
carries the same key, and eArchive answering `200` with
`Idempotency-Replayed: true` and the original protocol is exactly what
eCapital expects — it records that as a successful filing, not as a second
one.

## A `curl` to try it with

Placeholders in angle brackets. `--noproxy '*'` is not optional on this
host: the corporate Squid proxy answers a loopback destination with a fake
`503` otherwise.

```bash
curl --noproxy '*' -i \
  -X POST http://127.0.0.1:5011/api/v1/ingest/documents \
  -H "Authorization: Bearer <ECAPITAL_INGEST_TOKEN>" \
  -H "Idempotency-Key: ecapital:9f1c6a52-0b7e-4c1a-9f3a-6d2e5b8c4a11" \
  -F "meta=@award.meta.json;type=application/json" \
  -F "file_main=@<path to the pdf>;type=application/pdf;filename=apofasi-katakyrosis.pdf"
```

`meta.files[0].size` and `meta.files[0].sha256` in the sample describe a file
that does not exist here, so a real run needs them replaced with the ones
`stat -c %s <file>` and `sha256sum <file>` report — otherwise eArchive is
right to answer `400 SHA256_MISMATCH`, and that is a useful thing to see
working.

## What eCapital does with the answer

- **`201`** — `{protocol_id, protocol_number, url, registry, received_at}`.
  eCapital stores `protocol_id` and `protocol_number` and nothing else, and
  marks the item sent. The `url` and the registry are eArchive's to serve;
  eCapital keeps no copy of the archive.
- **`200` with `Idempotency-Replayed: true`** — treated exactly as a `201`.
- **`409`, `400`, `401`, `403`, `413`, `415`** — the item is marked FAILED
  with eArchive's own code, an administrator is told, and it is **not**
  retried. `SCHEMA_INVALID`, `SHA256_MISMATCH`, `MIME_REJECTED`,
  `DUPLICATE_SOURCE_REF`, `IDEMPOTENCY_MISMATCH`, `UNKNOWN_REGISTRY`,
  `LOOPBACK_ONLY`, `SERVICE_ONLY`, `SOURCE_MISMATCH` are all understood as
  «do not send this again».
- **`5xx`, or a refused connection** — retried after 1 minute, then 5, 15,
  60, then hourly. Never dropped.

## The callback

eArchive calls eCapital back at
`POST http://127.0.0.1:5015/api/v1/dms/events`, with the same bearer token:

```json
{
  "event": "legal_hold.set",
  "protocol_id": "…",
  "protocol_number": "ΤΥ/2026/00001",
  "source_ref": "award:22222222-2222-2222-2222-222222222222",
  "at": "2026-09-19T10:00:00+03:00"
}
```

`event` is `protocol.deleted`, `legal_hold.set` or `legal_hold.cleared`. The
route answers `200` quickly and is idempotent — the same event twice is
`200` both times. It is **loopback only**: a request carrying
`X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `CF-Connecting-IP` or `CF-Ray`
is refused `403 LOOPBACK_ONLY`, and a missing or wrong token is `401`.

A `protocol.deleted` leaves eCapital with a tombstone — the `source_ref`, the
protocol number and when it went — because eCapital holds no file copy to
delete. A `legal_hold.set` puts a marker on the record that blocks any local
action treating it as disposable.

See `docs/adr/ADR-0023-earchive-outbox.md` for why it is built this way, and
`docs/INTEGRATION-eFinance-eMAP-eCapital.md` §6 for the facts this contract
is drawn from.
