# ADR-0024 — Unit codes follow eArchive's site abbreviations, and the Ambulance Service leaves the register

**Status:** accepted · 19/09/2026 · supersedes the code table in [ADR-0019 §1](ADR-0019-entity-codes-and-contract-references.md)

## Context

Three systems on the same server estate describe the same eleven places, and until today each of them spelled a place differently.

- **eCapital** carried `org_unit.code` — `NGH`, `LAR`, `PAF`, `LMS`, `TRD`, `NAM3`, `PCH`, `FAM`, `DYP`, `PFY`, `HQ` — invented here, and used to build the project code ADR-0014 issues.
- **eFinance** carried its own `hospital_code`, which is also SAP's Fund Center. ADR-0019 stored it beside the first as `org_unit.entity_code`, precisely *because* the two differed: Πάφος `PAF`/`PAP`, Λεμεσός `LMS`/`LGH`, Μακάριος `NAM3`/`ARC`, Πόλις `PCH`/`CHR`, ΔΥΨΥ `DYP`/`MH`, ΠΦΥ `PFY`/`HC`.
- **eArchive** files a document by its own site code, a third string again: Λεμεσός `LGH`, Τρόοδος `KYP`, Μακάριος `NAM`, Πόλις `POL`, ΔΥΨΥ `MHS`, ΠΦΥ `PHC`. INTEGRATION-eFinance-eMAP-eCapital.md §6 recorded the table and planned a third column, `org_unit.dms_site_code`.

Three columns for one fact is three places for it to be wrong. A clerk reading `LGH` would have had to know which system's `LGH` it was — eFinance's Λεμεσός, or eArchive's Λεμεσός, which happen to agree, while eFinance's `MH` and eArchive's `MHS` do not.

Separately, and on the same day: **the Ambulance Service (Υπηρεσία Ασθενοφόρων) is no longer part of ΟΚΥπΥ.** The Capex Plan's four ambulance rows, the `ambulance` org unit and everything the seed hung off it describe capital works that belong to another body now.

## Decision

### 1. One code, and it is eArchive's

`org_unit.code` **and** `org_unit.entity_code` both carry eArchive's site abbreviation, for every unit. No third column is added; `dms_site_code` is not built.

| eCapital unit | old `code` | old `entity_code` (eFinance) | **code = entity_code, from now on** |
|---|---|---|---|
| Γενικό Νοσοκομείο Λευκωσίας | NGH | `NGH` | **`NGH`** |
| Γενικό Νοσοκομείο Λάρνακας | LAR | `LAR` | **`LAR`** |
| Γενικό Νοσοκομείο Πάφου | PAF | `PAP` | **`PAF`** |
| Γενικό Νοσοκομείο Λεμεσού | LMS | `LGH` | **`LGH`** |
| Νοσοκομείο Τροόδους | TRD | `TRD` | **`KYP`** |
| Νοσοκομείο Αρχιεπίσκοπος Μακάριος Γ΄ | NAM3 | `ARC` | **`NAM`** |
| Νοσοκομείο Πόλεως Χρυσοχούς | PCH | `CHR` | **`POL`** |
| Γενικό Νοσοκομείο Αμμοχώστου | FAM | `FAM` | **`FAM`** |
| Διεύθυνση Υπηρεσιών Ψυχικής Υγείας | DYP | `MH` | **`MHS`** |
| Πρωτοβάθμια Φροντίδα Υγείας | PFY | `HC` | **`PHC`** |
| Κεντρικά Γραφεία | HQ | `HQ` | **`HQ`** |

**Names do not change.** Νοσοκομείο Τροόδους keeps both its Greek and its English name and takes the code `KYP`, because Τρόοδος and Κυπερούντα are one hospital (errata, 18/09/2026) and eArchive files it under the Kyperounta abbreviation. A code is a key; the name is what people read.

**Unit ids do not change** — `nicosia-general`, `troodos`, `pfy` and the rest are what every foreign key in the schema points at, and renaming them would rewrite every row in the database to no purpose.

**eArchive's, not eFinance's, because the document is the artefact people hold.** A contract, a certificate and a drawing all end up in eArchive under its code, printed on the paper; eFinance's code appears in a ledger a clerk reads on a screen. Between two strings that both have to change on one side, the one already on paper is the one that stays.

### 2. The legacy eFinance codes are a lookup, not a column

`PAP`, `LGH`, `ARC`, `CHR`, `MH`, `HC` and `TRD` are **not** stored anywhere after migration `0012_unit_codes_earchive.sql`. They are kept here, and in INTEGRATION-eFinance-eMAP-eCapital.md §6, as a lookup table for anybody reading an older eFinance extract, **until eFinance aligns**:

| eArchive / eCapital code | legacy eFinance code |
|---|---|
| `PAF` | `PAP` |
| `LGH` | `LGH` (unchanged) |
| `KYP` | `TRD` |
| `NAM` | `ARC` |
| `POL` | `CHR` |
| `MHS` | `MH` |
| `PHC` | `HC` |
| `NGH`, `LAR`, `FAM`, `HQ` | unchanged |

This is deliberately a document and not a table. A mapping table in the database is a thing that has to be maintained, queried and eventually trusted; this one exists to be read twice and then thrown away when eFinance moves. **eFinance has been asked to align** — the same list of asks INTEGRATION §4 already carries.

`CNS` (Central Nursing Services; the Greek expansion in ADR-0019 and migration 0008 was a guess and is not confirmed) still has no eCapital unit and none is invented for it. Capital work for it files under `HQ` (owner decision 19/09/2026).

### 3. Project codes are re-prefixed; the counter is not

ADR-0014's code is `<unit code>-<year>-<seq>`, so six units' projects change prefix: `LMS-`→`LGH-`, `TRD-`→`KYP-`, `NAM3-`→`NAM-`, `PCH-`→`POL-`, `DYP-`→`MHS-`, `PFY-`→`PHC-`. **The year and the number do not move**: `PCH-2026-001` becomes `POL-2026-001` and is the same project.

`ecapital.project_code_seq` needs no migration. ADR-0014 keys it by `org_unit_id` and the year, and `allocate_project_code` reads the code off `org_unit` at the moment it hands out a number — so a unit that is renamed keeps its counter, and the next project it opens continues the same run of numbers under the new prefix. Nothing about this decision creates the gap an auditor would have to ask about.

**Contract references do not change.** `CAP-YYYY-NNNN` carries no unit code, which is exactly why ADR-0019 made that counter per year and not per unit.

### 4. The Ambulance Service is removed, not hidden

Migration `0012` deletes the `ambulance` unit and, before it, every row that points at it: its projects, their milestones, risks, issues and notes, the contracts on them with their variations, bills of quantities, RFIs, instructions and payment certificates, the budget lines, the cost transactions and warnings, the defects, the buildings, floors and areas, the user-to-unit rows, the role mappings, the alias and the code counter. If anything is still pointing at the unit after that list, the migration **refuses and names the table and the constraint** rather than deleting something it does not understand.

The seed no longer carries the unit, and the two projects it held (`PRJ-007`, `PRJ-037`) are gone with it. The other fixtures keep their `PRJ-nnn` names: those name a row, they never counted them, and renumbering would make every note that cites one point at a different project.

**The Excel importer rejects the spelling rather than resolving it.** `ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ` is listed in the import profile under `units_out_of_scope`, and a row on it fires a new blocking rule:

> **V15 — «Η μονάδα ανήκει στον ΟΚΥπΥ»** (ERROR, blocking). *Η μονάδα «…» δεν ανήκει στον ΟΚΥπΥ. Το έργο δεν εισάγεται στο μητρώο.*

V15 is a separate rule and not a case of V04 because the two give **opposite instructions**. V04 says a spelling was not recognised and tells the reader to add it as an alias of the unit it belongs to; following that advice here would put the Ambulance Service straight back into the register. The February file has four such rows and therefore cannot be committed until Technical Services take them out of the spreadsheet — which is the intended answer, the same one V06's six unreadable cells give.

### 5. What is deliberately left alone

- **The `AMBULANCE` value on the `directorate` enum stays.** Dropping a value from a PostgreSQL enum means recreating the type and every column that uses it, on a live database, to remove a value no row carries. Nothing in the interface lists a directorate that has no units in it — S01 groups by the directorates of the units it is showing — so the dormant value is invisible. If the enum is ever rebuilt for another reason, this is the moment to leave it out.
- **Cost centres.** `CC-LMS-01` and the rest are SAP's identifiers for a place, owned by the Οικονομική Διεύθυνση. This decision moved eCapital's codes, not finance's.
- **SAP WBS elements** on real projects. The seed's own `WBS-…` strings follow the new prefixes because they are obviously-fake fixture values; a WBS element that SAP actually issued is SAP's to change.
- **ADR-0019 itself**, which is accepted and stays as written. Its §1 table is superseded by §1 above; everything else in it — `contract.ref`, the lookup route, `GET /config/links`, HQ as a unit — is untouched.

## Consequences

- A record in any of the three systems joins to a record in either of the others on one string, with no lookup table and no third column. `org_unit.entity_code` remains the column a join uses, and it still says `entity_code` rather than being renamed, because the name is in the shared `OrgUnit` schema, in `GET /org-units` and in eFinance's notes.
- **Until eFinance aligns, an eFinance extract taken before today will not join.** Six of the eleven codes moved on our side. The table in §2 is what a person uses to read such an extract; nothing translates it automatically, because a silent translation is how an identifier becomes untrustworthy (ADR-0019's own opening argument).
- Every seeded project at six of the units has a new code. Any screenshot, note or email that cites `PCH-2026-001` now points at nothing; the project is `POL-2026-001`. This is a one-off cost of aligning, paid once.
- The register is eleven units again. Eight hospitals, two services and Κεντρικά Γραφεία.
- The capital works the Ambulance Service was running are no longer recorded anywhere in eCapital. If ΟΚΥπΥ needs them for a historical return, they are in the audit log's before-images and in the February spreadsheet, and that is where they should be looked for — not in a live register of what ΟΚΥπΥ is building.

## Addendum, 20/09/2026 — CNS gets a unit, and §2's lookup becomes a column

Two owner decisions, the day after this ADR was accepted, both correcting things this ADR (and yesterday's errata) got wrong. The text above is accepted and stays as written; this addendum does not rewrite it.

### A. CNS is «Κοινοτική Νοσηλευτική», and it is a unit

Yesterday's errata (`docs/briefs/README.md`) read: *"eFinance's `CNS` is Central Nursing Services (Greek name to be confirmed by the owner). It has no eCapital unit; capital work for it files under HQ (owner decision 19/09/2026)."* **Both halves were wrong.** `CNS` is «Κοινοτική Νοσηλευτική Υπηρεσία» — Community Nursing Service, not Central Nursing Services — and it gets a unit of its own, filing its papers under its own eArchive folder rather than HQ's.

- **`org_unit` row:** id `community-nursing`, `code` and `entity_code` both `CNS` (§1's rule applies to this unit exactly as it does to the other eleven: the code is eArchive's site abbreviation), type `SERVICE`, directorate `PFY`. No cost centre, no projects yet — the same starting point HQ had (ADR-0019 §5).
- **Directorate PFY — CONFIRMED by the owner, 20/09/2026.** It was recorded as an assumption when this addendum was written (nothing in any brief said which of the six directorates Community Nursing sits under; Primary Healthcare was the closest fit). The owner confirmed it the same day, together with the eArchive site code: eArchive's code for Κοινοτική Νοσηλευτική (Φ. ΤΥ.12) is `CNS`, so `org_unit.code` = `entity_code` = `CNS`, and the eArchive `hospital` field is that same code with nothing in between (`dms-meta.ts`), no special case. Migration 0018's header comment still calls PFY an assumption; migrations are checksummed and are not edited after they ship, so this line is the record.
- **Inserted by migration, not left to the seed script.** Unlike HQ (ADR-0019 §5, whose row has only ever come from `pnpm --filter @ecapital/api seed`), `community-nursing` is inserted directly by migration `0018_cns_unit_and_efinance_codes.sql`, `on conflict do nothing` — a server that never runs seed still has it, the same footing as a reference-table row (migration 0013's `budget_code` seed).
- **The Capex import alias** «ΚΟΙΝΟΤΙΚΗ ΝΟΣΗΛΕΥΤΙΚΗ» is carried by the seed's aliases list, for a future Capex Plan revision that might carry a row for it — the February 2026 file this deployment is tested against does not.
- **The register is twelve units again:** eight hospitals, two services, Κεντρικά Γραφεία and Κοινοτική Νοσηλευτική. Every count this ADR and its errata fixed at eleven — `apps/web/e2e/m0.spec.ts`, the web mocks, the seed, the API's own unit-count tests — moves to twelve with it.
- **`docs/INTEGRATION-eFinance-eMAP-eCapital.md` §2 and §6** are updated in place (not as an addendum there — those sections are living reference tables, not a decision record) to carry CNS as a full row rather than the one code with no eCapital unit.

### B. §2's lookup becomes a permanent column — the two-code model

§2 above kept the six eFinance codes eCapital's own code moved away from (`PAP`, `LGH` unchanged, `TRD`, `ARC`, `CHR`, `MH`, `HC`) as a document, not a database column, "until eFinance aligns". **eFinance has since said it will not align.** Those strings are foreign keys across twelve of eFinance's own tables and in SAP; renaming them is not a change eFinance can make. The lookup becomes a column instead.

- **`org_unit.efinance_code`** (nullable, unique text), added by the same migration as CNS. Mapped from the eArchive code (`= code = entity_code`): `NGH`→`NGH`, `LAR`→`LAR`, `PAF`→`PAP`, `LGH`→`LGH`, `KYP`→`TRD`, `NAM`→`ARC`, `POL`→`CHR`, `FAM`→`FAM`, `MHS`→`MH`, `PHC`→`HC`, `HQ`→`HQ`, `CNS`→`CNS`.
- **`entity_code` does not move again.** It keeps meaning exactly what §1 made it mean — eArchive's abbreviation, eCapital's own key — and `efinance_code` sits beside it rather than replacing it a second time. This is the **permanent two-code model**: eCapital's own key on one column, eFinance's own key on the other, neither derived from the other except where they happen to agree.
- **Full detail, including the PUT contract's use of it, is in ADR-0022's own addendum** — this is the entity-code half of one decision; ADR-0022 carries the eFinance-contract half.
- **`docs/INTEGRATION-eFinance-eMAP-eCapital.md` §2** replaces "until eFinance aligns" with this permanent model and a table of both codes side by side, rather than eArchive's code with a legacy-lookup footnote.
- **What does not change:** `EFinanceBudgetCodeReader` — a budget code carries no entity, so there is nothing on that reader for this decision to touch. The future SAP actuals / spent-ledger reader (§5 of the integration doc, still unbuilt) is the first thing that will need `efinance_code`, translated through the one new helper this decision adds, `OrgUnitsService.efinanceCodeFor(orgUnitId)` — nowhere else in the codebase should read the column directly.
