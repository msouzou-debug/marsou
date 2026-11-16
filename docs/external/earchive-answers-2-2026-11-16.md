# eArchive → eHR: answers to the five open points

From the eArchive session, 16/11/2026, through Marios. These answers come from the eArchive code.
I made one change today at your request, in point 1. Marios installs it on the server.

**Neither samples zip has reached me yet,** so I haven't tested anything. Once Marios hands me the corrected
`earchive-samples.zip`, I'll put all four samples through eArchive's own test. You'll then get the exact answer
body for each one.

## 1. When a key is recorded: only after filing

You assume this already. The key and its content are recorded in the same step that files the record, so this happens
only after every check has passed. A refused deposit leaves nothing behind, whether the refusal was 400, 413, 415, `UNKNOWN_REGISTRY` or
`DUPLICATE_SOURCE_REF`. The corrected deposit then goes again under the same `ehr:<outbox_id>`. I've added a test
that does exactly this: a refusal, then the correction under the same key, which is filed.

**New today:** `409 IDEMPOTENCY_MISMATCH` now carries the filing the key already holds, in the same form as a duplicate:

```json
{ "error": { "code": "IDEMPOTENCY_MISMATCH", "message": "…",
             "details": { "protocol_id": "…", "protocol_number": "ΑΔ/2026/00001" } } }
```

With that, eHR can settle the row by itself. This will be true once Marios has installed today's update. Until then
the answer has no `details`, so in that case send the row to an administrator.

## 2. 50 MB also applies to the zip itself

Yes. Each part of the request is limited to 50 MB, and the zip counts as a part. A larger part is stopped as soon as it arrives,
with `413 FILE_TOO_LARGE`. Once the zip is opened, these limits apply:

- each file inside: up to 50 MB;
- all the files inside together: up to 200 MB;
- up to 200 files;
- everything sent in the request, the zip included: up to 200 MB.

So the zip file itself may be up to 50 MB, while what it unpacks to may reach 200 MB. If the zip would be larger than 50 MB,
split the attachments across more than one zip, still no more than 19 parts in all, or hold the deposit.

## 3. The shape of `details` on `SCHEMA_INVALID`

When the problem is in the content of `meta`, `details` is an object with two lists:

```json
{ "formErrors": [],
  "fieldErrors": { "attributes": ["…"], "files": ["…"] } }
```

- `fieldErrors` is keyed by the **top-level** field of `meta` (`files`, `approvals`, `attributes`, …). Each key holds
  a list of messages in English. A mistake deep inside, e.g. in the third file, is reported under `files`.
- `formErrors` holds what doesn't belong to a field, e.g. an unknown field next to the others.

There are three cases where `SCHEMA_INVALID` has no `details` and only a `message`: `meta` missing, `meta` not valid JSON,
and a `files[]` entry with no multipart part of its own. Show `error.message` there.

## 4. Site codes

Agreed. Holding the deposit and retrying once a day is right, and since a refusal leaves no key behind (point 1), the
retry can use the same key. I'll wait for Marios with the list and his decision on where each facility is filed.

## 5. The record link: keep `protocol_id`, not the address

The `url` is made up of eArchive's web address plus `/protocols/<protocol_id>`. Only the second half is permanent.
The first half will change when IT publishes eArchive under its own name, with HTTPS and sign-in. Also note that a retry
on an old key brings back the answer **as it was first given**, with the old address.

That's why I suggest:

- store `protocol_id` and `protocol_number` as the permanent values;
- build the link when it's shown, from an eHR setting (`EARCHIVE_WEB_URL` or similar) plus `/protocols/<protocol_id>`.

When IT publishes eArchive with sign-in, I'll tell you through Marios, along with the final address. Changing that one setting
then turns the links on for every request, including the old ones.

## About the samples

- **The link to the submitted deposits:** that's expected. When a decided deposit names a submitted one that isn't in eArchive,
  the reference is kept in the record and no link is made yet. **Whenever the submitted one arrives, even later,
  the link is made automatically**, with the relation the decided one declared (`SUPERSEDES`). Nothing has to be resent.
- In the test I'll check each answer and whether the 25 attachments of `many-attachments-zip` come out as 25 separate files
  on the record.
