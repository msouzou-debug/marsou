-- eCapital M5 — Συντήρηση (maintenance).
--
-- R32 (PM schedules from uploaded SLAs), R33 (work orders with SLA timers and
-- escalation), R34 (failure / cause / remedy coding), R35 (backlog costed and
-- banded by risk), R36 (backlog-to-capital auto-draft), R37 (contractor
-- scorecard), R42 (audit log on every mutation). ADR-0031 records the
-- decisions; packages/shared/src/maintenance.ts is the contract.
--
-- Built from a real agreement: Γενικό Νοσοκομείο Λευκωσίας, Α.Ο 42/24, E&M
-- maintenance, six years, 24/7. Every system in it carries a band and three
-- times measured from the moment the call is sent — response, restore,
-- written report. The catalogue is data (`sla_system`), never code.
--
-- NO PATIENT DATA. A work order is a machine, a room, a clock and the name of
-- the member of staff who called it in. Never who was in the room. A column
-- added later that could hold anything about a person in a bed is a defect.
--
-- Written as plain SQL (ADR-0008): the row policies, the grants, the audit
-- triggers and the reference counter have no Drizzle representation.

-- ---------------------------------------------------------------- enums --

do $$
begin
  -- The contract's three priority bands, in its own order (ADR-0031 §2).
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'sla_band') then
    create type ecapital.sla_band as enum ('CRITICAL', 'P1', 'P2');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'pm_frequency') then
    create type ecapital.pm_frequency as enum (
      'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'maintenance_contract_status') then
    create type ecapital.maintenance_contract_status as enum ('ACTIVE', 'ENDED');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'work_order_kind') then
    create type ecapital.work_order_kind as enum ('CORRECTIVE', 'PM', 'STATUTORY');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'work_order_status') then
    create type ecapital.work_order_status as enum (
      'OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PAUSED', 'RESTORED', 'COMPLETED', 'CANCELLED');
  end if;

  -- Who raised the call (owner answer, 06/10/2026).
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'work_order_source') then
    create type ecapital.work_order_source as enum (
      'VENDOR_ONSITE', 'NURSING', 'TECHNICAL_SERVICES', 'PM_PROGRAMME', 'OTHER');
  end if;

  -- R34: three short lists a technician picks from on a phone (ADR-0031 §6).
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'failure_code') then
    create type ecapital.failure_code as enum (
      'NO_OUTPUT', 'DEGRADED', 'LEAK', 'NOISE_VIBRATION', 'ELECTRICAL_FAULT',
      'CONTROL_FAULT', 'ALARM', 'DAMAGE', 'OTHER');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'cause_code') then
    create type ecapital.cause_code as enum (
      'WEAR', 'LACK_OF_PM', 'MISUSE', 'POWER_SUPPLY', 'ENVIRONMENT', 'DESIGN',
      'EXTERNAL', 'UNKNOWN');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'remedy_code') then
    create type ecapital.remedy_code as enum (
      'REPAIR', 'REPLACE_PART', 'REPLACE_UNIT', 'ADJUST', 'CLEAN', 'RESET',
      'TEMPORARY_FIX', 'NO_FAULT_FOUND');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'work_order_event_kind') then
    create type ecapital.work_order_event_kind as enum (
      'CREATED', 'ACKNOWLEDGED', 'STARTED', 'PAUSED', 'RESUMED', 'RESTORED',
      'COMPLETED', 'CANCELLED', 'NOTE', 'ESCALATED', 'EXTENSION', 'CODED', 'PHOTO',
      'TO_BACKLOG', 'EDITED');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'backlog_kind') then
    create type ecapital.backlog_kind as enum ('REPAIR', 'REPLACEMENT', 'UPGRADE', 'STATUTORY');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'backlog_status') then
    create type ecapital.backlog_status as enum ('OPEN', 'FUNDED', 'DONE', 'DROPPED');
  end if;
  -- R36: why the system drafted an item by itself.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'backlog_auto_reason') then
    create type ecapital.backlog_auto_reason as enum (
      'THREE_CORRECTIVE_IN_12_MONTHS', 'REPAIR_COST_OVER_THRESHOLD');
  end if;
end $$;

-- ADR-0031 §11: a photograph or the contractor's report on a work order is a
-- document filed with eArchive. Nothing below reads the new label; the first
-- row that carries it is written by a request long after this has committed
-- (0009 and 0017 record why the ALTER is safe inside the transaction).
alter type ecapital.document_kind add value if not exists 'WORK_ORDER_DOCUMENT';

-- ------------------------------------------------ the agreement, R32 --

-- ADR-0031 §1: a maintenance agreement is its own record, not a capital
-- `contract`. It has no project, no BOQ and no certificate chain; it has a
-- contractor, dates, cover hours and the availability clause.
create table if not exists ecapital.maintenance_contract (
  id                  uuid primary key default gen_random_uuid(),
  org_unit_id         text not null references ecapital.org_unit (id) on delete restrict,
  contractor_id       uuid not null references ecapital.contractor (id) on delete restrict,
  -- The CAP- record when finance has registered one. The eFinance push stays
  -- with that record.
  contract_id         uuid references ecapital.contract (id) on delete set null,
  -- The tender or agreement number as written on the cover, «Α.Ο 42/24».
  ref                 text not null,
  title_el            text not null,
  start_date          date not null,
  end_date            date,
  round_the_clock     boolean not null default true,
  normal_hours_from   text not null default '07:30',
  normal_hours_to     text not null default '15:00',
  -- Contract clause: hours per year each system must be available.
  availability_hours_year integer not null default 8600,
  availability_penalty_critical_per_hour numeric(14, 2) not null default 5,
  availability_penalty_other_per_hour    numeric(14, 2) not null default 1,
  -- Penalties above this share of the contract value allow termination.
  penalty_cap_pct     numeric(5, 2) not null default 10,
  contract_value      numeric(14, 2),
  status              ecapital.maintenance_contract_status not null default 'ACTIVE',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_unit_id, ref),
  constraint maintenance_contract_dates check (end_date is null or end_date >= start_date),
  constraint maintenance_contract_hours_format
    check (normal_hours_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and normal_hours_to ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint maintenance_contract_availability_sane
    check (availability_hours_year between 1 and 8784),
  constraint maintenance_contract_rates_non_negative
    check (availability_penalty_critical_per_hour >= 0
       and availability_penalty_other_per_hour >= 0
       and (contract_value is null or contract_value >= 0)),
  constraint maintenance_contract_cap_pct check (penalty_cap_pct between 0 and 100),
  constraint maintenance_contract_ref_length check (char_length(btrim(ref)) between 1 and 60),
  constraint maintenance_contract_title_length check (char_length(btrim(title_el)) between 3 and 300)
);
create index if not exists maintenance_contract_unit_idx on ecapital.maintenance_contract (org_unit_id, status);
create index if not exists maintenance_contract_contractor_idx on ecapital.maintenance_contract (contractor_id);

comment on table ecapital.maintenance_contract is
  'ADR-0031 §1: the umbrella maintenance agreement one unit has with one contractor. Not a capital contract.';

-- One line of the contract's response-time table. The penalty rates are
-- nullable on purpose: the Nicosia table lost its amounts in the copy the
-- owner gave us, and the scorecard says «rates missing» instead of guessing
-- (ADR-0031 §2).
create table if not exists ecapital.sla_system (
  id                       uuid primary key default gen_random_uuid(),
  maintenance_contract_id  uuid not null references ecapital.maintenance_contract (id) on delete cascade,
  org_unit_id              text not null references ecapital.org_unit (id) on delete restrict,
  code                     text not null,
  name_el                  text not null,
  band                     ecapital.sla_band not null,
  response_hours           numeric(6, 2) not null,
  restore_hours            numeric(6, 2) not null,
  report_hours             numeric(6, 2) not null,
  pm_frequencies           ecapital.pm_frequency[] not null default '{}',
  penalty_pm_per_day       numeric(14, 2),
  penalty_response_per_hour numeric(14, 2),
  penalty_restore_per_hour numeric(14, 2),
  -- What register class and what shutdown system this line maps to, when it
  -- does. A corrective call on an asset of that class picks the line up.
  asset_class              ecapital.asset_class,
  permit_system            ecapital.permit_system,
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (maintenance_contract_id, code),
  constraint sla_system_hours_positive
    check (response_hours > 0 and restore_hours > 0 and report_hours > 0),
  constraint sla_system_rates_non_negative
    check ((penalty_pm_per_day is null or penalty_pm_per_day >= 0)
       and (penalty_response_per_hour is null or penalty_response_per_hour >= 0)
       and (penalty_restore_per_hour is null or penalty_restore_per_hour >= 0)),
  constraint sla_system_code_length check (char_length(btrim(code)) between 1 and 20),
  constraint sla_system_name_length check (char_length(btrim(name_el)) between 2 and 500)
);
create index if not exists sla_system_unit_idx on ecapital.sla_system (org_unit_id);
create index if not exists sla_system_class_idx on ecapital.sla_system (org_unit_id, asset_class)
  where asset_class is not null;

-- ----------------------------------------------- the programme, R32 --

-- One line of the preventive programme. The sweep turns it into a PM work
-- order `lead_days` before `next_due` and moves `next_due` on by the
-- frequency. The contract always follows the system: the trigger below takes
-- it, and the unit, from the `sla_system` row.
create table if not exists ecapital.pm_schedule (
  id                       uuid primary key default gen_random_uuid(),
  maintenance_contract_id  uuid not null references ecapital.maintenance_contract (id) on delete cascade,
  sla_system_id            uuid not null references ecapital.sla_system (id) on delete cascade,
  asset_id                 uuid references ecapital.asset (id) on delete set null,
  org_unit_id              text not null references ecapital.org_unit (id) on delete restrict,
  title_el                 text not null,
  frequency                ecapital.pm_frequency not null,
  checklist_el             text,
  next_due                 date not null,
  lead_days                integer not null default 14,
  active                   boolean not null default true,
  last_generated_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint pm_schedule_lead_days check (lead_days between 0 and 90),
  constraint pm_schedule_title_length check (char_length(btrim(title_el)) between 3 and 200)
);
create index if not exists pm_schedule_unit_idx on ecapital.pm_schedule (org_unit_id);
create index if not exists pm_schedule_contract_idx on ecapital.pm_schedule (maintenance_contract_id);
-- The sweep asks «which active lines are due inside their lead time».
create index if not exists pm_schedule_due_idx on ecapital.pm_schedule (next_due) where active;

-- ---------------------------------------------- work orders, R33/R34 --

create table if not exists ecapital.work_order (
  id                       uuid primary key default gen_random_uuid(),
  -- RULE (ADR-0031 §5, ADR-0014's pattern): `<UNITCODE>-WO-<YYYY>-<NNNN>`,
  -- allocated by ecapital.allocate_work_order_ref, immutable afterwards.
  ref                      text not null unique,
  org_unit_id              text not null references ecapital.org_unit (id) on delete restrict,
  kind                     ecapital.work_order_kind not null,
  status                   ecapital.work_order_status not null default 'OPEN',
  source                   ecapital.work_order_source not null,
  maintenance_contract_id  uuid references ecapital.maintenance_contract (id) on delete set null,
  sla_system_id            uuid references ecapital.sla_system (id) on delete set null,
  -- Copied from the system at the call, with the three deadlines, so a later
  -- change to the catalogue never rewrites history (ADR-0031 §3).
  band                     ecapital.sla_band,
  asset_id                 uuid references ecapital.asset (id) on delete set null,
  area_id                  uuid references ecapital.area (id) on delete set null,
  pm_schedule_id           uuid references ecapital.pm_schedule (id) on delete set null,
  title_el                 text not null,
  description_el           text,
  -- RULE (contract note *): every timer counts from the moment the call was sent.
  called_at                timestamptz not null,
  due_response_at          timestamptz,
  -- The restore deadline before any extension. Contract note 2 extends the
  -- restore time by working days; keeping the base is what lets a second
  -- extension replace the first instead of stacking on it.
  due_restore_base_at      timestamptz,
  due_restore_at           timestamptz,
  due_report_at            timestamptz,
  -- PM only: the programme date.
  due_date                 date,
  responded_at             timestamptz,
  started_at               timestamptz,
  restored_at              timestamptz,
  completed_at             timestamptz,
  report_received_at       timestamptz,
  cancelled_at             timestamptz,
  extension_days           integer not null default 0,
  extension_reason_el      text,
  failure_code             ecapital.failure_code,
  cause_code               ecapital.cause_code,
  remedy_code              ecapital.remedy_code,
  cost_estimate            numeric(14, 2),
  cost_actual              numeric(14, 2),
  parts_note_el            text,
  closeout_note_el         text,
  -- The contractor's technician, as a name typed on the order. Not a user:
  -- the vendor's staff have no account (ADR-0031 §5).
  assigned_to_el           text,
  -- Null when the programme sweep issued the order and nobody asked for it.
  raised_by                uuid references ecapital.app_user (id) on delete set null,
  -- Set once by the sweep when the response time passed unanswered (§4).
  escalated_at             timestamptz,
  backlog_item_id          uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- RULE (R34, ADR-0031 §6): a corrective order cannot complete uncoded.
  constraint work_order_completed_coded
    check (kind <> 'CORRECTIVE' or status <> 'COMPLETED'
       or (failure_code is not null and cause_code is not null and remedy_code is not null)),
  constraint work_order_cost_non_negative
    check ((cost_estimate is null or cost_estimate >= 0)
       and (cost_actual is null or cost_actual >= 0)),
  constraint work_order_extension_range check (extension_days between 0 and 60),
  constraint work_order_title_length check (char_length(btrim(title_el)) between 3 and 200),
  -- A PM order carries the programme date; a corrective one never does.
  constraint work_order_pm_due_date check (kind = 'PM' or due_date is null)
);
create index if not exists work_order_unit_idx on ecapital.work_order (org_unit_id, status);
create index if not exists work_order_called_idx on ecapital.work_order (called_at desc);
create index if not exists work_order_asset_idx on ecapital.work_order (asset_id, called_at)
  where asset_id is not null;
create index if not exists work_order_contract_idx on ecapital.work_order (maintenance_contract_id, called_at);
create index if not exists work_order_system_idx on ecapital.work_order (sla_system_id);
-- The escalation sweep: unanswered calls past their response time.
create index if not exists work_order_unanswered_idx on ecapital.work_order (due_response_at)
  where responded_at is null and escalated_at is null and status = 'OPEN';
-- RULE (R32, PmSchedule): one open PM order per schedule at a time. The
-- generator checks first; this is what makes a second sweep running at the
-- same moment unable to issue a duplicate.
create unique index if not exists work_order_one_open_pm on ecapital.work_order (pm_schedule_id)
  where pm_schedule_id is not null
    and status in ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PAUSED');

comment on column ecapital.work_order.ref is
  '<UNITCODE>-WO-<YYYY>-<NNNN>, allocated by ecapital.allocate_work_order_ref and never changed (ADR-0031 §5).';

-- The story of an order. Append-only: nothing updates or deletes a line
-- through a policy, so a step taken stays taken.
create table if not exists ecapital.work_order_event (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references ecapital.work_order (id) on delete cascade,
  org_unit_id    text not null references ecapital.org_unit (id) on delete restrict,
  at             timestamptz not null default now(),
  -- Null when the sweep wrote it.
  by_id          uuid references ecapital.app_user (id) on delete set null,
  kind           ecapital.work_order_event_kind not null,
  note_el        text,
  document_id    uuid references ecapital.document (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint work_order_event_note_length check (note_el is null or char_length(note_el) <= 4000)
);
create index if not exists work_order_event_order_idx on ecapital.work_order_event (work_order_id, at);

-- ---------------------------------------------------- backlog, R35 --

-- ADR-0031 §7: maintenance work the agreement will not absorb, banded with
-- the defect's four NHS ERIC bands. A defect is a handover snag on a capital
-- contract; this is not.
create table if not exists ecapital.backlog_item (
  id                    uuid primary key default gen_random_uuid(),
  org_unit_id           text not null references ecapital.org_unit (id) on delete restrict,
  kind                  ecapital.backlog_kind not null,
  title_el              text not null,
  description_el        text,
  risk_band             ecapital.risk_band not null,
  cost_estimate         numeric(14, 2),
  asset_id              uuid references ecapital.asset (id) on delete set null,
  sla_system_id         uuid references ecapital.sla_system (id) on delete set null,
  source_work_order_id  uuid references ecapital.work_order (id) on delete set null,
  auto_drafted          boolean not null default false,
  auto_reason           ecapital.backlog_auto_reason,
  -- R36: the order history the auto-draft attached. Read-only text.
  history_el            text,
  status                ecapital.backlog_status not null default 'OPEN',
  target_project_id     uuid references ecapital.project (id) on delete set null,
  -- Null when the R36 rule drafted it.
  raised_by             uuid references ecapital.app_user (id) on delete set null,
  raised_at             timestamptz not null default now(),
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint backlog_item_cost_non_negative check (cost_estimate is null or cost_estimate >= 0),
  -- RULE (R35): funded means a capital project is paying for it.
  constraint backlog_item_funded_has_project
    check (status <> 'FUNDED' or target_project_id is not null),
  -- An auto-drafted item says why; a typed one does not pretend to.
  constraint backlog_item_auto_reason
    check ((auto_drafted and auto_reason is not null) or (not auto_drafted and auto_reason is null)),
  constraint backlog_item_title_length check (char_length(btrim(title_el)) between 3 and 200)
);
create index if not exists backlog_item_unit_idx on ecapital.backlog_item (org_unit_id, status, risk_band);
create index if not exists backlog_item_asset_idx on ecapital.backlog_item (asset_id)
  where asset_id is not null;
-- RULE (R36, ADR-0031 §8): one OPEN auto-drafted item per asset. The rule
-- checks first; this is what holds when two completions race.
create unique index if not exists backlog_item_one_open_auto on ecapital.backlog_item (asset_id)
  where auto_drafted and status = 'OPEN' and asset_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'work_order_backlog_item_id_fkey'
                    and conrelid = 'ecapital.work_order'::regclass) then
    alter table ecapital.work_order
      add constraint work_order_backlog_item_id_fkey
      foreign key (backlog_item_id) references ecapital.backlog_item (id) on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------- the ref --

-- ADR-0014's machinery, a fifth time: a counter row per unit per year behind
-- a transaction-scoped advisory lock, SECURITY DEFINER so the number does not
-- depend on which rows the caller may read.
create table if not exists ecapital.work_order_ref_seq (
  org_unit_id text not null references ecapital.org_unit (id) on delete cascade,
  year        integer not null,
  next_seq    integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (org_unit_id, year)
);

create or replace function ecapital.allocate_work_order_ref(p_org_unit_id text, p_year integer)
returns text
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_seq  integer;
  v_code text;
begin
  select o.code into v_code from ecapital.org_unit o where o.id = p_org_unit_id;
  if v_code is null then
    raise exception 'no such org unit: %', p_org_unit_id using errcode = 'foreign_key_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('ecapital.work_order_ref'),
                                hashtext(p_org_unit_id || ':' || p_year::text));

  insert into ecapital.work_order_ref_seq (org_unit_id, year, next_seq)
    values (p_org_unit_id, p_year, 1)
    on conflict (org_unit_id, year) do nothing;

  update ecapital.work_order_ref_seq
     set next_seq = next_seq + 1, updated_at = now()
   where org_unit_id = p_org_unit_id and year = p_year
  returning next_seq - 1 into v_seq;

  -- Four digits: a hospital with ten thousand calls in a year is a hospital
  -- with a different problem, and the reference is read out over a phone.
  return format('%s-WO-%s-%s', v_code, p_year, lpad(v_seq::text, 4, '0'));
end $$;

-- A reference read out over the phone that later changed would be a call
-- nobody can find again. The same trigger ADR-0019 put on `contract.ref`.
create or replace function ecapital.refuse_work_order_ref_change() returns trigger
language plpgsql as $$
begin
  if new.ref is distinct from old.ref then
    raise exception 'ecapital.work_order.ref is immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists work_order_ref_immutable on ecapital.work_order;
create trigger work_order_ref_immutable
  before update of ref on ecapital.work_order
  for each row execute function ecapital.refuse_work_order_ref_change();

-- --------------------------------------------- denormalised org units --

-- Same reason as every child table before it (ADR-0010): the unit is a copy,
-- filled from the parent, so the policy compares a column instead of walking
-- the tree.
create or replace function ecapital.inherit_maintenance_org_unit() returns trigger
language plpgsql as $$
declare
  v_unit     text;
  v_contract uuid;
begin
  if tg_table_name = 'sla_system' then
    select c.org_unit_id into v_unit
      from ecapital.maintenance_contract c where c.id = new.maintenance_contract_id;
  elsif tg_table_name = 'pm_schedule' then
    -- The contract follows the system, so a schedule can never point at a
    -- line of one agreement and be counted against another.
    select s.org_unit_id, s.maintenance_contract_id into v_unit, v_contract
      from ecapital.sla_system s where s.id = new.sla_system_id;
    if v_contract is not null then new.maintenance_contract_id := v_contract; end if;
  elsif tg_table_name = 'work_order_event' then
    select w.org_unit_id into v_unit from ecapital.work_order w where w.id = new.work_order_id;
  end if;
  if v_unit is not null then new.org_unit_id := v_unit; end if;
  return new;
end $$;

drop trigger if exists sla_system_inherit_org_unit on ecapital.sla_system;
create trigger sla_system_inherit_org_unit
  before insert or update of maintenance_contract_id on ecapital.sla_system
  for each row execute function ecapital.inherit_maintenance_org_unit();

drop trigger if exists pm_schedule_inherit_org_unit on ecapital.pm_schedule;
create trigger pm_schedule_inherit_org_unit
  before insert or update of sla_system_id, maintenance_contract_id on ecapital.pm_schedule
  for each row execute function ecapital.inherit_maintenance_org_unit();

drop trigger if exists work_order_event_inherit_org_unit on ecapital.work_order_event;
create trigger work_order_event_inherit_org_unit
  before insert or update of work_order_id on ecapital.work_order_event
  for each row execute function ecapital.inherit_maintenance_org_unit();

-- ------------------------------------------------- who may do what --

-- ADR-0031 §10. The agreement and its catalogue are the head of estates' and
-- the administrator's. The two read-only roles are already refused by
-- can_write_unit and are not named again.
create or replace function ecapital.can_manage_maintenance_contract(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin') or ecapital.has_role('estates_head'))
$$;

-- RULE (owner answer, 06/10/2026): the nursing team is who notices, so the
-- clinical approver may raise a corrective call alongside the estate.
create or replace function ecapital.can_raise_work_order(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin')
       or ecapital.has_role('estates_head')
       or ecapital.has_role('project_engineer')
       or ecapital.has_role('technician')
       or ecapital.has_role('clinical_approver'))
$$;

-- Transitions, codes, costs and extensions: the estate's people, not the ward.
create or replace function ecapital.can_work_work_order(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin')
       or ecapital.has_role('estates_head')
       or ecapital.has_role('project_engineer')
       or ecapital.has_role('technician'))
$$;

create or replace function ecapital.can_manage_backlog(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin')
       or ecapital.has_role('estates_head')
       or ecapital.has_role('project_engineer'))
$$;

-- --------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array['maintenance_contract', 'sla_system', 'pm_schedule', 'work_order',
                           'work_order_event', 'backlog_item', 'work_order_ref_seq']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on ecapital.%I
         for each row execute function ecapital.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ------------------------------------------------- row-level security --

do $$
declare
  t text;
begin
  foreach t in array array['maintenance_contract', 'sla_system', 'pm_schedule', 'work_order',
                           'work_order_event', 'backlog_item', 'work_order_ref_seq']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
  end loop;
end $$;

-- Everyone who reads the unit reads all of it; the auditor and the executive
-- read everything and write nothing (ADR-0031 §10).
drop policy if exists maintenance_contract_read on ecapital.maintenance_contract;
create policy maintenance_contract_read on ecapital.maintenance_contract
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists maintenance_contract_write on ecapital.maintenance_contract;
create policy maintenance_contract_write on ecapital.maintenance_contract
  for all
  using (ecapital.can_manage_maintenance_contract(org_unit_id))
  with check (ecapital.can_manage_maintenance_contract(org_unit_id));

drop policy if exists sla_system_read on ecapital.sla_system;
create policy sla_system_read on ecapital.sla_system
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists sla_system_write on ecapital.sla_system;
create policy sla_system_write on ecapital.sla_system
  for all
  using (ecapital.can_manage_maintenance_contract(org_unit_id))
  with check (ecapital.can_manage_maintenance_contract(org_unit_id));

-- The programme is part of the agreement: the same two roles keep it, and
-- the generator that moves `next_due` runs as one of them or as the sweep.
drop policy if exists pm_schedule_read on ecapital.pm_schedule;
create policy pm_schedule_read on ecapital.pm_schedule
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists pm_schedule_write on ecapital.pm_schedule;
create policy pm_schedule_write on ecapital.pm_schedule
  for all
  using (ecapital.can_manage_maintenance_contract(org_unit_id))
  with check (ecapital.can_manage_maintenance_contract(org_unit_id));

-- RULE (ADR-0031 §10): raising and working are two different lists, so they
-- are two policies. Nobody deletes an order: a call made is a call made, and
-- one raised in error is CANCELLED with a reason.
drop policy if exists work_order_read on ecapital.work_order;
create policy work_order_read on ecapital.work_order
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists work_order_insert on ecapital.work_order;
create policy work_order_insert on ecapital.work_order
  for insert with check (ecapital.can_raise_work_order(org_unit_id));
drop policy if exists work_order_update on ecapital.work_order;
create policy work_order_update on ecapital.work_order
  for update
  using (ecapital.can_work_work_order(org_unit_id))
  with check (ecapital.can_work_work_order(org_unit_id));

-- The story is written by whoever may raise (a note from the ward is part of
-- it) and never rewritten: insert and select, nothing else.
drop policy if exists work_order_event_read on ecapital.work_order_event;
create policy work_order_event_read on ecapital.work_order_event
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists work_order_event_insert on ecapital.work_order_event;
create policy work_order_event_insert on ecapital.work_order_event
  for insert with check (ecapital.can_raise_work_order(org_unit_id));

drop policy if exists backlog_item_read on ecapital.backlog_item;
create policy backlog_item_read on ecapital.backlog_item
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists backlog_item_write on ecapital.backlog_item;
create policy backlog_item_write on ecapital.backlog_item
  for all
  using (ecapital.can_manage_backlog(org_unit_id))
  with check (ecapital.can_manage_backlog(org_unit_id));
-- RULE (R36, ADR-0031 §8): the replacement rule runs when a corrective order
-- completes, and the person completing it is usually the technician. So the
-- one row a technician may add to the backlog is the one the rule drafts —
-- insert only, auto-drafted only, never an edit of somebody's item.
drop policy if exists backlog_item_auto_draft on ecapital.backlog_item;
create policy backlog_item_auto_draft on ecapital.backlog_item
  for insert with check (auto_drafted and ecapital.can_work_work_order(org_unit_id));

-- ADR-0031 §11: a photograph from the plant room is taken by the technician
-- holding the phone, and the `document` row it makes is refused by
-- can_manage_document, which does not name the technician. This adds the one
-- narrow case — insert only, a work-order document, by whoever may work the
-- order — and leaves every other document exactly as 0014 left it.
drop policy if exists document_insert_work_order on ecapital.document;
create policy document_insert_work_order on ecapital.document
  for insert with check (
    entity_type = 'work_order'
    -- Compared as text: the label was added above, and PostgreSQL refuses
    -- to use a new enum value inside the transaction that added it.
    and kind::text = 'WORK_ORDER_DOCUMENT'
    and ecapital.can_work_work_order(org_unit_id));

-- The counter is nobody's to read (ADR-0014): row-level security on and no
-- policy at all, so the application role reaches it only through
-- allocate_work_order_ref.

-- R42: an order's trail opens to whoever may read its unit, as an asset's does.
drop policy if exists audit_log_read_maintenance on ecapital.audit_log;
create policy audit_log_read_maintenance on ecapital.audit_log
  for select using (
    entity_type in ('maintenance_contract', 'sla_system', 'pm_schedule', 'work_order',
                    'work_order_event', 'backlog_item')
    and ecapital.can_read_unit(org_unit_id));

-- ------------------------------------------- the eArchive queue's list --

-- ADR-0031 §11: photographs and the contractor's report are filed with
-- eArchive under `source_module: work_order_document`.
alter table ecapital.dms_outbox drop constraint if exists dms_outbox_module_known;
alter table ecapital.dms_outbox add constraint dms_outbox_module_known
  check (source_module in ('award', 'business_case', 'variation', 'permit',
                           'payment_cert', 'asset_document', 'work_order_document'));

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Said again for the reason every migration before it says it (R42), plus the
-- five counters, which move only through their allocate functions.
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
revoke all on ecapital.contract_ref_seq from ecapital_app;
revoke all on ecapital.permit_ref_seq from ecapital_app;
revoke all on ecapital.asset_tag_seq from ecapital_app;
revoke all on ecapital.work_order_ref_seq from ecapital_app;
