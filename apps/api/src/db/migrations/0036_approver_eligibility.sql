-- 0036 — owner decision of 26/11/2026: an approval line goes only to somebody
-- who can decide it.
--
-- Writing up eCapital's users and roles for eHire showed that the permit
-- routing (`resolveApprover`) took the earliest `area_clinical_owner` or
-- `unit_approver` row for a capacity without asking whether its person was
-- still switched on, or still held a role that may decide that line. A
-- switched-off account, or one whose clinical approver role was taken away
-- with its scope rows left behind, kept receiving lines nobody could move.
--
-- The scope rows stay where they are: an account switched back on keeps its
-- appointments. What changes is who routing may pick, and the question it
-- asks is this function. An ordinary account cannot read other people's
-- `app_user` or `app_user_role` rows (0001's policies show each person their
-- own record), and the person submitting a permit is an ordinary account, so
-- the answer comes through one narrow function rather than a wider policy.
--
--   ecapital.eligible_approvers(user ids, account roles)
--
-- returns those of the given people who are active and hold at least one of
-- the given account roles. The list of account roles is the caller's: the
-- API passes `approvalRoleHolders(role)` from packages/shared/src/permit.ts,
-- so the rule of who may hold which line is written once, there, and the
-- database only answers the question. It answers only
--   * inside a request (an actor is set), and
--   * about the caller themselves, or about somebody who holds an approver
--     scope in a unit the caller may read — the same people whose scope rows
--     the caller can already read under `area_clinical_owner_read` and
--     `unit_approver_read` (0015).
-- It gives back ids the caller passed in and nothing else: no name, no role,
-- no unit.
--
-- Row-level security: no policy is added, dropped or rewritten, and no grant
-- changes. The routing writes the line under the policies it always used;
-- the administrator moving somebody's pending lines writes them under
-- `can_manage_permit`, as when they decide one.
--
-- NO PATIENT DATA. Self-contained and idempotent (`create or replace`).

create or replace function ecapital.eligible_approvers(p_user_ids uuid[], p_roles text[])
returns table (user_id uuid)
language sql stable security definer set search_path = ecapital, pg_catalog as $$
  select u.id
    from ecapital.app_user u
   where ecapital.current_actor_id() is not null
     and u.id = any (p_user_ids)
     and u.is_active
     and exists (select 1 from ecapital.app_user_role r
                  where r.app_user_id = u.id and r.role::text = any (p_roles))
     and (u.subject = ecapital.current_actor_id()
          or exists (select 1 from ecapital.unit_approver ua
                      where ua.user_id = u.id and ecapital.can_read_unit(ua.org_unit_id))
          or exists (select 1 from ecapital.area_clinical_owner aco
                      where aco.user_id = u.id and ecapital.can_read_unit(aco.org_unit_id)))
$$;

comment on function ecapital.eligible_approvers(uuid[], text[]) is
  'Of the given people, those who are active and hold one of the given account roles (0036). Answers only about the caller or about a holder of an approver scope in a unit the caller may read; ids only.';
