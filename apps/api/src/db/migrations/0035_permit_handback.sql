-- 0035 — owner decision of 26/11/2026: a work permit is closed in two steps.
--
-- UAT found that nobody could close a permit from the screen: «Κλείσιμο» was
-- offered to the works side (engineer, head of estates, administrator), and
-- the API refused anybody who did not hold the clinical acceptance capacity
-- (§6.6, `errors.permitAcceptanceNotYours`), while the clinical approvers who
-- do hold it were never shown the button. The owner chose two steps:
--
--   1. The works side ticks the closeout checklist and submits the area for
--      acceptance. The checklist, who submitted it and when are recorded, and
--      `actual_end` is set: the works are finished.
--   2. The clinical owner of the area accepts it (their own id is stamped as
--      the acceptance signature, the permit goes CLOSED) or returns it with a
--      comment (the submission is cleared and the permit stays ACTIVE or
--      BREACH, whichever it was).
--
-- No new permit status: statuses feed the calendar, the filters, the banners
-- and the reports, and the wait between the two steps is a fact about a live
-- permit, not a state of its own. These columns say it instead.
--
--   * `closeout_submitted_at` — set while a handback waits for acceptance,
--     cleared by a return.
--   * `closeout_submitted_by` — who submitted it last. Kept by a return, so
--     the returned handback waits in that person's inbox with the comment.
--   * `closeout_returned_at`, `closeout_returned_by`,
--     `closeout_return_comment_el` — the last return, so the submitter reads
--     why on the permit and in the inbox. Every earlier return is in the
--     audit trail (R42): the row's audit trigger records each update.
--
-- The breach sweep (§6.5) no longer flips a permit whose handback is waiting:
-- the works finished inside the window and the clock that is still running is
-- the clinical owner's, not the contractor's. A permit already in BREACH
-- stays in BREACH (`flip_overrun_permits` only ever touches ACTIVE rows). A
-- return puts the permit back on the works side's clock, so an ACTIVE permit
-- returned after its end is flipped on the next pass, which is right: the
-- area was not in fact handed back.
--
-- Row-level security: no policy is added, dropped or rewritten. Step 1 is the
-- works side, which writes the row under `can_manage_permit` as it did for
-- «Έναρξη εργασιών». Step 2 is the clinical owner, who already writes the row
-- under `permit_actionable_by` (0015): a clinical owner of one of the
-- permit's areas through `permit_visible_to_clinician`, a unit-wide approver
-- of the permit's unit through its `unit_approver` clause. The service decides
-- which of those may sign (§6.6's three roles); the policy only says the row
-- is theirs to touch, as it did for the one-step close.
--
-- One narrow addition, to `permit_visible_to_clinician` (the read rule of
-- CAPEX-01 §9 for somebody whose only role is clinical_approver). Its 0015
-- reading is «a line on the permit assigned to them, or an area of the permit
-- they own». A unit-wide NURSING or INFECTION_CONTROL officer signs the
-- handback for every room of their hospital (§6.6, `holdsAcceptanceRole`),
-- but on a permit whose route never had a line for them — a plant room, an
-- office — the 0015 rule hid the permit from them, so the one person who
-- could accept the handback could not open it. They now also see a permit of
-- their own unit
--   * while its handback waits for acceptance (ACTIVE or BREACH, submitted), and
--   * that they closed or whose handback they last returned — so the permit
--     they just signed does not vanish under them in the same transaction,
--     and their own decision stays readable.
-- Nothing else widens: not other permits of the unit, not drafts, not the
-- audit trail (`audit_log_read_permits` still excludes clinical_approver_only),
-- and nobody who is not a unit-wide NURSING or INFECTION_CONTROL appointment.
-- The function keeps its signature, so the policies that call it (the
-- permit's and its children's reads, `permit_actionable_by`) are unchanged.
--
-- NO PATIENT DATA: a person, a time and a sentence about a plant room.
--
-- Self-contained and idempotent: `add column if not exists`, `drop … if
-- exists` before each constraint, `create or replace` for the two functions.
-- Depends on nothing after 0015.

alter table ecapital.shutdown_permit
  add column if not exists closeout_submitted_at timestamptz;
alter table ecapital.shutdown_permit
  add column if not exists closeout_submitted_by uuid
    references ecapital.app_user (id) on delete restrict;
alter table ecapital.shutdown_permit
  add column if not exists closeout_returned_at timestamptz;
alter table ecapital.shutdown_permit
  add column if not exists closeout_returned_by uuid
    references ecapital.app_user (id) on delete restrict;
alter table ecapital.shutdown_permit
  add column if not exists closeout_return_comment_el text;

comment on column ecapital.shutdown_permit.closeout_submitted_at is
  'When the works side submitted the area for clinical acceptance (step 1 of the handback, 0035). Null when no handback is waiting.';
comment on column ecapital.shutdown_permit.closeout_submitted_by is
  'Who submitted the handback last; kept by a return so the returned handback reaches them. Never the person who accepts it.';
comment on column ecapital.shutdown_permit.closeout_returned_at is
  'When the clinical owner last returned a handback with comments (0035).';
comment on column ecapital.shutdown_permit.closeout_returned_by is
  'Who last returned the handback.';
comment on column ecapital.shutdown_permit.closeout_return_comment_el is
  'Why the handback was last returned. Earlier returns are in the audit trail.';

-- RULE (§6.6, 0035): a submission is a checklist, a person and a time, on a
-- permit whose works are running or have just finished, and the works ended
-- when it was submitted.
alter table ecapital.shutdown_permit drop constraint if exists permit_handback_complete;
alter table ecapital.shutdown_permit add constraint permit_handback_complete
  check (closeout_submitted_at is null
         or (closeout_submitted_by is not null
             and closeout is not null
             and actual_end is not null
             and status in ('ACTIVE', 'BREACH', 'CLOSED')));
-- A return names who returned it, when, and why.
alter table ecapital.shutdown_permit drop constraint if exists permit_handback_return_complete;
alter table ecapital.shutdown_permit add constraint permit_handback_return_complete
  check (closeout_returned_at is null
         or (closeout_returned_by is not null
             and length(btrim(coalesce(closeout_return_comment_el, ''))) > 0));

-- §6.5, as 0015 wrote it, plus one clause: a permit whose handback is waiting
-- for acceptance is not an overrun.
create or replace function ecapital.flip_overrun_permits(p_now timestamptz)
returns table (id uuid, ref text, org_unit_id text, title_el text, planned_end timestamptz)
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  -- Already in BREACH is left alone, so `breached_at` is the moment the
  -- overrun was first noticed and never drifts forward.
  return query
  update ecapital.shutdown_permit p
     set status = 'BREACH', breached_at = p_now, updated_at = now()
   where p.status = 'ACTIVE'
     and p.planned_end < p_now
     and p.closeout_submitted_at is null
  returning p.id, p.ref, p.org_unit_id, p.title_el, p.planned_end;
end $$;

-- §9, as 0015 wrote it, plus the third clause described in the header.
create or replace function ecapital.permit_visible_to_clinician(p_permit_id uuid)
returns boolean
language sql stable security definer set search_path = ecapital, pg_catalog as $$
  select exists (select 1 from ecapital.permit_approval pa
                   join ecapital.app_user u on u.id = pa.approver_id
                  where pa.permit_id = p_permit_id
                    and u.subject = ecapital.current_actor_id())
      or exists (select 1 from ecapital.shutdown_permit_area spa
                   join ecapital.area_clinical_owner aco on aco.area_id = spa.area_id
                   join ecapital.app_user u on u.id = aco.user_id
                  where spa.permit_id = p_permit_id
                    and u.subject = ecapital.current_actor_id())
      -- 0035: the unit-wide acceptance capacity, for the handback only.
      or exists (select 1 from ecapital.shutdown_permit p
                   join ecapital.unit_approver ua on ua.org_unit_id = p.org_unit_id
                   join ecapital.app_user u on u.id = ua.user_id
                  where p.id = p_permit_id
                    and u.subject = ecapital.current_actor_id()
                    and ua.approval_role in ('NURSING', 'INFECTION_CONTROL')
                    and ((p.status in ('ACTIVE', 'BREACH') and p.closeout_submitted_at is not null)
                      or p.closed_by = u.id
                      or p.closeout_returned_by = u.id))
$$;
