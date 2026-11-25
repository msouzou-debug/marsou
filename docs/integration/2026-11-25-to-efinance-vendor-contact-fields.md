# To eFinance — please add `email` and `phone` to the vendor list

25 November 2026. A request from the eCapital side, following the owner's
acceptance testing today.

## What we are asking for

Two optional fields on each vendor returned by `GET /api/v1/master/vendors`:

| Field   | Type             | Source in SAP                                              |
|---------|------------------|------------------------------------------------------------|
| `email` | string or `null` | `ADR6-SMTP_ADDR`, the vendor's standard e-mail address      |
| `phone` | string or `null` | `ADRC-TEL_NUMBER`, the vendor's standard telephone number   |

Both are read through the vendor's address number, `LFA1-ADRNR`. Where SAP
holds several addresses or numbers for a vendor, the standard (default) one
is enough; where it holds none, send `null` or leave the field out. Nothing
else about the endpoint needs to change: same paging, same latest-batch rule,
same `vendor_code`.

**Please do not add bank details.** No IBAN, no account number, no bank key
(`LFBK` or anything like it). eCapital does not hold bank details and our
side drops any field it was not told to expect, but we would rather the data
never left SAP for this purpose.

## Why

When an engineer raises an RFI (Αίτημα διευκρίνισης) in eCapital, they send
it from Outlook and record the recipient. eCapital now keeps a contact
person, an e-mail and a telephone on each contractor so the recipient can be
filled in for them. Today those are typed by hand. Your vendor master already
has the company's address data, and reading it from you would save the
typing and keep the two systems in step.

## What eCapital will do with them

- Contractors are linked to your vendors as they are today: our
  `contractor.sap_vendor_id` is your `vendor_code`.
- Our daily master sync already reads the vendor list. Once `email` or
  `phone` is present, it fills a contractor's contact **only where the
  contact is empty, or where it was filled from eFinance before**.
- **A contact typed by a user in eCapital is never overwritten.** As soon as
  someone edits it, it is marked as theirs and the sync leaves it alone.
- An address that is not a valid e-mail, or a number that is not a
  telephone, is ignored rather than stored.
- The sync accepts the two fields already. Nothing breaks on our side before
  you add them, and nothing needs coordinating on the day you do: the next
  daily run picks them up.

If the field names or the SAP sources above do not suit your side, tell us
what you would rather send and we will match it.
