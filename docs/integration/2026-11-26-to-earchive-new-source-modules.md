# To eArchive: please accept five more `source_module` values from eCapital

26 November 2026. A request from the eCapital side.

## What we are asking for

eCapital files its papers through `POST /api/v1/ingest/documents`, as set out
in the brief of 19/09/2026. That brief listed five `source_module` values:
`award`, `business_case`, `variation`, `permit` and `payment_cert`. Since then
eCapital has started filing five more kinds of paper. Please add these values
to the list your ingest route accepts, or tell us if they already pass:

| `source_module` | What it is | `doc_type` (as sent) | `category` |
|---|---|---|---|
| `asset_document` | A paper about a piece of equipment: O&M manual, certificate, commissioning pack, warranty, drawing, photograph | «Εγχειρίδιο λειτουργίας και συντήρησης», «Πιστοποιητικό εξοπλισμού», «Φάκελος παραλαβής και θέσης σε λειτουργία», «Εγγύηση εξοπλισμού», «Σχέδιο εξοπλισμού», «Φωτογραφία εξοπλισμού» | Συμβάσεις (commissioning, certificate, warranty), Διοίκηση (manual, drawing, photo) |
| `work_order_document` | A photograph or the contractor's report on a maintenance work order | «Έγγραφο εντολής εργασίας συντήρησης» | Συμβάσεις |
| `claim_document` | A claim letter, the reply to it, or a lawyer's letter about it | «Επιστολή αξίωσης», «Απάντηση σε αξίωση», «Επιστολή δικηγόρου για αξίωση» | Συμβάσεις (letter, reply), Νομικά (lawyer's letter) |
| `rfi_document` | The e-mail or letter that sent a request for information (RFI) to the contractor, and the contractor's reply | «Αλληλογραφία αιτήματος διευκρίνισης» | Συμβάσεις |
| `site_instruction_document` | The e-mail or letter that sent a site instruction to the contractor | «Αλληλογραφία οδηγίας εργοταξίου» | Συμβάσεις |

The `source_ref` patterns are `asset_doc:<id>:<n>`, `work_order_doc:<id>:<n>`,
`claim_doc:<id>:<n>`, `rfi_doc:<id>:<n>` and `site_instruction_doc:<id>:<n>`,
where `<n>` is the nth paper on that record. Everything else in `meta` keeps
the shape of the brief. No new field, no new category and no new direction:
all the categories above are already in your list. A claim letter from the
contractor goes as `direction: "IN"` with `sender_name`; everything else goes
as `INTERNAL`.

## Three things to confirm

1. **E-mail files.** RFI and site-instruction correspondence will mostly be
   `.msg` (`application/vnd.ms-outlook`) and `.eml` (`message/rfc822`). Both
   are on the whitelist in the brief. Please confirm they are accepted on the
   live server.
2. **Greek file names.** The file part carries the user's original file
   name, often Greek with spaces (for example «Επιστολή προς ανάδοχο.pdf»),
   sent as UTF-8. Please confirm your side keeps it as it is.
3. **`permit` and `payment_cert`.** These are in the brief but eCapital
   does not send them yet. No action needed; we will tell you before we
   start.

## If something was refused already

A refusal comes back as a 4xx. eCapital then marks the item FAILED and never
resends it on its own. Once you confirm the new values, our administrator
puts any failed items back in the queue from eCapital's eArchive screen, and
they go again unchanged.

## What does not change

- **No patient data.** `personal_data` is `false` on every item, and no
  `personal_data_category` is ever set (ADR-0023).
- **No secrets travel in this request.** The ingest token stays where it is,
  on the server, and is not part of this change.
- Same route, same limits (50 MB per file, 20 files, 200 MB per request),
  same registry hint «ΤΥ» and retention class `rc-capital`.

## Contact

Reply through Marios, as before. A short "accepted, live from <date>" is
enough. If any value clashes with something on your side, tell us the
spelling you want and we will change ours.
