# ADR-0026 — Shutdown permits: a versioned ICRA matrix, a route derived from the rooms, and a clock that never blocks

**Status:** accepted · 19/09/2026 · builds on [ADR-0010](ADR-0010-row-level-security-by-org-unit.md) (row-level security), [ADR-0011](ADR-0011-audit-log-by-trigger.md) (the audit trigger), [ADR-0014](ADR-0014-project-codes-and-the-phase-rule.md) (counters behind an advisory lock), [ADR-0017](ADR-0017-site-logs-rfi-instruction-defect.md) (the SLA is a state, not a gate), [ADR-0019](ADR-0019-entity-codes-and-contract-references.md) (references the system owns), [ADR-0020](ADR-0020-roles-per-user-not-per-ad-group.md) (roles are per user), [ADR-0021](ADR-0021-cost-ledgers-and-sap-ingestion.md) (`email_outbox`) and [ADR-0023](ADR-0023-earchive-outbox.md) (a scheduled job talks to the database through SECURITY DEFINER functions).

## Context

M3 is R19–R25 and CAPEX-01 §6, and §5's table calls it «the differentiator, get it right». It is also the first module in this system where a bug hurts a patient rather than a budget: a permit that routes past Infection Control, a Class III permit drawn as Class II, or a theatre that nobody told is a clinical incident, not a reporting error.

Three things about the brief shaped every decision below.

1. **The rules are already written, and they are not ours.** ASHE ICRA 2.0 (2022) is the standard, §2 quotes two of its cells by name, and §6.2 says ΟΚΥπΥ Infection Control «approves the local edition and can amend it without a release». So the matrix is data with a version on it, not a table in code.
2. **The brief is specific about the shape and silent about five details.** Who signs when ILSM fires, what the Director's threshold is, how long an approver has, what a ward manager is called, and how the system knows what a riser feeds. Each is listed under *Assumptions* below, and each is resolved the stricter way: more approvers, never fewer; refuse rather than allow.
3. **Nothing in §6 blocks except the two things that should.** A clash warns. A breach warns. A permit outside its window does not open, an unfinished checklist does not close, and an open permit stops a milestone — those three are the gates, and they are the only ones.

## Decision

### 1. The ICRA matrix is versioned reference data; a cell is never edited

`icra_matrix_version` (id, based_on, effective_from, status, notes_el) and `icra_matrix_cell` (activity type × risk group → class, plus the controls as `jsonb`). A unique partial index allows exactly one `ACTIVE` edition, so «the matrix» is a question with one answer.

`POST /icra/matrix/versions` publishes a new edition as `DRAFT` with all sixteen of its cells; `POST /icra/matrix/versions/:id/activate` makes it `ACTIVE`, retires the one before it in the same transaction, and stamps `approved_at` — activation *is* the approval, because that is the moment somebody takes responsibility. A `RETIRED` edition never comes back: reinstating one is publishing it again under a new id, so the audit trail says who decided to.

Every evaluation records `matrixVersionId`, and the permit stores the whole `IcraResult`. A permit signed in March still reads in November as the thing that was signed, whatever Infection Control publishes in between.

Who may publish: `admin`, or a `clinical_approver` who holds the `INFECTION_CONTROL` capacity. Said twice — a role guard on the route and `ecapital.can_manage_icra_matrix()` in the row policy. Reading needs no role at all: the wizard shows the cell and the controls to whoever is filling it in.

### 2. The engine is pure, and the two hard rules live in two different places

`src/icra/icra-engine.ts` takes a matrix and a set of areas and answers. No database, no clock, no request — so every sentence of §6.2 is a unit test.

- **The risk group is the highest of every area involved**, direct and indirect alike (§6.1: an indirect area «counts for routing and for the ICRA risk group exactly like a direct one»), plus the surrounding assessment. `riskGroupFromAreaId` names the area that set it, so the screen can say why.
- **The class comes from the ACTIVE matrix.** «Type C in a high-risk area is Class IV, not III» is therefore **not a rule of the engine**. It is a cell, in `src/db/seed-data.ts`, checked cell by cell in `icra-engine.test.ts`.
- **Class III and above needs a printed permit** — `permitRequired` is an index comparison on the class ladder.
- **Class II is invalid for construction and renovation**, and that one *is* a rule of the engine, because it depends on the kind of work and the matrix does not know that. The engine answers with the cell it found plus `refusalKey`; `POST /permits/:id/icra` turns that key into a 422 rather than storing it.

`POST /icra/evaluate` runs the engine and stores nothing. Risk bands are always read from `area`, never taken from the body: a caller who could type its own risk group could type its way out of a Class IV.

### 3. Indirect impact is a `system_feed` row until M4 brings the asset register

§6.1 asks the system to know that pulling a riser feeds theatres two floors up, and points at `asset.serves_area_ids` — which is M4 and this is M3. `system_feed` carries the same fact in the meantime: this system, from this source area (or from nowhere in particular, meaning the whole unit, like the main LV board), serves these areas.

`GET /areas/impact` answers a `DIRECT` row per picked area and an `INDIRECT` row for everything a matching feed serves, deduped with DIRECT winning. The permit stores the answer, because a permit is a decision about a set of rooms and that set has to be the one people signed, not one recomputed after somebody edited a feed.

**This is a seam, not a second model.** When M4 lands, the query behind `GET /areas/impact` changes and nothing above it does.

### 4. The route is derived from the rooms, and every line has to be decided

`routeFor()` is a pure function of the class, the areas, whether ILSM fired and how long the window is. §6.4 gives five of the six lines; the sixth is an assumption (below).

A line nobody could be resolved for stays unassigned and `PENDING`, which **blocks the permit**. That is the strict reading and the right one: a route with a signature missing is not an approved permit. An administrator can decide such a line, and is recorded as the person who decided it.

Decisions: every line `APPROVED` → the permit is `APPROVED` and stamped; any line `RETURNED` → back to `DRAFT` with that comment kept and every other line reset, because their answers were about the old request; any line `REJECTED` → `REJECTED`, which is final. Re-submitting rebuilds the route from scratch — the areas or the class may have moved — and keeps the reference, which has already been printed.

**Segregation of duties on the route, 19/09/2026.** A permit-detail screenshot showed the requester resolved as her own TECHNICAL approver, with live decide buttons on her own permit — Larnaca's sole TECHNICAL appointment is the same engineer who raises most of Larnaca's shutdowns, so `resolveApprover`'s ordinary fallback landed on her. ADR-0015 already says a variation is never approved by the person who raised it; `resolveApprover` now applies the same rule to routing. When the approver it would otherwise pick — by area, unit-wide, or the area-owner fallback — is the requester, it looks for another holder of the same role anywhere in the unit (`anotherHolderInUnit`, unit-wide appointments first) before falling back to unassigned-and-PENDING, and never hands the line to the requester. `decide()` says the same thing a second way, 409 `errors.permitSelfApproval`, checked before the admin bypass and for whoever the caller is: an administrator who is also the requester cannot clear their own unassigned line either, because a line an administrator could decide on the requester's own behalf would make the routing guard pointless.

### 5. `PTW-<UNITCODE>-<YYYY>-<NNN>`, allocated on submission

ADR-0014's machinery, a third time: a counter per unit per year, a transaction-scoped advisory lock, `SECURITY DEFINER`, no grant and no policy for the application role. Allocated on `SUBMITTED` and not on draft — a draft nobody ever sends should not burn a number — and immutable afterwards, enforced by a trigger as well as by leaving it out of every write schema.

### 6. The window, the closeout and the breach

- **ACTIVE** only from `APPROVED` and only inside `[plannedStart, plannedEnd]`, inclusive at both ends. Outside it the answer is 422: a permit that can be started three days late is a permit the clinical approvers did not agree to.
- **CLOSED** (§6.6) only from `ACTIVE` or `BREACH`, with every checklist box true. The clinical acceptance is **stamped from the caller**, never read out of the body, and the caller must hold `WARD_MANAGER`, `NURSING` or `INFECTION_CONTROL` over one of the affected areas — or `NURSING`/`INFECTION_CONTROL` for the unit, which are hospital-wide capacities. Anybody else is refused, the engineer who raised it included.
- **BREACH** is the clock's, not a caller's. A job runs every minute (`@nestjs/schedule`, the same interval the eArchive sender uses), flips `ACTIVE` permits past `plannedEnd`, stamps `breachedAt` once, and writes `email_outbox` rows to the unit's heads of estates and to the clinical owner of every affected area. It runs outside a request, so it reaches the table only through `ecapital.flip_overrun_permits` and `ecapital.permit_breach_recipients`, both `SECURITY DEFINER` — ADR-0023's shape. It sets `app.user_id` to `scheduler:breach` first, so R42 has no gap where the server acted on its own.

### 7. Clash detection is a warning, and the redundant-halves case is a seam

§6.7 names two cases; there are three kinds here, reported worst first, at most one per other permit:

| kind | what it means |
|---|---|
| `SAME_AREA_OVERLAP` | the same room closed twice over. The second crew finds the first one's barrier up. |
| `TWO_THEATRES` | §6.7 by name: two permits touching theatres in one hospital at once. |
| `REDUNDANT_HALVES` | two permits on the same system in the same unit at once. |

Whether two feeds are the A and B halves of one system is an asset-register fact (M4). Until then `REDUNDANT_HALVES` is the set every real redundant-halves clash is inside — it warns more often than it eventually will, which is the right way round for a warning about medical gas.

Clashes are found at submission, stored on the record, and emailed to the head of estates through `ecapital.queue_email` (ADR-0021). **Never blocking.** The calendar reads the stored clashes rather than recomputing them, so the chip on the grid and the warning on the record say the same thing.

### 8. An open permit blocks a project milestone (R24)

`PATCH /projects/:id/milestones/:mid` answers **409** with `errors.openPermitBlocksMilestone`, naming the permit, when the actual date arrives on a milestone whose project has a permit in `SUBMITTED`, `CLINICAL_REVIEW`, `APPROVED`, `ACTIVE` or `BREACH`. It fires on the moment the date arrives and not on every save, so renaming an already-completed milestone is not refused by a permit raised afterwards. 409 and not 422: the body is right, and the state of the world is what makes it wrong.

### 9. Access: §9 is a row policy, and the write policies are per command

`clinical_approver` — and only a caller whose *sole* unit role is that — reads a permit when a line on it is assigned to them or when it touches an area they own (`area_clinical_owner`). Everyone else reads by unit, and the auditor and the executive read everything and write nothing, as everywhere.

**The trap worth naming:** a permissive `FOR ALL` policy's `USING` clause is also consulted on `SELECT`, and policies are OR'd. A write rule written as «is this permit yours to act on» would therefore have quietly widened §9's read rule back out to the whole unit for every approver holding a unit-wide capacity — which the first run of `permit-access.test.ts` caught. The three permit tables carry separate `INSERT`, `UPDATE` and `DELETE` policies for that reason, and the read rule is the only thing that decides what a clinical approver can see.

Approver scoping lives in two tables, following ADR-0020 rather than CAPEX-01 §4's `area.clinical_owner_group_id`, which is an Entra group in a system that stopped using them:

- `area_clinical_owner (area_id, user_id, approval_role)` — who answers for one room;
- `unit_approver (org_unit_id, user_id, approval_role)` — who answers for the hospital.

### 10. The inbox (S14)

`GET /inbox` is personal: the permit approval lines waiting on the caller (`SHUTDOWN`, `decidable: true`, exactly three facts — class and system, window, rooms), plus the `SUBMITTED` variations they could decide and the payment certificates whose next step is theirs. Those two are `decidable: false` and link out, because their decisions have screens with figures on them that a three-fact card cannot carry honestly — and both carry their own segregation rule (R10, R11), so nobody's own work waits on them. `inbox_read (user_id, item_id)` tracks unread per person and gates nothing.

### 11. Reconciled with the web side, 19/09/2026

The two halves of M3 were built in parallel and met at the merge. Six things moved, and all six moved on the API side:

- **`PermitListRow.projectId`.** S03's «Ανοικτές άδειες» card filters on it rather than fetching every permit's detail. Added to the list query.
- **`GET` / `PUT /admin/users/:id/approver-scopes`**, administrator only, replacing the account's rows in `area_clinical_owner` and `unit_approver` in one transaction. `ApproverScopes` narrows the roles by where they apply — `WARD_MANAGER` is never unit-wide, `HOSPITAL_DIRECTOR` is never one room's — so a scope that does not fit is a 400 before it reaches the tables. **Scopes are refused on an account that does not hold `clinical_approver`**: a scope without the role routes a permit to somebody who cannot decide it, which is a permit that waits forever.
- **A partial create.** S11 autosaves: `POST /permits` happens when the requester leaves step 1, with no areas and no window yet. `ShutdownPermitDraft` makes `affectedAreaIds`, `plannedStart` and `plannedEnd` optional, `ShutdownPermit.affectedAreas` loses its `.min(1)`, and the completeness rules move to the SUBMITTED transition where they belong — `errors.permitNoAreas` and `errors.permitWindowRequired`. The window keeps two non-null timestamps and a `window_provisional` flag (migration 0016) rather than becoming nullable, so `ShutdownPermit.plannedStart` stays a string the screen can format. The unit of an area-less draft comes from the project, then the contract, then the caller's own single unit, and is refused as ambiguous otherwise: guessing which hospital a shutdown is in is not a guess to make.
- **`PATCH /permits/:id` uses `sentKeysOnly`.** Without it the contract's own `affectedAreaIds: []` default would arrive on every autosave and unpick every area the wizard had chosen. A PATCH touches what it names.
- **`messageKey` is `permitClash.<KIND>`**, rendered with `{ ref }`. Both catalogues carry the three keys. `refusalKey` stays the bare enum value `classTwoInvalidForWorks`; the web prefixes `icraRefusal.` itself.
- **`GET /permits/:id/audit`**, in the shape `GET /projects/:id` already carries its own trail in. S13's timeline is derived from the lifecycle fields today; this is what it moves to when it wants who and when as well as what. The `scheduler:breach` actor shows as itself, because a flip nobody asked for still has a name on it.

Unchanged and confirmed: the inbox sends the approval-line id as `InboxItem.id` and `/permits/<permitId>` as `href`, so the web decides through `POST /permits/:id/approvals/:approvalId/decide` with no route of its own; and `dueAt` and `slaState` are always present, on the two-working-day clock this ADR sets, so nothing downstream has to assume 48 hours.

## Assumptions

Each is the stricter reading, each is an owner question, and each is an Errata bullet.

1. **`PTW-` as the reference prefix.** Nothing in the briefs names one. «Permit to work» is what the paper form is called.
2. **`WARD_MANAGER` as an approval role.** §6.4 asks for «ward/department manager for every clinical area touched»; CAPEX-01 §4's `permit_approval.role` has no such value, so the enum gains one.
3. **SAFETY signs when ILSM is required.** §6.4 never names Safety; §6.3 makes ILSM mandatory and puts «notification to the fire officer» in it. A fire officer who is notified and has no line to sign is a notification nobody can prove happened.
4. **72 hours as the Hospital Director's threshold.** §6.4 says «above a threshold duration» and never says what it is. It is `PERMIT_DIRECTOR_THRESHOLD_HOURS`, a setting, so a hospital that wants the Director on anything over two days changes it without a release. Lowering it only ever adds an approver.
5. **Two working days for an approval.** §6.4 gives the route and no clock; `packages/shared/src/permit.ts` writes «2 working days, like an RFI's default» on `PermitApproval.dueAt`. Working days and not calendar days, because a permit submitted on Friday afternoon whose approvals are all RED by Monday morning is a clock that teaches people to ignore it. **Cyprus public holidays are not modelled** — that calendar is data nobody has given us, and guessing one would be worse than being a day optimistic twice a year.
6. **`system_feed` until M4.** §6.1 points at `asset.serves_area_ids`, which does not exist yet. §7 above.
7. **The seeded ICRA matrix is the standard, not the ΟΚΥπΥ edition.** `OKYPY-ICRA-2.0-2026.1` carries «Προς επικύρωση από την Επιτροπή Ελέγχου Λοιμώξεων» in `notesEl` for exactly that reason. It is a faithful local rendering of ASHE ICRA 2.0's precautions and it has not been through Infection Control. The way to change it is a new version through the API, never an edit of the seed.
8. **A surrounding side with a band and no area still raises the risk group**, named `surrounding:<SIDE>`. Dropping a band somebody typed because there was no room to attach it to would be the looser reading of a clinical-safety rule.
9. **Only the clinical acceptor may close a permit.** §6.6 says the clinical owner signs; the signature is stamped from the caller, so the caller has to be that person. The consequence is that a permit touching no area with a clinical owner, in a unit with no Nursing or Infection Control appointment, **cannot be closed** until somebody is appointed. That is the strict reading of «no closeout, no permit closure», and it is visible rather than silent.

## Consequences

- Infection Control can change the matrix from inside the system, and every permit keeps the edition it was decided under.
- Adding a role to `ApprovalRole` means deciding who resolves it; `resolveApprover` falls back from unit-wide to area-owner and then to nobody, and nobody blocks.
- The breach job is the only code path that writes a permit without a caller. It is also the only one that needs a `SECURITY DEFINER` function to do it; anything else that wants to must add one and say why.
- `REDUNDANT_HALVES` will get narrower at M4 and the wording of the warning will not, so the i18n string is about the system rather than about the halves.
- Closing a permit needs an appointment in `unit_approver` or `area_clinical_owner`. A unit rolled out without one has permits it cannot close — which is a deployment checklist item, not a code change.
