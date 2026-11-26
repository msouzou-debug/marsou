# ADR-0039 — The technical and safety lines get a role of their own

**Status:** accepted · 26/11/2026

## Context

A permit's route (CAPEX-01 §6.4, ADR-0026) has two lines that are the
estate's and not the ward's: TECHNICAL, always, and SAFETY, when ILSM is
required. Until now the administrator could appoint somebody to either line
for a unit only if that person held `clinical_approver`
(`errors.approverScopesNeedRole`), so an estates officer who was to sign
the technical line got the right to decide infection control, nursing and
the director's line as well, and §9's narrow read of the permit register
with it.

The owner decided (26/11/2026): a separate role for the technical and safety
approvers, so estates staff do not get clinical approval rights. Who may
start works (`permitOperate`) stays as it is.

## Decisions

1. **A ninth role, `technical_approver`**, «Εγκρίνων τεχνικών και
   ασφάλειας» / "Technical and safety approver". Scope `unit` (it means
   something only against a list of units). It sits right after
   `clinical_approver` in `AppRole`, in the matrix's columns and in the
   database enum.

2. **A new row, `permitTechnical`**, «Έγκριση τεχνικών και ασφάλειας», in
   the permits group. Defaults: APPROVE for the new role, the estates head
   and the administrator; READ for everybody else.

3. **The new role's column is the clinical approver's, less the clinical
   decision.** On every other row it starts at the clinical approver's
   default (so it raises a fault call, ADR-0031 §10), and on
   `permitClinical` it is READ. The administrator can change either column
   afterwards, as any other (ADR-0033).

4. **Which row decides which line** (`apps/api/src/permits/line-needs.ts`).
   The four clinical lines still accept `permitClinical` APPROVE alone.
   TECHNICAL and SAFETY accept `permitTechnical` APPROVE or
   `permitClinical` APPROVE. The technical row replaces the request row
   these lines borrowed after the UAT of 25/11/2026, so rejecting a request
   and deciding a technical line can now be given out separately. The
   clinical row stays on them so clinical approvers already appointed to
   those lines on the live server keep working. The assignment check is
   unchanged: holding a row never decides a line waiting on someone else.

5. **Who may be given which scope** (`approverScopesRefusal` in
   packages/shared/src/permit.ts, read by the API and by S24's editor). A
   TECHNICAL or SAFETY unit scope goes to a technical and safety approver,
   a clinical approver or an estates head; anyone else gets 422
   `errors.approverScopesNeedTechnicalRole`. Every other scope, by area or
   by unit, still goes to a clinical approver alone, 422
   `errors.approverScopesNeedRole`. S24 shows the editor to any of the
   three and offers only the scope roles the ticked roles allow.

6. **Row-level security is not widened.** The new role reads by unit
   (`can_read_unit`), as every unit role. Deciding a line writes the permit
   through `permit_actionable_by` (0015), which already admits «an approver
   appointed in this unit» without naming a role, so no policy needed the
   new role. `ecapital.clinical_approver_only()` is unchanged: a person who
   holds both approver roles stays on §9's narrow read, the safer side.

## Consequences

- Migration `0033_technical_approver_role.sql` adds the enum value, widens
  the two CHECK constraints on `ecapital.role_permission` and seeds the new
  row and column `on conflict do nothing`. It writes nothing into an
  `app_role` column, because a value added to an enum inside the runner's
  transaction cannot be used before it commits. No appointment moves.
- On the live server, clinical approvers holding TECHNICAL or SAFETY lines
  keep deciding them. The administrator moves them to the new role when
  ready: tick «Εγκρίνων τεχνικών και ασφάλειας», untick «Κλινικός
  εγκριτής» if they need nothing clinical, and keep the two scopes.
- The estates head keeps the technical lines through the new row instead of
  the request row. An administrator who had lowered the estates head's
  request row to stop them rejecting requests will find they now keep the
  technical lines; one who wants them off the technical lines lowers the new
  row.
- The dev seed adds `technical.larnaca@ecapital.test`, appointed TECHNICAL
  and SAFETY at Λάρνακα after the estates head, so the TECHNICAL line still
  resolves to her first and to him when she raised the permit.
- The help map and the persona guides gain the new persona on the screens
  the clinical approver reads (S00, S02a, S11, S13, S14, S15, S18, S18a,
  S20, S26); the release builds its PDF guide with the rest.
