-- eCapital M2 — the cost module: SAP ingestion, the four ledgers, the
-- warn-and-flag rules, payment certificates, cash flow and accruals.
--
-- R11 (payment certificates), R13 (four ledgers), R14 (SAP extract import
-- with an unmatched-allocation queue), R15 (a swappable cost source), R16
-- (forecast and cost to complete), R17 (cash flow), R18 (year-end accruals),
-- R31 (budget warnings, warn-and-flag only). CAPEX-01 §7 is the cost engine;
-- `packages/shared/src/cost.ts` is the contract this schema has to be able to
-- answer, field for field. ADR-0021 records the decisions.
--
-- 0005 already created import_batch, import_exception, budget_line, cost_txn
-- and project_note for the Excel migration. They are extended here, never
-- recreated: the capex plan's rows are in them and the importer still writes
-- them the same way.
--
-- NO PATIENT DATA. Same rule as every migration before it. A cost
-- transaction is a money figure against a project, a date and a SAP document;
-- a payment certificate is a money figure against a contract; a warning is a
-- sentence about money. None of them has anywhere to put a patient name, an
-- identifier, a diagnosis, an episode or an appointment.
--
-- Every table added here gets its row-level-security policies and its audit
-- trigger in this same file (ADR-0008, ADR-0011).

-- ---------------------------------------------------------------- enums --

do $$
begin
  -- packages/shared `SapReport`. CAPEX-01 §7 writes «FBL5N»; the contract the
  -- web and the API share says FBL1N, which is the vendor line-item report a
  -- clerk actually runs. The contract wins and the brief's erratum records it.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'sap_report') then
    create type ecapital.sap_report as enum ('ME2N', 'KSB1', 'FBL1N');
  end if;

  -- packages/shared `ImportBatchStatus`. A DRY_RUN row is never written — the
  -- value exists so the API can answer with one without inventing a status
  -- the shared enum does not have.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'import_batch_status') then
    create type ecapital.import_batch_status as enum (
      'DRY_RUN', 'PENDING_ALLOCATION', 'COMMITTED', 'FAILED');
  end if;

  -- packages/shared `CostTxn.matchedBy` (R14): how the row found its project.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'cost_matched_by') then
    create type ecapital.cost_matched_by as enum (
      'WBS', 'PO', 'COST_CENTRE', 'MANUAL', 'RULE', 'NONE');
  end if;

  -- packages/shared `PaymentCertStatus` (R11, CAPEX-01 §4). Forward only.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'payment_cert_status') then
    create type ecapital.payment_cert_status as enum (
      'DRAFT', 'ENGINEER_APPROVED', 'FINANCE_RECEIVED', 'PAID');
  end if;

  -- packages/shared `CostWarningKey` (R31). Five rules, none of them blocking.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'cost_warning_key') then
    create type ecapital.cost_warning_key as enum (
      'commitmentOverYearBudget', 'forecastOverApproved', 'variationsOverTenPct',
      'certifiedOverContract', 'retentionBeforeDlpEnd');
  end if;
end $$;

-- ------------------------------------------------- the register's keys --

-- R14, matching step 3. CAPEX-01 §4 puts a cost centre on org_unit and on
-- area but not on project, and a KSB1 extract matches on exactly that: the
-- cost centre the posting carries. Without it the third matching step has
-- nothing to compare against and every KSB1 row that has no WBS and no PO
-- falls straight through to the unmatched queue.
alter table ecapital.project
  add column if not exists cost_centre text;
create index if not exists project_cost_centre_idx on ecapital.project (cost_centre)
  where cost_centre is not null;
create index if not exists project_sap_wbs_idx on ecapital.project (sap_wbs)
  where sap_wbs is not null;
create index if not exists contract_sap_po_idx on ecapital.contract (sap_po_number)
  where sap_po_number is not null;

-- SIMILAR_TEXT suggestions run trigram similarity over the project titles and
-- the contract references of the caller's own units (R14). pg_trgm is already
-- installed by 0002 for the project list's `q` search.
create index if not exists project_title_trgm_idx
  on ecapital.project using gin (ecapital.normalise(title_el) gin_trgm_ops);

-- ---------------------------------------------- import_batch, extended --

-- 0005 built this for the Excel migration, which has no report, no period in
-- the SAP sense, no money totals and only a committed/dry-run flag. A SAP
-- extract has all of them, and the shared `ImportBatch` names every one.
-- `report` is the SAP report and `report_json` is the reconciliation report
-- the capex CLI stores. 0005 called the second one `report`, which is the
-- name the shared contract needs for the first. The column is renamed once,
-- here, and the CLI follows; nothing else reads it.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'ecapital' and table_name = 'import_batch'
                and column_name = 'report' and data_type = 'jsonb') then
    alter table ecapital.import_batch rename column report to report_json;
  end if;
end $$;
alter table ecapital.import_batch
  add column if not exists report_json jsonb;

alter table ecapital.import_batch
  add column if not exists report ecapital.sap_report,
  add column if not exists status ecapital.import_batch_status,
  add column if not exists rows_matched integer not null default 0,
  add column if not exists rows_unmatched integer not null default 0,
  add column if not exists amount_in numeric(16, 2) not null default 0,
  add column if not exists amount_matched numeric(16, 2) not null default 0,
  add column if not exists imported_by_id uuid references ecapital.app_user (id) on delete set null,
  add column if not exists error_el text,
  add column if not exists error_en text;

-- Backfill the status of the batches the Excel importer already wrote, so a
-- column that is NOT NULL from here on has no gap behind it.
update ecapital.import_batch
   set status = case when committed then 'COMMITTED' else 'DRY_RUN' end::ecapital.import_batch_status
 where status is null;
alter table ecapital.import_batch
  alter column status set default 'PENDING_ALLOCATION',
  alter column status set not null;

-- R14: the same file twice is a mistake, not an import. One committed batch
-- per file hash per report; a dry run writes nothing, so it cannot collide.
create unique index if not exists import_batch_sha_report_key
  on ecapital.import_batch (file_sha256, report)
  where report is not null and status <> 'FAILED';

-- --------------------------------------------- import_exception, wider --

-- 0005 restricted the rule to CAPEX-03's fourteen validation rules. A SAP
-- import has its own, so the constraint is widened rather than dropped: a
-- rule name nobody implements is still refused.
alter table ecapital.import_exception
  drop constraint if exists import_exception_rule_known;
alter table ecapital.import_exception
  add constraint import_exception_rule_known
  check (rule in ('V01','V02','V03','V04','V05','V06','V07',
                  'V08','V09','V10','V11','V12','V13','V14',
                  -- R14, the SAP extract's own exceptions.
                  'ROW_UNREADABLE', 'AMOUNT_UNREADABLE', 'DATE_UNREADABLE',
                  'COLUMN_MISSING', 'UNMATCHED', 'SKIPPED'));

alter table ecapital.import_exception
  add column if not exists cost_txn_id uuid references ecapital.cost_txn (id) on delete cascade;
create index if not exists import_exception_txn_idx on ecapital.import_exception (cost_txn_id);

-- ------------------------------------------------- cost_txn, extended --

-- Every field of the shared `CostTxn` that 0005 did not need. work_order_id
-- and asset_id stay out for the reason 0005 gave — their tables arrive with
-- M5 and M6 — and the API answers null for both until they do.
alter table ecapital.cost_txn
  add column if not exists vendor_name text,
  add column if not exists sap_wbs text,
  add column if not exists sap_po text,
  add column if not exists cost_centre text,
  add column if not exists gl_account text,
  add column if not exists matched_by ecapital.cost_matched_by not null default 'NONE',
  -- R14: a row the allocator passed over. It stays unmatched and stays in the
  -- batch, but the queue stops offering it so the next row can be dealt with.
  add column if not exists skipped boolean not null default false,
  -- The normalised description, so a remembered rule matches next month's
  -- spelling of the same narrative. Stored rather than computed per query.
  add column if not exists description_norm text
    generated always as (ecapital.normalise(coalesce(description, ''))) stored;

-- A row the Excel migration wrote is matched: it came in against a project.
update ecapital.cost_txn set matched_by = 'MANUAL'
 where source = 'EXCEL_MIGRATION' and project_id is not null and matched_by = 'NONE';

-- R14: a row that has not found its project yet belongs to no unit, because
-- nobody knows which unit it belongs to — that is the whole point of the
-- unmatched queue. The column therefore has to be nullable, and the policies
-- below say who may see and allocate a row with no unit on it.
alter table ecapital.cost_txn alter column org_unit_id drop not null;

create index if not exists cost_txn_contract_idx on ecapital.cost_txn (contract_id);
create index if not exists cost_txn_type_idx on ecapital.cost_txn (txn_type, posting_date);
create index if not exists cost_txn_unmatched_idx on ecapital.cost_txn (import_batch_id)
  where project_id is null;
create index if not exists cost_txn_desc_trgm_idx
  on ecapital.cost_txn using gin (description_norm gin_trgm_ops);

-- R14: one row per document reference per SAP batch. The Excel migration's
-- own unique index (project_id, source, source_ref) stays and this one does
-- not touch it — the capex plan writes one opening balance per project under
-- a source reference naming the column, so the same reference appears 113
-- times in one batch and is meant to.
create unique index if not exists cost_txn_batch_source_ref_key
  on ecapital.cost_txn (import_batch_id, source_ref)
  where import_batch_id is not null and source_ref is not null
    and source in ('SAP_EXTRACT', 'SAP_MCP');

-- ---------------------------------------------- budget_line, extended --

-- The shared `BudgetLine.category` is a cost category — the bucket S04 groups
-- the four ledgers by — and not one of the six kinds of project. 0005 typed
-- it as project_category, which is the wrong vocabulary and which nothing has
-- ever written. It becomes text with a closed list, in the same lower-case
-- spelling the interface uses as an i18n key suffix.
alter table ecapital.budget_line
  alter column category type text using category::text;
update ecapital.budget_line set category = null
 where category is not null and category not in ('works', 'equipment', 'fees', 'contingency', 'other');
alter table ecapital.budget_line
  drop constraint if exists budget_line_category_known;
alter table ecapital.budget_line
  add constraint budget_line_category_known
  check (category is null or category in ('works', 'equipment', 'fees', 'contingency', 'other'));

-- ------------------------------------------------------ forecast_inputs --

-- R16. What the engineer sets on top of the commitments: a contingency and
-- the weight a submitted-but-undecided variation carries. One row per
-- project; a project with no row uses the contract's defaults (0 and 0.5).
create table if not exists ecapital.forecast_inputs (
  project_id                uuid primary key references ecapital.project (id) on delete cascade,
  org_unit_id               text not null references ecapital.org_unit (id) on delete restrict,
  contingency               numeric(14, 2) not null default 0,
  pending_variation_weight  numeric(4, 3) not null default 0.5,
  contingency_note_el       text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint forecast_inputs_contingency_non_negative check (contingency >= 0),
  constraint forecast_inputs_weight_range check (pending_variation_weight between 0 and 1)
);

-- ------------------------------------------------------ allocation_rule --

-- R14: "remember previous allocations, suggest by supplier and text
-- similarity". A rule is the vendor plus the normalised narrative, and it
-- says which project and which contract that pair belongs to. The next
-- import applies it as matchedBy RULE, which is the whole reason the
-- unmatched queue shrinks month by month.
create table if not exists ecapital.allocation_rule (
  id              uuid primary key default gen_random_uuid(),
  org_unit_id     text not null references ecapital.org_unit (id) on delete restrict,
  project_id      uuid not null references ecapital.project (id) on delete cascade,
  contract_id     uuid references ecapital.contract (id) on delete set null,
  vendor_name     text not null,
  vendor_norm     text not null,
  -- Empty where the allocation was made on the vendor alone.
  text_norm       text not null default '',
  hits            integer not null default 0,
  created_by      uuid references ecapital.app_user (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists allocation_rule_key
  on ecapital.allocation_rule (vendor_norm, text_norm);
create index if not exists allocation_rule_project_idx on ecapital.allocation_rule (project_id);
create index if not exists allocation_rule_unit_idx on ecapital.allocation_rule (org_unit_id);

-- --------------------------------------------------------- payment_cert --

-- R11, CAPEX-01 §4 `payment_cert`. The derived figures are columns and not a
-- view because they are what was certified on the day — a retention
-- percentage that changes next year must not rewrite last year's certificate.
-- They are computed by the API and checked here (ADR-0021).
create table if not exists ecapital.payment_cert (
  id                 uuid primary key default gen_random_uuid(),
  contract_id        uuid not null references ecapital.contract (id) on delete cascade,
  org_unit_id        text not null references ecapital.org_unit (id) on delete restrict,
  -- 1..n per contract, allocated by ecapital.allocate_payment_cert_number.
  number             integer not null,
  period_from        date not null,
  period_to          date not null,
  work_done_value    numeric(14, 2) not null,
  materials_on_site  numeric(14, 2) not null default 0,
  retention_held     numeric(14, 2) not null default 0,
  previous_certified numeric(14, 2) not null default 0,
  net_payable        numeric(14, 2) not null default 0,
  status             ecapital.payment_cert_status not null default 'DRAFT',
  created_by         uuid not null references ecapital.app_user (id) on delete restrict,
  approved_by        uuid references ecapital.app_user (id) on delete set null,
  approved_at        timestamptz,
  sap_invoice_ref    text,
  paid_date          date,
  retention_released boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payment_cert_period_ordered check (period_to >= period_from),
  constraint payment_cert_amounts_non_negative
    check (work_done_value >= 0 and materials_on_site >= 0 and retention_held >= 0),
  -- RULE (R11, CAPEX-01 §10, ADR-0015's precedent): whoever approves a
  -- certificate is never the person who created it. Written here as well as
  -- in the service, so it holds for a repair script and a psql session too.
  constraint payment_cert_approver_not_creator
    check (approved_by is null or approved_by <> created_by),
  -- FINANCE_RECEIVED needs the SAP invoice reference; PAID needs the date.
  constraint payment_cert_invoice_ref_when_received
    check (status not in ('FINANCE_RECEIVED', 'PAID') or sap_invoice_ref is not null),
  constraint payment_cert_paid_date_when_paid
    check (status <> 'PAID' or paid_date is not null)
);
create unique index if not exists payment_cert_contract_number_key
  on ecapital.payment_cert (contract_id, number);
create index if not exists payment_cert_contract_idx on ecapital.payment_cert (contract_id);
create index if not exists payment_cert_unit_status_idx on ecapital.payment_cert (org_unit_id, status);

-- R11: the statuses go forward and only forward. A trigger rather than a
-- CHECK, because a CHECK cannot see where the row came from.
create or replace function ecapital.payment_cert_forward_only() returns trigger
language plpgsql as $$
declare
  v_old integer;
  v_new integer;
begin
  v_old := array_position(
    array['DRAFT', 'ENGINEER_APPROVED', 'FINANCE_RECEIVED', 'PAID'], old.status::text);
  v_new := array_position(
    array['DRAFT', 'ENGINEER_APPROVED', 'FINANCE_RECEIVED', 'PAID'], new.status::text);
  if v_new < v_old then
    raise exception 'a payment certificate does not go back from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists payment_cert_forward_only on ecapital.payment_cert;
create trigger payment_cert_forward_only
  before update of status on ecapital.payment_cert
  for each row execute function ecapital.payment_cert_forward_only();

-- The same advisory-lock pattern as the variation number (ADR-0015): two
-- engineers certifying in the same second queue instead of racing, and the
-- unique index is the backstop.
create or replace function ecapital.allocate_payment_cert_number(p_contract_id uuid)
returns integer
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_next integer;
begin
  if not exists (select 1 from ecapital.contract c where c.id = p_contract_id) then
    raise exception 'no such contract: %', p_contract_id using errcode = 'foreign_key_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ecapital.payment_cert_number'), hashtext(p_contract_id::text));
  select coalesce(max(pc.number), 0) + 1 into v_next
    from ecapital.payment_cert pc where pc.contract_id = p_contract_id;
  return v_next;
end $$;

-- ---------------------------------------------------------- cost_warning --

-- R31, and CAPEX-01 §1's rule that budget control is warn-and-flag and never
-- a hard block. A warning is a row so that a dismissal survives the next page
-- load; the sentence is stored in both languages because the system never
-- machine-translates (CAPEX-01 §6.1) and the figures inside it were formatted
-- when it fired.
create table if not exists ecapital.cost_warning (
  id                uuid primary key default gen_random_uuid(),
  org_unit_id       text not null references ecapital.org_unit (id) on delete restrict,
  project_id        uuid not null references ecapital.project (id) on delete cascade,
  contract_id       uuid references ecapital.contract (id) on delete cascade,
  key               ecapital.cost_warning_key not null,
  sentence_el       text not null,
  sentence_en       text not null,
  amount            numeric(16, 2),
  fired_at          timestamptz not null default now(),
  dismissed_by      uuid references ecapital.app_user (id) on delete set null,
  dismissed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint cost_warning_dismissal_complete
    check ((dismissed_by is null) = (dismissed_at is null))
);
-- RULE (R31): one live warning per rule per subject. A dismissed one stays
-- for the record, and a new one fires beside it when the figure moves.
create unique index if not exists cost_warning_live_key
  on ecapital.cost_warning (project_id, coalesce(contract_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
  where dismissed_at is null;
create index if not exists cost_warning_project_idx on ecapital.cost_warning (project_id, fired_at desc);
create index if not exists cost_warning_unit_idx on ecapital.cost_warning (org_unit_id);

-- ----------------------------------------------------------- email_outbox --

-- CAPEX-01 §7: each warn-and-flag rule "fires a flag on the project, an entry
-- in the exceptions list and an email to the head of estates". There is no
-- SMTP server configured for eCapital yet and inventing one here would either
-- send mail nobody asked for or fail every write that produces a warning. The
-- row is written; a sender picks it up when there is one (ADR-0021).
create table if not exists ecapital.email_outbox (
  id            uuid primary key default gen_random_uuid(),
  org_unit_id   text references ecapital.org_unit (id) on delete set null,
  to_email      text not null,
  to_name       text,
  subject_el    text not null,
  subject_en    text not null,
  body_el       text not null,
  body_en       text not null,
  entity_type   text not null,
  entity_id     text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  error         text
);
create index if not exists email_outbox_unsent_idx on ecapital.email_outbox (created_at)
  where sent_at is null;

-- --------------------------------------------------- inherited org units --

-- The same trigger every child of a project and of a contract uses
-- (ADR-0010): the unit is a copy, filled from the parent, so the policy is a
-- column comparison and not a walk up the tree.
do $$
declare
  t text;
begin
  foreach t in array array['forecast_inputs', 'allocation_rule', 'cost_warning']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_inherit_org_unit', t);
    execute format(
      'create trigger %I before insert or update of project_id on ecapital.%I
         for each row when (new.project_id is not null)
         execute function ecapital.inherit_project_org_unit()',
      t || '_inherit_org_unit', t);
  end loop;
end $$;

drop trigger if exists payment_cert_inherit_org_unit on ecapital.payment_cert;
create trigger payment_cert_inherit_org_unit
  before insert or update of contract_id on ecapital.payment_cert
  for each row execute function ecapital.inherit_contract_org_unit();

-- ------------------------------------------------- warnings and outbox --

-- R31 fires on read as well as on write: opening a project's cost screen is
-- how somebody finds out the forecast has gone past the approved budget. A
-- read-only account must be able to open that screen, so the warning row
-- cannot be written under the caller's own policy — an auditor would be
-- refused and the screen would fail. SECURITY DEFINER writes it as the owner;
-- the audit trigger still records the caller as the actor, which is what
-- matters for R42.
-- Written by the same code path that records a warning, and for the same
-- reason it is SECURITY DEFINER.
create or replace function ecapital.queue_email(
  p_org_unit_id text, p_to_email text, p_to_name text,
  p_subject_el text, p_subject_en text, p_body_el text, p_body_en text,
  p_entity_type text, p_entity_id text)
returns uuid
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_id uuid;
begin
  insert into ecapital.email_outbox
    (org_unit_id, to_email, to_name, subject_el, subject_en, body_el, body_en,
     entity_type, entity_id)
  values (p_org_unit_id, p_to_email, p_to_name, p_subject_el, p_subject_en,
          p_body_el, p_body_en, p_entity_type, p_entity_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function ecapital.record_cost_warning(
  p_project_id   uuid,
  p_contract_id  uuid,
  p_key          ecapital.cost_warning_key,
  p_amount       numeric,
  p_sentence_el  text,
  p_sentence_en  text)
returns uuid
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_unit    text;
  v_live    ecapital.cost_warning%rowtype;
  v_amount  numeric := round(coalesce(p_amount, 0), 2);
  v_id      uuid;
  v_head    record;
begin
  select p.org_unit_id into v_unit from ecapital.project p where p.id = p_project_id;
  if v_unit is null then
    raise exception 'no such project: %', p_project_id using errcode = 'foreign_key_violation';
  end if;

  select * into v_live from ecapital.cost_warning w
   where w.project_id = p_project_id
     and w.key = p_key
     and w.contract_id is not distinct from p_contract_id
     and w.dismissed_at is null
   limit 1;

  if found then
    -- Still live and still the same figure: leave the row alone so the audit
    -- trail does not grow a line every time somebody opens the screen.
    if round(coalesce(v_live.amount, 0), 2) = v_amount
       and v_live.sentence_el = p_sentence_el then
      return v_live.id;
    end if;
    update ecapital.cost_warning
       set amount = p_amount, sentence_el = p_sentence_el, sentence_en = p_sentence_en,
           fired_at = now(), updated_at = now()
     where id = v_live.id;
    return v_live.id;
  end if;

  -- RULE (R31): a rule that was dismissed fires again as a NEW row once the
  -- figure moves. The dismissed row stays exactly as it was.
  if exists (
    select 1 from ecapital.cost_warning w
     where w.project_id = p_project_id
       and w.key = p_key
       and w.contract_id is not distinct from p_contract_id
       and w.dismissed_at is not null
       and round(coalesce(w.amount, 0), 2) = v_amount
     order by w.fired_at desc
     limit 1)
  then
    return null;
  end if;

  insert into ecapital.cost_warning
    (org_unit_id, project_id, contract_id, key, sentence_el, sentence_en, amount)
  values (v_unit, p_project_id, p_contract_id, p_key, p_sentence_el, p_sentence_en, p_amount)
  returning id into v_id;

  -- CAPEX-01 §7: every one of these rules "fires a flag on the project, an
  -- entry in the exceptions list and an email to the head of estates". The
  -- flag is the row above and the entry is the same row read from the
  -- exceptions list; the email is queued here, once, when the warning is
  -- new. A warning that keeps firing at the same figure does not send a
  -- second letter, and a dismissed one that fires again does.
  for v_head in
    select u.email, u.name
      from ecapital.app_user u
      join ecapital.app_user_role r on r.app_user_id = u.id and r.role = 'estates_head'
      join ecapital.app_user_org_unit ou on ou.app_user_id = u.id and ou.org_unit_id = v_unit
     where u.is_active
  loop
    perform ecapital.queue_email(
      v_unit, v_head.email, v_head.name,
      'eCapital — προειδοποίηση κόστους', 'eCapital — cost warning',
      p_sentence_el, p_sentence_en, 'cost_warning', v_id::text);
  end loop;

  return v_id;
end $$;

-- The condition stopped holding: the figure came back under the line, the
-- variation was withdrawn, the certificate was corrected. The row goes; the
-- audit log keeps the DELETE with its before-image, which is the record that
-- it ever fired.
create or replace function ecapital.clear_cost_warning(
  p_project_id uuid, p_contract_id uuid, p_key ecapital.cost_warning_key)
returns integer
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_count integer;
begin
  delete from ecapital.cost_warning w
   where w.project_id = p_project_id
     and w.key = p_key
     and w.contract_id is not distinct from p_contract_id
     and w.dismissed_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- R14: the batch's counters after an allocation or a skip. A project
-- engineer may allocate rows in their own unit but may not write the batch
-- record, which spans every unit in the file — so the counters are moved by
-- the database and not by the caller.
create or replace function ecapital.refresh_import_batch_counts(p_batch_id uuid)
returns void
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  update ecapital.import_batch b
     set rows_matched = c.matched,
         rows_unmatched = c.unmatched,
         amount_matched = c.amount_matched,
         updated_at = now()
    from (
      select count(*) filter (where t.project_id is not null)::int as matched,
             count(*) filter (where t.project_id is null)::int as unmatched,
             coalesce(sum(t.amount) filter (where t.project_id is not null), 0) as amount_matched
        from ecapital.cost_txn t
       where t.import_batch_id = p_batch_id) c
   where b.id = p_batch_id;
end $$;

-- --------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array[
    'forecast_inputs', 'allocation_rule', 'payment_cert', 'cost_warning', 'email_outbox']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on ecapital.%I
         for each row execute function ecapital.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ------------------------------------------------- row-level security --

-- CAPEX-01 §10 and §1. Finance owns the money screens, the head of estates
-- and the engineers own the projects, and the two read-only roles are already
-- refused by can_write_unit. The cost ledger is the one place where finance
-- writes as well as reads, which is why it needs a predicate of its own.
create or replace function ecapital.can_manage_cost(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin')
       or ecapital.has_role('estates_head')
       or ecapital.has_role('project_engineer')
       or ecapital.has_role('finance'))
$$;

-- ADR-0014, owner decision 19/09/2026: a budget after approval is finance's.
-- The approved budget on the project already goes through
-- ecapital.set_approved_budget for that reason; the budget lines behind it
-- follow the same rule, so an engineer cannot rewrite the annual profile that
-- the approved figure is the sum of.
create or replace function ecapital.can_manage_budget_line(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin') or ecapital.has_role('finance'))
$$;

-- An import batch is a file, not a unit: it spans every unit the extract
-- touches. Whoever runs the cost screens may read one; only the three roles
-- that may import write one. The auditor and the executive read everything
-- and write nothing (ADR-0010).
drop policy if exists import_batch_read on ecapital.import_batch;
create policy import_batch_read on ecapital.import_batch
  for select using (
    ecapital.has_role('admin') or ecapital.has_role('auditor_readonly')
    or ecapital.has_role('executive_readonly') or ecapital.has_role('finance')
    or ecapital.has_role('estates_head') or ecapital.has_role('project_engineer'));
drop policy if exists import_batch_write on ecapital.import_batch;
create policy import_batch_write on ecapital.import_batch
  for all
  using (ecapital.has_role('admin') or ecapital.has_role('finance') or ecapital.has_role('estates_head'))
  with check (ecapital.has_role('admin') or ecapital.has_role('finance') or ecapital.has_role('estates_head'));

drop policy if exists import_exception_read on ecapital.import_exception;
create policy import_exception_read on ecapital.import_exception
  for select using (
    ecapital.has_role('admin') or ecapital.has_role('auditor_readonly')
    or ecapital.has_role('executive_readonly') or ecapital.has_role('finance')
    or ecapital.has_role('estates_head') or ecapital.has_role('project_engineer'));
drop policy if exists import_exception_write on ecapital.import_exception;
create policy import_exception_write on ecapital.import_exception
  for all
  using (ecapital.has_role('admin') or ecapital.has_role('finance') or ecapital.has_role('estates_head'))
  with check (ecapital.has_role('admin') or ecapital.has_role('finance') or ecapital.has_role('estates_head'));

-- R14: who may work the unmatched queue. A row with no unit on it is not in
-- anybody's unit, so `can_read_unit` cannot answer for it; these two say what
-- happens instead. The read side is everyone who may open the cost screens,
-- including the two read-only roles, and the write side is everyone who may
-- allocate — which is the three importing roles plus the engineers, who
-- CAPEX-01 §1 has running ten to twenty projects each and reading cost all
-- day.
create or replace function ecapital.can_read_unallocated() returns boolean
language sql stable parallel safe as $$
  select ecapital.has_role('admin') or ecapital.has_role('finance')
      or ecapital.has_role('estates_head') or ecapital.has_role('project_engineer')
      or ecapital.has_role('auditor_readonly') or ecapital.has_role('executive_readonly')
$$;

create or replace function ecapital.can_allocate_unallocated() returns boolean
language sql stable parallel safe as $$
  select not ecapital.has_role('auditor_readonly')
     and not ecapital.has_role('executive_readonly')
     and (ecapital.has_role('admin') or ecapital.has_role('finance')
       or ecapital.has_role('estates_head') or ecapital.has_role('project_engineer'))
$$;

-- Finance imports and allocates, so it writes the ledger. 0005 gave cost_txn
-- the project register's own predicate, which leaves finance out.
--
-- RULE (R14, CAPEX-01 §10): an engineer may allocate a row to a project in
-- their own units and nowhere else. That is not checked in the service: the
-- USING clause lets them pick up a row that belongs to nobody, and the WITH
-- CHECK — evaluated after the trigger has copied the project's unit onto the
-- row — refuses to put it down anywhere they may not write.
drop policy if exists cost_txn_read on ecapital.cost_txn;
create policy cost_txn_read on ecapital.cost_txn
  for select using (
    ecapital.can_read_unit(org_unit_id)
    or (org_unit_id is null and ecapital.can_read_unallocated()));
drop policy if exists cost_txn_write on ecapital.cost_txn;
create policy cost_txn_write on ecapital.cost_txn
  for all
  using (
    ecapital.can_manage_cost(org_unit_id)
    or (org_unit_id is null and ecapital.can_allocate_unallocated()))
  with check (
    ecapital.can_manage_cost(org_unit_id)
    or (org_unit_id is null and ecapital.can_allocate_unallocated()));

drop policy if exists budget_line_write on ecapital.budget_line;
create policy budget_line_write on ecapital.budget_line
  for all using (ecapital.can_manage_budget_line(org_unit_id))
  with check (ecapital.can_manage_budget_line(org_unit_id));

do $$
declare
  t text;
begin
  foreach t in array array[
    'forecast_inputs', 'allocation_rule', 'payment_cert', 'cost_warning', 'email_outbox']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
  end loop;

  foreach t in array array['forecast_inputs', 'allocation_rule', 'payment_cert', 'cost_warning']
  loop
    execute format('drop policy if exists %I on ecapital.%I', t || '_read', t);
    execute format(
      'create policy %I on ecapital.%I for select using (ecapital.can_read_unit(org_unit_id))',
      t || '_read', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_write', t);
    execute format(
      'create policy %I on ecapital.%I for all
         using (ecapital.can_manage_cost(org_unit_id))
         with check (ecapital.can_manage_cost(org_unit_id))',
      t || '_write', t);
  end loop;
end $$;

-- The outbox is a record of what the system decided to tell somebody. It is
-- written by ecapital.queue_email as the owner and read by an administrator
-- or the auditor; nobody writes it directly.
drop policy if exists email_outbox_read on ecapital.email_outbox;
create policy email_outbox_read on ecapital.email_outbox
  for select using (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly'));

-- R42 and the cost screens. 0002, 0003 and 0006 opened each entity's own
-- trail to whoever may read its unit; the money follows the same rule.
drop policy if exists audit_log_read_cost on ecapital.audit_log;
create policy audit_log_read_cost on ecapital.audit_log
  for select using (
    entity_type in ('cost_txn', 'budget_line', 'payment_cert', 'cost_warning',
                    'forecast_inputs', 'allocation_rule')
    and ecapital.can_read_unit(org_unit_id));

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Same revoke as every migration before it: the grant above is written `on
-- all tables`, so say it again (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
revoke all on ecapital.contract_ref_seq from ecapital_app;
