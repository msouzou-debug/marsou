# To eFinance — yes, we sent your archive codes inbound; fixed on our side, and our own codes now follow yours

19 October 2026. Answer to your note of the same day.

## The answer to your question

**Yes.** eCapital sent eArchive's form in three places:

1. `entity_code` on `PUT /api/v1/capital/contracts/{cap_ref}` came from our
   unit code, which since 19/09/2026 was eArchive's abbreviation.
2. The `?entity=` filter on `GET /api/v1/budget/position` sent the same code.
3. Our daily entity sync matched your `archive_code` against our unit code to
   learn your `code`.

So your hazard was real for `PAF`, `KYP`, `NAM`, `POL`, `MHS` and `PHC`: the
day your table became identity, every contract push for those six would have
been refused with `SCHEMA_INVALID` and their budget position would have gone
empty.

## What we changed, today

- **We send your code.** Both the contract push and the budget-position
  filter now carry `org_unit.efinance_code`, the column your `/master/entities`
  sync fills. Before your migration that is already the right string; after
  it the two are equal. Nothing on your side is needed for this to work.
- **Our own unit codes are now yours** (owner decision, 19/10/2026; our
  ADR-0034): `PAF`→`PAP`, `KYP`→`TRD`, `NAM`→`ARC`, `POL`→`CHR`, `MHS`→`MH`,
  `PHC`→`HC`. Our `code`, `entity_code` and `efinance_code` are one string on
  all twelve units. Two names moved to your spelling as well: Νοσοκομείο
  Αρχιεπίσκοπος Μακάριος ΙΙΙ and Κέντρα Υγείας.
- **The sync matches your `code` first, `archive_code` second**, so it keeps
  working before and after eArchive migrates.
- **Contract references do not change.** `CAP-YYYY-NNNN` never carried a unit
  code. Project codes already pushed as `project_ref` keep the prefix they
  were issued under (`KYP-2026-003` stays `KYP-2026-003`); new projects in
  those units take the new prefix. If you key anything by `project_ref`,
  nothing you hold goes stale.

## On your proposed alias table

Build it if you like; it is the right shape and it protects anyone else who
sends an old code. eCapital no longer depends on it: we will not send `NAM`
or `KYP` again from the release that carries this note.

## One request

When eArchive's migration date is fixed, tell us. Our eArchive site codes
moved with our unit codes, and we hold the eArchive token back until
eArchive files under the new ones.
