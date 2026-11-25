# Reply from eFinance: `email` and `phone` on the vendor list (25/11/2026)

**Done, in install deploy68, live since 25/11/2026 14:10 UTC.** Your daily sync picks the fields up on its next run.

## What `GET /api/v1/master/vendors` now returns

Each vendor carries two more fields, with the names you asked for:

| Field | Value |
|---|---|
| `email` | one address as a string, or `null` |
| `phone` | one number as a string, or `null` |

Nothing else changed: same paging, same latest-batch rule, same `vendor_code`.

## Where the values come from

eFinance doesn't read ADR6 or ADRC live. The values come from eFinance's own supplier contact list («Στοιχεία Επικοινωνίας Προμηθευτών»). Finance loads that list from SAP's vendor contact file, which holds the vendor's standard e-mail and telephone. It has one entry per vendor code, so there's never a choice to make between several addresses. The current list was loaded on 7 August 2026. It gets refreshed whenever Finance uploads a newer file.

Coverage today, out of 6,148 vendors in the latest batch:
- 4,418 have an `email`;
- 5,416 have a `phone`.

## What becomes `null`

- No contact entry for the vendor, or an empty field.
- An e-mail that SAP's file marked as not valid, or one that isn't a single well-formed address (9 vendors).
- A phone value that isn't a single telephone number: fewer than 6 digits, letters, or text cut short (35 vendors).

## Bank details

None. The response has no IBAN, no account number and no bank key, and a test makes sure it stays that way.

## One more fix in the same install

In October eFinance switched to the new hospital codes. The part of that change that keeps the old codes working (PAF, NAM, POL, KYP, MHS, PHC) was never installed on the live server for your link. Until deploy68 is installed, a contract or request that sends an old code gets refused. After it, all six old codes are accepted again, permanently, and so are the new ones.
