# ADR-0019 — Entity codes, `CAP-` contract references, and links to eMAP and eFinance

**Status:** accepted · 19/09/2026

## Context

eCapital is being fitted to a server estate that already has two systems on it. eMAP runs procurement — tenders `TND-`, requests `REQ-`, contracts `CON-YYYY-NNNN`, purchase orders `PO-YYYY-NNNN`. eFinance runs invoices and budget, and its invoice screen already carries a link to `{emap_url}/contracts?q=<contract_ref>`.

Both of them describe money along the same two axes, and so does SAP: an **entity code** (eFinance's `hospital_code`, SAP's Fund Center) and a **budget code** (SAP's Commitment Item). INTEGRATION-eMAP §2 is blunt about the first: *send codes, never names* — `NGH`, not `Γενικό Νοσοκομείο Λευκωσίας`, because names are display text and get edited while codes are the key.

eCapital has neither. Its org units carry their own `code` (`NGH`, `LAR`, `PAF`, `LMS`, `NAM3`, `PCH`, …) which is *nearly* eFinance's and not quite; and a contract here carries only `contract_no`, the number somebody typed off the tender papers, which is free text and per-unit unique at best. eFinance's own notes (§4) describe exactly what happens to an identifier that is re-keyed by hand at each hop: six invoices, six incompatible `po_number` formats, and a three-way match that became impossible.

## Decision

### 1. `org_unit.entity_code` — the eFinance code, stored, never derived

A nullable, unique text column holding the eFinance entity code, exposed as `entityCode` on the shared `OrgUnit` schema and on `GET /org-units`.

It is a second column and not a rename of `code` because the two genuinely differ, and the differences are exactly the ones that would be silently wrong if anybody assumed they were the same: Πάφος is `PAF` here and `PAP` there, Λεμεσός `LMS` and `LGH`, Μακάριος `NAM3` and `ARC`, Πόλις `PCH` and `CHR`, ΔΥΨΥ `DYP` and `MH`.

The eleven seeded units:

| eCapital unit | eCapital `code` | eFinance `entity_code` |
|---|---|---|
| Γενικό Νοσοκομείο Λευκωσίας | NGH | `NGH` |
| Γενικό Νοσοκομείο Λάρνακας | LAR | `LAR` |
| Γενικό Νοσοκομείο Πάφου | PAF | `PAP` |
| Γενικό Νοσοκομείο Λεμεσού | LMS | `LGH` |
| Νοσοκομείο Τροόδους | TRD | `TRD` |
| Νοσοκομείο Αρχιεπίσκοπος Μακάριος Γ΄ | NAM3 | `ARC` |
| Νοσοκομείο Πόλεως Χρυσοχούς | PCH | `CHR` |
| Γενικό Νοσοκομείο Αμμοχώστου | FAM | `FAM` |
| Διεύθυνση Υπηρεσιών Ψυχικής Υγείας | DYP | `MH` |
| Πρωτοβάθμια Φροντίδα Υγείας | PFY | `HC` |
| Υπηρεσία Ασθενοφόρων | AMB | `AMB` |

**FLAG — an assumption, not a fact.** ΠΦΥ (Πρωτοβάθμια Φροντίδα Υγείας) is mapped to eFinance's `HC` (Κέντρα Υγείας). The two names describe the same service from two directions — the directorate, and the health centres it runs — and no other eFinance code is a plausible home for it. But nobody has said so in writing, and if the two are not the same thing then every figure eCapital sends for ΠΦΥ lands in the wrong Fund Center. **The owner has to confirm this before anything is sent to eFinance.**

**Two eFinance codes have no eCapital unit and are deliberately left unmapped:** `HQ` (Κεντρικά Γραφεία) and `CNS` (Κοινοτική Νοσηλευτική Υπηρεσία). Inventing units for them would put two fictional hospitals in the capital register, which is worse than a gap that is visible. If capital work is ever raised against either, the unit is opened properly and the code is filled in then.

The column is nullable for the same reason in reverse: a unit opened here before finance gives it a code simply has none, and the API says `null` rather than guessing.

The Excel importer's `org_unit_alias` table is untouched. It maps the *spellings* column D of the capex workbook uses, which is a different problem from this one.

### 2. `contract.ref` — `CAP-<YEAR>-<NNNN>`, allocated by the API, immutable

Every contract now carries a reference eCapital owns, allocated inside the create transaction by `ecapital.allocate_contract_ref(year)` — a per-year counter behind a transaction-scoped advisory lock, the same machinery and the same reasoning as ADR-0014's project code. The counter table has no grant and no policy for the application role; the only way to move it is through the function, which only ever hands out the next number.

Two differences from the project code, both deliberate:

- **The counter is per year, not per unit,** and the reference carries no unit in it. A project code is read by people inside one hospital; this one is read by eFinance, which holds contracts from every unit in one list, so it has to be unique across the organisation.
- **The year is the award year,** so a contract awarded in December 2026 and recorded in January still reads `CAP-2026-…`, which is what the papers say.

`contract_no` does not change and is not replaced: it stays the legal or tender number a person typed, exactly as typed. The two are different facts and neither substitutes for the other.

The reference is immutable, enforced by a trigger as well as by leaving it out of `ContractUpdate`. It is printed on paper, it is what eFinance stores against an invoice, and a reference that can be edited is a reference that eventually points at a different contract.

### 3. `GET /contracts/lookup?q=` and `/contracts?q=` — eFinance's way in

eFinance stores a `contract_ref` on an invoice and routes it **by prefix**: `CON-` opens eMAP, `CAP-` opens eCapital. Both systems answer the same shape of request, `/contracts?q=<ref>`, so a finance clerk's link works without either system knowing anything about the other's ids, and without eFinance holding a mapping table that would go stale.

`GET /contracts/lookup?q=` resolves `q` against `ref` and `contract_no` — exactly first, then folded through `ecapital.normalise` so that a number typed with different capitals or accents still finds its row — and answers `{id}` or 404. It is RLS-scoped: a contract in a unit the caller may not see answers the same 404 an unknown reference gets, never a 403 (ADR-0010).

The web route `/contracts` resolves `q` **on the server** and redirects, so nobody sees a list flash past on the way to the contract they asked for. Without a `q`, and when a `q` matches nothing, it lists the caller's own contracts — backed by a new `GET /contracts` with `unit` and `q` filters — so a link that has gone stale lands somewhere useful instead of on an error.

### 4. `GET /config/links` — where the sibling systems are

`EMAP_URL` and `EFINANCE_URL` are optional API configuration, served to any signed-in caller. S07 then offers:

- **«Άνοιγμα στο eMAP»** → `{EMAP_URL}/contracts?q=<emapRef>`, and only when the contract actually carries an eMAP reference: the new nullable `contract.emap_ref` (`CON-YYYY-NNNN`, validated by regular expression in the form, in the API and as a CHECK constraint), or a `contract_no` that is already one.
- **«Τιμολόγια στο eFinance»** → `{EFINANCE_URL}/invoices?contract_ref=<ref>`, and only when `EFINANCE_URL` is set.

Both open in a new tab with `rel="noopener"`: the other system must not be handed a window handle back into this one.

**Neither link is ever guessed.** With no base URL there is no link. A link to a host we invented is worse than no link — it teaches people the button is broken, and they stop pressing the ones that work.

**A request to the eFinance team, recorded here so it is not lost:** eFinance does not support `/invoices?contract_ref=` today. eCapital sends it anyway (a query string is harmless where it is not read) and there is a `TODO` on the line, but until eFinance reads that parameter the link opens the invoice list and the clerk searches by hand. This is the mirror image of INTEGRATION-eMAP §8's own asks of eMAP, and it should go on the same list: **please make `/invoices?contract_ref=<ref>` filter, and tell us if the route changes.**

## Consequences

- eFinance can point an invoice at an eCapital contract with a one-line settings change, and the two systems stay independent.
- Every contract gets a reference whether or not anybody uses it yet. The cost is one counter table and four characters; the cost of adding it later would be back-filling references onto contracts already printed and filed.
- `entity_code` is stored and never derived, so if eFinance renames a hospital nothing here breaks, and if eFinance adds an entity somebody fills in a row.
- Two flags remain open and both belong to the owner, not to this repository: whether ΠΦΥ is `HC`, and whether `HQ` and `CNS` will ever need eCapital units.
