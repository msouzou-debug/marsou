# ADR-0034 — One code and one name per hospital in every tool, eFinance's; references keep the prefix they were issued under

**Status:** accepted · 19/10/2026 · supersedes the code table in [ADR-0024](ADR-0024-unit-codes-follow-earchive.md) and the two-code model of ADR-0022's addendum

## Context

ADR-0024 (19/09/2026) keyed every place by eArchive's site abbreviation, and
ADR-0022's addendum (20/09/2026) accepted that eFinance would never follow,
because its codes are foreign keys across twelve of its own tables and in
SAP. eCapital therefore carried two codes per unit and sent eArchive's one
everywhere, trusting eFinance to translate at its boundary.

On 19/10/2026 the owner settled it the other way round: **one code and one
name per hospital across every tool, both eFinance's.** eArchive migrates its
six diverging site codes (`PAF`→`PAP`, `NAM`→`ARC`, `POL`→`CHR`, `KYP`→`TRD`,
`MHS`→`MH`, `PHC`→`HC`) and, with them, three names are settled: Νοσοκομείο
Τροόδους (already ours), Κέντρα Υγείας (ours said Πρωτοβάθμια Φροντίδα
Υγείας) and Νοσοκομείο Αρχιεπίσκοπος Μακάριος ΙΙΙ (ours said Μακάριος Γ΄).

eFinance's note of the same day found what the earlier "eCapital needs
nothing" had missed: eCapital **does** send eArchive's code inbound, on the
contract push (`entity_code`) and on the budget-position filter, and matches
eFinance's `archive_code` on the daily entity sync. The day eFinance's
translation table becomes identity, a push for one of the six units is
refused with `SCHEMA_INVALID` and the budget-position panel for them goes
empty.

## Decision

1. **`org_unit.code`, `entity_code` and `efinance_code` are one string, eFinance's.**
   Migration `0024_unit_codes_follow_efinance.sql` moves the six codes and
   the two names. The `efinance_code` column stays: it is what the eFinance
   client sends, and keeping it means a future divergence is a data change
   and not a code change.

2. **The eFinance client sends `efinance_code`, never the unit code**, on
   the contract push and both budget-position reads. Before 0024 that is
   already the right string; after it the two are equal. So the fix is safe
   whichever day eFinance flips its table, and eFinance's proposed inbound
   alias table is a courtesy, not something eCapital depends on.

3. **The entity sync matches eFinance's `code` first, `archive_code` second.**
   A unit that for any reason still carries an older abbreviation is found
   either way, and `efinance_code` is written from eFinance's `code`.

4. **No reference is re-prefixed.** 0012 re-prefixed project codes because
   nothing had been printed. Now asset tags are on labels, work order
   references are on contractors' reports and project codes are on
   eArchive filings, so every reference keeps the prefix it was issued
   under (owner decision, 19/10/2026). The allocators read `org_unit.code`
   at the moment they hand out a number, so the next project, asset or
   order a renamed unit opens takes the new prefix and continues the same
   run of numbers. The seed matches existing rows by unit and name, not by
   code, so a re-seed creates no duplicates.

5. **eArchive site codes are these same strings.** `SITE_CODES` in
   `earchive-contract.ts` moves with the units, since by ADR-0024 the site
   code is exactly `org_unit.code`. **Order of release:** eArchive must carry
   the new codes before the eArchive token is installed on the ΟΚΥπΥ server
   (runbook §11.2). Until then the outbox holds, which is the state it has
   been in since 19/09/2026.

6. **The directorate is not the unit.** «Πρωτοβάθμια Φροντίδα Υγείας» stays
   as the name of directorate PFY; «Κέντρα Υγείας» is the unit under it. The
   Capex importer keeps the old spellings as aliases so a February-style
   sheet still resolves.

## Consequences

- Six units change code on the server with one migration, no seed run, no
  restart beyond the release script's own. Existing project codes, tags and
  work order references are untouched; new ones carry `PAP`, `TRD`, `ARC`,
  `CHR`, `MH`, `HC`.
- eFinance's `archive_code` becomes equal to `entity_code` after their
  migration; eCapital does not store it and reads nothing from it.
- The two-code tables in `INTEGRATION-eFinance-eMAP-eCapital.md` §2 and §6
  are rewritten in place as one column; ADR-0024's text stands as the record
  of the month in which the codes were eArchive's.
