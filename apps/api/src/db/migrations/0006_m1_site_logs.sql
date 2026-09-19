-- eCapital M1 — the site log: rfi, site_instruction, defect.
--
-- R09 (RFI and site instruction logs with SLA timers), R12 (the defects list
-- at handover, tracked to close inside the defects liability period), R35
-- (backlog costed and banded by risk) and R42 (audit log on every mutation).
-- CAPEX-01 §4 is the column list, §2 is where the NHS ERIC risk bands come
-- from, §7 is warn-and-flag and §1 says a breach never blocks.
--
-- NO PATIENT DATA. Same rule as 0001, 0002 and 0003: nothing below holds a
-- patient name, identifier, diagnosis, episode or appointment. An RFI is a
-- question about the works, a site instruction is a direction to the
-- contractor, and a defect is something wrong with the building. `area_id`
-- points at a room, never at whoever is in it.
--
-- Every table added here gets its row-level-security policies and its audit
-- trigger in this same file (ADR-0008, ADR-0011), and the two rules that are
-- decisions rather than access — the instruction that may become a variation,
-- and the funded defect that needs somewhere to be funded from — are written
-- as CHECK constraints on top of the service rules, for the reason ADR-0015
-- gives: every one of them gets a second code path later (ADR-0017).

-- ---------------------------------------------------------------- enums --

do $$
begin
  -- OPEN → ANSWERED → CLOSED. There is no REJECTED: a question nobody can
  -- answer is answered with "we cannot answer this", which is an answer.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'rfi_status') then
    create type ecapital.rfi_status as enum ('OPEN', 'ANSWERED', 'CLOSED');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'defect_source') then
    create type ecapital.defect_source as enum (
      'HANDOVER', 'INSPECTION', 'WORK_ORDER', 'CONDITION_SURVEY');
  end if;
  -- NHS ERIC backlog bands (CAPEX-01 §2). The objective input to next year's
  -- capital programme, which is why they are an enum and not free text.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'risk_band') then
    create type ecapital.risk_band as enum ('HIGH', 'SIGNIFICANT', 'MODERATE', 'LOW');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'defect_status') then
    create type ecapital.defect_status as enum ('OPEN', 'IN_PROGRESS', 'CLOSED');
  end if;
end $$;

-- --------------------------------------------------------------- tables --

-- RULE (R09, CAPEX-01 §1): the SLA is a clock, not a gate. `sla_due_at` is
-- raised_at + slaDays × 24h and `sla_hours` is the length of that promise;
-- the band GREEN | AMBER | RED | BREACHED is computed from the two on the way
-- out and is deliberately not a column — a band that was stored would be
-- wrong the minute after it was written, and nothing in the system reads it
-- to decide whether a write may happen.
--
-- RULE (CAPEX-01 §1, ADR-0017): an RFI is a question put to the ΟΚΥπΥ side.
-- Staff raise it, staff attach the contractor's correspondence, and the
-- person who answers it may well be the person who raised it. There is
-- deliberately no segregation constraint here — the variation's one exists
-- because a variation moves money, and this does not.
create table if not exists ecapital.rfi (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references ecapital.contract (id) on delete cascade,
  org_unit_id  text not null references ecapital.org_unit (id) on delete restrict,
  -- 1..n per contract, allocated by ecapital.allocate_rfi_number below,
  -- never typed (the same reasoning as the variation number, ADR-0015).
  number       integer not null,
  question_el  text not null,
  answer_el    text,
  raised_by    uuid not null references ecapital.app_user (id) on delete restrict,
  raised_at    timestamptz not null default now(),
  answered_by  uuid references ecapital.app_user (id) on delete restrict,
  answered_at  timestamptz,
  sla_due_at   timestamptz not null,
  sla_hours    integer not null,
  status       ecapital.rfi_status not null default 'OPEN',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (contract_id, number),
  constraint rfi_number_positive check (number >= 1),
  constraint rfi_sla_hours_positive check (sla_hours > 0),
  -- An answer is three things at once or none of them.
  constraint rfi_answer_complete check (
    (answer_el is null and answered_by is null and answered_at is null)
    or (answer_el is not null and answered_by is not null and answered_at is not null)),
  -- RULE (R09): an RFI is closed after it has been answered and not before.
  -- The service refuses the early close with errors.rfiNotAnswered; this is
  -- what makes the refusal true of every code path (ADR-0015, ADR-0017).
  constraint rfi_answered_before_closed check (status = 'OPEN' or answered_at is not null)
);
create index if not exists rfi_contract_idx on ecapital.rfi (contract_id, number desc);
create index if not exists rfi_unit_idx on ecapital.rfi (org_unit_id);
create index if not exists rfi_status_idx on ecapital.rfi (status);
create index if not exists rfi_sla_due_idx on ecapital.rfi (sla_due_at) where status = 'OPEN';

create table if not exists ecapital.site_instruction (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references ecapital.contract (id) on delete cascade,
  org_unit_id      text not null references ecapital.org_unit (id) on delete restrict,
  number           integer not null,
  text_el          text not null,
  issued_by        uuid not null references ecapital.app_user (id) on delete restrict,
  issued_at        timestamptz not null default now(),
  -- RULE (CAPEX-01 §4, R09): an instruction with cost impact has to end up as
  -- a variation. The flag is what the contract's warnings cross-check.
  cost_impact_flag boolean not null default false,
  -- Set once, when somebody turns the instruction into a variation. Null
  -- until then, and it never goes back to null: the link is the record that
  -- the instruction was paid for.
  variation_id     uuid references ecapital.variation (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (contract_id, number),
  -- One variation belongs to one instruction. Two instructions pointing at
  -- the same change would double-count nothing and confuse everybody.
  unique (variation_id),
  constraint site_instruction_number_positive check (number >= 1),
  -- RULE (R09): an instruction with no cost impact has nothing to turn into.
  -- The service refuses it with errors.noCostImpact; the constraint is what
  -- makes the refusal a property of the data (ADR-0015, ADR-0017).
  constraint site_instruction_variation_needs_cost_impact
    check (variation_id is null or cost_impact_flag)
);
create index if not exists site_instruction_contract_idx
  on ecapital.site_instruction (contract_id, number desc);
create index if not exists site_instruction_unit_idx on ecapital.site_instruction (org_unit_id);

-- RULE (R12, ADR-0017): a defect always belongs to a unit. It may hang off a
-- contract (a snag found at handover), off a project (something the works
-- turned up), or off neither (a technician walking a plant room), so
-- `org_unit_id` is the one thing it can never be without: it is what decides
-- who may see it, and it is what the backlog is grouped by. The trigger below
-- takes it from the contract or the project where there is one, and the API
-- requires it in the body where there is not.
create table if not exists ecapital.defect (
  id                uuid primary key default gen_random_uuid(),
  org_unit_id       text not null references ecapital.org_unit (id) on delete restrict,
  source            ecapital.defect_source not null,
  contract_id       uuid references ecapital.contract (id) on delete set null,
  project_id        uuid references ecapital.project (id) on delete set null,
  area_id           uuid references ecapital.area (id) on delete set null,
  -- M6 asset register; text and unreferenced until the table exists.
  asset_id          text,
  description_el    text not null,
  -- M8 document register; empty until then (CAPEX-01 §8 queues them offline).
  photo_ids         text[] not null default '{}',
  estimated_cost    numeric(14, 2),
  -- NHS ERIC band (CAPEX-01 §2). Every defect carries one, funded or not:
  -- the band is what next year's programme is argued from.
  risk_band         ecapital.risk_band not null,
  funded            boolean not null default false,
  target_project_id uuid references ecapital.project (id) on delete set null,
  status            ecapital.defect_status not null default 'OPEN',
  raised_by         uuid not null references ecapital.app_user (id) on delete restrict,
  raised_at         timestamptz not null default now(),
  -- RULE (R12): a handover defect must close inside the defects liability
  -- period, so its due date is the contract's completion date plus its
  -- extensions plus defects_liability_months. Worked out by the API when the
  -- defect is raised; null for every other source, which has no such period.
  due_date          date,
  closed_at         timestamptz,
  closed_by         uuid references ecapital.app_user (id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint defect_cost_non_negative check (estimated_cost is null or estimated_cost >= 0),
  -- RULE (R35, CAPEX-01 §2): "funded" means a capital project is paying for
  -- it. Funded with nothing to pay for it is a figure in next year's backlog
  -- that nobody owns, so the API refuses it with errors.fundedNeedsProject
  -- and this refuses it whatever asks.
  constraint defect_funded_needs_project
    check (not funded or target_project_id is not null),
  -- A closing is a time and a person, or neither.
  constraint defect_closure_complete
    check ((closed_at is null and closed_by is null) or (closed_at is not null and closed_by is not null)),
  constraint defect_closed_has_closure
    check ((status = 'CLOSED') = (closed_at is not null))
);
create index if not exists defect_unit_idx on ecapital.defect (org_unit_id);
create index if not exists defect_contract_idx on ecapital.defect (contract_id);
create index if not exists defect_project_idx on ecapital.defect (project_id);
create index if not exists defect_target_project_idx on ecapital.defect (target_project_id);
create index if not exists defect_status_idx on ecapital.defect (status);
-- R35: the backlog groups open work by unit and band, so index the pair.
create index if not exists defect_backlog_idx on ecapital.defect (org_unit_id, risk_band)
  where status <> 'CLOSED';

-- ------------------------------------------------ denormalised org unit --

-- rfi and site_instruction hang off a contract, so 0003's function does it.
do $$
declare
  t text;
begin
  foreach t in array array['rfi', 'site_instruction']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_inherit_org_unit', t);
    execute format(
      'create trigger %I before insert or update of contract_id on ecapital.%I
         for each row execute function ecapital.inherit_contract_org_unit()',
      t || '_inherit_org_unit', t);
  end loop;
end $$;

-- A defect takes its unit from the contract where it has one, from the
-- project where it has one, and otherwise keeps what it was given — which is
-- what the API required in the body. It never ends up without one: the column
-- is NOT NULL, so a defect with no parent and no unit in the body is refused
-- by the database as well as by the service.
create or replace function ecapital.inherit_defect_org_unit() returns trigger
language plpgsql as $$
declare
  v_unit text;
begin
  if new.contract_id is not null then
    select c.org_unit_id into v_unit from ecapital.contract c where c.id = new.contract_id;
  elsif new.project_id is not null then
    select p.org_unit_id into v_unit from ecapital.project p where p.id = new.project_id;
  end if;
  if v_unit is not null then new.org_unit_id := v_unit; end if;
  return new;
end $$;

drop trigger if exists defect_inherit_org_unit on ecapital.defect;
create trigger defect_inherit_org_unit
  before insert or update of contract_id, project_id on ecapital.defect
  for each row execute function ecapital.inherit_defect_org_unit();

-- ------------------------------------------------------------ numbering --

-- ADR-0015's shape, twice over: the next number for a contract, allocated
-- inside the caller's transaction behind a transaction-scoped advisory lock
-- on the contract, so two engineers raising an RFI in the same second queue
-- instead of racing. The unique index on (contract_id, number) is the
-- backstop. SECURITY DEFINER so the maximum is over every row of the
-- contract, not only the ones the caller's policies let them read — a number
-- that depended on who was looking would not be a number.
create or replace function ecapital.allocate_rfi_number(p_contract_id uuid) returns integer
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_next integer;
begin
  if not exists (select 1 from ecapital.contract c where c.id = p_contract_id) then
    raise exception 'no such contract: %', p_contract_id using errcode = 'foreign_key_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ecapital.rfi_number'), hashtext(p_contract_id::text));
  select coalesce(max(r.number), 0) + 1 into v_next
    from ecapital.rfi r where r.contract_id = p_contract_id;
  return v_next;
end $$;

create or replace function ecapital.allocate_site_instruction_number(p_contract_id uuid)
returns integer
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_next integer;
begin
  if not exists (select 1 from ecapital.contract c where c.id = p_contract_id) then
    raise exception 'no such contract: %', p_contract_id using errcode = 'foreign_key_violation';
  end if;
  perform pg_advisory_xact_lock(
    hashtext('ecapital.site_instruction_number'), hashtext(p_contract_id::text));
  select coalesce(max(s.number), 0) + 1 into v_next
    from ecapital.site_instruction s where s.contract_id = p_contract_id;
  return v_next;
end $$;

-- --------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array['rfi', 'site_instruction', 'defect']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on ecapital.%I
         for each row execute function ecapital.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ------------------------------------------------- row-level security --

-- RULE (ADR-0017): the field persona. CAPEX-01 §2 wants Procore's field-first
-- capture — "photo, mark up, assign, done, in 30 seconds" — and §8 lists
-- defect capture among the five offline surfaces the technician works on. So
-- a technician writes defects, and only the two sources a technician actually
-- produces: what they found on an inspection round, and what a work order
-- turned up. A handover defect is a contractual position on somebody else's
-- work and stays with the people who run the contract.
--
-- Everything else about a defect follows the project register: whoever runs
-- projects in the unit writes them, and whoever may read the unit reads them.
create or replace function ecapital.can_manage_defect(
  p_org_unit_id text, p_source ecapital.defect_source) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_manage_project(p_org_unit_id)
      or (ecapital.has_role('technician')
          and ecapital.can_write_unit(p_org_unit_id)
          and p_source in ('INSPECTION', 'WORK_ORDER'))
$$;

do $$
declare
  t text;
begin
  foreach t in array array['rfi', 'site_instruction', 'defect']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_read', t);
    execute format(
      'create policy %I on ecapital.%I for select using (ecapital.can_read_unit(org_unit_id))',
      t || '_read', t);
  end loop;

  foreach t in array array['rfi', 'site_instruction']
  loop
    execute format('drop policy if exists %I on ecapital.%I', t || '_write', t);
    execute format(
      'create policy %I on ecapital.%I for all
         using (ecapital.can_manage_project(org_unit_id))
         with check (ecapital.can_manage_project(org_unit_id))',
      t || '_write', t);
  end loop;
end $$;

-- The technician clause is why the defect policy is written out rather than
-- generated with the other two: it is the only policy in the schema that
-- reads a second column of the row.
drop policy if exists defect_write on ecapital.defect;
create policy defect_write on ecapital.defect
  for all using (ecapital.can_manage_defect(org_unit_id, source))
  with check (ecapital.can_manage_defect(org_unit_id, source));

-- R42 and the contract page. 0002 opened a project's own trail to whoever may
-- read the unit and 0003 did the same for a contract's; the site log belongs
-- to the same people and for the same reason. Policies are OR'd, so this adds
-- to the ones already there. GET /audit-log stays admin and auditor only.
drop policy if exists audit_log_read_site on ecapital.audit_log;
create policy audit_log_read_site on ecapital.audit_log
  for select using (
    entity_type in ('rfi', 'site_instruction', 'defect')
    and ecapital.can_read_unit(org_unit_id));

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Said again for the same reason 0002 and 0003 say it: the grant above is
-- written `on all tables`, and the application reads the audit log and can
-- neither write to it nor take anything out of it (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
