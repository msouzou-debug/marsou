-- eCapital M1 — the contract register: contractor, contract, boq_item, variation.
--
-- R08 (contract register with BOQ, bond and retention terms), R10 (variation
-- workflow with reason coding and segregation of duties), R13 (the commitment
-- ledger: contract value plus approved variations), R31 (warn-and-flag, never
-- block) and R42 (audit log on every mutation). CAPEX-01 §4 is the column
-- list, §7 defines the commitment, §10 the segregation rule.
--
-- The system starts at the awarded contract (CAPEX-01 §1): the tender stage
-- stays in e-Procurement, so a contract needs a project that has reached
-- AWARDED and carries the award date and, later, the award decision document.
--
-- NO PATIENT DATA. Same rule as 0001 and 0002: nothing below holds a patient
-- name, identifier, diagnosis, episode or appointment. A contractor is a
-- company, a contract is a works agreement, a bill of quantities is a list of
-- building items, and a variation is a change to the works.
--
-- Every table added here gets its row-level-security policies and its audit
-- trigger in this same file (ADR-0008, ADR-0011). The segregation rule of R10
-- gets a CHECK constraint on top of the service rule, so no code path — not a
-- future endpoint, not a console session, not a repair script — can record a
-- variation approved by the person who raised it (ADR-0015).

-- ---------------------------------------------------------------- enums --

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'contractor_category') then
    create type ecapital.contractor_category as enum (
      'BUILDING', 'MECHANICAL', 'ELECTRICAL', 'BIOMEDICAL', 'IT', 'CONSULTANT', 'OTHER');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'contract_type') then
    create type ecapital.contract_type as enum (
      'LUMP_SUM', 'BOQ', 'FRAMEWORK', 'MEASURE_TERM', 'SUPPLY', 'SERVICE');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'variation_reason') then
    create type ecapital.variation_reason as enum (
      'CLIENT_CHANGE', 'SITE_CONDITION', 'DESIGN_ERROR', 'STATUTORY', 'OTHER');
  end if;
  -- DRAFT → SUBMITTED → APPROVED | RETURNED (back to the raiser, editable
  -- again) | REJECTED (final; a rejected change comes back as a new
  -- variation, never as an edit of this one). Only APPROVED counts towards
  -- the contract's current value.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'variation_status') then
    create type ecapital.variation_status as enum (
      'DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED');
  end if;
end $$;

-- --------------------------------------------------------------- tables --

-- A contractor works for the whole organisation, not for one hospital, so it
-- carries no org_unit_id and there is nothing to scope it by: the same
-- company holds contracts at Larnaca and at Paphos and the register has to
-- show one row, not two. Every signed-in user may read it; admin and the
-- heads of estates keep it (CAPEX-01 §10 does not name an owner for the
-- supplier register — flagged with the owner, ADR-0015).
create table if not exists ecapital.contractor (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  vat_number      text,
  registration_no text,
  category        ecapital.contractor_category not null default 'OTHER',
  sap_vendor_id   text,
  -- RULE (contract `Contractor`): a blacklisted contractor takes no new
  -- contract; the ones it already holds run to their end.
  blacklisted     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists contractor_category_idx on ecapital.contractor (category);

-- contract, boq_item and variation each keep a copy of org_unit_id although
-- it is reachable through the project, for the same reason floor, area,
-- milestone, risk and issue do (ADR-0010): the policy is then a column
-- comparison and not a walk up the tree. The triggers below fill it from the
-- parent and keep the copy honest.
create table if not exists ecapital.contract (
  id                         uuid primary key default gen_random_uuid(),
  project_id                 uuid not null references ecapital.project (id) on delete restrict,
  org_unit_id                text not null references ecapital.org_unit (id) on delete restrict,
  contractor_id              uuid not null references ecapital.contractor (id) on delete restrict,
  contract_no                text not null,
  type                       ecapital.contract_type not null,
  award_date                 date not null,
  -- M8 document register; null until it exists.
  award_decision_doc_id      text,
  original_value             numeric(14, 2) not null,
  -- RULE (CAPEX-01 §7, R13): current_value = original_value + the approved
  -- variations. It is maintained by ecapital.contract_current_value() below
  -- and is never typed: whatever a caller sends in this column is overwritten
  -- before the row lands.
  current_value              numeric(14, 2) not null default 0,
  currency                   text not null default 'EUR',
  start_date                 date,
  completion_date            date,
  extension_days             integer not null default 0,
  retention_pct              numeric(5, 2) not null default 0,
  performance_bond_value     numeric(14, 2),
  bond_expiry                date,
  liquidated_damages_per_day numeric(14, 2),
  defects_liability_months   integer not null default 0,
  sap_po_number              text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  -- The contract number comes from the award decision and is unique within
  -- the unit that issued it. Unique across the organisation would leak the
  -- existence of another unit's contract through the error message.
  unique (org_unit_id, contract_no),
  constraint contract_currency_eur check (currency = 'EUR'),
  constraint contract_original_value_non_negative check (original_value >= 0),
  constraint contract_current_value_non_negative check (current_value >= 0),
  constraint contract_retention_range check (retention_pct >= 0 and retention_pct <= 100),
  constraint contract_extension_non_negative check (extension_days >= 0),
  constraint contract_defects_months_non_negative check (defects_liability_months >= 0),
  constraint contract_bond_non_negative
    check (performance_bond_value is null or performance_bond_value >= 0),
  constraint contract_damages_non_negative
    check (liquidated_damages_per_day is null or liquidated_damages_per_day >= 0)
);
create index if not exists contract_project_idx on ecapital.contract (project_id);
create index if not exists contract_unit_idx on ecapital.contract (org_unit_id);
create index if not exists contract_contractor_idx on ecapital.contract (contractor_id);

create table if not exists ecapital.boq_item (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references ecapital.contract (id) on delete cascade,
  org_unit_id    text not null references ecapital.org_unit (id) on delete restrict,
  item_no        text not null,
  description_el text not null,
  unit           text not null,
  qty            numeric(14, 3) not null,
  rate           numeric(14, 2) not null,
  -- RULE (contract `BoqItem`): the amount is qty × rate and is derived, not
  -- typed. A generated column puts that where nobody can get it wrong.
  amount         numeric(14, 2) generated always as (round(qty * rate, 2)) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (contract_id, item_no)
);
create index if not exists boq_item_contract_idx on ecapital.boq_item (contract_id);
create index if not exists boq_item_unit_idx on ecapital.boq_item (org_unit_id);

create table if not exists ecapital.variation (
  id                  uuid primary key default gen_random_uuid(),
  contract_id         uuid not null references ecapital.contract (id) on delete cascade,
  org_unit_id         text not null references ecapital.org_unit (id) on delete restrict,
  -- 1..n per contract, allocated by ecapital.allocate_variation_number below,
  -- never typed (the same reasoning as the project code, ADR-0014).
  number              integer not null,
  description_el      text not null,
  reason              ecapital.variation_reason not null,
  -- May be negative: an omission is a variation too.
  value               numeric(14, 2) not null,
  time_impact_days    integer not null default 0,
  status              ecapital.variation_status not null default 'DRAFT',
  raised_by           uuid not null references ecapital.app_user (id) on delete restrict,
  raised_at           timestamptz not null default now(),
  decided_by          uuid references ecapital.app_user (id) on delete restrict,
  decided_at          timestamptz,
  decision_comment_el text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (contract_id, number),
  constraint variation_number_positive check (number >= 1),
  -- RULE (R10, CAPEX-01 §10): whoever approves a variation is never the
  -- person who raised it. The service refuses it with errors.sameUserApproval
  -- and answers 403; this constraint is what makes that refusal a property of
  -- the data rather than of one code path (ADR-0015).
  constraint variation_decider_not_raiser check (decided_by is null or decided_by <> raised_by),
  -- A decision has a decider and a time, or none of the three.
  constraint variation_decision_complete
    check ((decided_by is null and decided_at is null) or (decided_by is not null and decided_at is not null))
);
create index if not exists variation_contract_idx on ecapital.variation (contract_id, number desc);
create index if not exists variation_unit_idx on ecapital.variation (org_unit_id);
create index if not exists variation_status_idx on ecapital.variation (status);

-- ------------------------------------------------ denormalised org unit --

-- contract hangs off a project, so 0002's function already does the job.
drop trigger if exists contract_inherit_org_unit on ecapital.contract;
create trigger contract_inherit_org_unit
  before insert or update of project_id on ecapital.contract
  for each row execute function ecapital.inherit_project_org_unit();

create or replace function ecapital.inherit_contract_org_unit() returns trigger
language plpgsql as $$
declare
  v_unit text;
begin
  select c.org_unit_id into v_unit from ecapital.contract c where c.id = new.contract_id;
  new.org_unit_id := v_unit;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['boq_item', 'variation']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_inherit_org_unit', t);
    execute format(
      'create trigger %I before insert or update of contract_id on ecapital.%I
         for each row execute function ecapital.inherit_contract_org_unit()',
      t || '_inherit_org_unit', t);
  end loop;
end $$;

-- ------------------------------------------------ the commitment ledger --

-- RULE (CAPEX-01 §7, R13): the commitment on a contract is its original value
-- plus the variations that have been approved. Pending, returned and rejected
-- variations are not commitments — they are proposals — so they count for
-- nothing here.
--
-- A BEFORE trigger, so the derived figure is computed on the way in and there
-- is no window in which the stored column disagrees with the variations. It
-- runs on every insert and every update, which is what makes current_value
-- impossible to type: a body that carries one is simply overwritten.
--
-- SECURITY DEFINER so the sum is over every variation of the contract, not
-- only the ones the caller's policies let them read. A commitment that
-- depended on who was looking would not be a commitment.
create or replace function ecapital.contract_current_value() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  new.current_value := new.original_value + coalesce((
    select sum(v.value) from ecapital.variation v
     where v.contract_id = new.id and v.status = 'APPROVED'), 0);
  return new;
end $$;

drop trigger if exists contract_current_value on ecapital.contract;
create trigger contract_current_value
  before insert or update on ecapital.contract
  for each row execute function ecapital.contract_current_value();

-- Every write to a variation recomputes the contract it belongs to. The
-- contract row is touched only when the figure actually moves, so a variation
-- that goes from DRAFT to SUBMITTED leaves no "the contract changed" line in
-- the audit trail — nothing about the contract did.
create or replace function ecapital.variation_recompute_contract() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_contract uuid;
  v_should   numeric(14, 2);
  v_current  numeric(14, 2);
begin
  if tg_op = 'DELETE' then v_contract := old.contract_id; else v_contract := new.contract_id; end if;

  select c.current_value,
         c.original_value + coalesce((select sum(v.value) from ecapital.variation v
                                       where v.contract_id = c.id and v.status = 'APPROVED'), 0)
    into v_current, v_should
    from ecapital.contract c
   where c.id = v_contract;

  if v_should is null then return null; end if;
  if v_should is distinct from v_current then
    -- The BEFORE trigger above is what puts the number in; this only asks it to.
    update ecapital.contract set updated_at = now() where id = v_contract;
  end if;
  return null;
end $$;

drop trigger if exists variation_recompute_contract on ecapital.variation;
create trigger variation_recompute_contract
  after insert or update or delete on ecapital.variation
  for each row execute function ecapital.variation_recompute_contract();

-- ADR-0015. The next variation number for a contract, allocated inside the
-- caller's transaction, with a transaction-scoped advisory lock on the
-- contract so two engineers raising a variation in the same second queue
-- instead of racing: the second waits for the first to commit or roll back
-- and then reads the number the first left behind. The unique index on
-- (contract_id, number) is the backstop if anybody ever bypasses this.
--
-- SECURITY DEFINER so the maximum is over every variation of the contract,
-- for the same reason the commitment is.
create or replace function ecapital.allocate_variation_number(p_contract_id uuid) returns integer
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_next integer;
begin
  if not exists (select 1 from ecapital.contract c where c.id = p_contract_id) then
    raise exception 'no such contract: %', p_contract_id using errcode = 'foreign_key_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('ecapital.variation_number'), hashtext(p_contract_id::text));

  select coalesce(max(v.number), 0) + 1 into v_next
    from ecapital.variation v where v.contract_id = p_contract_id;
  return v_next;
end $$;

-- --------------------------------------------- the approved budget rule --

-- ADR-0014, owner decision of 19/09/2026: once a project is APPROVED or
-- later, only `finance` may change its approved budget. The register's write
-- policy gives the project to admin, the head of estates and the engineers
-- and deliberately does not give it to finance, so the change cannot go
-- through an ordinary UPDATE. It goes through this function, which changes
-- that one column and nothing else and checks the role itself — the service
-- refuses the other roles with errors.budgetFinanceOnly, and this is what
-- makes the refusal true of every code path rather than of that one.
--
-- Admin is not exempt. The segregation is the point.
create or replace function ecapital.set_approved_budget(p_project_id uuid, p_amount numeric)
returns boolean
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_unit text;
begin
  select p.org_unit_id into v_unit from ecapital.project p where p.id = p_project_id;
  if v_unit is null then return false; end if;
  if not ecapital.has_role('finance') then return false; end if;
  if not ecapital.can_write_unit(v_unit) then return false; end if;
  if p_amount is null or p_amount < 0 then return false; end if;

  update ecapital.project
     set approved_budget = p_amount, updated_at = now()
   where id = p_project_id;
  return true;
end $$;

-- --------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array['contractor', 'contract', 'boq_item', 'variation']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on ecapital.%I
         for each row execute function ecapital.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ------------------------------------------------- row-level security --

-- The supplier register is shared: every signed-in user reads it, because a
-- contract page has to be able to name its contractor whichever unit the
-- reader belongs to. `current_actor_id() is not null` is what "signed in"
-- means here — outside a request transaction it is null and the table is
-- readable by nobody.
create or replace function ecapital.can_read_contractor() returns boolean
language sql stable parallel safe as $$
  select ecapital.current_actor_id() is not null
$$;

-- CAPEX-01 §10 names no owner for the supplier register. Owner's answer:
-- admin and estates_head keep it; an engineer picks from it (ADR-0015).
create or replace function ecapital.can_manage_contractor() returns boolean
language sql stable parallel safe as $$
  select ecapital.current_actor_id() is not null
     and not ecapital.has_role('auditor_readonly')
     and not ecapital.has_role('executive_readonly')
     and (ecapital.has_role('admin') or ecapital.has_role('estates_head'))
$$;

alter table ecapital.contractor enable row level security;

drop policy if exists contractor_read on ecapital.contractor;
create policy contractor_read on ecapital.contractor
  for select using (ecapital.can_read_contractor());
drop policy if exists contractor_write on ecapital.contractor;
create policy contractor_write on ecapital.contractor
  for all using (ecapital.can_manage_contractor())
  with check (ecapital.can_manage_contractor());

-- contract, boq_item and variation follow the project they belong to:
-- whoever may read the unit reads them, whoever runs the register writes
-- them. Which of those writers may *decide* a variation is a narrower
-- question and is a role check on the route (estates_head and admin only),
-- on top of these policies.
do $$
declare
  t text;
begin
  foreach t in array array['contract', 'boq_item', 'variation']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_read', t);
    execute format(
      'create policy %I on ecapital.%I for select using (ecapital.can_read_unit(org_unit_id))',
      t || '_read', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_write', t);
    execute format(
      'create policy %I on ecapital.%I for all
         using (ecapital.can_manage_project(org_unit_id))
         with check (ecapital.can_manage_project(org_unit_id))',
      t || '_write', t);
  end loop;
end $$;

-- R42 and the contract page. 0002 opened a project's own trail to whoever may
-- read the unit; a contract's trail belongs to the same people and for the
-- same reason (ADR-0014, ADR-0015). GET /audit-log stays admin and auditor
-- only. Policies are OR'd, so this adds to the two already there.
drop policy if exists audit_log_read_contract on ecapital.audit_log;
create policy audit_log_read_contract on ecapital.audit_log
  for select using (
    entity_type in ('contract', 'boq_item', 'variation')
    and ecapital.can_read_unit(org_unit_id));

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- The grant above is written `on all tables`, so 0001's revoke has to be said
-- again: the application reads the audit log and can neither write to it nor
-- take anything out of it (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
