# ADR-0028 — The asset register is lean on purpose, and it is what permits read

**Status:** accepted · 20/09/2026

## Context

M4 is the asset register: R26 (hierarchy, criticality, condition, warranty),
R27 (linked to the source project, contract and capital cost), R28 (O&M
documents, certificates and the commissioning pack), R29 (QR labels and
scan-to-asset), R30 (whole-life cost and replacement forecast) and R45
(biomedical equipment in the same register as the building assets). The
definition of done is one sentence: **a technician scans a QR label and sees
the full history.**

Three things shaped every decision below.

1. **The owner steered the scope on 20/09/2026** (`docs/briefs/README.md`
   Errata): the system goes live as a plain capital-and-maintenance register
   and expands later. The brief offers more than that in places — CAPEX-01 §2
   has whole-life cost «falling out for free», §8 has meter readings feeding
   the offline app, Maximo's row has criticality driving spares. The steer is
   to build the register the contract describes and nothing beyond it.
2. **CAPEX-01 §2 says the asset, not the project, is the permanent record.**
   A project is an event in an asset's life. That is not a slogan here; it
   decides what happens when a project is deleted, what the history is
   assembled from, and why the tag cannot move.
3. **§6.1 has been waiting for this.** «Pulling a riser feeds theatres two
   floors up — model that with `serves_area_ids` on the asset.» ADR-0026 built
   `system_feed` as a seam until the register existed, and said in as many
   words that when M4 landed the query behind `GET /areas/impact` would
   change and nothing above it would.

## Decision

### 1. The scope is the contract, and the contract is the whole of it

`packages/shared/src/asset.ts` is the register: identity, place, class,
criticality, condition, warranty, what project and contract it came from,
what it cost, when it is due for replacement, its papers as eArchive protocol
numbers, and a QR label. Migration `0017_m4_assets.sql` is that list and
nothing else.

**Deliberately not built**, each because the owner steer says «when a hospital
asks for it»:

- **No depreciation model.** No book value, no method, no useful-life
  schedule, no revaluation. `wholeLife` is what the row already knows — the
  capital cost, the replacement estimate, the replacement year, the age and
  what is left of the expected life. Depreciation is an accounting policy,
  and eCapital has not been given one.
- **No spares, stores or consumables.** Maximo's row in CAPEX-01 §2 has
  criticality driving spares holdings. Criticality is here; the spares model
  is not, and would need a stores system eCapital does not have.
- **No meter analytics.** `asset_reading` is one row — a time, a free-text
  type, a number and a unit. No rollups, no trends, no thresholds, no alerts.
  M5's work orders are what a reading is supposed to raise, and building the
  analytics before the thing they trigger would be building the wrong half.
- **`maintenanceToDate` is null, not zero.** There are no work orders to add
  up until M5. Zero would read as «nothing has been spent on it», which is a
  different and false statement.
- **No note on a condition assessment.** `POST /assets/:id/condition` accepts
  `noteEl` and does not store it: there is no note column in the lean register
  and inventing one is exactly what the steer forbids. The field is accepted
  so the mobile form can carry it today and lose nothing when M5's work order
  gives it somewhere to live.
- **WORK_ORDER and DEFECT are on `AssetHistoryEntry.kind` and are never
  produced.** The history returns what exists.

### 2. The tag is `<UNITCODE>-<CLASS>-<NNNN>` and it never changes

`NGH-MGS-0001` is Nicosia General's first medical-gas asset.
`ecapital.allocate_asset_tag(org_unit_id, asset_class)` issues it with
ADR-0014's machinery for the fourth time: a counter row per unit **and
class**, a transaction-scoped advisory lock so two engineers pressing
«create» in the same second do not read the same number, `SECURITY DEFINER`
so the counter is not readable by anybody, and a counter row rather than a
sequence so a create that rolls back does not burn a number.

The class code is three letters — `BLD HVA ELE MGS WAT FIR LFT BIO ITE OTH` —
because the label is small and a technician reads it out over the telephone.
The mapping is fixed forever by the fact that a tag never changes: if the
codes moved, every sticker already on a machine would be wrong.

Four digits. A hospital with ten thousand chillers has a different problem.

**Immutable, and enforced three times**: `AssetWrite` has no `tag`, no route
takes one, and a trigger refuses an `update` of the column with
`restrict_violation`. The unit and the class cannot move either (422
`errors.assetUnitFixed`, `errors.assetClassFixed`) because both are inside the
tag. An asset that really did move hospital is a disposal here and a new asset
there — which is also the truth about what happened.

### 3. The hierarchy is one level deep in practice and safe at any depth

`parent_asset_id`: AHU → fan, chiller → pump, which is all anybody has asked
for. The column allows more, so a trigger refuses the one shape that would
hang a reader — a cycle — and the detail answers with `parentTag` and the
immediate `children`, not a tree. A deleted parent leaves its children
standing with a null parent, because the asset is the permanent record.

### 4. `serves_area_ids` replaces `system_feed`, per system, over time

`GET /areas/impact` now asks the register first:

- For each system the request names, if the unit has **any** asset carrying
  that system with a non-empty `serves_area_ids` and a status other than
  DISPOSED, those assets answer for that system and no feed is consulted for
  it.
- For every other system, the `system_feed` rows answer exactly as they did
  before M4.

**Per system and not per unit**, because a hospital half-way through its
survey has the medical gas in the register and the HVAC risers not, and both
answers have to be right on the same morning. The seed is arranged that way
on purpose, and the tests exercise both paths.

**An asset fires on the system alone**, wherever it happens to stand. A feed
needed `source_area_id` as a proxy for «is this riser in the work zone»
because it described a system rather than a thing; the asset **is** the thing,
and taking its system down in its unit interrupts what it serves whichever
room the work is in. For a plant-room asset this warns more often than the
feed did, which is the right way round for medical gas — ADR-0026's own
reasoning about `REDUNDANT_HALVES`.

Nothing above the route changed. `system_feed` is not deprecated and no
migration moves its rows: a feed is how a unit with no register answers, and
it stops being consulted for a system the moment an asset carries it. That is
the migration, and it is performed one asset at a time by the person who knows
what the riser feeds.

### 5. Who may do what, and the one field a technician owns

Read by whoever may read the unit, the auditor and the executive included.
Written by `admin`, `estates_head` and `project_engineer` —
`ecapital.can_manage_asset`, the same three who run the project register,
because the asset register is the estate's own record.

**The technician has the condition and the readings and nothing else.**
CAPEX-01 §8 puts «meter and condition readings» among the five offline
surfaces, and the person in the plant room holding the telephone is the
technician. A reading is its own table and its own policy, so that is easy.
The condition is a column on `asset`, and a row policy cannot be narrowed to a
column — so `POST /assets/:id/condition` writes through
`ecapital.record_asset_condition`, `SECURITY DEFINER`, which carries the
permission rule itself and moves the band and its date and nothing else. The
audit trigger still records the caller, because `app.user_id` is the request's
and not the function's.

The counter table has row-level security on and **no policy at all**, as the
other three counters do: the application role cannot read it, move it, or do
anything with it except ask for the next tag.

An asset's own audit trail opens to whoever may read its unit
(`audit_log_read_assets`), because the history is assembled from it and the
history is the definition of done. `GET /audit-log` stays the administrator's
and the auditor's, as it has since ADR-0014.

### 6. The papers go through the eArchive outbox that already exists

`POST /assets/:id/documents` calls `DocumentsService.fileAssetDocument`. The
`document` row, the `dms_outbox` item and the `asset_document` link are
written in one transaction — ADR-0023's first decision, reached through the
same service rather than a second implementation of it.

- `source_module: "asset_document"`, a sixth value on the queue's list.
- `source_ref: "asset_doc:<asset_id>:<n>"`, the nth paper on this asset. The
  `:vN` suffix the other three carry is not used: a manual is not a correction
  of a certificate, so the running number is what makes the reference unique.
  A corrected manual is the next n, with a SUPERSEDES relation — the same rule
  stated a different way.
- **Category**: «Συμβάσεις» for COMMISSIONING, CERT and WARRANTY, which come
  out of a contract; «Διοίκηση» for OM_MANUAL, DRAWING and PHOTO, which are
  the estate's own papers.
- **Folder hint** is the unit's code, which since ADR-0024 *is* eArchive's
  site code, with nothing in between.
- The MIME whitelist, the 50 MB limit and the strict `meta` schema are
  eArchive's and are enforced at the upload, unchanged.

`document.kind` gains `ASSET_DOCUMENT` so a commissioning pack is not filed as
«OTHER». The six kinds a technician filters the asset's folder by stay on
`asset_document.kind`, where they belong.

### 7. The history is assembled, not stored

`AssetDetail.history` is built on read from six sources: the asset's own audit
rows (CREATED, UPDATED, and CONDITION where the band moved), the readings, the
papers, the source project, the source contract, and every permit touching a
room the asset occupies or serves. Newest first, `summaryEl` in Greek, an
`href` to the record on every line, a tie broken by the kind so two rows with
the same timestamp do not reshuffle between reads.

It is assembled rather than stored because a stored history is a second copy
of facts that already exist, and a second copy goes stale. The trail is the
audit log, which is append-only and which R42 already guarantees.

The ceiling is two hundred audit lines, the same one the permit trail uses.

### 8. The priority rank is a function, not a position

`AssetListRow.priorityRank` is computed from criticality and condition alone —
criticality first, worst condition first within it, an unknown condition
behind the five known bands of its criticality, 1 to 29. The contract says
«the rank is server-side so every list agrees», and a rank that depended on the
page would make the register and S21 disagree about the same chiller.

A DISPOSED asset has no rank. It has left the estate, and dead plant at the
top of a worklist is how a worklist stops being read.

### 9. `serves_area_ids` is `text[]`, and every element is checked

CAPEX-01 §4 spells it `serves_area_ids[]` and the build brief says `text[]`, so
it is `text[]` and not `uuid[]` — which `system_feed` used. An array cannot
carry a foreign key either way, and the real risk of the text form is a string
that is not a uuid breaking the impact query for a whole unit the first time
it is cast. So a CHECK constraint, through an immutable helper, refuses one at
the write. The service checks that every room named is in the asset's own unit
on top of that.

### 10. `defect.asset_id` becomes what §4 always said it was

Migration 0006 created it as `text` and unreferenced, with a comment saying
«until the table exists». It exists, so 0017 types it `uuid` and points it at
`asset`. Nothing had ever written it, so there was nothing to convert.
`AssetDetail.openDefects` counts the open **handover** defects on the asset —
what a contractor still owes; the inspection and work-order backlog is M5's
view.

## Consequences

- **The tag is a promise.** The class-code mapping and the four digits cannot
  change without relabelling the estate, so both are settled here rather than
  in a helper somebody edits later.
- **`system_feed` stays.** Two ways of answering the same question live side
  by side, deliberately, for as long as the survey takes. The rule for which
  one answers is one line and is tested from both sides.
- **An asset warns more often than its feed did**, for a plant-room asset.
  That is a change in behaviour for Nicosia's medical gas the day the register
  is filled in, and it is the change §6.1 asked for.
- **The history costs six queries per read.** It is the scan route's answer
  and a technician's phone makes it once, standing in front of the machine.
  If it ever needs to be a list endpoint, it needs paging, not caching.
- **The condition's `noteEl` is dropped silently.** The route accepts it, the
  register does not keep it, and this paragraph is the only place that says
  so. When M5 lands, the note belongs on the work order and the field stops
  being a lie.
- **Nothing here has been tested against a printed label.** The QR payload is
  a URL and the web app owns `/a/<tag>`; the first sheet somebody prints and
  scans is a thing to watch.
- **If the owner asks for depreciation, spares or meter analytics**, each is a
  new ADR and a new migration. None of them is a change to what is here; they
  are additions this deliberately left room for.
