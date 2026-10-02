-- 0020 — the eFinance client (ADR-0029): the contract push, eFinance's
-- invoices and requisitions read into eCapital, and eFinance's vendors as a
-- local search list.
--
-- eFinance's integration record (docs/integration/eFinance-integration-
-- record.md) is the source of truth for every field name below. eCapital
-- never writes to an eFinance table; these are eCapital's own copies of what
-- eFinance answered, kept so the contract screen and the cost ledger can be
-- read without a round trip, and so a re-run of the sync changes nothing that
-- has not changed on eFinance's side.
--
--   1. `contract` gains three columns: when eFinance last accepted the
--      contract, what went wrong the last time it did not, and the spend
--      figures eFinance answered with (record §4).
--   2. `efinance_invoice` + `efinance_invoice_line`: the invoices tagged with
--      a CAP- reference, header and lines as the record spells them, plus
--      the raw answer. "Take spend from the lines, never the header."
--   3. `efinance_requisition`: the requisitions tagged the same way.
--   4. `efinance_sync_state`: one row per feed — the updated_since cursor,
--      when it last ran, what went wrong, how many rows it moved.
--   5. `efinance_vendor`: the vendor list, so the contractor form searches
--      locally instead of paging 6,148 rows over the loopback.
--   6. `EFINANCE` joins `cost_source`: a booked invoice line becomes an
--      ACTUAL cost_txn beside the SAP extract's, never instead of the table.
--
-- NO PATIENT DATA. An invoice is a supplier, an amount, a cost centre and a
-- budget code; a requisition is the same before the supplier is known. There
-- is nowhere here to put a patient name, an identifier, a diagnosis, an
-- episode or an appointment.

-- ------------------------------------------------------------ cost_source --

-- Added outside any use in this file: Postgres refuses a new enum value in
-- the same transaction that adds it, so nothing below names 'EFINANCE' as a
-- literal. The upsert reuses 0005's unique index on (project_id, source,
-- source_ref), which already covers it.
alter type ecapital.cost_source add value if not exists 'EFINANCE';

-- ----------------------------------------------------- contract, extended --

-- Record §4: eCapital pushes its contract before any read can return a row.
--   efinance_pushed_at   the last time eFinance accepted the current figures.
--                        Null: never accepted.
--   efinance_last_error  `CODE: message` from the last attempt that failed;
--                        null after a success. `CONFLICT: …` is never retried
--                        by the timer — a person resolves it.
--   efinance_spend       what eFinance answered: current_value, booked,
--                        in_flight, requisitions, remaining (2-decimal strings,
--                        as eFinance sent them) and fetched_at.
alter table ecapital.contract
  add column if not exists efinance_pushed_at timestamptz,
  add column if not exists efinance_last_error text,
  add column if not exists efinance_spend jsonb;

comment on column ecapital.contract.efinance_pushed_at is
  'When eFinance last accepted PUT /api/v1/capital/contracts/{cap_ref} for this contract (ADR-0029). Null: never.';
comment on column ecapital.contract.efinance_last_error is
  'CODE: message from the last push that failed; null after a success. CONFLICT is not retried automatically.';
comment on column ecapital.contract.efinance_spend is
  'eFinance''s own figures for this contract: current_value, booked, in_flight, requisitions, remaining (2-decimal strings) and fetched_at.';

-- The push state is the service's, not the caller's: a head of estates who
-- approves a variation may not be able to write every column of the contract
-- under a stricter policy one day, and the retry timer has no caller at all.
-- Both go through these two, as the eArchive queue goes through 0014's.
create or replace function ecapital.efinance_record_push(
  p_contract_id uuid, p_ok boolean, p_error text, p_spend jsonb)
returns void
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  if p_ok then
    update ecapital.contract
       set efinance_pushed_at = now(),
           efinance_last_error = null,
           efinance_spend = coalesce(p_spend, efinance_spend)
     where id = p_contract_id;
  else
    update ecapital.contract
       set efinance_last_error = p_error
     where id = p_contract_id
       and efinance_last_error is distinct from p_error;
  end if;
end $$;

create or replace function ecapital.efinance_record_spend(p_contract_id uuid, p_spend jsonb)
returns void
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  update ecapital.contract
     set efinance_spend = p_spend
   where id = p_contract_id
     and efinance_spend is distinct from p_spend;
end $$;

-- ------------------------------------------------ which actuals count --

-- RULE (ADR-0029 §3): for a contract eFinance has accepted, eFinance's booked
-- invoice lines are the spent ledger, and the SAP extract's actuals posted
-- against that same contract are kept for reconciliation but not added on
-- top — the same invoice would otherwise be spent twice. A SAP actual on a
-- contract eFinance does not know, or on no contract at all, counts exactly
-- as before. Every query that sums ACTUAL rows asks this one function, so
-- the rule is written once.
create or replace function ecapital.cost_txn_counts_as_spent(
  p_source ecapital.cost_source, p_contract_id uuid)
returns boolean
language sql stable as $$
  select not (
    p_source in ('SAP_EXTRACT', 'SAP_MCP')
    and p_contract_id is not null
    and exists (select 1 from ecapital.contract c
                 where c.id = p_contract_id and c.efinance_pushed_at is not null))
$$;

-- ------------------------------------------------------- efinance_invoice --

-- Keyed by eFinance's own id, so the sync is an upsert and a second run is a
-- no-op. `org_unit_id` and `contract_id` are eCapital's, resolved from
-- `cap_ref`; both are null for an invoice whose reference names no contract
-- this side knows, which is then visible to the cost roles and to nobody's
-- unit (the same rule as an unmatched cost_txn, ADR-0021 §4).
create table if not exists ecapital.efinance_invoice (
  id                  text primary key,
  org_unit_id         text references ecapital.org_unit (id) on delete restrict,
  contract_id         uuid references ecapital.contract (id) on delete set null,
  invoice_no          text,
  invoice_date        date,
  -- Record §3: the day the invoice went into the SAP batch file. Null while
  -- in flight. The cash-flow month; invoice_date is never a posting date.
  sap_batch_date      date,
  vendor_code         text,
  vendor_name         text,
  entity_code         text,
  currency            text not null,
  net                 numeric(14, 2),
  vat                 numeric(14, 2),
  gross               numeric(14, 2),
  status              text,
  ledger              text not null,
  cap_ref             text,
  reversed_at         timestamptz,
  reversal_sap_doc_no text,
  reversal_reason     text,
  -- eFinance's own updated_at, the cursor the next poll starts from.
  updated_at          timestamptz not null,
  raw                 jsonb not null,
  synced_at           timestamptz not null default now(),
  constraint efinance_invoice_ledger_known
    check (ledger in ('booked', 'in_flight', 'reversed', 'rejected'))
);
create index if not exists efinance_invoice_contract_idx on ecapital.efinance_invoice (contract_id);
create index if not exists efinance_invoice_cap_ref_idx on ecapital.efinance_invoice (cap_ref);
create index if not exists efinance_invoice_updated_idx on ecapital.efinance_invoice (updated_at);

comment on table ecapital.efinance_invoice is
  'eFinance''s capital invoices as eFinance last answered them (record §3). eCapital''s copy, never written back. Spend is taken from the lines, and only from booked ones (ADR-0029).';

create table if not exists ecapital.efinance_invoice_line (
  invoice_id   text not null references ecapital.efinance_invoice (id) on delete cascade,
  line_no      integer not null,
  org_unit_id  text references ecapital.org_unit (id) on delete restrict,
  descr        text,
  qty          numeric(14, 3),
  unit_price   numeric(14, 2),
  line_total   numeric(14, 2),
  vat_rate     numeric(7, 3),
  gl_account   text,
  cost_centre  text,
  budget_code  text,
  wbs_code     text,
  primary key (invoice_id, line_no),
  constraint efinance_invoice_line_no_non_negative check (line_no >= 0)
);

-- --------------------------------------------------- efinance_requisition --

create table if not exists ecapital.efinance_requisition (
  id             text primary key,
  org_unit_id    text references ecapital.org_unit (id) on delete restrict,
  contract_id    uuid references ecapital.contract (id) on delete set null,
  number         text not null,
  description    text,
  justification  text,
  entity_code    text,
  cost_centre    text,
  budget_code    text,
  gl_account     text,
  amount         numeric(14, 2),
  currency       text not null,
  status         text not null,
  cap_ref        text,
  po_number      text,
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  raw            jsonb not null,
  synced_at      timestamptz not null default now()
);
create index if not exists efinance_requisition_contract_idx on ecapital.efinance_requisition (contract_id);
create index if not exists efinance_requisition_cap_ref_idx on ecapital.efinance_requisition (cap_ref);

comment on table ecapital.efinance_requisition is
  'eFinance''s requisitions tagged with a CAP- reference (record §3). eFinance-side commitments, shown per contract and never added to eCapital''s own committed ledger (ADR-0015, ADR-0029).';

-- ---------------------------------------------------- efinance_sync_state --

create table if not exists ecapital.efinance_sync_state (
  feed             text primary key,
  -- The highest eFinance updated_at seen, sent back as `updated_since`.
  -- Null until the first run has seen a row; that run reads by reference.
  cursor           text,
  last_run_at      timestamptz,
  last_success_at  timestamptz,
  last_error       text,
  rows             integer not null default 0,
  constraint efinance_sync_state_feed_known
    check (feed in ('invoices', 'requisitions', 'master'))
);

-- -------------------------------------------------------- efinance_vendor --

-- The latest SAP batch's vendors, as eFinance serves them (record §3). The
-- contractor form searches this table by name or code; a vendor that drops
-- out of eFinance's list is marked inactive, never deleted, because a
-- contractor may already carry its code.
create table if not exists ecapital.efinance_vendor (
  vendor_code  text primary key,
  name         text not null,
  name_norm    text generated always as (ecapital.normalise(name)) stored,
  vat          text,
  blocked      boolean not null default false,
  active       boolean not null default true,
  sap_batch    text,
  synced_at    timestamptz not null default now()
);
create index if not exists efinance_vendor_name_trgm_idx
  on ecapital.efinance_vendor using gin (name_norm gin_trgm_ops);

-- ------------------------------------------------------------------ audit --

-- The invoice and requisition copies are audited, because a reversal or a
-- re-tagging arriving here is something an auditor asks about. The lines go
-- with their invoice (the raw answer is on the header row), and the vendor
-- list and the sync state are reference data and bookkeeping: six thousand
-- audit rows a day for a vendor batch would bury the trail it is there for.
do $$
declare
  t text;
begin
  foreach t in array array['efinance_invoice', 'efinance_requisition']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on ecapital.%I
         for each row execute function ecapital.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ------------------------------------------------------ row-level security --

alter table ecapital.efinance_invoice enable row level security;
alter table ecapital.efinance_invoice_line enable row level security;
alter table ecapital.efinance_requisition enable row level security;
alter table ecapital.efinance_sync_state enable row level security;
alter table ecapital.efinance_vendor enable row level security;

-- Read: whoever reads the unit, and — for a row whose CAP- reference names
-- no contract here — whoever may read the unmatched cost queue. Write: the
-- administrator only, which is the sync (run by an administrator, or by the
-- timer under the service's own administrative context, ADR-0029).
do $$
declare
  t text;
begin
  foreach t in array array['efinance_invoice', 'efinance_invoice_line', 'efinance_requisition']
  loop
    execute format('drop policy if exists %I on ecapital.%I', t || '_read', t);
    execute format(
      'create policy %I on ecapital.%I for select using (
         ecapital.can_read_unit(org_unit_id)
         or (org_unit_id is null and ecapital.can_read_unallocated()))',
      t || '_read', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_write', t);
    execute format(
      'create policy %I on ecapital.%I for all
         using (ecapital.has_role(''admin''))
         with check (ecapital.has_role(''admin''))',
      t || '_write', t);
  end loop;
end $$;

drop policy if exists efinance_sync_state_read on ecapital.efinance_sync_state;
create policy efinance_sync_state_read on ecapital.efinance_sync_state
  for select using (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly'));
drop policy if exists efinance_sync_state_write on ecapital.efinance_sync_state;
create policy efinance_sync_state_write on ecapital.efinance_sync_state
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

-- Reference data, like budget_code: every signed-in role searches it.
drop policy if exists efinance_vendor_read on ecapital.efinance_vendor;
create policy efinance_vendor_read on ecapital.efinance_vendor
  for select using (true);
drop policy if exists efinance_vendor_write on ecapital.efinance_vendor;
create policy efinance_vendor_write on ecapital.efinance_vendor
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

-- The two audited tables' trails open to whoever may read the unit.
drop policy if exists audit_log_read_efinance on ecapital.audit_log;
create policy audit_log_read_efinance on ecapital.audit_log
  for select using (
    entity_type in ('efinance_invoice', 'efinance_requisition')
    and (ecapital.can_read_unit(org_unit_id)
      or ecapital.has_role('admin') or ecapital.has_role('auditor_readonly')));

-- ------------------------------------------------------------------ grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Said again for the reason every migration before it says it (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
revoke all on ecapital.contract_ref_seq from ecapital_app;
revoke all on ecapital.permit_ref_seq from ecapital_app;
revoke all on ecapital.asset_tag_seq from ecapital_app;
