-- eCapital M4 — το μητρώο παγίων (the asset register).
--
-- R26 (register with hierarchy, criticality, condition, warranty), R27 (the
-- asset linked to its source project, contract and capital cost), R28 (O&M
-- documents, certificates and the commissioning pack, filed with eArchive),
-- R29 (QR labels and scan-to-asset), R30 (whole-life view and replacement
-- forecast), R45 (biomedical equipment in the same register as the building
-- assets), R42 (audit log on every mutation).
--
-- CAPEX-01 §4 is the column list (`asset`, `asset_document`, `asset_reading`),
-- §2 the three rows this is built from — Kahua («the asset, not the project,
-- is the permanent record»), Maximo («criticality 1–5 per asset») and NHS
-- ERIC («condition banded by risk») — §6.1 the `serves_area_ids` rule the
-- permit module reads, and §8 the QR label.
--
-- OWNER STEER, 20/09/2026 (docs/briefs/README.md Errata): the system starts
-- on a simple capital-and-maintenance basis and expands later. So this is the
-- backbone and nothing else: identity, place, class, criticality, condition,
-- warranty, where it came from, what it cost, when it is due for replacement,
-- its papers and a label. There is **no depreciation model**, **no spares or
-- stores**, and **no meter analytics** — `asset_reading` is a plain row a
-- technician writes and M5 builds on. ADR-0028 records what was left out and
-- why.
--
-- NO PATIENT DATA. An asset is a machine in a room: a tag, a manufacturer, a
-- serial number, a date, a money figure and the rooms it serves.
-- `serves_area_ids` names rooms, never people. A ventilator and an anaesthesia
-- machine are in here as equipment (R45) and carry nothing about whoever was
-- ever connected to one — no patient name, identifier, diagnosis, episode or
-- appointment — and a column added later that could is a defect.
--
-- Written as plain SQL (ADR-0008): the row policies, the grants, the audit
-- triggers and the tag counter have no Drizzle representation.

-- ---------------------------------------------------------------- enums --

do $$
begin
  -- CAPEX-01 §4 `asset.asset_class`, verbatim, and the same list as
  -- packages/shared/src/asset.ts.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'asset_class') then
    create type ecapital.asset_class as enum (
      'BUILDING_FABRIC', 'HVAC', 'ELECTRICAL', 'MEDICAL_GAS', 'WATER', 'FIRE',
      'LIFT', 'BIOMEDICAL', 'IT', 'OTHER');
  end if;

  -- CAPEX-01 §4: PLANNED is an asset a project has bought and not yet
  -- commissioned; DISPOSED is one that has left the estate and stays in the
  -- register because its history is the reason the next one was bought.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'asset_status') then
    create type ecapital.asset_status as enum (
      'IN_SERVICE', 'OUT_OF_SERVICE', 'DISPOSED', 'PLANNED');
  end if;

  -- R28: what kind of paper this is. eArchive gets the file; the kind stays
  -- here because it is what a technician filters the asset's folder by.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'asset_document_kind') then
    create type ecapital.asset_document_kind as enum (
      'OM_MANUAL', 'CERT', 'COMMISSIONING', 'WARRANTY', 'DRAWING', 'PHOTO');
  end if;
end $$;

-- R28: the `document` row an asset's paper produces needs a kind of its own,
-- so the eArchive folder does not file a commissioning certificate as
-- «OTHER». Nothing below reads the new label — PostgreSQL 16 allows the ALTER
-- inside a transaction and only refuses to *use* the value before it commits
-- (0009 records the reasoning), and the first row that carries it is written
-- by a request, long after this has committed.
alter type ecapital.document_kind add value if not exists 'ASSET_DOCUMENT';

-- --------------------------------------------------------- the register --

-- Every element of `serves_area_ids` has to be an area id. The column is
-- `text[]` (CAPEX-01 §4, and the build brief says so in as many words), so
-- nothing else stops a string that is not a uuid getting in — and one that
-- did would break `GET /areas/impact` for the whole unit the first time the
-- query cast the array. This is what stops it at the write.
create or replace function ecapital.all_uuid_like(p_values text[]) returns boolean
language sql immutable parallel safe as $$
  select coalesce(
    bool_and(v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    true)
    from unnest(coalesce(p_values, '{}'::text[])) v
$$;

create table if not exists ecapital.asset (
  id                  uuid primary key default gen_random_uuid(),
  org_unit_id         text not null references ecapital.org_unit (id) on delete restrict,
  -- null = whole building or external plant, which is where a main LV board
  -- and a chiller on the roof live.
  area_id             uuid references ecapital.area (id) on delete set null,
  -- RULE (R29, ADR-0014's pattern): `<UNITCODE>-<CLASS>-<NNNN>`, allocated by
  -- ecapital.allocate_asset_tag, immutable afterwards. It is the label text,
  -- the QR payload's key and what a technician reads out over the telephone.
  tag                 text not null unique,
  name_el             text not null,
  asset_class         ecapital.asset_class not null,
  manufacturer        text,
  model               text,
  serial_no           text,
  installed_date      date,
  commissioned_date   date,
  -- R27: where it came from. `on delete set null` — deleting a project must
  -- not take the asset with it; the asset is the permanent record (§2 Kahua).
  source_project_id   uuid references ecapital.project (id) on delete set null,
  source_contract_id  uuid references ecapital.contract (id) on delete set null,
  capital_cost        numeric(14, 2),
  warranty_end        date,
  -- R30, lean: an expected life, a replacement year and an estimate the
  -- engineer sets. The forecast is a sum over these three and nothing more —
  -- there is no depreciation model here and the owner steer says there is not
  -- meant to be one.
  expected_life_years integer,
  replacement_year    integer,
  replacement_cost_est numeric(14, 2),
  -- RULE (§2 Maximo): 1 = life-critical, 5 = cosmetic. M5 derives PM
  -- frequency and SLA response time from it.
  criticality         integer not null,
  -- RULE (§2 NHS ERIC): A = as new, E = life expired. «Φυσική κατάσταση» in
  -- the glossary (CAPEX-02 §7), never «Κατάσταση», which is `status`.
  condition           text,
  condition_assessed_at timestamptz,
  -- Hierarchy: AHU → fan, chiller → pump. One level is all anybody has asked
  -- for; the column allows any depth and the cycle trigger below refuses the
  -- one shape that would hang a reader.
  parent_asset_id     uuid references ecapital.asset (id) on delete set null,
  -- RULE (CAPEX-01 §6.1): which areas this asset serves. When it is set and
  -- `system` matches, the permit module counts those areas as INDIRECT
  -- impact and `system_feed` is not consulted for that system (ADR-0028).
  serves_area_ids     text[] not null default '{}',
  system              ecapital.permit_system,
  cost_centre         text,
  sap_asset_no        text,
  status              ecapital.asset_status not null default 'IN_SERVICE',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint asset_criticality_range check (criticality between 1 and 5),
  constraint asset_condition_band check (condition is null or condition in ('A', 'B', 'C', 'D', 'E')),
  -- A condition is a band and the day somebody looked, or it is neither.
  constraint asset_condition_assessed
    check ((condition is null) = (condition_assessed_at is null)),
  constraint asset_capital_cost_non_negative check (capital_cost is null or capital_cost >= 0),
  constraint asset_replacement_cost_non_negative
    check (replacement_cost_est is null or replacement_cost_est >= 0),
  constraint asset_expected_life_positive
    check (expected_life_years is null or expected_life_years between 1 and 120),
  constraint asset_replacement_year_sane
    check (replacement_year is null or replacement_year between 1900 and 2200),
  constraint asset_not_its_own_parent check (parent_asset_id is null or parent_asset_id <> id),
  constraint asset_serves_areas_are_uuids check (ecapital.all_uuid_like(serves_area_ids)),
  constraint asset_name_length check (char_length(btrim(name_el)) between 2 and 200)
);
create index if not exists asset_unit_idx on ecapital.asset (org_unit_id, status);
create index if not exists asset_area_idx on ecapital.asset (area_id);
create index if not exists asset_parent_idx on ecapital.asset (parent_asset_id);
create index if not exists asset_class_idx on ecapital.asset (org_unit_id, asset_class);
create index if not exists asset_project_idx on ecapital.asset (source_project_id);
create index if not exists asset_contract_idx on ecapital.asset (source_contract_id);
-- R30: the forecast groups by unit and year over the assets that have one.
create index if not exists asset_replacement_idx on ecapital.asset (replacement_year)
  where replacement_year is not null;
-- §6.1: the permit module asks «which assets of this unit carry this system
-- and serve somebody», 1440 times a day once the calendar is in use.
create index if not exists asset_system_idx on ecapital.asset (org_unit_id, system)
  where system is not null;

comment on table ecapital.asset is
  'CAPEX-01 §4 `asset`, lean per the owner steer of 20/09/2026: identity, place, class, criticality, condition, warranty, provenance, replacement and papers. No depreciation, no spares, no meter analytics (ADR-0028).';
comment on column ecapital.asset.tag is
  '<UNITCODE>-<CLASS>-<NNNN>, allocated by ecapital.allocate_asset_tag and immutable afterwards. The QR label prints it and the scan route resolves it.';
comment on column ecapital.asset.condition is
  'NHS ERIC band A–E, «Φυσική κατάσταση» in the glossary. A = as new, E = life expired.';
comment on column ecapital.asset.serves_area_ids is
  'CAPEX-01 §6.1: the areas a shutdown of this asset would interrupt. Replaces system_feed for a unit and a system once it is set (ADR-0028).';

-- R28 — the papers. The file itself goes to eArchive (ADR-0023); what stays
-- here is the link to the `document` row and what kind of paper it is.
create table if not exists ecapital.asset_document (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references ecapital.asset (id) on delete cascade,
  document_id uuid not null references ecapital.document (id) on delete cascade,
  org_unit_id text not null references ecapital.org_unit (id) on delete restrict,
  kind        ecapital.asset_document_kind not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- The same file linked to the same asset twice is a mistake, not a version.
  -- A corrected document is a new `document` row with a new source_ref and a
  -- SUPERSEDES relation (ADR-0023 §6), which is a different document_id.
  unique (asset_id, document_id)
);
create index if not exists asset_document_asset_idx on ecapital.asset_document (asset_id);
create index if not exists asset_document_document_idx on ecapital.asset_document (document_id);

-- A plain reading. CAPEX-01 §4 `asset_reading`: run hours, a temperature, a
-- pressure, a condition score. M5 builds the meter work on top of it; there
-- is deliberately no analytics, no rollup and no alert threshold here.
create table if not exists ecapital.asset_reading (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references ecapital.asset (id) on delete cascade,
  org_unit_id   text not null references ecapital.org_unit (id) on delete restrict,
  taken_at      timestamptz not null default now(),
  -- A free key, e.g. RUN_HOURS or CONDITION. Not an enum: the next kind of
  -- reading is a thing a hospital starts recording, not a release.
  reading_type  text not null,
  value         numeric(16, 4) not null,
  unit          text,
  taken_by      uuid not null references ecapital.app_user (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint asset_reading_type_length check (char_length(btrim(reading_type)) between 2 and 40),
  constraint asset_reading_unit_length check (unit is null or char_length(btrim(unit)) between 1 and 20)
);
create index if not exists asset_reading_asset_idx on ecapital.asset_reading (asset_id, taken_at desc);
create index if not exists asset_reading_unit_idx on ecapital.asset_reading (org_unit_id);

-- ------------------------------------------------- the defect's asset --

-- CAPEX-01 §4 puts `asset_id` on `defect`; 0006 created it as `text` and
-- unreferenced, with a comment saying «until the table exists». It exists
-- now, so the column becomes what it was always meant to be. Nothing has
-- ever written it — no service sets it and the seed does not — so the
-- conversion has nothing to convert, and it is written defensively anyway.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'ecapital' and table_name = 'defect'
                and column_name = 'asset_id' and data_type = 'text') then
    execute 'alter table ecapital.defect
               alter column asset_id type uuid
               using nullif(btrim(asset_id), '''')::uuid';
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'defect_asset_id_fkey'
                    and conrelid = 'ecapital.defect'::regclass) then
    execute 'alter table ecapital.defect
               add constraint defect_asset_id_fkey
               foreign key (asset_id) references ecapital.asset (id) on delete set null';
  end if;
end $$;

-- S17 asks «how many open defects on this asset». Partial, because a closed
-- one is history and the badge counts the open ones.
create index if not exists defect_asset_idx on ecapital.defect (asset_id)
  where asset_id is not null;

comment on column ecapital.defect.asset_id is
  'The asset the defect is on. Typed uuid and referenced by 0017, which built the asset register.';

-- ------------------------------------------------------------- the tag --

-- ADR-0014's machinery, a fourth time: a counter row behind a
-- transaction-scoped advisory lock, SECURITY DEFINER so the number does not
-- depend on which rows the caller may read. Keyed by unit **and class**,
-- because the label reads `NGH-HVA-0007` and the seventh HVAC asset of
-- Nicosia is what that has to mean.
create table if not exists ecapital.asset_tag_seq (
  org_unit_id text not null references ecapital.org_unit (id) on delete cascade,
  asset_class ecapital.asset_class not null,
  next_seq    integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (org_unit_id, asset_class)
);

-- The three letters that go on the label. Short because the label is small
-- and a technician reads it out loud; stable because a tag never changes, so
-- this mapping can never change either (ADR-0028).
create or replace function ecapital.asset_class_code(p_class ecapital.asset_class)
returns text
language sql immutable parallel safe as $$
  select case p_class
    when 'BUILDING_FABRIC' then 'BLD'
    when 'HVAC'            then 'HVA'
    when 'ELECTRICAL'      then 'ELE'
    when 'MEDICAL_GAS'     then 'MGS'
    when 'WATER'           then 'WAT'
    when 'FIRE'            then 'FIR'
    when 'LIFT'            then 'LFT'
    when 'BIOMEDICAL'      then 'BIO'
    when 'IT'              then 'ITE'
    else                        'OTH'
  end
$$;

create or replace function ecapital.allocate_asset_tag(
  p_org_unit_id text, p_asset_class ecapital.asset_class)
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

  perform pg_advisory_xact_lock(hashtext('ecapital.asset_tag'),
                                hashtext(p_org_unit_id || ':' || p_asset_class::text));

  insert into ecapital.asset_tag_seq (org_unit_id, asset_class, next_seq)
    values (p_org_unit_id, p_asset_class, 1)
    on conflict (org_unit_id, asset_class) do nothing;

  update ecapital.asset_tag_seq
     set next_seq = next_seq + 1, updated_at = now()
   where org_unit_id = p_org_unit_id and asset_class = p_asset_class
  returning next_seq - 1 into v_seq;

  -- Four digits: a hospital with ten thousand chillers has a different
  -- problem, and a number that is one character longer would not fit the
  -- label the labels route prints.
  return format('%s-%s-%s', v_code, ecapital.asset_class_code(p_asset_class),
                lpad(v_seq::text, 4, '0'));
end $$;

-- The tag is printed on a sticker, stuck to a machine and scanned with a
-- telephone. A tag that could be edited is a sticker that eventually points
-- at a different machine, so the same trigger ADR-0019 put on `contract.ref`
-- and ADR-0026 on `shutdown_permit.ref` goes here.
create or replace function ecapital.refuse_asset_tag_change() returns trigger
language plpgsql as $$
begin
  if new.tag is distinct from old.tag then
    raise exception 'ecapital.asset.tag is immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists asset_tag_immutable on ecapital.asset;
create trigger asset_tag_immutable
  before update of tag on ecapital.asset
  for each row execute function ecapital.refuse_asset_tag_change();

-- A hierarchy that points at itself is not a hierarchy. One level is all the
-- brief asks for (AHU → fan, chiller → pump); the column allows more, so the
-- one shape that would hang a reader is refused here rather than hoped about.
create or replace function ecapital.refuse_asset_parent_cycle() returns trigger
language plpgsql as $$
declare
  v_seen uuid[] := array[new.id];
  v_next uuid   := new.parent_asset_id;
  v_hops integer := 0;
begin
  while v_next is not null and v_hops < 32 loop
    if v_next = any (v_seen) then
      raise exception 'asset % would make a cycle in the hierarchy', new.id
        using errcode = 'restrict_violation';
    end if;
    v_seen := v_seen || v_next;
    select a.parent_asset_id into v_next from ecapital.asset a where a.id = v_next;
    v_hops := v_hops + 1;
  end loop;
  return new;
end $$;

drop trigger if exists asset_parent_no_cycle on ecapital.asset;
create trigger asset_parent_no_cycle
  before insert or update of parent_asset_id on ecapital.asset
  for each row when (new.parent_asset_id is not null)
  execute function ecapital.refuse_asset_parent_cycle();

-- --------------------------------------------- denormalised org units --

-- Same reason as every child table before it (ADR-0010): the unit is a copy,
-- filled from the parent, so the policy compares a column instead of walking
-- the tree.
create or replace function ecapital.inherit_asset_org_unit() returns trigger
language plpgsql as $$
declare
  v_unit text;
begin
  select a.org_unit_id into v_unit from ecapital.asset a where a.id = new.asset_id;
  if v_unit is not null then new.org_unit_id := v_unit; end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['asset_document', 'asset_reading']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_inherit_org_unit', t);
    execute format(
      'create trigger %I before insert or update of asset_id on ecapital.%I
         for each row execute function ecapital.inherit_asset_org_unit()',
      t || '_inherit_org_unit', t);
  end loop;
end $$;

-- ------------------------------------------------- who may do what --

-- R26, CAPEX-01 §10: the asset register is the estate's own record. The
-- engineer who commissions a machine, the head of estates who owns the
-- estate and the administrator keep it. The two read-only roles are already
-- refused by can_write_unit and are named again for the reader's sake.
create or replace function ecapital.can_manage_asset(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin')
       or ecapital.has_role('estates_head')
       or ecapital.has_role('project_engineer'))
$$;

-- RULE (CAPEX-01 §8, the field persona): «meter and condition readings» are
-- one of the five offline surfaces, and the person holding the telephone in
-- the plant room is the technician. So a technician may add a reading and
-- record a condition, and may not change anything else about the asset —
-- not its tag, not its cost, not where it is.
create or replace function ecapital.can_record_asset_reading(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_manage_asset(p_org_unit_id)
      or (ecapital.can_write_unit(p_org_unit_id) and ecapital.has_role('technician'))
$$;

-- The condition is the one field on `asset` a technician may move, and RLS
-- cannot restrict a policy to a column. So the write goes through this
-- instead: SECURITY DEFINER, its own permission check, and only the two
-- columns. The audit trigger still records the caller as the actor, because
-- `app.user_id` is the request's and not this function's (ADR-0011).
create or replace function ecapital.record_asset_condition(
  p_asset_id uuid, p_condition text, p_assessed_at timestamptz)
returns ecapital.asset
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_row ecapital.asset%rowtype;
begin
  select * into v_row from ecapital.asset where id = p_asset_id;
  if not found then
    return null;
  end if;
  -- Read as well as write: an asset in a unit the caller cannot see has to
  -- stay invisible, and the caller is told «no such asset» by the service.
  if not ecapital.can_read_unit(v_row.org_unit_id) then
    return null;
  end if;
  if not ecapital.can_record_asset_reading(v_row.org_unit_id) then
    raise exception 'not allowed to record a condition on asset %', p_asset_id
      using errcode = 'insufficient_privilege';
  end if;
  if p_condition is null or p_condition not in ('A', 'B', 'C', 'D', 'E') then
    raise exception 'condition must be A to E' using errcode = 'check_violation';
  end if;

  update ecapital.asset
     set condition = p_condition,
         condition_assessed_at = coalesce(p_assessed_at, now()),
         updated_at = now()
   where id = p_asset_id
  returning * into v_row;
  return v_row;
end $$;

-- --------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array['asset', 'asset_document', 'asset_reading', 'asset_tag_seq']
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
  foreach t in array array['asset', 'asset_document', 'asset_reading', 'asset_tag_seq']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
  end loop;
end $$;

-- An asset belongs to a unit and is read by whoever may read that unit — the
-- auditor and the executive included, who read everything and write nothing
-- (can_write_unit refuses them, so can_manage_asset does too).
drop policy if exists asset_read on ecapital.asset;
create policy asset_read on ecapital.asset
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists asset_write on ecapital.asset;
create policy asset_write on ecapital.asset
  for all
  using (ecapital.can_manage_asset(org_unit_id))
  with check (ecapital.can_manage_asset(org_unit_id));

-- The papers follow the asset: whoever may read the unit reads them, and
-- whoever files documents for the unit attaches them. The same role list as
-- every other document route, so the `document` row and this link row are
-- written by one caller in one transaction or neither is (ADR-0023).
drop policy if exists asset_document_read on ecapital.asset_document;
create policy asset_document_read on ecapital.asset_document
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists asset_document_write on ecapital.asset_document;
create policy asset_document_write on ecapital.asset_document
  for all
  using (ecapital.can_manage_document(org_unit_id))
  with check (ecapital.can_manage_document(org_unit_id));

-- RULE: the technician's one write. A reading is read by the unit and
-- written by anyone who may keep the asset plus the technician.
drop policy if exists asset_reading_read on ecapital.asset_reading;
create policy asset_reading_read on ecapital.asset_reading
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists asset_reading_write on ecapital.asset_reading;
create policy asset_reading_write on ecapital.asset_reading
  for all
  using (ecapital.can_record_asset_reading(org_unit_id))
  with check (ecapital.can_record_asset_reading(org_unit_id));

-- The counter is nobody's to read. Same shape as the other three (ADR-0014):
-- row-level security on and no policy at all, so the application role can do
-- nothing with it except ask allocate_asset_tag for the next number.
-- (No policy statement here on purpose — enabling RLS with none denies all.)

-- R42 and the M4 definition of done: «a technician scans a QR label and sees
-- the full history». The history is assembled from this trail, so an asset's
-- own trail opens to whoever may read its unit, exactly as a project's,
-- a contract's and a document's already do.
drop policy if exists audit_log_read_assets on ecapital.audit_log;
create policy audit_log_read_assets on ecapital.audit_log
  for select using (
    entity_type in ('asset', 'asset_document', 'asset_reading')
    and ecapital.can_read_unit(org_unit_id));

-- ------------------------------------------- the eArchive queue's list --

-- R28: an asset's papers are filed with eArchive like everything else, under
-- `source_module: asset_document`. 0014's check constraint names the modules
-- the queue accepts, so it gains a sixth.
alter table ecapital.dms_outbox drop constraint if exists dms_outbox_module_known;
alter table ecapital.dms_outbox add constraint dms_outbox_module_known
  check (source_module in ('award', 'business_case', 'variation', 'permit',
                           'payment_cert', 'asset_document'));

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Said again for the reason every migration before it says it (R42), plus the
-- four counters, which move only through their allocate functions.
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
revoke all on ecapital.contract_ref_seq from ecapital_app;
revoke all on ecapital.permit_ref_seq from ecapital_app;
revoke all on ecapital.asset_tag_seq from ecapital_app;
