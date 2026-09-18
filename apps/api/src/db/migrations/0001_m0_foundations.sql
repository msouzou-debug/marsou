-- eCapital M0 — foundations: org unit, area tree, users, roles, audit log.
--
-- R01 (Entra ID SSO, role and unit-scoped access), R42 (full audit log on
-- every mutation, immutable to admin), CAPEX-01 §4 (data model) and §12
-- (all timestamps UTC).
--
-- NO PATIENT DATA. CAPEX-01 §12 says no patient data enters this system and
-- the schema must make that impossible by design. Nothing below holds a
-- patient name, identifier, diagnosis, episode or appointment. `area.beds`
-- is a count of beds in a room, not an occupancy. `patient_risk_group` is
-- the ICRA Table 2 band of the room, a property of the building, not of any
-- person. Any column added later that could carry patient data is a defect.
--
-- Written as plain SQL, not generated (ADR-0008): row-level security,
-- grants and the audit trigger have no Drizzle representation and a DBA has
-- to be able to read them.

create schema if not exists ecapital;

-- The role the API connects as. It is never the owner of these tables, so
-- row-level security applies to it without FORCE. The DBA gives it a
-- password on the real server; the throwaway test cluster uses trust auth.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ecapital_app') then
    create role ecapital_app login;
  end if;
end $$;

-- ---------------------------------------------------------------- enums --

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'org_unit_type') then
    create type ecapital.org_unit_type as enum ('HOSPITAL', 'SERVICE');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'directorate') then
    create type ecapital.directorate as enum (
      'LEMESOU_PAFOU', 'LEFKOSIAS', 'LARNAKAS_AMMOCHOSTOU', 'DYPSY', 'PFY', 'AMBULANCE');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'area_type') then
    create type ecapital.area_type as enum (
      'THEATRE', 'ICU', 'WARD', 'OPD', 'LAB', 'PLANT', 'OFFICE', 'OTHER');
  end if;
  -- ICRA 2.0 Table 2 bands.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'patient_risk_group') then
    create type ecapital.patient_risk_group as enum ('LOW', 'MEDIUM', 'HIGH', 'HIGHEST');
  end if;
  -- CAPEX-01 §10.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'app_role') then
    create type ecapital.app_role as enum (
      'admin', 'estates_head', 'project_engineer', 'technician',
      'finance', 'clinical_approver', 'executive_readonly', 'auditor_readonly');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'audit_action') then
    create type ecapital.audit_action as enum ('INSERT', 'UPDATE', 'DELETE');
  end if;
end $$;

-- ------------------------------------------------------------- session --
-- Every request runs in one transaction that sets app.user_id, app.roles,
-- app.org_unit_ids and app.ip with SET LOCAL (ADR-0010). Outside such a
-- transaction these read as empty and the policies below let nothing through.

create or replace function ecapital.current_actor_id() returns text
language sql stable parallel safe as $$
  select nullif(current_setting('app.user_id', true), '')
$$;

create or replace function ecapital.current_roles() returns text[]
language sql stable parallel safe as $$
  select coalesce(
    string_to_array(nullif(current_setting('app.roles', true), ''), ','),
    array[]::text[])
$$;

create or replace function ecapital.current_org_unit_ids() returns text[]
language sql stable parallel safe as $$
  select coalesce(
    string_to_array(nullif(current_setting('app.org_unit_ids', true), ''), ','),
    array[]::text[])
$$;

create or replace function ecapital.has_role(p_role text) returns boolean
language sql stable parallel safe as $$
  select p_role = any (ecapital.current_roles())
$$;

-- admin, executive_readonly and auditor_readonly see every unit. So does a
-- Central Administration user, who carries all eleven unit ids in the token.
create or replace function ecapital.sees_all_units() returns boolean
language sql stable parallel safe as $$
  select ecapital.has_role('admin')
      or ecapital.has_role('executive_readonly')
      or ecapital.has_role('auditor_readonly')
$$;

create or replace function ecapital.can_read_unit(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.sees_all_units()
      or (p_org_unit_id is not null and p_org_unit_id = any (ecapital.current_org_unit_ids()))
$$;

-- auditor_readonly and executive_readonly see everything and write nothing.
-- The policy, not the controller, is what enforces that (CAPEX-01 §10; the
-- executive block was the owner's decision on 18/09/2026, ADR-0010).
create or replace function ecapital.can_write_unit(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select not ecapital.has_role('auditor_readonly')
     and not ecapital.has_role('executive_readonly')
     and ecapital.can_read_unit(p_org_unit_id)
$$;

-- -------------------------------------------------------------- tables --

create table if not exists ecapital.org_unit (
  id           text primary key,
  code         text not null unique,
  name_el      text not null,
  name_en      text not null,
  type         ecapital.org_unit_type not null,
  directorate  ecapital.directorate not null,
  cost_centre  text,
  timezone     text not null default 'Europe/Nicosia',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- CAPEX-03 §3: the next revision of the spreadsheet will spell at least one
-- unit differently, so the source spellings are data, not code.
create table if not exists ecapital.org_unit_alias (
  id           uuid primary key default gen_random_uuid(),
  org_unit_id  text not null references ecapital.org_unit (id) on delete cascade,
  alias        text not null unique,
  created_at   timestamptz not null default now()
);
create index if not exists org_unit_alias_unit_idx on ecapital.org_unit_alias (org_unit_id);

create table if not exists ecapital.building (
  id            uuid primary key default gen_random_uuid(),
  org_unit_id   text not null references ecapital.org_unit (id) on delete restrict,
  code          text not null,
  name_el       text not null,
  gross_area_m2 numeric(12, 2),
  year_built    integer,
  storeys       integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_unit_id, code)
);
create index if not exists building_unit_idx on ecapital.building (org_unit_id);

-- floor and area carry org_unit_id although it is reachable through the
-- parent. The policies then compare one column instead of walking the tree,
-- which keeps the area query on the index (CAPEX-01 §12: under 500ms). The
-- trigger below keeps the copy honest.
create table if not exists ecapital.floor (
  id           uuid primary key default gen_random_uuid(),
  building_id  uuid not null references ecapital.building (id) on delete cascade,
  org_unit_id  text not null references ecapital.org_unit (id) on delete restrict,
  code         text not null,
  name_el      text not null,
  level        integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (building_id, code)
);
create index if not exists floor_building_idx on ecapital.floor (building_id);
create index if not exists floor_unit_idx on ecapital.floor (org_unit_id);

create table if not exists ecapital.area (
  id                 uuid primary key default gen_random_uuid(),
  floor_id           uuid not null references ecapital.floor (id) on delete cascade,
  org_unit_id        text not null references ecapital.org_unit (id) on delete restrict,
  code               text not null,
  name_el            text not null,
  area_type          ecapital.area_type not null,
  patient_risk_group ecapital.patient_risk_group not null,
  cost_centre        text,
  beds               integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (floor_id, code),
  constraint area_beds_non_negative check (beds is null or beds >= 0)
);
create index if not exists area_floor_idx on ecapital.area (floor_id);
create index if not exists area_unit_idx on ecapital.area (org_unit_id);

create or replace function ecapital.inherit_org_unit() returns trigger
language plpgsql as $$
declare
  v_parent_unit text;
begin
  if tg_table_name = 'floor' then
    select b.org_unit_id into v_parent_unit from ecapital.building b where b.id = new.building_id;
  else
    select f.org_unit_id into v_parent_unit from ecapital.floor f where f.id = new.floor_id;
  end if;
  new.org_unit_id := v_parent_unit;
  return new;
end $$;

drop trigger if exists floor_inherit_org_unit on ecapital.floor;
create trigger floor_inherit_org_unit
  before insert or update of building_id on ecapital.floor
  for each row execute function ecapital.inherit_org_unit();

drop trigger if exists area_inherit_org_unit on ecapital.area;
create trigger area_inherit_org_unit
  before insert or update of floor_id on ecapital.area
  for each row execute function ecapital.inherit_org_unit();

-- Staff only. CAPEX-01 §12: personal data is limited to staff name and
-- work email. No home address, no national id, no patient anything.
create table if not exists ecapital.app_user (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null unique,
  name        text not null,
  email       text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists ecapital.app_user_org_unit (
  app_user_id uuid not null references ecapital.app_user (id) on delete cascade,
  org_unit_id text not null references ecapital.org_unit (id) on delete cascade,
  primary key (app_user_id, org_unit_id)
);

create table if not exists ecapital.app_user_role (
  app_user_id uuid not null references ecapital.app_user (id) on delete cascade,
  role        ecapital.app_role not null,
  primary key (app_user_id, role)
);

-- Entra group -> role. Configuration, not code (ADR-0009). A null
-- org_unit_id means the role applies to every unit.
create table if not exists ecapital.role_mapping (
  id             uuid primary key default gen_random_uuid(),
  entra_group_id text not null,
  role           ecapital.app_role not null,
  org_unit_id    text references ecapital.org_unit (id) on delete cascade,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists role_mapping_unique_idx
  on ecapital.role_mapping (entra_group_id, role, coalesce(org_unit_id, ''));

-- R42. Append-only: no UPDATE or DELETE grant to anyone, plus a trigger so
-- even the owner and a superuser are refused.
create table if not exists ecapital.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    text,
  entity_type text not null,
  entity_id   text,
  action      ecapital.audit_action not null,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now(),
  ip          inet,
  org_unit_id text
);
create index if not exists audit_log_entity_idx on ecapital.audit_log (entity_type, entity_id);
create index if not exists audit_log_at_idx on ecapital.audit_log (at desc);
create index if not exists audit_log_actor_idx on ecapital.audit_log (actor_id);

-- ------------------------------------------------------- audit trigger --
-- SECURITY DEFINER so the insert happens as the table owner: the API role
-- has no INSERT grant on audit_log and cannot forge a row directly.
create or replace function ecapital.write_audit() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_ip     text := nullif(current_setting('app.ip', true), '');
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
  else
    v_after := to_jsonb(new);
  end if;

  insert into ecapital.audit_log (actor_id, entity_type, entity_id, action, before, after, at, ip, org_unit_id)
  values (
    ecapital.current_actor_id(),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id'),
    tg_op::ecapital.audit_action,
    v_before,
    v_after,
    now(),
    case when v_ip is null then null else v_ip::inet end,
    coalesce(v_after ->> 'org_unit_id', v_before ->> 'org_unit_id'));

  return null;
end $$;

create or replace function ecapital.refuse_audit_change() returns trigger
language plpgsql as $$
begin
  raise exception 'ecapital.audit_log is append-only'
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists audit_log_append_only on ecapital.audit_log;
create trigger audit_log_append_only
  before update or delete on ecapital.audit_log
  for each row execute function ecapital.refuse_audit_change();

do $$
declare
  t text;
begin
  foreach t in array array[
    'org_unit', 'org_unit_alias', 'building', 'floor', 'area',
    'app_user', 'app_user_org_unit', 'app_user_role', 'role_mapping']
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
    'org_unit', 'org_unit_alias', 'building', 'floor', 'area',
    'app_user', 'app_user_org_unit', 'app_user_role', 'role_mapping', 'audit_log']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists org_unit_read on ecapital.org_unit;
create policy org_unit_read on ecapital.org_unit
  for select using (ecapital.can_read_unit(id));
drop policy if exists org_unit_write on ecapital.org_unit;
create policy org_unit_write on ecapital.org_unit
  for all using (ecapital.has_role('admin') and ecapital.can_write_unit(id))
  with check (ecapital.has_role('admin') and ecapital.can_write_unit(id));

drop policy if exists org_unit_alias_read on ecapital.org_unit_alias;
create policy org_unit_alias_read on ecapital.org_unit_alias
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists org_unit_alias_write on ecapital.org_unit_alias;
create policy org_unit_alias_write on ecapital.org_unit_alias
  for all using (ecapital.has_role('admin') and ecapital.can_write_unit(org_unit_id))
  with check (ecapital.has_role('admin') and ecapital.can_write_unit(org_unit_id));

drop policy if exists building_read on ecapital.building;
create policy building_read on ecapital.building
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists building_write on ecapital.building;
create policy building_write on ecapital.building
  for all using (ecapital.can_write_unit(org_unit_id))
  with check (ecapital.can_write_unit(org_unit_id));

drop policy if exists floor_read on ecapital.floor;
create policy floor_read on ecapital.floor
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists floor_write on ecapital.floor;
create policy floor_write on ecapital.floor
  for all using (ecapital.can_write_unit(org_unit_id))
  with check (ecapital.can_write_unit(org_unit_id));

drop policy if exists area_read on ecapital.area;
create policy area_read on ecapital.area
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists area_write on ecapital.area;
create policy area_write on ecapital.area
  for all using (ecapital.can_write_unit(org_unit_id))
  with check (ecapital.can_write_unit(org_unit_id));

-- A user reads their own record; admin, auditor and executive read all.
drop policy if exists app_user_read on ecapital.app_user;
create policy app_user_read on ecapital.app_user
  for select using (ecapital.sees_all_units() or subject = ecapital.current_actor_id());
drop policy if exists app_user_write on ecapital.app_user;
create policy app_user_write on ecapital.app_user
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

drop policy if exists app_user_org_unit_read on ecapital.app_user_org_unit;
create policy app_user_org_unit_read on ecapital.app_user_org_unit
  for select using (
    ecapital.sees_all_units()
    or exists (select 1 from ecapital.app_user u
               where u.id = app_user_id and u.subject = ecapital.current_actor_id()));
drop policy if exists app_user_org_unit_write on ecapital.app_user_org_unit;
create policy app_user_org_unit_write on ecapital.app_user_org_unit
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

drop policy if exists app_user_role_read on ecapital.app_user_role;
create policy app_user_role_read on ecapital.app_user_role
  for select using (
    ecapital.sees_all_units()
    or exists (select 1 from ecapital.app_user u
               where u.id = app_user_id and u.subject = ecapital.current_actor_id()));
drop policy if exists app_user_role_write on ecapital.app_user_role;
create policy app_user_role_write on ecapital.app_user_role
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

drop policy if exists role_mapping_read on ecapital.role_mapping;
create policy role_mapping_read on ecapital.role_mapping
  for select using (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly'));
drop policy if exists role_mapping_write on ecapital.role_mapping;
create policy role_mapping_write on ecapital.role_mapping
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

-- The audit log is readable by the auditor and by admin and by nobody else.
-- There is deliberately no INSERT, UPDATE or DELETE policy: rows arrive only
-- through the SECURITY DEFINER trigger above.
drop policy if exists audit_log_read on ecapital.audit_log;
create policy audit_log_read on ecapital.audit_log
  for select using (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly'));

-- -------------------------------------------------------------- grants --

grant usage on schema ecapital to ecapital_app;
grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- R42: immutable to admin. The application role can read the audit log and
-- nothing else. Removing this revoke is a security defect, not a fix.
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.audit_log from public;
grant select on ecapital.audit_log to ecapital_app;
