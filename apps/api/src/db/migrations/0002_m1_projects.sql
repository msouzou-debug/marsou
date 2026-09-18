-- eCapital M1 — the project register: project, milestone, risk, issue.
--
-- R04 (project lifecycle with phases and gate approvals), R05 (the business
-- case fields the register carries from the sheet), R06 (milestones with
-- baseline vs forecast vs actual), R07 (risk and issue registers) and R42
-- (audit log on every mutation). CAPEX-01 §4 is the column list, CAPEX-03 §2
-- says what the register carries from the capex plan and §4 maps its three
-- source statuses onto the nine phases.
--
-- NO PATIENT DATA. Same rule as 0001: nothing below holds a patient name,
-- identifier, diagnosis, episode or appointment. A project is a building
-- works record; a risk and an issue describe the works, never a person's
-- care. `risk.owner_id` and `issue.raised_by` point at staff accounts.
--
-- Every table added here gets its row-level-security policies and its audit
-- trigger in this same file (ADR-0008, ADR-0011).

-- pg_trgm backs the `q` search on the project list: `%…%` on a normalised
-- column is a sequential scan without it, and CAPEX-01 §12 asks for portfolio
-- queries over 500 projects to stay under 500ms. The DBA applies the
-- migration as the owner, which is who may create an extension.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- enums --

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'project_category') then
    create type ecapital.project_category as enum (
      'NEW_BUILD', 'RENOVATION', 'SMALL_WORKS', 'EQUIPMENT', 'MAINTENANCE_CAPITAL', 'IT');
  end if;
  -- The nine phases, in order. The order IS the rule: R04 lets a project move
  -- exactly one step along this list and no further, so the enum's own
  -- ordering is what the service compares against. Inserting a phase in the
  -- middle later changes the meaning of "one step" and needs its own ADR.
  -- PREPARATION sits between IDEA and APPROVED per CAPEX-03 §4, which is
  -- where 70 of the 113 migrated rows land.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'project_phase') then
    create type ecapital.project_phase as enum (
      'IDEA', 'PREPARATION', 'APPROVED', 'TENDERED', 'AWARDED',
      'IN_PROGRESS', 'PRACTICAL_COMPLETION', 'DEFECTS_LIABILITY', 'CLOSED');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'funding_source') then
    create type ecapital.funding_source as enum ('STATE_BUDGET', 'EU', 'DONATION', 'OWN');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'rag') then
    create type ecapital.rag as enum ('GREEN', 'AMBER', 'RED');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'risk_status') then
    create type ecapital.risk_status as enum ('OPEN', 'MITIGATED', 'CLOSED');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'issue_status') then
    create type ecapital.issue_status as enum ('OPEN', 'RESOLVED');
  end if;
end $$;

-- ------------------------------------------------------- text searching --

-- Fold a Greek or Latin string down to something a search can compare:
-- accents off, capitals down, final sigma to plain sigma.
--
-- Why not unaccent() and lower(): unaccent() is STABLE, not IMMUTABLE — it
-- reads a dictionary — so it cannot back a generated column or an expression
-- index, and lower() only folds ASCII unless the database's LC_CTYPE knows
-- Greek, which the throwaway test cluster (initdb --locale=C) does not. A
-- translate() over the Greek block is immutable, locale-independent and does
-- the one job the list search needs: «ΑΝΑΚΑΙΝΙΣΗ» has to find
-- «Ανακαίνιση χειρουργείων».
create or replace function ecapital.normalise(p_text text) returns text
language sql immutable parallel safe strict as $$
  select lower(translate(
    p_text,
    'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰς',
    'αβγδεζηθικλμνξοπρστυφχψωαεηιουωιυαεηιουωιυιυσ'))
$$;

-- --------------------------------------------------------------- tables --

create table if not exists ecapital.project (
  id                      uuid primary key default gen_random_uuid(),
  -- <unit code>-<year>-<seq>, allocated by ecapital.allocate_project_code
  -- below. Never typed by a user (ADR-0014).
  code                    text not null unique,
  org_unit_id             text not null references ecapital.org_unit (id) on delete restrict,
  title_el                text not null,
  -- The system never machine-translates content (CAPEX-01 §6.1): an English
  -- title exists only where somebody typed one.
  title_en                text,
  note_el                 text,                                   -- CAPEX-03 col E tail
  category                ecapital.project_category not null,
  phase                   ecapital.project_phase not null default 'IDEA',
  -- The reason given with the last phase change (R04). It is a column so the
  -- audit trigger's after-image carries it, which is what makes the project
  -- timeline able to say why a phase moved.
  phase_reason_el         text,
  phase_changed_at        timestamptz,
  approved_budget         numeric(14, 2) not null default 0,
  funding_source          ecapital.funding_source not null default 'STATE_BUDGET',
  -- CAPEX-03 §2 V06: a date cell in the source can be blank or hold text, so
  -- the planned dates are nullable and the importer flags the row rather than
  -- inventing a date.
  planned_start           date,
  planned_finish          date,
  forecast_start          date,                                   -- CAPEX-03 col AB
  forecast_finish         date,                                   -- CAPEX-03 col AC
  actual_start            date,
  actual_finish           date,
  budget_year_from        integer,
  budget_year_to          integer,
  rag                     ecapital.rag not null default 'GREEN',
  rag_reason              text not null default '',
  sap_wbs                 text,
  tender_reference        text,
  -- CAPEX-03 cols F, H, I, J, K, AE — carried so the register can be
  -- reconciled to the sheet it came from during the first year (CAPEX-01 §9).
  budget_article          text,
  commitment_flag         boolean not null default false,
  commitment_note         text,
  action_plan_ref         text,
  in_budget_2026          boolean not null default false,
  contractual_commitment  boolean not null default false,
  internal_audit_file     boolean not null default false,
  source_row_ref          text,                                   -- CAPEX-03 col B, reference only
  sponsor_id              uuid references ecapital.app_user (id) on delete set null,
  project_manager_id      uuid references ecapital.app_user (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- What `GET /projects?q=` matches on: the code and the Greek title, folded.
  search_norm             text generated always as
                            (ecapital.normalise(coalesce(code, '') || ' ' || coalesce(title_el, '')))
                            stored,
  constraint project_budget_non_negative check (approved_budget >= 0),
  -- CAPEX-03 col F: the article is one of three, or unknown.
  constraint project_budget_article_known
    check (budget_article is null or budget_article in ('08021', '08022', '08023')),
  constraint project_budget_years_ordered
    check (budget_year_from is null or budget_year_to is null or budget_year_to >= budget_year_from)
);
create index if not exists project_unit_idx on ecapital.project (org_unit_id);
create index if not exists project_phase_idx on ecapital.project (phase);
create index if not exists project_rag_idx on ecapital.project (rag);
create index if not exists project_updated_idx on ecapital.project (updated_at desc);
create index if not exists project_search_idx on ecapital.project using gin (search_norm gin_trgm_ops);

-- milestone, risk and issue each keep a copy of org_unit_id although it is
-- reachable through the project, for the same reason floor and area do
-- (ADR-0010): the policy is then a column comparison and not a join. The
-- trigger below fills it from the parent project and keeps it honest.
create table if not exists ecapital.milestone (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references ecapital.project (id) on delete cascade,
  org_unit_id   text not null references ecapital.org_unit (id) on delete restrict,
  title_el      text not null,
  -- R06. The baseline is the promise; it never moves once the milestone
  -- exists (the service refuses a change, errors.baselineFixed). Forecast and
  -- actual move as often as reality does.
  baseline_date date not null,
  forecast_date date,
  actual_date   date,
  -- R04: a gate milestone closes a phase. The phase cannot advance past it
  -- until the gate has an actual date.
  is_gate       boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists milestone_project_idx on ecapital.milestone (project_id, sort_order);
create index if not exists milestone_unit_idx on ecapital.milestone (org_unit_id);

create table if not exists ecapital.risk (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references ecapital.project (id) on delete cascade,
  org_unit_id    text not null references ecapital.org_unit (id) on delete restrict,
  description_el text not null,
  -- R07: likelihood × impact on a 1–5 scale. The score is the product and is
  -- derived in the client, so it is not stored.
  likelihood     integer not null,
  impact         integer not null,
  owner_id       uuid references ecapital.app_user (id) on delete set null,
  mitigation_el  text,
  status         ecapital.risk_status not null default 'OPEN',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint risk_likelihood_range check (likelihood between 1 and 5),
  constraint risk_impact_range check (impact between 1 and 5)
);
create index if not exists risk_project_idx on ecapital.risk (project_id);
create index if not exists risk_unit_idx on ecapital.risk (org_unit_id);

create table if not exists ecapital.issue (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references ecapital.project (id) on delete cascade,
  org_unit_id    text not null references ecapital.org_unit (id) on delete restrict,
  description_el text not null,
  -- Always the caller who raised it; the service never takes it from a body.
  raised_by      uuid not null references ecapital.app_user (id) on delete restrict,
  due_date       date,
  status         ecapital.issue_status not null default 'OPEN',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists issue_project_idx on ecapital.issue (project_id);
create index if not exists issue_unit_idx on ecapital.issue (org_unit_id);

-- ADR-0014. One sequence per unit per year, so NGH-2026-007 says which unit
-- and which year without a lookup. Not a Postgres sequence: a sequence per
-- unit per year is 11 objects a year created by DDL, and a gap in the numbers
-- after a rolled-back transaction is exactly what an auditor asks about.
create table if not exists ecapital.project_code_seq (
  org_unit_id text not null references ecapital.org_unit (id) on delete cascade,
  year        integer not null,
  next_seq    integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (org_unit_id, year)
);

create or replace function ecapital.inherit_project_org_unit() returns trigger
language plpgsql as $$
declare
  v_unit text;
begin
  select p.org_unit_id into v_unit from ecapital.project p where p.id = new.project_id;
  new.org_unit_id := v_unit;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['milestone', 'risk', 'issue']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_inherit_org_unit', t);
    execute format(
      'create trigger %I before insert or update of project_id on ecapital.%I
         for each row execute function ecapital.inherit_project_org_unit()',
      t || '_inherit_org_unit', t);
  end loop;
end $$;

-- ADR-0014: the next code for a unit and a year, allocated inside the
-- caller's transaction.
--
-- The advisory lock is per unit, taken for the length of the transaction, so
-- two engineers pressing "create" in the same second queue rather than race:
-- the second one waits for the first to commit or roll back and then reads
-- the counter the first left behind. The `update … returning` would serialise
-- on its own through the row lock; the advisory lock is what also covers the
-- insert of a unit's very first row of the year, which two transactions could
-- otherwise both attempt.
--
-- SECURITY DEFINER because the counter table is machinery: the application
-- role has no policy on it and cannot read or move a counter except through
-- this function, which only ever hands out the next number.
create or replace function ecapital.allocate_project_code(p_org_unit_id text, p_year integer)
returns text
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_unit_code text;
  v_seq       integer;
begin
  select o.code into v_unit_code from ecapital.org_unit o where o.id = p_org_unit_id;
  if v_unit_code is null then
    raise exception 'no such org unit: %', p_org_unit_id using errcode = 'foreign_key_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('ecapital.project_code'), hashtext(p_org_unit_id));

  insert into ecapital.project_code_seq (org_unit_id, year, next_seq)
    values (p_org_unit_id, p_year, 1)
    on conflict (org_unit_id, year) do nothing;

  update ecapital.project_code_seq
     set next_seq = next_seq + 1, updated_at = now()
   where org_unit_id = p_org_unit_id and year = p_year
  returning next_seq - 1 into v_seq;

  return format('%s-%s-%s', v_unit_code, p_year, lpad(v_seq::text, 3, '0'));
end $$;

-- The contract asks a project page for the sponsor's and the manager's names
-- and for the name of whoever made each audit entry. The app_user read policy
-- gives an ordinary user only their own row, and widening it would hand every
-- signed-in user every colleague's work email as well. This hands back one
-- name and nothing else, only to a caller who is inside a request
-- transaction. See ADR-0014.
create or replace function ecapital.user_display_name(p_user_id uuid) returns text
language sql stable security definer set search_path = ecapital, pg_catalog as $$
  select u.name from ecapital.app_user u
   where ecapital.current_actor_id() is not null and u.id = p_user_id
$$;

create or replace function ecapital.user_display_name_by_subject(p_subject text) returns text
language sql stable security definer set search_path = ecapital, pg_catalog as $$
  select u.name from ecapital.app_user u
   where ecapital.current_actor_id() is not null and u.subject = p_subject
$$;

-- --------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array['project', 'milestone', 'risk', 'issue', 'project_code_seq']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on ecapital.%I
         for each row execute function ecapital.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ------------------------------------------------- row-level security --

-- CAPEX-01 §10 and §4: the three roles that run capital projects write them.
-- finance, technician and clinical_approver read the register but change
-- nothing in it; executive_readonly and auditor_readonly are already refused
-- by can_write_unit.
create or replace function ecapital.can_manage_project(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin')
       or ecapital.has_role('estates_head')
       or ecapital.has_role('project_engineer'))
$$;

do $$
declare
  t text;
begin
  foreach t in array array['project', 'milestone', 'risk', 'issue', 'project_code_seq']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
  end loop;

  foreach t in array array['project', 'milestone', 'risk', 'issue']
  loop
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

-- project_code_seq deliberately has row-level security on and no policy at
-- all: the application role reaches it only through
-- ecapital.allocate_project_code, which runs as the owner.

-- R42 and the project timeline. 0001 opens audit_log to admin and the
-- auditor only, which is right for GET /audit-log — the whole trail of the
-- organisation is an auditor's document. A project's own history is not: the
-- contract puts it on the project page, so whoever may read the project may
-- read what happened to it and to its milestones, risks and issues, and
-- nothing else. Policies are OR'd, so this adds to the 0001 policy rather
-- than replacing it. See ADR-0014.
drop policy if exists audit_log_read_project on ecapital.audit_log;
create policy audit_log_read_project on ecapital.audit_log
  for select using (
    entity_type in ('project', 'milestone', 'risk', 'issue')
    and ecapital.can_read_unit(org_unit_id));

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Same revoke as 0001: the grant above is written `on all tables`, so say it
-- again. The application reads the audit log and can neither write to it nor
-- take anything out of it (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
