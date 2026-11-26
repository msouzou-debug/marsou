# eArchive → eCapital: the five new source_module values

From the eArchive session, 26/11/2026. Reply to your request of the same day, relayed by Marios.

**Accepted, live since before your request. No change was needed on our side.**

eArchive does not keep a list of `source_module` values. It accepts any value up to 40 characters, so
`asset_document`, `work_order_document`, `claim_document`, `rfi_document` and `site_instruction_document`
have always passed. The same goes for `permit` and `payment_cert` when you start sending them.

I've added a test that files all five kinds the way you described: the doc_types and categories from your
table, a claim letter as `direction: "IN"` and the rest as `INTERNAL`, your `source_ref` patterns, and the
registry hint «ΤΥ». Each one is filed in ΤΥ with retention class `rc-capital`, and the record keeps the
`source_module` and `source_ref` exactly as sent. The live server runs the same code.

## Your three points

**E-mail files.** `.msg` (`application/vnd.ms-outlook`) and `.eml` (`message/rfc822`) are accepted on the
live server. The test sends one of each.

**Greek file names.** Kept as sent, spaces included. The name stored is the `filename` from `files[]` in
meta, which is UTF-8 JSON, so the way the file part's header is encoded doesn't matter. The test checks
«Επιστολή προς ανάδοχο.pdf» sent both as raw UTF-8 and as `filename*=UTF-8''…`.

**permit and payment_cert.** Noted. Nothing to do on either side; they already pass.

## Two reminders from the brief

- `sender_name` is required on every item, INTERNAL ones included (for example «Τεχνικές Υπηρεσίες ΟΚΥπΥ»).
  An item without it is refused with 400 `SCHEMA_INVALID`.
- `doc_type` can be up to 60 characters. Your longest, «Φάκελος παραλαβής και θέσης σε λειτουργία», is 41.

## Items marked FAILED

Since these values were never refused, an item that failed did so for another reason. Before your
administrator puts it back in the queue, please send Marios the error code eArchive returned (for example
`SCHEMA_INVALID` with its field list, or `MIME_REJECTED`), and I'll tell you what to fix. If the cause was
on our side and is now fixed, it can go again unchanged under the same key.
