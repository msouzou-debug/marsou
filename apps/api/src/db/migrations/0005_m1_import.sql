-- eCapital M1 — the Excel migration: import_batch, import_exception,
-- budget_line, cost_txn, project_note, and the provenance columns on project.
--
-- R41 (Excel migration CLI with a reconciliation report). CAPEX-01 §4 gives
-- the `budget_line`, `cost_txn` and `import_batch` column lists and §9 says
-- every import produces a reconciliation report and keeps the source file
-- hash and a link from each record to the file it came from for the first
-- year. CAPEX-03 §2 says which column of the capex plan lands where, §5 the
-- fourteen validation rules whose exceptions this schema stores, and §8 the
-- vintages the budget lines carry.
--
-- NO PATIENT DATA. Same rule as 0001 and 0002: a budget line is a money
-- figure against a project and a year, a cost transaction is a money figure
-- against a project and a date, and a project note is the Technical Services
-- narrative about why a works programme moved. None of them has anywhere to
-- put a patient name, identifier, diagnosis, episode or appointment.
--
-- Every table added here gets its row-level-security policies and its audit
-- trigger in this same file (ADR-0008, ADR-0011).

-- ---------------------------------------------------------------- enums --

-- CAPEX-03 §2 col L: «ΣΑΑ» is the Σχέδιο Ανάκαμψης και Ανθεκτικότητας, the
-- Cyprus Recovery and Resilience Plan. It is not the EU structural funds
-- already in the enum, and 16 rows of the capex plan carry it, so it is its
-- own funding source. Adding a value to an enum is safe inside a transaction
-- from PostgreSQL 12 on as long as nothing uses it in the same transaction,
-- and nothing below does.
alter type ecapital.funding_source add value if not exists 'RRF';

-- CAPEX-03 §2 col A: «Αναπτυξιακά Έργα» is the only category the capex plan
-- holds, and it names the capital programme rather than one of the six kinds
-- of works the enum already carries — a row in it can be a new building, a
-- renovation or a piece of equipment. Mapping all 113 rows onto one of the
-- six would label them with something the sheet never said, so the mapping's
-- own value is added. Projects opened in the system still choose from the
-- six; the raw cell is kept in project.category_source either way.
alter type ecapital.project_category add value if not exists 'CAPITAL_WORKS';

do $$
begin
  -- CAPEX-03 §8: a budget vintage is either the forecast the current
  -- revision carries (cols U–X) or the superseded budget (cols AF–AI).
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'budget_line_type') then
    create type ecapital.budget_line_type as enum ('FORECAST', 'BUDGET');
  end if;
  -- CAPEX-01 §4 `cost_txn`.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'cost_txn_type') then
    create type ecapital.cost_txn_type as enum ('COMMITMENT', 'ACTUAL', 'ACCRUAL');
  end if;
  -- CAPEX-01 §4 lists SAP_EXTRACT, SAP_MCP and MANUAL. EXCEL_MIGRATION is
  -- the fourth: the opening balance carried over from the capex plan
  -- (CAPEX-03 §2 col S), which is neither a SAP posting nor something a
  -- person typed, and which has to be distinguishable from both for the
  -- first year the two sources run side by side.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'cost_source') then
    create type ecapital.cost_source as enum (
      'SAP_EXTRACT', 'SAP_MCP', 'MANUAL', 'EXCEL_MIGRATION');
  end if;
  -- CAPEX-03 §5: ERROR blocks the row, WARN imports it flagged, INFO is
  -- logged only.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'import_severity') then
    create type ecapital.import_severity as enum ('ERROR', 'WARN', 'INFO');
  end if;
  -- CAPEX-03 §2 col AD. One kind today; the delay narratives are the only
  -- audit trail of why dates moved, and they are kept apart from whatever
  -- kinds of note the system grows later.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'project_note_kind') then
    create type ecapital.project_note_kind as enum ('TECHNICAL');
  end if;
end $$;

-- --------------------------------------------------------- import_batch --

-- CAPEX-01 §4 `import_batch`, plus what CAPEX-03 §9 needs: the file's hash,
-- the profile that read it, the counts the reconciliation report prints, the
-- report itself, and whether the run was committed or was a dry run.
--
-- There is no org_unit_id on purpose. A batch spans every unit in the file,
-- so it is not a unit-scoped record; it is an administrator's record, and the
-- policies below say so.
create table if not exists ecapital.import_batch (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,
  file_name        text not null,
  -- CAPEX-01 §9: keep the source file hash and a link from each record to the
  -- file it came from, for the first year.
  file_sha256      text not null,
  profile_id       text not null,
  -- The revision of the sheet, e.g. «2026-02» (CAPEX-03 §8).
  period           text,
  rows_in          integer not null default 0,
  rows_project     integer not null default 0,
  rows_footer      integer not null default 0,
  rows_skipped     integer not null default 0,
  rows_created     integer not null default 0,
  rows_updated     integer not null default 0,
  rows_rejected    integer not null default 0,
  -- The subject of the person who ran it, the same value the audit trigger
  -- records as actor_id (ADR-0011), so one join answers "who imported this".
  imported_by      text,
  imported_at      timestamptz not null default now(),
  -- The whole reconciliation report as data: counts, per-column totals with
  -- their pass or fail, exceptions by rule, and the diff against the previous
  -- batch (CAPEX-03 §9). Kept so a report can be reprinted a year later
  -- without the file.
  report           jsonb,
  -- False for a dry run. A dry run rolls back, so a committed = false row
  -- only ever exists where the caller asked for the row to be kept.
  committed        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint import_batch_sha256_shape check (file_sha256 ~ '^[0-9a-f]{64}$')
);
create index if not exists import_batch_imported_idx on ecapital.import_batch (imported_at desc);
create index if not exists import_batch_file_idx on ecapital.import_batch (file_sha256);
create index if not exists import_batch_profile_idx on ecapital.import_batch (profile_id, imported_at desc);

-- ----------------------------------------------------- import_exception --

-- CAPEX-03 §5 and §9: every rule that fired, with the row number, the project
-- title and the offending value, so the exception can be resolved in the
-- system by somebody with a name against it. Nothing is ever fixed in the
-- spreadsheet.
create table if not exists ecapital.import_exception (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references ecapital.import_batch (id) on delete cascade,
  rule          text not null,
  severity      ecapital.import_severity not null,
  row_no        integer,
  project_title text,
  -- The offending cell as it was read, as text. It is text because the whole
  -- point of V06 is that the cell holds something a number column cannot.
  value         text,
  message_el    text not null,
  message_en    text not null,
  created_at    timestamptz not null default now(),
  constraint import_exception_rule_known
    check (rule in ('V01','V02','V03','V04','V05','V06','V07',
                    'V08','V09','V10','V11','V12','V13','V14'))
);
create index if not exists import_exception_batch_idx on ecapital.import_exception (batch_id, rule, row_no);

-- ----------------------------------------------------------- budget_line --

-- CAPEX-01 §4 `budget_line`, extended per CAPEX-03 §8 with the project it
-- belongs to, the vintage it was published in, whether it is a forecast or a
-- budget, and the year.
--
-- Why a vintage rather than one row per project per year: the capex plan
-- carries two generations of the same numbers side by side — the February
-- 2026 forecast in columns U–X and the superseded 2025 budget in AF–AI. Both
-- are imported so variance against the closed version is reportable (CAPEX-03
-- §2 AF–AI). Overwriting one with the other would destroy the only record of
-- what was promised last year.
create table if not exists ecapital.budget_line (
  id              uuid primary key default gen_random_uuid(),
  org_unit_id     text not null references ecapital.org_unit (id) on delete restrict,
  project_id      uuid references ecapital.project (id) on delete cascade,
  -- e.g. «2026-02» (the February 2026 revision) or «2025-prior».
  vintage_id      text not null,
  line_type       ecapital.budget_line_type not null,
  -- 9999 is the sentinel for "beyond the horizon" — CAPEX-03 §2 cols X and
  -- AI, «ΔΑΠΑΝΕΣ ΜΕΤΑ ΤΟ 2028». It is a year column, not a null, because the
  -- money is real and has to sum.
  budget_year     integer not null,
  amount          numeric(14, 2) not null,
  -- The rest of the CAPEX-01 §4 column list. The capex plan carries none of
  -- them; they are filled by the SAP ingestion and by finance (M2, R14).
  category        ecapital.project_category,
  sap_gl          text,
  approved_amount numeric(14, 2),
  revised_amount  numeric(14, 2),
  import_batch_id uuid references ecapital.import_batch (id) on delete set null,
  source_row_no   integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint budget_line_year_range check (budget_year between 2000 and 9999)
);
-- One line per project per vintage per year: re-running the same file finds
-- the line it wrote last time instead of writing a second one (CAPEX-03 §9).
create unique index if not exists budget_line_project_vintage_year_idx
  on ecapital.budget_line (project_id, vintage_id, budget_year)
  where project_id is not null;
create index if not exists budget_line_unit_year_idx on ecapital.budget_line (org_unit_id, budget_year);
create index if not exists budget_line_batch_idx on ecapital.budget_line (import_batch_id);

-- -------------------------------------------------------------- cost_txn --

-- CAPEX-01 §4 `cost_txn`. work_order_id and asset_id are in that column list
-- and are deliberately absent here: neither table exists yet (M6, M7), and a
-- column referencing nothing is a column nobody can trust. They arrive with
-- their tables.
--
-- CAPEX-03 §2 col S: the capex plan's «Πραγματική δαπάνη … μέχρι 03/2026» is
-- cumulative from the start of the project despite what the header says, so
-- it is posted as ONE opening balance dated at the as-of date, never as a
-- 2026 figure. The year-by-year actuals arrive from SAP KSB1/FBL5N (CAPEX-03
-- §7) and will be ordinary rows in this same table.
create table if not exists ecapital.cost_txn (
  id              uuid primary key default gen_random_uuid(),
  org_unit_id     text not null references ecapital.org_unit (id) on delete restrict,
  project_id      uuid references ecapital.project (id) on delete cascade,
  contract_id     uuid references ecapital.contract (id) on delete set null,
  budget_line_id  uuid references ecapital.budget_line (id) on delete set null,
  txn_type        ecapital.cost_txn_type not null,
  source          ecapital.cost_source not null,
  -- Where the figure came from in the source, e.g.
  -- «capex_plan_2026_02:S:41» — profile, column, row.
  source_ref      text,
  doc_date        date,
  posting_date    date,
  amount          numeric(14, 2) not null,
  currency        text not null default 'EUR',
  description     text,
  import_batch_id uuid references ecapital.import_batch (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint cost_txn_currency_eur check (currency = 'EUR')
);
-- The opening balance is one row per project per source reference, so a
-- second run of the same file updates it rather than posting the spend twice.
create unique index if not exists cost_txn_project_source_ref_idx
  on ecapital.cost_txn (project_id, source, source_ref)
  where project_id is not null and source_ref is not null;
create index if not exists cost_txn_project_idx on ecapital.cost_txn (project_id);
create index if not exists cost_txn_unit_date_idx on ecapital.cost_txn (org_unit_id, doc_date);
create index if not exists cost_txn_batch_idx on ecapital.cost_txn (import_batch_id);

-- ---------------------------------------------------------- project_note --

-- CAPEX-03 §2 col AD: 74 rows of «Σχόλια από Τεχνικό Τμήμα», some over a
-- thousand characters. Kept verbatim — they are the delay narratives and the
-- only audit trail of why dates moved.
create table if not exists ecapital.project_note (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references ecapital.project (id) on delete cascade,
  org_unit_id     text not null references ecapital.org_unit (id) on delete restrict,
  kind            ecapital.project_note_kind not null default 'TECHNICAL',
  text_el         text not null,
  import_batch_id uuid references ecapital.import_batch (id) on delete set null,
  source_row_no   integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- An imported note is the one the sheet carries for that project and kind, so
-- the next run of the same file rewrites it in place. Notes somebody types in
-- the system later have no batch and are not touched by this.
create unique index if not exists project_note_imported_idx
  on ecapital.project_note (project_id, kind)
  where import_batch_id is not null;
create index if not exists project_note_project_idx on ecapital.project_note (project_id);

-- ------------------------------------------- provenance on the register --

-- CAPEX-01 §9: a link from each record to the file it came from, for the
-- first year. A project created in the system carries none of these.
alter table ecapital.project
  add column if not exists import_batch_id uuid references ecapital.import_batch (id) on delete set null,
  add column if not exists source_file_sha256 text,
  add column if not exists source_row_no integer,
  -- CAPEX-03 §2 col A: «Αναπτυξιακά Έργα» is the only value the sheet holds
  -- and nine rows are blank. The register stores CAPITAL_WORKS either way;
  -- this keeps what the cell actually said, so the nine defaulted rows stay
  -- visible after the import report has been filed (V03).
  add column if not exists category_source text;
create index if not exists project_import_batch_idx on ecapital.project (import_batch_id);

-- The inherited-unit trigger of 0002, for the three new project children.
do $$
declare
  t text;
begin
  foreach t in array array['budget_line', 'cost_txn', 'project_note']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_inherit_org_unit', t);
    execute format(
      'create trigger %I before insert or update of project_id on ecapital.%I
         for each row when (new.project_id is not null)
         execute function ecapital.inherit_project_org_unit()',
      t || '_inherit_org_unit', t);
  end loop;
end $$;

-- --------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array[
    'import_batch', 'import_exception', 'budget_line', 'cost_txn', 'project_note']
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
    'import_batch', 'import_exception', 'budget_line', 'cost_txn', 'project_note']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
  end loop;
end $$;

-- An import is an administrator's job: it writes to every unit in one
-- transaction, which is exactly what a unit-scoped account must not be able
-- to do. The auditor reads it, like everything else (CAPEX-01 §10), and
-- writes nothing.
drop policy if exists import_batch_read on ecapital.import_batch;
create policy import_batch_read on ecapital.import_batch
  for select using (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly'));
drop policy if exists import_batch_write on ecapital.import_batch;
create policy import_batch_write on ecapital.import_batch
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

drop policy if exists import_exception_read on ecapital.import_exception;
create policy import_exception_read on ecapital.import_exception
  for select using (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly'));
drop policy if exists import_exception_write on ecapital.import_exception;
create policy import_exception_write on ecapital.import_exception
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

-- The money and the notes belong to the unit that owns the project, and are
-- read and written exactly like the project itself (ADR-0010).
do $$
declare
  t text;
begin
  foreach t in array array['budget_line', 'cost_txn', 'project_note']
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

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Same revoke as 0001 and 0002: the grant above is written `on all tables`,
-- so say it again (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
