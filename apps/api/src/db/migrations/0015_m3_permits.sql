-- eCapital M3 — διακοπές συστήματος και άδειες εργασίας (shutdown and
-- permit-to-work), with the ICRA 2.0 matrix as versioned reference data.
--
-- R19 (shutdown request with system and area impact, including indirect),
-- R20 (ICRA 2.0 wizard producing class I–V from a versioned matrix),
-- R21 (ILSM trigger and interim measures), R22 (clinical approval routing
-- derived from the affected areas), R23 (permit print view, active-window
-- enforcement, overrun breach), R24 (closeout checklist with clinical
-- acceptance), R25 (network-wide disruption calendar with clash detection),
-- R42 (audit log on every mutation).
--
-- CAPEX-01 §6 is the module spec, §4 the column list, §9 the access rule
-- («clinical approvers see only permits touching their areas»), §11 the
-- theatre and ICU hours lost, §2 the ASHE ICRA 2.0 row — «Class II is never
-- valid for construction or renovation; Type C in a high-risk area is Class
-- IV, not III». ADR-0026 records what this file decides and every ASSUMPTION
-- it rests on.
--
-- NO PATIENT DATA. Same rule as every migration before it. A permit is a
-- decision about a building: which rooms are affected, which systems are off,
-- who said yes and when. `area.patient_risk_group` is the ICRA Table 2 band
-- of the room and a property of the building; nothing below can hold a
-- patient name, identifier, diagnosis, episode or appointment, and a column
-- added later that could is a defect.
--
-- Written as plain SQL (ADR-0008): the row policies, the grants, the audit
-- triggers and the two counters have no Drizzle representation.

-- ---------------------------------------------------------------- enums --

do $$
begin
  -- CAPEX-01 §4 `shutdown_permit.systems[]`.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'permit_system') then
    create type ecapital.permit_system as enum (
      'ELECTRICAL', 'HVAC', 'MEDICAL_GAS', 'WATER', 'FIRE', 'IT', 'STEAM', 'DRAINAGE');
  end if;

  -- What kind of work this is. The ICRA engine needs it for the one rule
  -- that refuses a cell outright (§6.2): Class II is invalid for
  -- construction or renovation.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'permit_work_kind') then
    create type ecapital.permit_work_kind as enum (
      'CONSTRUCTION', 'RENOVATION', 'MAINTENANCE', 'INSPECTION', 'OTHER');
  end if;

  -- ASHE ICRA 2.0 (2022) Table 1: activity type A–D.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'icra_activity_type') then
    create type ecapital.icra_activity_type as enum ('A', 'B', 'C', 'D');
  end if;

  -- Table 3: the class of precautions, I–V, in Latin numerals (CAPEX-02 §7).
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'icra_class') then
    create type ecapital.icra_class as enum ('I', 'II', 'III', 'IV', 'V');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'icra_matrix_status') then
    create type ecapital.icra_matrix_status as enum ('DRAFT', 'ACTIVE', 'RETIRED');
  end if;

  -- §6.1: DIRECT is what the engineer picked, INDIRECT is what a system feed
  -- says is downstream. Both count for routing and for the risk group.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'permit_impact') then
    create type ecapital.permit_impact as enum ('DIRECT', 'INDIRECT');
  end if;

  -- CAPEX-01 §4 `permit_approval.role` plus WARD_MANAGER, which §6.4 names
  -- («ward/department manager for every clinical area touched») and §4 omits.
  -- ASSUMPTION — ADR-0026, Errata.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'approval_role') then
    create type ecapital.approval_role as enum (
      'INFECTION_CONTROL', 'WARD_MANAGER', 'NURSING', 'TECHNICAL', 'SAFETY',
      'HOSPITAL_DIRECTOR');
  end if;

  -- Why a line is on the route. Shown in the inbox and on the printed permit,
  -- so it is stored rather than re-derived — the reason a permit was routed
  -- somewhere must still read the same after the matrix has moved on.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'routing_reason') then
    create type ecapital.routing_reason as enum (
      'classThreeOrAbove', 'clinicalAreaTouched', 'inpatientAreaTouched',
      'always', 'ilsmRequired', 'durationAboveThreshold', 'classFive');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'approval_decision') then
    create type ecapital.approval_decision as enum (
      'PENDING', 'APPROVED', 'RETURNED', 'REJECTED');
  end if;

  -- CAPEX-01 §4 plus BREACH: §6.5 says an overrun «flips it to breach», which
  -- is a state the calendar and the banner show.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'permit_status') then
    create type ecapital.permit_status as enum (
      'DRAFT', 'SUBMITTED', 'CLINICAL_REVIEW', 'APPROVED', 'ACTIVE', 'BREACH',
      'CLOSED', 'REJECTED');
  end if;

  -- §6.7. Warnings, never blocks.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'permit_clash_kind') then
    create type ecapital.permit_clash_kind as enum (
      'REDUNDANT_HALVES', 'TWO_THEATRES', 'SAME_AREA_OVERLAP');
  end if;
end $$;

-- ------------------------------------------------- the ICRA matrix, R20 --

-- RULE (§6.2, §2): «Ship the matrix as reference data with a version and
-- effective date; ΟΚΥπΥ Infection Control approves the local edition and can
-- amend it without a release.» So a change is a **new version**, never an
-- edit of a cell: a permit decided under 2026.1 has to keep reading as it was
-- decided, whatever Infection Control does next year. `permit.icra` stores
-- the version id it was evaluated against for exactly that reason.
create table if not exists ecapital.icra_matrix_version (
  id               text primary key,
  based_on         text not null,
  effective_from   date not null,
  approved_by_name text,
  approved_at      timestamptz,
  status           ecapital.icra_matrix_status not null default 'DRAFT',
  notes_el         text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One ACTIVE edition at a time. The wizard asks for «the matrix» and there
-- has to be exactly one answer; activating a version retires the one before.
create unique index if not exists icra_matrix_version_one_active
  on ecapital.icra_matrix_version ((status)) where status = 'ACTIVE';

create table if not exists ecapital.icra_matrix_cell (
  id            uuid primary key default gen_random_uuid(),
  version_id    text not null references ecapital.icra_matrix_version (id) on delete cascade,
  activity_type ecapital.icra_activity_type not null,
  risk_group    ecapital.patient_risk_group not null,
  icra_class    ecapital.icra_class not null,
  -- The mandatory controls of that class, bilingual, each with a stable id
  -- so the wizard can record that the requester acknowledged every one.
  controls      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (version_id, activity_type, risk_group),
  constraint icra_matrix_cell_controls_is_array check (jsonb_typeof(controls) = 'array')
);
create index if not exists icra_matrix_cell_version_idx on ecapital.icra_matrix_cell (version_id);

-- ------------------------------------------- system feeds, R19 (§6.1) --

-- RULE (§6.1): «Pulling a riser feeds theatres two floors up — model that
-- with serves_area_ids on the asset, and warn on indirect impact.» The asset
-- register is M4 and the permit module is M3, so until `asset.serves_area_ids`
-- exists a `system_feed` row says which areas a system serves from a given
-- source. ASSUMPTION — a seam, not a second model: M4 replaces the query
-- behind GET /areas/impact and nothing above it changes (ADR-0026).
create table if not exists ecapital.system_feed (
  id              uuid primary key default gen_random_uuid(),
  org_unit_id     text not null references ecapital.org_unit (id) on delete restrict,
  system          ecapital.permit_system not null,
  -- null = the whole unit, e.g. the main LV board.
  source_area_id  uuid references ecapital.area (id) on delete set null,
  serves_area_ids uuid[] not null default '{}',
  label_el        text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists system_feed_unit_idx on ecapital.system_feed (org_unit_id, system);
create index if not exists system_feed_source_idx on ecapital.system_feed (source_area_id);

-- ---------------------------------------------- the permit, R19 to R24 --

create table if not exists ecapital.shutdown_permit (
  id                  uuid primary key default gen_random_uuid(),
  -- PTW-<UNITCODE>-<YYYY>-<NNN>, allocated on SUBMITTED and never after.
  -- ASSUMPTION on the prefix (ADR-0026): nothing in the briefs names one, and
  -- «permit to work» is what the paper form at the pilot hospital is called.
  ref                 text unique,
  org_unit_id         text not null references ecapital.org_unit (id) on delete restrict,
  project_id          uuid references ecapital.project (id) on delete set null,
  contract_id         uuid references ecapital.contract (id) on delete set null,
  title_el            text not null,
  description_el      text not null default '',
  work_kind           ecapital.permit_work_kind not null,
  systems             ecapital.permit_system[] not null,
  planned_start       timestamptz not null,
  planned_end         timestamptz not null,
  actual_start        timestamptz,
  actual_end          timestamptz,
  -- The engine's answer, stored whole: class, controls, the area that set the
  -- risk group and the matrix version it was decided under (§6.2).
  icra                jsonb,
  -- Denormalised out of `icra` so the list, the calendar and §11's hours can
  -- filter and group on it without unpacking jsonb on every row.
  icra_class          ecapital.icra_class,
  surrounding         jsonb not null default '[]'::jsonb,
  ilsm                jsonb,
  contingency_plan_el text,
  status              ecapital.permit_status not null default 'DRAFT',
  closeout            jsonb,
  clashes             jsonb not null default '[]'::jsonb,
  requested_by        uuid not null references ecapital.app_user (id) on delete restrict,
  requested_at        timestamptz not null default now(),
  submitted_at        timestamptz,
  approved_at         timestamptz,
  closed_by           uuid references ecapital.app_user (id) on delete restrict,
  closed_at           timestamptz,
  -- RULE (§6.5): overrun = now past planned_end while ACTIVE. Stamped by the
  -- breach job, never by a caller.
  breached_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint permit_window_ordered check (planned_end > planned_start),
  constraint permit_actual_window_ordered
    check (actual_end is null or actual_start is null or actual_end >= actual_start),
  -- RULE (§6.2, §6.4): a permit is not submitted before the ICRA has run.
  -- The service refuses it with errors.permitIcraRequired; this says the same
  -- to every other code path (ADR-0015's reasoning).
  constraint permit_submitted_needs_icra
    check (status in ('DRAFT', 'REJECTED') or icra is not null),
  constraint permit_submitted_needs_ref
    check (status = 'DRAFT' or ref is not null),
  constraint permit_class_matches_icra
    check ((icra is null and icra_class is null) or (icra is not null and icra_class is not null)),
  -- RULE (§6.5): live only inside its window, and it started when it started.
  constraint permit_active_has_start
    check (status not in ('ACTIVE', 'BREACH') or actual_start is not null),
  constraint permit_breach_has_time
    check (status <> 'BREACH' or breached_at is not null),
  -- RULE (§6.6): «No closeout, no permit closure.» A closure is a checklist,
  -- a person and a time, or it is not a closure.
  constraint permit_closed_complete
    check (status <> 'CLOSED'
           or (closeout is not null and closed_by is not null
               and closed_at is not null and actual_end is not null)),
  constraint permit_approved_has_time
    check (status not in ('APPROVED', 'ACTIVE', 'BREACH', 'CLOSED') or approved_at is not null)
);
create index if not exists shutdown_permit_unit_idx on ecapital.shutdown_permit (org_unit_id, status);
create index if not exists shutdown_permit_project_idx on ecapital.shutdown_permit (project_id);
create index if not exists shutdown_permit_window_idx
  on ecapital.shutdown_permit (planned_start, planned_end);
-- The breach job asks one question a minute: which ACTIVE permits are past
-- their end. CAPEX-01 §12 wants the portfolio queries under 500ms and this
-- one runs 1440 times a day.
create index if not exists shutdown_permit_overrun_idx
  on ecapital.shutdown_permit (planned_end) where status = 'ACTIVE';

-- RULE (§6.1): one row per area the permit touches, DIRECT or INDIRECT, with
-- the system that carried the indirect impact. DIRECT wins on a dedupe — an
-- area the engineer picked is not downgraded by also being downstream.
create table if not exists ecapital.shutdown_permit_area (
  id          uuid primary key default gen_random_uuid(),
  permit_id   uuid not null references ecapital.shutdown_permit (id) on delete cascade,
  area_id     uuid not null references ecapital.area (id) on delete restrict,
  org_unit_id text not null references ecapital.org_unit (id) on delete restrict,
  impact      ecapital.permit_impact not null,
  via_system  ecapital.permit_system,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (permit_id, area_id),
  -- An indirect area is indirect because of a system. A direct one is not.
  constraint permit_area_via_system_only_indirect
    check ((impact = 'INDIRECT') = (via_system is not null))
);
create index if not exists shutdown_permit_area_permit_idx
  on ecapital.shutdown_permit_area (permit_id);
create index if not exists shutdown_permit_area_area_idx on ecapital.shutdown_permit_area (area_id);

-- CAPEX-01 §4 `permit_approval`, with the routing reason and the SLA clock
-- R09 already built for the RFI (ADR-0017): a due moment and the length of
-- the promise, and the band computed on the way out, never stored.
create table if not exists ecapital.permit_approval (
  id           uuid primary key default gen_random_uuid(),
  permit_id    uuid not null references ecapital.shutdown_permit (id) on delete cascade,
  org_unit_id  text not null references ecapital.org_unit (id) on delete restrict,
  role         ecapital.approval_role not null,
  reason       ecapital.routing_reason not null,
  -- For WARD_MANAGER: which area this line is for. Null for unit-wide roles.
  area_id      uuid references ecapital.area (id) on delete restrict,
  approver_id  uuid references ecapital.app_user (id) on delete restrict,
  decision     ecapital.approval_decision not null default 'PENDING',
  comment_el   text,
  decided_at   timestamptz,
  due_at       timestamptz not null,
  sla_hours    integer not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One line per role per area per permit. Two WARD_MANAGER lines on one
  -- theatre would ask the same person twice and count the route wrong.
  unique (permit_id, role, area_id),
  constraint permit_approval_sla_positive check (sla_hours > 0),
  -- A decision is a verdict and a time, or neither.
  constraint permit_approval_decided_complete
    check ((decision = 'PENDING') = (decided_at is null)),
  -- RULE (§6.4, UI S14): «Επιστροφή με σχόλια» — a return and a rejection
  -- both carry the reason. An approval need not.
  constraint permit_approval_return_needs_comment
    check (decision not in ('RETURNED', 'REJECTED')
           or (comment_el is not null and length(btrim(comment_el)) > 0))
);
create index if not exists permit_approval_permit_idx on ecapital.permit_approval (permit_id);
create index if not exists permit_approval_approver_idx
  on ecapital.permit_approval (approver_id, decision);
create index if not exists permit_approval_unit_idx on ecapital.permit_approval (org_unit_id);

-- ------------------------------------------------- who approves what --

-- RULE (§6.4, §9): approvers «derive from the affected areas», and a clinical
-- approver «sees only permits touching their areas and nothing else». That
-- needs a table saying which areas somebody is the clinical owner of, and in
-- which capacity. CAPEX-01 §4 has `area.clinical_owner_group_id` — an Entra
-- group — which ADR-0020 has already replaced everywhere else with per-user
-- assignment, so this follows ADR-0020 and not §4. ASSUMPTION (ADR-0026).
create table if not exists ecapital.area_clinical_owner (
  id            uuid primary key default gen_random_uuid(),
  area_id       uuid not null references ecapital.area (id) on delete cascade,
  user_id       uuid not null references ecapital.app_user (id) on delete cascade,
  org_unit_id   text not null references ecapital.org_unit (id) on delete restrict,
  approval_role ecapital.approval_role not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (area_id, user_id, approval_role)
);
create index if not exists area_clinical_owner_area_idx on ecapital.area_clinical_owner (area_id);
create index if not exists area_clinical_owner_user_idx on ecapital.area_clinical_owner (user_id);

-- The unit-wide capacities: TECHNICAL, SAFETY, HOSPITAL_DIRECTOR, and the
-- Infection Control and Nursing officers, who answer for the whole hospital
-- rather than for one room.
create table if not exists ecapital.unit_approver (
  id            uuid primary key default gen_random_uuid(),
  org_unit_id   text not null references ecapital.org_unit (id) on delete cascade,
  user_id       uuid not null references ecapital.app_user (id) on delete cascade,
  approval_role ecapital.approval_role not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_unit_id, user_id, approval_role)
);
create index if not exists unit_approver_unit_idx on ecapital.unit_approver (org_unit_id, approval_role);
create index if not exists unit_approver_user_idx on ecapital.unit_approver (user_id);

-- ------------------------------------------------------ the inbox, S14 --

-- Unread is per person and per item and nothing else. It is not a decision,
-- it is not audited as one, and it never gates anything.
create table if not exists ecapital.inbox_read (
  user_id  uuid not null references ecapital.app_user (id) on delete cascade,
  item_id  text not null,
  read_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- ------------------------------------------------------------ the ref --

-- ADR-0014's machinery, a third time: a counter row per unit per year behind
-- a transaction-scoped advisory lock, SECURITY DEFINER so the maximum is over
-- every row and not only the ones the caller may read. A number that depended
-- on who was looking would not be a number.
create table if not exists ecapital.permit_ref_seq (
  org_unit_id text not null references ecapital.org_unit (id) on delete cascade,
  year        integer not null,
  next_seq    integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (org_unit_id, year)
);

create or replace function ecapital.allocate_permit_ref(p_org_unit_id text, p_year integer)
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

  perform pg_advisory_xact_lock(hashtext('ecapital.permit_ref'),
                                hashtext(p_org_unit_id || ':' || p_year::text));

  insert into ecapital.permit_ref_seq (org_unit_id, year, next_seq)
    values (p_org_unit_id, p_year, 1)
    on conflict (org_unit_id, year) do nothing;

  update ecapital.permit_ref_seq
     set next_seq = next_seq + 1, updated_at = now()
   where org_unit_id = p_org_unit_id and year = p_year
  returning next_seq - 1 into v_seq;

  -- PTW-<UNITCODE>-<YYYY>-<NNN>. Three digits: a hospital that needs a
  -- thousand shutdown permits in one year has a different problem.
  return format('PTW-%s-%s-%s', v_code, p_year, lpad(v_seq::text, 3, '0'));
end $$;

comment on column ecapital.shutdown_permit.ref is
  'PTW-<UNITCODE>-<YYYY>-<NNN>, allocated by ecapital.allocate_permit_ref on submission and never changed. The prefix is an ASSUMPTION (ADR-0026).';

-- --------------------------------------------- denormalised org units --

-- Same reason as every child table before it (ADR-0010): the unit is a copy,
-- filled from the parent, so the policy compares a column instead of walking
-- the tree.
create or replace function ecapital.inherit_permit_org_unit() returns trigger
language plpgsql as $$
declare
  v_unit text;
begin
  select p.org_unit_id into v_unit
    from ecapital.shutdown_permit p where p.id = new.permit_id;
  if v_unit is not null then new.org_unit_id := v_unit; end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['shutdown_permit_area', 'permit_approval']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_inherit_org_unit', t);
    execute format(
      'create trigger %I before insert or update of permit_id on ecapital.%I
         for each row execute function ecapital.inherit_permit_org_unit()',
      t || '_inherit_org_unit', t);
  end loop;
end $$;

create or replace function ecapital.inherit_area_owner_org_unit() returns trigger
language plpgsql as $$
declare
  v_unit text;
begin
  select a.org_unit_id into v_unit from ecapital.area a where a.id = new.area_id;
  if v_unit is not null then new.org_unit_id := v_unit; end if;
  return new;
end $$;

drop trigger if exists area_clinical_owner_inherit_org_unit on ecapital.area_clinical_owner;
create trigger area_clinical_owner_inherit_org_unit
  before insert or update of area_id on ecapital.area_clinical_owner
  for each row execute function ecapital.inherit_area_owner_org_unit();

-- The ref is printed on paper and posted on the barrier (§6.5). A reference
-- that can be edited is a reference that eventually points at a different
-- permit, so the same trigger ADR-0019 put on `contract.ref` goes here.
create or replace function ecapital.refuse_permit_ref_change() returns trigger
language plpgsql as $$
begin
  if old.ref is not null and new.ref is distinct from old.ref then
    raise exception 'ecapital.shutdown_permit.ref is immutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists shutdown_permit_ref_immutable on ecapital.shutdown_permit;
create trigger shutdown_permit_ref_immutable
  before update of ref on ecapital.shutdown_permit
  for each row execute function ecapital.refuse_permit_ref_change();

-- RULE (§6.6, CAPEX-01 §10): a rejected or closed permit is immutable. The
-- service says so first; this says it to every other code path. Reopening is
-- a new request, because the closed one is the record that the area was
-- handed back.
create or replace function ecapital.refuse_settled_permit_change() returns trigger
language plpgsql as $$
begin
  if old.status in ('CLOSED', 'REJECTED') then
    raise exception 'permit % is % and cannot be changed', old.id, old.status
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists shutdown_permit_settled_immutable on ecapital.shutdown_permit;
create trigger shutdown_permit_settled_immutable
  before update on ecapital.shutdown_permit
  for each row execute function ecapital.refuse_settled_permit_change();

-- -------------------------------------------------- who is who, in SQL --

-- These four answer «is the caller this permit's business» for the policies
-- below. All SECURITY DEFINER: each reads a table whose own policy reads
-- `shutdown_permit`, and a policy that asks a policy that asks it back is an
-- infinite recursion, not an access rule.

/** Does the caller hold this approval capacity anywhere, unit-wide or by area? */
create or replace function ecapital.holds_approval_role(p_role ecapital.approval_role)
returns boolean
language sql stable security definer set search_path = ecapital, pg_catalog as $$
  select ecapital.current_actor_id() is not null
     and (exists (select 1 from ecapital.unit_approver ua
                    join ecapital.app_user u on u.id = ua.user_id
                   where ua.approval_role = p_role
                     and u.subject = ecapital.current_actor_id())
       or exists (select 1 from ecapital.area_clinical_owner aco
                    join ecapital.app_user u on u.id = aco.user_id
                   where aco.approval_role = p_role
                     and u.subject = ecapital.current_actor_id()))
$$;

/**
 * CAPEX-01 §9: «Clinical approvers see only permits touching their areas and
 * nothing else.» This is «their areas», read exactly: a line on the permit
 * assigned to them, or an area of the permit they are the clinical owner of.
 */
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
$$;

/**
 * Who may write to a permit row without running the project register: the
 * people whose decision the permit is waiting on. An approver deciding a line
 * moves the permit's own status, and the person who signs the clinical
 * acceptance closes it (§6.6), so both need the row.
 *
 * What they may change is the service's business and is checked there. This
 * only says the row is theirs to touch at all.
 */
create or replace function ecapital.permit_actionable_by(p_permit_id uuid, p_org_unit_id text)
returns boolean
language sql stable security definer set search_path = ecapital, pg_catalog as $$
  select ecapital.current_actor_id() is not null
     and not ecapital.has_role('auditor_readonly')
     and not ecapital.has_role('executive_readonly')
     and (ecapital.permit_visible_to_clinician(p_permit_id)
       or exists (select 1 from ecapital.unit_approver ua
                    join ecapital.app_user u on u.id = ua.user_id
                   where ua.org_unit_id = p_org_unit_id
                     and u.subject = ecapital.current_actor_id()))
$$;

/** Is this caller an approver and nothing else? Then §9's narrow read applies. */
create or replace function ecapital.clinical_approver_only() returns boolean
language sql stable parallel safe as $$
  select ecapital.has_role('clinical_approver')
     and not ecapital.has_role('admin')
     and not ecapital.has_role('estates_head')
     and not ecapital.has_role('project_engineer')
     and not ecapital.has_role('technician')
     and not ecapital.has_role('finance')
     and not ecapital.has_role('auditor_readonly')
     and not ecapital.has_role('executive_readonly')
$$;

-- R19, CAPEX-01 §10: the engineer raises a shutdown request, the head of
-- estates and the administrator do too. The same three that run the project
-- register, which is what a permit hangs off.
create or replace function ecapital.can_manage_permit(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_manage_project(p_org_unit_id)
$$;

-- The ICRA matrix is ΟΚΥπΥ Infection Control's document (§6.2). An
-- administrator keeps the reference data; the Infection Control officer
-- amends the local edition without waiting for a release.
create or replace function ecapital.can_manage_icra_matrix() returns boolean
language sql stable as $$
  select not ecapital.has_role('auditor_readonly')
     and not ecapital.has_role('executive_readonly')
     and (ecapital.has_role('admin')
       or (ecapital.has_role('clinical_approver')
           and ecapital.holds_approval_role('INFECTION_CONTROL')))
$$;

-- R19: the feeds are estate facts, not clinical ones. Whoever runs the
-- technical services of a unit records what its risers serve.
create or replace function ecapital.can_manage_system_feed(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin') or ecapital.has_role('estates_head'))
$$;

-- ------------------------------------------------ the breach sweep, §6.5 --

-- «Overrun flips it to breach and notifies the head of estates and the area
-- owner.» That job runs on a timer, outside any request, so it has no caller
-- and no row policy to run under. It reaches these two functions and nothing
-- else, which is the shape ADR-0023 already uses for the eArchive queue.
--
-- The audit trigger still records who did it: the job sets `app.user_id` to
-- `scheduler:breach` on its own connection before it calls this, so R42 has
-- no gap where the server acted on its own.

create or replace function ecapital.flip_overrun_permits(p_now timestamptz)
returns table (id uuid, ref text, org_unit_id text, title_el text, planned_end timestamptz)
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  -- Already in BREACH is left alone, so `breached_at` is the moment the
  -- overrun was first noticed and never drifts forward.
  return query
  update ecapital.shutdown_permit p
     set status = 'BREACH', breached_at = p_now, updated_at = now()
   where p.status = 'ACTIVE' and p.planned_end < p_now
  returning p.id, p.ref, p.org_unit_id, p.title_el, p.planned_end;
end $$;

-- Who hears about it: the unit's heads of estates, and the clinical owner of
-- every area the permit touches. Distinct, so somebody who is both is told
-- once.
create or replace function ecapital.permit_breach_recipients(p_permit_id uuid)
returns table (email text, name text)
language sql stable security definer set search_path = ecapital, pg_catalog as $$
  select distinct u.email, u.name
    from ecapital.shutdown_permit p
    join ecapital.app_user u on u.is_active
    left join ecapital.app_user_role r on r.app_user_id = u.id
    left join ecapital.app_user_org_unit ou on ou.app_user_id = u.id
    left join ecapital.area_clinical_owner aco on aco.user_id = u.id
    left join ecapital.shutdown_permit_area spa
           on spa.permit_id = p.id and spa.area_id = aco.area_id
   where p.id = p_permit_id
     and ((r.role = 'estates_head' and ou.org_unit_id = p.org_unit_id)
       or spa.id is not null)
$$;

-- --------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array[
    'icra_matrix_version', 'icra_matrix_cell', 'system_feed', 'shutdown_permit',
    'shutdown_permit_area', 'permit_approval', 'area_clinical_owner', 'unit_approver',
    'permit_ref_seq']
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
  foreach t in array array[
    'icra_matrix_version', 'icra_matrix_cell', 'system_feed', 'shutdown_permit',
    'shutdown_permit_area', 'permit_approval', 'area_clinical_owner', 'unit_approver',
    'inbox_read', 'permit_ref_seq']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
  end loop;
end $$;

-- The matrix is reference data every signed-in role reads: the wizard shows
-- the cell and the controls to whoever is filling it in (§6.2, UI S12).
drop policy if exists icra_matrix_version_read on ecapital.icra_matrix_version;
create policy icra_matrix_version_read on ecapital.icra_matrix_version
  for select using (ecapital.current_actor_id() is not null);
drop policy if exists icra_matrix_version_write on ecapital.icra_matrix_version;
create policy icra_matrix_version_write on ecapital.icra_matrix_version
  for all using (ecapital.can_manage_icra_matrix())
  with check (ecapital.can_manage_icra_matrix());

drop policy if exists icra_matrix_cell_read on ecapital.icra_matrix_cell;
create policy icra_matrix_cell_read on ecapital.icra_matrix_cell
  for select using (ecapital.current_actor_id() is not null);
drop policy if exists icra_matrix_cell_write on ecapital.icra_matrix_cell;
create policy icra_matrix_cell_write on ecapital.icra_matrix_cell
  for all using (ecapital.can_manage_icra_matrix())
  with check (ecapital.can_manage_icra_matrix());

drop policy if exists system_feed_read on ecapital.system_feed;
create policy system_feed_read on ecapital.system_feed
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists system_feed_write on ecapital.system_feed;
create policy system_feed_write on ecapital.system_feed
  for all using (ecapital.can_manage_system_feed(org_unit_id))
  with check (ecapital.can_manage_system_feed(org_unit_id));

-- RULE (CAPEX-01 §9): «Clinical approvers see only permits touching their
-- areas and nothing else.» Every other unit role reads by unit as usual, and
-- the auditor and the executive read everything, as they do everywhere.
--
-- The narrow rule applies to somebody whose *only* role is clinical_approver.
-- Holding it alongside estates_head does not take the estate away from them;
-- it is an extra capacity, not a smaller one.
drop policy if exists shutdown_permit_read on ecapital.shutdown_permit;
create policy shutdown_permit_read on ecapital.shutdown_permit
  for select using (
    case when ecapital.clinical_approver_only()
      then ecapital.permit_visible_to_clinician(id)
      else ecapital.can_read_unit(org_unit_id)
    end);

-- RULE (ADR-0010, and a trap worth naming): the write policies below are
-- **per command**, not `for all`. A permissive `for all` policy's USING clause
-- is also consulted on SELECT, and policies are OR'd — so a `for all` write
-- rule written against «is this permit your business to act on» would quietly
-- widen §9's read rule back out to the whole unit for every approver who
-- holds a unit-wide capacity. Splitting them is what keeps the read rule the
-- only thing that decides what a clinical approver can see.
drop policy if exists shutdown_permit_write on ecapital.shutdown_permit;
drop policy if exists shutdown_permit_insert on ecapital.shutdown_permit;
create policy shutdown_permit_insert on ecapital.shutdown_permit
  for insert
  with check (ecapital.can_manage_permit(org_unit_id));
drop policy if exists shutdown_permit_update on ecapital.shutdown_permit;
create policy shutdown_permit_update on ecapital.shutdown_permit
  for update
  using (ecapital.can_manage_permit(org_unit_id)
      or ecapital.permit_actionable_by(id, org_unit_id))
  with check (ecapital.can_manage_permit(org_unit_id)
           or ecapital.permit_actionable_by(id, org_unit_id));
drop policy if exists shutdown_permit_delete on ecapital.shutdown_permit;
create policy shutdown_permit_delete on ecapital.shutdown_permit
  for delete
  using (ecapital.can_manage_permit(org_unit_id));

-- The children follow the permit: a row about a permit the caller cannot see
-- is a row that does not exist for them.
do $$
declare
  t text;
begin
  foreach t in array array['shutdown_permit_area', 'permit_approval']
  loop
    execute format('drop policy if exists %I on ecapital.%I', t || '_read', t);
    execute format(
      'create policy %I on ecapital.%I for select using (
         case when ecapital.clinical_approver_only()
           then ecapital.permit_visible_to_clinician(permit_id)
           else ecapital.can_read_unit(org_unit_id)
         end)', t || '_read', t);

    execute format('drop policy if exists %I on ecapital.%I', t || '_write', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_insert', t);
    execute format(
      'create policy %I on ecapital.%I for insert
         with check (ecapital.can_manage_permit(org_unit_id)
                  or ecapital.permit_actionable_by(permit_id, org_unit_id))',
      t || '_insert', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_update', t);
    execute format(
      'create policy %I on ecapital.%I for update
         using (ecapital.can_manage_permit(org_unit_id)
             or ecapital.permit_actionable_by(permit_id, org_unit_id))
         with check (ecapital.can_manage_permit(org_unit_id)
                  or ecapital.permit_actionable_by(permit_id, org_unit_id))',
      t || '_update', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_delete', t);
    execute format(
      'create policy %I on ecapital.%I for delete
         using (ecapital.can_manage_permit(org_unit_id)
             or ecapital.permit_actionable_by(permit_id, org_unit_id))',
      t || '_delete', t);
  end loop;
end $$;

-- Who owns which room, clinically, is an organisational fact: whoever may
-- read the unit may read it, and an administrator maintains it.
drop policy if exists area_clinical_owner_read on ecapital.area_clinical_owner;
create policy area_clinical_owner_read on ecapital.area_clinical_owner
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists area_clinical_owner_write on ecapital.area_clinical_owner;
create policy area_clinical_owner_write on ecapital.area_clinical_owner
  for all using (ecapital.has_role('admin') and ecapital.can_write_unit(org_unit_id))
  with check (ecapital.has_role('admin') and ecapital.can_write_unit(org_unit_id));

drop policy if exists unit_approver_read on ecapital.unit_approver;
create policy unit_approver_read on ecapital.unit_approver
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists unit_approver_write on ecapital.unit_approver;
create policy unit_approver_write on ecapital.unit_approver
  for all using (ecapital.has_role('admin') and ecapital.can_write_unit(org_unit_id))
  with check (ecapital.has_role('admin') and ecapital.can_write_unit(org_unit_id));

-- Unread is nobody else's business, including an administrator's.
drop policy if exists inbox_read_own on ecapital.inbox_read;
create policy inbox_read_own on ecapital.inbox_read
  for all
  using (exists (select 1 from ecapital.app_user u
                  where u.id = user_id and u.subject = ecapital.current_actor_id()))
  with check (exists (select 1 from ecapital.app_user u
                       where u.id = user_id and u.subject = ecapital.current_actor_id()));

-- R42 and the permit screens. 0002, 0003, 0006 and 0011 opened each entity's
-- own trail to whoever may read its unit; a permit's follows the same rule,
-- except for the clinical approver, whose §9 scope is narrower than the unit.
drop policy if exists audit_log_read_permits on ecapital.audit_log;
create policy audit_log_read_permits on ecapital.audit_log
  for select using (
    entity_type in ('shutdown_permit', 'shutdown_permit_area', 'permit_approval',
                    'icra_matrix_version', 'icra_matrix_cell', 'system_feed',
                    'area_clinical_owner', 'unit_approver')
    and not ecapital.clinical_approver_only()
    and ecapital.can_read_unit(org_unit_id));

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Said again for the reason every migration before it says it (R42), plus the
-- three counters, which move only through their allocate functions.
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
revoke all on ecapital.contract_ref_seq from ecapital_app;
revoke all on ecapital.permit_ref_seq from ecapital_app;
