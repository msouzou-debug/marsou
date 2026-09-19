-- eCapital M3 — a draft that is not finished yet (R19, CAPEX-01 §6.1).
--
-- S11 is a wizard and it autosaves: the request is created the moment the
-- requester leaves step 1, which is before any area has been picked and
-- before anybody has said when the work happens. Steps 2 and 3 arrive as
-- PATCHes. A permit that only exists from step 4 is a permit a browser crash
-- loses, which is the thing autosave is for.
--
-- Two facts have to survive that, and neither is expressible as «the column
-- is null»:
--
--   * `planned_start` and `planned_end` are NOT NULL and the shared contract
--     types them as strings the screen formats. A provisional window keeps
--     both true; this flag is what says the window is provisional, so the
--     SUBMITTED transition can refuse it. A nullable column would have made
--     `ShutdownPermit.plannedStart` nullable on the web too, for a state that
--     only a half-finished draft is ever in.
--   * an empty `shutdown_permit_area` is already sayable, so nothing is
--     needed for the areas. `ShutdownPermit.affectedAreas` loses its `.min(1)`
--     in `packages/shared/src/permit.ts` for the same reason: the rule was
--     right and it was attached to the wrong moment. Both are enforced at the
--     transition instead, where they belong (ADR-0026).
--
-- NO PATIENT DATA: one boolean about a form.

alter table ecapital.shutdown_permit
  add column if not exists window_provisional boolean not null default false;

comment on column ecapital.shutdown_permit.window_provisional is
  'True while the planned window is a placeholder the API invented because the wizard has not reached step 3. Refused at SUBMITTED. ADR-0026.';

-- RULE (§6.4): a permit past DRAFT has a window somebody chose. Said in the
-- service with errors.permitWindowRequired and said here so it is true of
-- every code path (ADR-0015's reasoning).
alter table ecapital.shutdown_permit
  drop constraint if exists permit_submitted_needs_window;
alter table ecapital.shutdown_permit
  add constraint permit_submitted_needs_window
  check (status = 'DRAFT' or not window_provisional);

-- ------------------------------------------------- approver scopes, S24u --

-- ADR-0020's screen gains the M3 capacities: Διαχείριση › Χρήστες sets which
-- areas and which units a clinical approver answers for, the same way it sets
-- roles and units today. The tables are 0015's; the only thing missing was a
-- way for an administrator to replace somebody's rows in one call, which
-- `PUT /admin/users/:id/approver-scopes` does inside one transaction so a
-- half-applied scope never exists.
--
-- No new table and no new policy: `area_clinical_owner` and `unit_approver`
-- are already administrator-only to write and unit-readable to read (0015).

-- The index the screen reads by, which is the person and not the place.
create index if not exists area_clinical_owner_user_role_idx
  on ecapital.area_clinical_owner (user_id, approval_role);
create index if not exists unit_approver_user_role_idx
  on ecapital.unit_approver (user_id, approval_role);

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
