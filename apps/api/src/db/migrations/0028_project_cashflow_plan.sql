-- 0028 — a project's cash-flow plan, by month (ADR-0037, owner decision
-- 25/11/2026: «Projects need a cash-flow schedule»).
--
-- Until now the «Προγραμματισμένο» column of S04's cash flow was each year's
-- budget line divided by twelve (R17). That stays the fallback. A project
-- that has a plan reads its planned figures from here instead: one row per
-- month, an amount that is never negative, and an optional note.
--
-- The plan is not the budget. Its total may differ from the approved budget;
-- the API says by how much and nobody is stopped.
--
-- Who writes it: the same people who write the project's budget lines
-- (`budgetLines` WRITE, finance and the administrator by default). The row
-- policy says the same through `ecapital.can_manage_budget_line`, so a
-- script cannot do what the route refuses (ADR-0010, ADR-0014).
--
-- NO PATIENT DATA: months, money and a short note.
--
-- Self-contained and idempotent: `if not exists`, `create or replace`,
-- `drop … if exists` before every trigger and policy.

create table if not exists ecapital.project_cashflow_plan (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references ecapital.project (id) on delete cascade,
  -- Copied from the project by the trigger below, for the row policy.
  org_unit_id  text not null references ecapital.org_unit (id),
  period       text not null,
  amount       numeric(14, 2) not null,
  note         text,
  updated_by   uuid references ecapital.app_user (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint project_cashflow_plan_period_key unique (project_id, period),
  constraint project_cashflow_plan_period_month
    check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint project_cashflow_plan_amount_nonnegative check (amount >= 0),
  constraint project_cashflow_plan_note_length check (note is null or char_length(note) <= 500)
);

create index if not exists project_cashflow_plan_unit_idx
  on ecapital.project_cashflow_plan (org_unit_id);

-- ------------------------------------------------------- the unit copy --

-- 0002's function, as milestone, risk and issue use it: the unit comes from
-- the project, whatever the body says.
drop trigger if exists project_cashflow_plan_inherit_org_unit on ecapital.project_cashflow_plan;
create trigger project_cashflow_plan_inherit_org_unit
  before insert or update of project_id on ecapital.project_cashflow_plan
  for each row execute function ecapital.inherit_project_org_unit();

-- ---------------------------------------------------------------- audit --

drop trigger if exists project_cashflow_plan_audit on ecapital.project_cashflow_plan;
create trigger project_cashflow_plan_audit
  after insert or update or delete on ecapital.project_cashflow_plan
  for each row execute function ecapital.write_audit();

-- --------------------------------------------------- row-level security --

-- Read like the budget lines: whoever may read the unit. Write like the
-- budget lines: `budgetLines` WRITE in a unit the caller may write.
alter table ecapital.project_cashflow_plan enable row level security;

drop policy if exists project_cashflow_plan_read on ecapital.project_cashflow_plan;
create policy project_cashflow_plan_read on ecapital.project_cashflow_plan
  for select using (ecapital.can_read_unit(org_unit_id));

drop policy if exists project_cashflow_plan_write on ecapital.project_cashflow_plan;
create policy project_cashflow_plan_write on ecapital.project_cashflow_plan
  for all
  using (ecapital.can_manage_budget_line(org_unit_id))
  with check (ecapital.can_manage_budget_line(org_unit_id));

-- The cost screens' trail (0011's `audit_log_read_cost`) covers the plan
-- too, for the same readers. Policies are OR'd.
drop policy if exists audit_log_read_cashflow_plan on ecapital.audit_log;
create policy audit_log_read_cashflow_plan on ecapital.audit_log
  for select using (
    entity_type = 'project_cashflow_plan'
    and ecapital.can_read_unit(org_unit_id));

-- --------------------------------------------------------------- grants --

grant select, insert, update, delete on ecapital.project_cashflow_plan to ecapital_app;
