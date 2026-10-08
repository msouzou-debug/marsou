-- eCapital — the role matrix becomes the rule (ADR-0033).
--
-- Owner, 08/10/2026: «The admin should be able to adjust the roles and
-- permissions for each role.» Until now the matrix in
-- packages/shared/src/role-matrix.ts described rules that lived three times
-- over: the role lists inside the `ecapital.can_*` functions below, the API's
-- `@Roles(...)` decorators, and the web's `can*` helpers. This migration puts
-- the matrix in a table, seeds it from the shared defaults, and rewrites every
-- role list in the row policies as a question to that table:
-- `ecapital.allowed(area, level)`.
--
-- What does NOT move into the table, and stays written out below (ADR-0033):
--   * unit membership — `can_read_unit` / `can_write_unit` decide which rows a
--     caller reaches at all; the matrix only decides what they may do there;
--   * the two read-only roles — `can_write_unit` refuses them whatever the
--     matrix holds, and the guard trigger refuses to give them more than READ;
--   * segregation of duties — the requester never decides their own permit,
--     the raiser never decides their own variation, the creator never approves
--     their own certificate (services and CHECK constraints, untouched here);
--   * the administrator's identity — `app_user`, `role_mapping` and the
--     password table answer to `has_role('admin')`, not to the matrix.
--
-- Written as plain SQL (ADR-0008). Idempotent: `create or replace`, `if not
-- exists`, `drop policy if exists`, and a seed that is `on conflict do
-- nothing`, so a deployment that already holds the administrator's choices
-- keeps them when this runs again.

-- ---------------------------------------------------------------- table --

create table if not exists ecapital.role_permission (
  role        text not null,
  area_key    text not null,
  level       text not null,
  -- Null while the row is still the seeded default; set by the guard trigger
  -- the first time a person changes it.
  updated_at  timestamptz,
  updated_by  uuid references ecapital.app_user (id) on delete set null,
  -- The audit trigger keys its rows on `id` (ADR-0011), so the pair is
  -- spelled out once as one: `technician:defects`.
  id          text generated always as (role || ':' || area_key) stored,
  primary key (role, area_key),
  constraint role_permission_role_known check (role in (
    'admin', 'estates_head', 'project_engineer', 'technician', 'finance',
    'clinical_approver', 'executive_readonly', 'auditor_readonly')),
  constraint role_permission_level_known check (level in (
    'NONE', 'READ', 'WRITE', 'APPROVE', 'MANAGE')),
  -- The matrix's rows. packages/shared/src/access.ts (`MatrixArea`) is the
  -- mirror, and test/permissions.test.ts pins the two lists equal.
  constraint role_permission_area_known check (area_key in (
    'portfolio',
    'projectRecords', 'projectPhase', 'approvedBudget',
    'contractRecords', 'rfisInstructions', 'variationSubmit', 'variationDecide',
    'defects', 'paymentCertCreate', 'paymentCertEngineer', 'paymentCertFinance',
    'sapImport', 'budgetLines', 'accruals', 'forecastWarnings',
    'permitRequest', 'permitClinical', 'permitOperate', 'permitCalendar',
    'assetRegister', 'assetCondition', 'assetDocuments', 'assetForecast', 'assetLabels',
    'workOrderRaise', 'workOrderWork', 'maintenanceAgreement', 'backlog',
    'backlogToProject', 'scorecard',
    'reports',
    'users', 'contractors', 'efinance',
    'auditTrail'))
);

-- --------------------------------------------------------------- levels --

-- NONE 0, READ 1, WRITE 2, APPROVE 3, MANAGE 4. A higher level includes the
-- lower ones on the same row. Anything else is null, and null compares to
-- nothing, so a typo refuses rather than grants.
create or replace function ecapital.level_rank(p_level text) returns integer
language sql immutable parallel safe as $$
  select case p_level
    when 'NONE' then 0
    when 'READ' then 1
    when 'WRITE' then 2
    when 'APPROVE' then 3
    when 'MANAGE' then 4
  end
$$;

-- The one question every policy below asks: does any role this request
-- carries hold at least `p_level` on `p_area`? No row is NONE.
--
-- SECURITY DEFINER so it reads the table as its owner: the answer must not
-- depend on the table's own row policy, and a policy that asks a table whose
-- policy asks it back is a recursion, not a rule.
--
-- `app.system` is set by `DatabaseService.withRls` for the server's own timers
-- (the eFinance sync and push, the maintenance sweep), which run as `admin`
-- with no person behind them. They keep working whatever the administrator
-- does to the admin column; they are code, not a role.
create or replace function ecapital.allowed(p_area text, p_level text) returns boolean
language sql stable security definer set search_path = ecapital, pg_catalog as $$
  select coalesce(current_setting('app.system', true), '') = 'on'
      or exists (
        select 1 from ecapital.role_permission rp
         where rp.area_key = p_area
           and rp.role = any (ecapital.current_roles())
           and ecapital.level_rank(rp.level) >= ecapital.level_rank(p_level))
$$;

-- ----------------------------------------------------------- guardrails --

-- The only things the administrator cannot change (ADR-0033). The same four
-- rules, plus the users row, are `levelBounds` in
-- packages/shared/src/role-matrix.ts; the API test walks every cell of both.
--
--   readOnlyRoles   auditor_readonly and executive_readonly never above READ
--   auditTrailRead  the audit trail row is NONE or READ, nothing more
--   adminReads      admin never below READ anywhere
--   adminUsers      admin never below MANAGE on users: nobody locks the way in
--   usersAdminOnly  users is NONE for every other role, because the user and
--                   role routes answer to the admin identity, not the matrix
--
-- `restrict_violation`, like the audit log's own refusal (ADR-0011); the API
-- turns it into 422 errors.rolePermissionGuardrail with the area named. The
-- message carries `area_key` first so the service can read it back.
create or replace function ecapital.role_permission_guard() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_rank  integer := ecapital.level_rank(new.level);
  v_actor text := ecapital.current_actor_id();
begin
  if new.role in ('auditor_readonly', 'executive_readonly') and v_rank > 1 then
    raise exception 'role_permission guardrail: %: readOnlyRoles', new.area_key
      using errcode = 'restrict_violation';
  end if;
  if new.area_key = 'auditTrail' and v_rank > 1 then
    raise exception 'role_permission guardrail: %: auditTrailRead', new.area_key
      using errcode = 'restrict_violation';
  end if;
  if new.role = 'admin' and v_rank < 1 then
    raise exception 'role_permission guardrail: %: adminReads', new.area_key
      using errcode = 'restrict_violation';
  end if;
  if new.role = 'admin' and new.area_key = 'users' and v_rank < 4 then
    raise exception 'role_permission guardrail: %: adminUsers', new.area_key
      using errcode = 'restrict_violation';
  end if;
  if new.role <> 'admin' and new.area_key = 'users' and v_rank > 0 then
    raise exception 'role_permission guardrail: %: usersAdminOnly', new.area_key
      using errcode = 'restrict_violation';
  end if;

  -- Who and when, from the request itself rather than from the body. The
  -- seed below runs with no actor and leaves both null.
  if v_actor is not null then
    new.updated_at := now();
    new.updated_by := (select u.id from ecapital.app_user u where u.subject = v_actor);
  end if;
  return new;
end $$;

drop trigger if exists role_permission_guard on ecapital.role_permission;
create trigger role_permission_guard
  before insert or update on ecapital.role_permission
  for each row execute function ecapital.role_permission_guard();

-- R42, ADR-0011: every change to the matrix is in the trail.
drop trigger if exists role_permission_audit on ecapital.role_permission;
create trigger role_permission_audit
  after insert or update or delete on ecapital.role_permission
  for each row execute function ecapital.write_audit();

-- ------------------------------------------------------------------ seed --

-- The defaults: `ROLE_MATRIX` in packages/shared/src/role-matrix.ts, cell for
-- cell (test/permissions.test.ts compares a fresh database with it). `on
-- conflict do nothing`, so an administrator's choice survives a re-run.
insert into ecapital.role_permission (role, area_key, level) values
  -- portfolio
  ('estates_head', 'portfolio', 'READ'), ('project_engineer', 'portfolio', 'READ'), ('technician', 'portfolio', 'READ'), ('finance', 'portfolio', 'READ'),
  ('clinical_approver', 'portfolio', 'READ'), ('executive_readonly', 'portfolio', 'READ'), ('auditor_readonly', 'portfolio', 'READ'), ('admin', 'portfolio', 'READ'),
  -- projects
  ('estates_head', 'projectRecords', 'WRITE'), ('project_engineer', 'projectRecords', 'WRITE'), ('technician', 'projectRecords', 'READ'), ('finance', 'projectRecords', 'READ'),
  ('clinical_approver', 'projectRecords', 'READ'), ('executive_readonly', 'projectRecords', 'READ'), ('auditor_readonly', 'projectRecords', 'READ'), ('admin', 'projectRecords', 'WRITE'),
  ('estates_head', 'projectPhase', 'WRITE'), ('project_engineer', 'projectPhase', 'WRITE'), ('technician', 'projectPhase', 'READ'), ('finance', 'projectPhase', 'READ'),
  ('clinical_approver', 'projectPhase', 'READ'), ('executive_readonly', 'projectPhase', 'READ'), ('auditor_readonly', 'projectPhase', 'READ'), ('admin', 'projectPhase', 'MANAGE'),
  ('estates_head', 'approvedBudget', 'READ'), ('project_engineer', 'approvedBudget', 'READ'), ('technician', 'approvedBudget', 'READ'), ('finance', 'approvedBudget', 'APPROVE'),
  ('clinical_approver', 'approvedBudget', 'READ'), ('executive_readonly', 'approvedBudget', 'READ'), ('auditor_readonly', 'approvedBudget', 'READ'), ('admin', 'approvedBudget', 'READ'),
  -- contracts
  ('estates_head', 'contractRecords', 'WRITE'), ('project_engineer', 'contractRecords', 'WRITE'), ('technician', 'contractRecords', 'READ'), ('finance', 'contractRecords', 'READ'),
  ('clinical_approver', 'contractRecords', 'READ'), ('executive_readonly', 'contractRecords', 'READ'), ('auditor_readonly', 'contractRecords', 'READ'), ('admin', 'contractRecords', 'WRITE'),
  ('estates_head', 'rfisInstructions', 'WRITE'), ('project_engineer', 'rfisInstructions', 'WRITE'), ('technician', 'rfisInstructions', 'READ'), ('finance', 'rfisInstructions', 'READ'),
  ('clinical_approver', 'rfisInstructions', 'READ'), ('executive_readonly', 'rfisInstructions', 'READ'), ('auditor_readonly', 'rfisInstructions', 'READ'), ('admin', 'rfisInstructions', 'WRITE'),
  ('estates_head', 'variationSubmit', 'WRITE'), ('project_engineer', 'variationSubmit', 'WRITE'), ('technician', 'variationSubmit', 'READ'), ('finance', 'variationSubmit', 'READ'),
  ('clinical_approver', 'variationSubmit', 'READ'), ('executive_readonly', 'variationSubmit', 'READ'), ('auditor_readonly', 'variationSubmit', 'READ'), ('admin', 'variationSubmit', 'WRITE'),
  ('estates_head', 'variationDecide', 'APPROVE'), ('project_engineer', 'variationDecide', 'READ'), ('technician', 'variationDecide', 'READ'), ('finance', 'variationDecide', 'READ'),
  ('clinical_approver', 'variationDecide', 'READ'), ('executive_readonly', 'variationDecide', 'READ'), ('auditor_readonly', 'variationDecide', 'READ'), ('admin', 'variationDecide', 'APPROVE'),
  ('estates_head', 'defects', 'WRITE'), ('project_engineer', 'defects', 'WRITE'), ('technician', 'defects', 'WRITE'), ('finance', 'defects', 'READ'),
  ('clinical_approver', 'defects', 'READ'), ('executive_readonly', 'defects', 'READ'), ('auditor_readonly', 'defects', 'READ'), ('admin', 'defects', 'WRITE'),
  ('estates_head', 'paymentCertCreate', 'WRITE'), ('project_engineer', 'paymentCertCreate', 'WRITE'), ('technician', 'paymentCertCreate', 'READ'), ('finance', 'paymentCertCreate', 'READ'),
  ('clinical_approver', 'paymentCertCreate', 'READ'), ('executive_readonly', 'paymentCertCreate', 'READ'), ('auditor_readonly', 'paymentCertCreate', 'READ'), ('admin', 'paymentCertCreate', 'WRITE'),
  ('estates_head', 'paymentCertEngineer', 'APPROVE'), ('project_engineer', 'paymentCertEngineer', 'APPROVE'), ('technician', 'paymentCertEngineer', 'READ'), ('finance', 'paymentCertEngineer', 'READ'),
  ('clinical_approver', 'paymentCertEngineer', 'READ'), ('executive_readonly', 'paymentCertEngineer', 'READ'), ('auditor_readonly', 'paymentCertEngineer', 'READ'), ('admin', 'paymentCertEngineer', 'APPROVE'),
  ('estates_head', 'paymentCertFinance', 'READ'), ('project_engineer', 'paymentCertFinance', 'READ'), ('technician', 'paymentCertFinance', 'READ'), ('finance', 'paymentCertFinance', 'APPROVE'),
  ('clinical_approver', 'paymentCertFinance', 'READ'), ('executive_readonly', 'paymentCertFinance', 'READ'), ('auditor_readonly', 'paymentCertFinance', 'READ'), ('admin', 'paymentCertFinance', 'APPROVE'),
  -- cost
  ('estates_head', 'sapImport', 'NONE'), ('project_engineer', 'sapImport', 'NONE'), ('technician', 'sapImport', 'NONE'), ('finance', 'sapImport', 'WRITE'),
  ('clinical_approver', 'sapImport', 'NONE'), ('executive_readonly', 'sapImport', 'NONE'), ('auditor_readonly', 'sapImport', 'NONE'), ('admin', 'sapImport', 'WRITE'),
  ('estates_head', 'budgetLines', 'READ'), ('project_engineer', 'budgetLines', 'READ'), ('technician', 'budgetLines', 'READ'), ('finance', 'budgetLines', 'WRITE'),
  ('clinical_approver', 'budgetLines', 'READ'), ('executive_readonly', 'budgetLines', 'READ'), ('auditor_readonly', 'budgetLines', 'READ'), ('admin', 'budgetLines', 'WRITE'),
  ('estates_head', 'accruals', 'READ'), ('project_engineer', 'accruals', 'NONE'), ('technician', 'accruals', 'NONE'), ('finance', 'accruals', 'READ'),
  ('clinical_approver', 'accruals', 'NONE'), ('executive_readonly', 'accruals', 'READ'), ('auditor_readonly', 'accruals', 'READ'), ('admin', 'accruals', 'READ'),
  ('estates_head', 'forecastWarnings', 'WRITE'), ('project_engineer', 'forecastWarnings', 'WRITE'), ('technician', 'forecastWarnings', 'READ'), ('finance', 'forecastWarnings', 'READ'),
  ('clinical_approver', 'forecastWarnings', 'READ'), ('executive_readonly', 'forecastWarnings', 'READ'), ('auditor_readonly', 'forecastWarnings', 'READ'), ('admin', 'forecastWarnings', 'WRITE'),
  -- permits
  ('estates_head', 'permitRequest', 'APPROVE'), ('project_engineer', 'permitRequest', 'WRITE'), ('technician', 'permitRequest', 'READ'), ('finance', 'permitRequest', 'READ'),
  ('clinical_approver', 'permitRequest', 'READ'), ('executive_readonly', 'permitRequest', 'READ'), ('auditor_readonly', 'permitRequest', 'READ'), ('admin', 'permitRequest', 'APPROVE'),
  ('estates_head', 'permitClinical', 'READ'), ('project_engineer', 'permitClinical', 'READ'), ('technician', 'permitClinical', 'READ'), ('finance', 'permitClinical', 'READ'),
  ('clinical_approver', 'permitClinical', 'APPROVE'), ('executive_readonly', 'permitClinical', 'READ'), ('auditor_readonly', 'permitClinical', 'READ'), ('admin', 'permitClinical', 'READ'),
  ('estates_head', 'permitOperate', 'WRITE'), ('project_engineer', 'permitOperate', 'WRITE'), ('technician', 'permitOperate', 'READ'), ('finance', 'permitOperate', 'READ'),
  ('clinical_approver', 'permitOperate', 'READ'), ('executive_readonly', 'permitOperate', 'READ'), ('auditor_readonly', 'permitOperate', 'READ'), ('admin', 'permitOperate', 'WRITE'),
  ('estates_head', 'permitCalendar', 'READ'), ('project_engineer', 'permitCalendar', 'READ'), ('technician', 'permitCalendar', 'READ'), ('finance', 'permitCalendar', 'READ'),
  ('clinical_approver', 'permitCalendar', 'READ'), ('executive_readonly', 'permitCalendar', 'READ'), ('auditor_readonly', 'permitCalendar', 'READ'), ('admin', 'permitCalendar', 'READ'),
  -- assets
  ('estates_head', 'assetRegister', 'WRITE'), ('project_engineer', 'assetRegister', 'WRITE'), ('technician', 'assetRegister', 'READ'), ('finance', 'assetRegister', 'READ'),
  ('clinical_approver', 'assetRegister', 'READ'), ('executive_readonly', 'assetRegister', 'READ'), ('auditor_readonly', 'assetRegister', 'READ'), ('admin', 'assetRegister', 'WRITE'),
  ('estates_head', 'assetCondition', 'WRITE'), ('project_engineer', 'assetCondition', 'WRITE'), ('technician', 'assetCondition', 'WRITE'), ('finance', 'assetCondition', 'READ'),
  ('clinical_approver', 'assetCondition', 'READ'), ('executive_readonly', 'assetCondition', 'READ'), ('auditor_readonly', 'assetCondition', 'READ'), ('admin', 'assetCondition', 'WRITE'),
  ('estates_head', 'assetDocuments', 'WRITE'), ('project_engineer', 'assetDocuments', 'WRITE'), ('technician', 'assetDocuments', 'READ'), ('finance', 'assetDocuments', 'READ'),
  ('clinical_approver', 'assetDocuments', 'READ'), ('executive_readonly', 'assetDocuments', 'READ'), ('auditor_readonly', 'assetDocuments', 'READ'), ('admin', 'assetDocuments', 'WRITE'),
  ('estates_head', 'assetForecast', 'READ'), ('project_engineer', 'assetForecast', 'NONE'), ('technician', 'assetForecast', 'NONE'), ('finance', 'assetForecast', 'READ'),
  ('clinical_approver', 'assetForecast', 'NONE'), ('executive_readonly', 'assetForecast', 'READ'), ('auditor_readonly', 'assetForecast', 'NONE'), ('admin', 'assetForecast', 'READ'),
  ('estates_head', 'assetLabels', 'READ'), ('project_engineer', 'assetLabels', 'READ'), ('technician', 'assetLabels', 'READ'), ('finance', 'assetLabels', 'READ'),
  ('clinical_approver', 'assetLabels', 'READ'), ('executive_readonly', 'assetLabels', 'READ'), ('auditor_readonly', 'assetLabels', 'READ'), ('admin', 'assetLabels', 'READ'),
  -- maintenance
  ('estates_head', 'workOrderRaise', 'WRITE'), ('project_engineer', 'workOrderRaise', 'WRITE'), ('technician', 'workOrderRaise', 'WRITE'), ('finance', 'workOrderRaise', 'READ'),
  ('clinical_approver', 'workOrderRaise', 'WRITE'), ('executive_readonly', 'workOrderRaise', 'READ'), ('auditor_readonly', 'workOrderRaise', 'READ'), ('admin', 'workOrderRaise', 'WRITE'),
  ('estates_head', 'workOrderWork', 'WRITE'), ('project_engineer', 'workOrderWork', 'WRITE'), ('technician', 'workOrderWork', 'WRITE'), ('finance', 'workOrderWork', 'READ'),
  ('clinical_approver', 'workOrderWork', 'READ'), ('executive_readonly', 'workOrderWork', 'READ'), ('auditor_readonly', 'workOrderWork', 'READ'), ('admin', 'workOrderWork', 'WRITE'),
  ('estates_head', 'maintenanceAgreement', 'MANAGE'), ('project_engineer', 'maintenanceAgreement', 'READ'), ('technician', 'maintenanceAgreement', 'READ'), ('finance', 'maintenanceAgreement', 'READ'),
  ('clinical_approver', 'maintenanceAgreement', 'READ'), ('executive_readonly', 'maintenanceAgreement', 'READ'), ('auditor_readonly', 'maintenanceAgreement', 'READ'), ('admin', 'maintenanceAgreement', 'MANAGE'),
  ('estates_head', 'backlog', 'WRITE'), ('project_engineer', 'backlog', 'WRITE'), ('technician', 'backlog', 'READ'), ('finance', 'backlog', 'READ'),
  ('clinical_approver', 'backlog', 'READ'), ('executive_readonly', 'backlog', 'READ'), ('auditor_readonly', 'backlog', 'READ'), ('admin', 'backlog', 'WRITE'),
  ('estates_head', 'backlogToProject', 'APPROVE'), ('project_engineer', 'backlogToProject', 'READ'), ('technician', 'backlogToProject', 'READ'), ('finance', 'backlogToProject', 'READ'),
  ('clinical_approver', 'backlogToProject', 'READ'), ('executive_readonly', 'backlogToProject', 'READ'), ('auditor_readonly', 'backlogToProject', 'READ'), ('admin', 'backlogToProject', 'APPROVE'),
  ('estates_head', 'scorecard', 'READ'), ('project_engineer', 'scorecard', 'READ'), ('technician', 'scorecard', 'READ'), ('finance', 'scorecard', 'READ'),
  ('clinical_approver', 'scorecard', 'READ'), ('executive_readonly', 'scorecard', 'READ'), ('auditor_readonly', 'scorecard', 'READ'), ('admin', 'scorecard', 'READ'),
  -- reports
  ('estates_head', 'reports', 'READ'), ('project_engineer', 'reports', 'NONE'), ('technician', 'reports', 'NONE'), ('finance', 'reports', 'READ'),
  ('clinical_approver', 'reports', 'NONE'), ('executive_readonly', 'reports', 'READ'), ('auditor_readonly', 'reports', 'READ'), ('admin', 'reports', 'READ'),
  -- admin
  ('estates_head', 'users', 'NONE'), ('project_engineer', 'users', 'NONE'), ('technician', 'users', 'NONE'), ('finance', 'users', 'NONE'),
  ('clinical_approver', 'users', 'NONE'), ('executive_readonly', 'users', 'NONE'), ('auditor_readonly', 'users', 'NONE'), ('admin', 'users', 'MANAGE'),
  ('estates_head', 'contractors', 'MANAGE'), ('project_engineer', 'contractors', 'READ'), ('technician', 'contractors', 'NONE'), ('finance', 'contractors', 'NONE'),
  ('clinical_approver', 'contractors', 'NONE'), ('executive_readonly', 'contractors', 'NONE'), ('auditor_readonly', 'contractors', 'NONE'), ('admin', 'contractors', 'MANAGE'),
  ('estates_head', 'efinance', 'NONE'), ('project_engineer', 'efinance', 'NONE'), ('technician', 'efinance', 'NONE'), ('finance', 'efinance', 'NONE'),
  ('clinical_approver', 'efinance', 'NONE'), ('executive_readonly', 'efinance', 'NONE'), ('auditor_readonly', 'efinance', 'NONE'), ('admin', 'efinance', 'MANAGE'),
  -- audit
  ('estates_head', 'auditTrail', 'NONE'), ('project_engineer', 'auditTrail', 'NONE'), ('technician', 'auditTrail', 'NONE'), ('finance', 'auditTrail', 'NONE'),
  ('clinical_approver', 'auditTrail', 'NONE'), ('executive_readonly', 'auditTrail', 'NONE'), ('auditor_readonly', 'auditTrail', 'READ'), ('admin', 'auditTrail', 'READ')
on conflict (role, area_key) do nothing;

-- -------------------------------------------------- row-level security --

alter table ecapital.role_permission enable row level security;

-- Every signed-in user reads the matrix: the web decides which controls to
-- show from it, and the roles tab is read by the head of estates too.
drop policy if exists role_permission_read on ecapital.role_permission;
create policy role_permission_read on ecapital.role_permission
  for select using (ecapital.current_actor_id() is not null);

-- Only the administrator changes it — by identity, not by the matrix, or the
-- matrix could be used to hand out the right to change the matrix.
drop policy if exists role_permission_write on ecapital.role_permission;
create policy role_permission_write on ecapital.role_permission
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

-- The matrix's trail is part of GET /audit-log (admin and auditor), which
-- audit_log_read in 0001 already opens; nothing to add.

-- ------------------------------------------- the functions, rewritten --
--
-- Each keeps its signature, its floor and any rule that is not a role list.
-- Only the list of roles becomes a call to `allowed`.

-- 0002. The project register, its milestones, risks, issues and notes.
create or replace function ecapital.can_manage_project(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('projectRecords', 'WRITE')
$$;

-- 0003. ADR-0014: from APPROVED on, only the role that holds APPROVE on the
-- approved budget changes it. The administrator is not exempt by default; if
-- the administrator gives themselves the row, that is now a recorded choice.
create or replace function ecapital.set_approved_budget(p_project_id uuid, p_amount numeric)
returns boolean
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_unit text;
begin
  select p.org_unit_id into v_unit from ecapital.project p where p.id = p_project_id;
  if v_unit is null then return false; end if;
  if not ecapital.allowed('approvedBudget', 'APPROVE') then return false; end if;
  if not ecapital.can_write_unit(v_unit) then return false; end if;
  if p_amount is null or p_amount < 0 then return false; end if;

  update ecapital.project
     set approved_budget = p_amount, updated_at = now()
   where id = p_project_id;
  return true;
end $$;

-- 0003. The supplier register (ADR-0015).
create or replace function ecapital.can_manage_contractor() returns boolean
language sql stable parallel safe as $$
  select ecapital.current_actor_id() is not null
     and not ecapital.has_role('auditor_readonly')
     and not ecapital.has_role('executive_readonly')
     and ecapital.allowed('contractors', 'MANAGE')
$$;

-- New. A contract and its BoQ were written under `can_manage_project`; they
-- now follow their own row of the matrix.
create or replace function ecapital.can_manage_contract(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('contractRecords', 'WRITE')
$$;

-- New. A variation row is written by whoever drafts and submits it and by
-- whoever decides it. Which of the two a request is, and that the decider is
-- never the raiser (R10), is the route's `@Needs` and the service's check.
create or replace function ecapital.can_manage_variation(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.allowed('variationSubmit', 'WRITE')
       or ecapital.allowed('variationDecide', 'APPROVE'))
$$;

-- New. RFIs and site instructions (ADR-0017).
create or replace function ecapital.can_manage_site_log(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('rfisInstructions', 'WRITE')
$$;

-- 0006, RULE (ADR-0017): a handover or condition-survey defect is a
-- contractual position on somebody else's work and stays with whoever writes
-- the contract; an inspection or work-order defect needs the defects row
-- alone. That is the technician's default and the reason for the two rows.
create or replace function ecapital.can_manage_defect(
  p_org_unit_id text, p_source ecapital.defect_source) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('defects', 'WRITE')
     and (p_source in ('INSPECTION', 'WORK_ORDER')
       or ecapital.allowed('contractRecords', 'WRITE'))
$$;

-- 0011. The cost ledger, the forecast inputs, the allocation rules, the
-- payment certificates and the cost warnings share one floor: any of the cost
-- rows that writes. Which step of a certificate a role may take is the
-- route's `@Needs` (paymentCertCreate / Engineer / Finance).
create or replace function ecapital.can_manage_cost(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.allowed('forecastWarnings', 'WRITE')
       or ecapital.allowed('sapImport', 'WRITE')
       or ecapital.allowed('budgetLines', 'WRITE')
       or ecapital.allowed('paymentCertCreate', 'WRITE')
       or ecapital.allowed('paymentCertEngineer', 'APPROVE')
       or ecapital.allowed('paymentCertFinance', 'APPROVE'))
$$;

-- 0011, ADR-0014: the budget lines behind the approved figure.
create or replace function ecapital.can_manage_budget_line(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('budgetLines', 'WRITE')
$$;

-- 0011, R14: who may put an unmatched row down on a project — whoever runs
-- the SAP import, and whoever runs a project's cost (the engineers, who read
-- cost all day). Where they may put it is still the row's own WITH CHECK.
create or replace function ecapital.can_allocate_unallocated() returns boolean
language sql stable parallel safe as $$
  select not ecapital.has_role('auditor_readonly')
     and not ecapital.has_role('executive_readonly')
     and (ecapital.allowed('sapImport', 'WRITE')
       or ecapital.allowed('forecastWarnings', 'WRITE'))
$$;

-- 0014. Attaching a document to a contract, a project, a variation, a
-- certificate or an asset: whoever writes one of the rows the paperwork
-- belongs to. Work-order photographs keep their own policy in 0022.
create or replace function ecapital.can_manage_document(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.allowed('contractRecords', 'WRITE')
       or ecapital.allowed('paymentCertFinance', 'APPROVE')
       or ecapital.allowed('assetDocuments', 'WRITE'))
$$;

-- 0015, R19: a shutdown request is raised and edited on permitRequest, started
-- and closed on permitOperate. Rejecting one (permitRequest APPROVE) and
-- deciding a clinical line (permitClinical APPROVE, and only the line that is
-- yours, §9) are the service's checks; the approver's own write still goes
-- through `permit_actionable_by`, which is about whose decision a permit is
-- waiting on and has no role list to move.
create or replace function ecapital.can_manage_permit(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.allowed('permitRequest', 'WRITE')
       or ecapital.allowed('permitOperate', 'WRITE'))
$$;

-- 0017, R26: the asset register.
create or replace function ecapital.can_manage_asset(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('assetRegister', 'WRITE')
$$;

-- 0017, CAPEX-01 §8: condition and meter readings — the technician's default.
create or replace function ecapital.can_record_asset_reading(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('assetCondition', 'WRITE')
$$;

-- 0022, ADR-0031 §10.
create or replace function ecapital.can_manage_maintenance_contract(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('maintenanceAgreement', 'MANAGE')
$$;

create or replace function ecapital.can_raise_work_order(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('workOrderRaise', 'WRITE')
$$;

create or replace function ecapital.can_work_work_order(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('workOrderWork', 'WRITE')
$$;

create or replace function ecapital.can_manage_backlog(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and ecapital.allowed('backlog', 'WRITE')
$$;

-- Not rewritten, and why (ADR-0033):
--   can_read_unit, can_read_contractor, can_read_unallocated — reading is
--     unit membership, not the matrix;
--   can_write_unit, sees_all_units — the floor;
--   clinical_approver_only, holds_approval_role, permit_visible_to_clinician,
--     permit_actionable_by — §9's narrow read and the approval routing, which
--     follow the approver scopes, not a role list;
--   can_manage_icra_matrix — Infection Control's own document, decided by an
--     approval capacity (`INFECTION_CONTROL`), and no row of the matrix is it;
--   can_manage_system_feed — the risers' feeds have no row of their own.

-- ---------------------------------------------- the policies, rewritten --

-- 0003: contract and boq_item were `can_manage_project`; variation too.
do $$
declare
  t text;
begin
  foreach t in array array['contract', 'boq_item']
  loop
    execute format('drop policy if exists %I on ecapital.%I', t || '_write', t);
    execute format(
      'create policy %I on ecapital.%I for all
         using (ecapital.can_manage_contract(org_unit_id))
         with check (ecapital.can_manage_contract(org_unit_id))',
      t || '_write', t);
  end loop;

  -- 0006: rfi and site_instruction were `can_manage_project`.
  foreach t in array array['rfi', 'site_instruction']
  loop
    execute format('drop policy if exists %I on ecapital.%I', t || '_write', t);
    execute format(
      'create policy %I on ecapital.%I for all
         using (ecapital.can_manage_site_log(org_unit_id))
         with check (ecapital.can_manage_site_log(org_unit_id))',
      t || '_write', t);
  end loop;
end $$;

drop policy if exists variation_write on ecapital.variation;
create policy variation_write on ecapital.variation
  for all using (ecapital.can_manage_variation(org_unit_id))
  with check (ecapital.can_manage_variation(org_unit_id));

-- 0011: an import batch and its exceptions span units, so they have no
-- `can_write_unit`; the two read-only roles are named instead, as
-- `can_allocate_unallocated` names them.
drop policy if exists import_batch_write on ecapital.import_batch;
create policy import_batch_write on ecapital.import_batch
  for all
  using (not ecapital.has_role('auditor_readonly') and not ecapital.has_role('executive_readonly')
         and ecapital.allowed('sapImport', 'WRITE'))
  with check (not ecapital.has_role('auditor_readonly') and not ecapital.has_role('executive_readonly')
              and ecapital.allowed('sapImport', 'WRITE'));

drop policy if exists import_exception_write on ecapital.import_exception;
create policy import_exception_write on ecapital.import_exception
  for all
  using (not ecapital.has_role('auditor_readonly') and not ecapital.has_role('executive_readonly')
         and ecapital.allowed('sapImport', 'WRITE'))
  with check (not ecapital.has_role('auditor_readonly') and not ecapital.has_role('executive_readonly')
              and ecapital.allowed('sapImport', 'WRITE'));

-- 0013: the budget-code reference list belongs with the budget lines.
drop policy if exists budget_code_write on ecapital.budget_code;
create policy budget_code_write on ecapital.budget_code
  for all
  using (not ecapital.has_role('auditor_readonly') and not ecapital.has_role('executive_readonly')
         and ecapital.allowed('budgetLines', 'WRITE'))
  with check (not ecapital.has_role('auditor_readonly') and not ecapital.has_role('executive_readonly')
              and ecapital.allowed('budgetLines', 'WRITE'));

-- 0020: the eFinance mirror is written by the push and the sync, which run as
-- the system (see `allowed`), and by an administrator's «Συγχρονισμός».
do $$
declare
  t text;
begin
  foreach t in array array['efinance_invoice', 'efinance_invoice_line', 'efinance_requisition',
                           'efinance_sync_state', 'efinance_vendor']
  loop
    execute format('drop policy if exists %I on ecapital.%I', t || '_write', t);
    execute format(
      'create policy %I on ecapital.%I for all
         using (ecapital.allowed(''efinance'', ''MANAGE''))
         with check (ecapital.allowed(''efinance'', ''MANAGE''))',
      t || '_write', t);
  end loop;
end $$;

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on ecapital.role_permission to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Said again for the reason every migration before it says it (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
