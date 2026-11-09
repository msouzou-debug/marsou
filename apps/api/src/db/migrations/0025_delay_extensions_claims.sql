-- eCapital — sections, extensions of time, claims and the delay penalty
-- (ADR-0035, from the ΜΕΕ report of November 2026 on capital investments,
-- docs/audit/2026-11-09-MEE-capital-findings-vs-eCapital.md).
--
-- Three tables under a contract, two columns on it, one sum kept by trigger
-- and one carry-over:
--
--   contract_section    «Τμήμα Α», «Τμήμα Β»: its own contractual completion,
--                       its own handover, an optional rate that overrides the
--                       contract's, and the activation of the penalty.
--   contract_extension  one row per approved extension of time (παράταση):
--                       days, when, who approved it, why, and whether the
--                       delay is the contractor's fault.
--   contract_claim      a claim (αξίωση) by the contractor or by the
--                       Organisation, its stage and the contingent-liability
--                       flag finance reads.
--
-- The penalty itself is never stored. It is computed on read
-- (apps/api/src/contracts/delay.ts) and shown; finance withholds it on the
-- payment certificate (owner decision, 09/11/2026). What is stored is the
-- activation: the date and the note the head of estates records.
--
-- `contract.extension_days` stays, as the sum of the extension rows. Nothing
-- that read it changes, and nobody types it any more: a BEFORE trigger on the
-- contract recomputes it on every write, the way `current_value` is kept
-- (0003), and an AFTER trigger on the extensions touches the contract when
-- the sum moves. A value typed before ADR-0035 becomes one extension row
-- marked as carried over.
--
-- The default role matrix gains APPROVE on `contractRecords` for admin and
-- estates_head (activating a penalty). Only cells still holding the seeded
-- default are moved; a cell the administrator has set is left as they set it.
--
-- NO PATIENT DATA: dates, days, money, committee names and legal stages.
--
-- Written as plain SQL (ADR-0008). Idempotent: `if not exists`, `create or
-- replace`, `drop … if exists` before every trigger and policy, and the two
-- data steps guarded so a second run finds nothing to do.

-- ------------------------------------------------------------ contract --

alter table ecapital.contract
  add column if not exists ld_activated_at date,
  add column if not exists ld_activation_note_el text;

-- ------------------------------------------------------------- sections --

create table if not exists ecapital.contract_section (
  id                          uuid primary key default gen_random_uuid(),
  contract_id                 uuid not null references ecapital.contract (id) on delete cascade,
  -- Copied from the contract by the trigger below, for the row policy.
  org_unit_id                 text not null references ecapital.org_unit (id),
  code                        text not null,
  title_el                    text not null,
  completion_date             date not null,
  handover_date               date,
  liquidated_damages_per_day  numeric(14, 2),
  ld_activated_at             date,
  ld_activation_note_el       text,
  sort_order                  integer not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint contract_section_code_key unique (contract_id, code),
  constraint contract_section_code_length check (char_length(code) between 1 and 8),
  constraint contract_section_rate_nonnegative
    check (liquidated_damages_per_day is null or liquidated_damages_per_day >= 0)
);
create index if not exists contract_section_contract_idx on ecapital.contract_section (contract_id);
create index if not exists contract_section_unit_idx on ecapital.contract_section (org_unit_id);

-- --------------------------------------------------- extensions of time --

create table if not exists ecapital.contract_extension (
  id                   uuid primary key default gen_random_uuid(),
  contract_id          uuid not null references ecapital.contract (id) on delete cascade,
  org_unit_id          text not null references ecapital.org_unit (id),
  -- Null: the contract's own clock. A section that is deleted hands its
  -- extensions back to the contract's clock rather than losing them.
  section_id           uuid references ecapital.contract_section (id) on delete set null,
  days                 integer not null,
  approved_at          date not null,
  approver             text not null,
  approver_name_el     text not null,
  reason_el            text not null,
  contractor_culpable  boolean not null default false,
  document_id          uuid references ecapital.document (id),
  created_by           uuid references ecapital.app_user (id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint contract_extension_days_positive check (days > 0),
  constraint contract_extension_approver_known
    check (approver in ('TEAA', 'KEAA', 'ENGINEER', 'OTHER'))
);
create index if not exists contract_extension_contract_idx on ecapital.contract_extension (contract_id);
create index if not exists contract_extension_section_idx on ecapital.contract_extension (section_id);
create index if not exists contract_extension_unit_idx on ecapital.contract_extension (org_unit_id);

-- --------------------------------------------------------------- claims --

create table if not exists ecapital.contract_claim (
  id                    uuid primary key default gen_random_uuid(),
  contract_id           uuid not null references ecapital.contract (id) on delete cascade,
  org_unit_id           text not null references ecapital.org_unit (id),
  direction             text not null,
  title_el              text not null,
  amount                numeric(14, 2) not null,
  stage                 text not null,
  notified_at           date,
  legal_advisor_el      text,
  contingent_liability  boolean not null default false,
  notes_el              text not null default '',
  document_id           uuid references ecapital.document (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint contract_claim_direction_known
    check (direction in ('BY_CONTRACTOR', 'BY_ORGANISATION')),
  constraint contract_claim_stage_known
    check (stage in ('NOTIFIED', 'UNDER_REVIEW', 'NEGOTIATION', 'ARBITRATION', 'COURT',
                     'SETTLED', 'WITHDRAWN')),
  constraint contract_claim_amount_nonnegative check (amount >= 0)
);
create index if not exists contract_claim_contract_idx on ecapital.contract_claim (contract_id);
create index if not exists contract_claim_unit_idx on ecapital.contract_claim (org_unit_id);

-- ------------------------------------------------------- the unit copy --

-- 0003's function: the unit comes from the contract, whatever the body says.
do $$
declare
  t text;
begin
  foreach t in array array['contract_section', 'contract_extension', 'contract_claim']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_inherit_org_unit', t);
    execute format(
      'create trigger %I before insert or update of contract_id on ecapital.%I
         for each row execute function ecapital.inherit_contract_org_unit()',
      t || '_inherit_org_unit', t);
  end loop;
end $$;

-- -------------------------------------------- the sum of the extensions --

-- RULE (ADR-0035 §2): `extension_days` is the sum of the approved extension
-- rows and is never typed. BEFORE, on every insert and update of a contract,
-- like `contract_current_value` in 0003, so a body that carries a number is
-- overwritten on the way in.
--
-- SECURITY DEFINER so the sum is over every extension of the contract, not
-- only the ones the caller's policy lets them read.
create or replace function ecapital.contract_extension_days() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  new.extension_days := coalesce((
    select sum(e.days) from ecapital.contract_extension e
     where e.contract_id = new.id), 0);
  return new;
end $$;

-- Every write to an extension recomputes the contract it belongs to. The
-- contract row is touched only when the sum actually moves, so the audit
-- trail does not gain a «contract changed» line for nothing.
create or replace function ecapital.extension_recompute_contract() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_contract uuid;
  v_sum      integer;
begin
  foreach v_contract in array array[
    case when tg_op = 'DELETE' then null else new.contract_id end,
    case when tg_op = 'INSERT' then null else old.contract_id end]
  loop
    continue when v_contract is null;
    v_sum := coalesce((select sum(e.days) from ecapital.contract_extension e
                        where e.contract_id = v_contract), 0);
    update ecapital.contract
       set extension_days = v_sum, updated_at = now()
     where id = v_contract and extension_days is distinct from v_sum;
  end loop;
  return null;
end $$;

drop trigger if exists extension_recompute_contract on ecapital.contract_extension;
create trigger extension_recompute_contract
  after insert or update or delete on ecapital.contract_extension
  for each row execute function ecapital.extension_recompute_contract();

-- ----------------------------------------------------------- carry-over --

-- RULE (ADR-0035 §2): a number typed into «Παρατάσεις (ημέρες)» before this
-- migration becomes one extension row, marked as carried over, dated the day
-- the contract was last changed, and not judged the contractor's fault —
-- nobody recorded that judgement, so the row does not invent one. Guarded by
-- "no rows yet", so a second run adds nothing.
insert into ecapital.contract_extension
  (contract_id, org_unit_id, section_id, days, approved_at, approver, approver_name_el,
   reason_el, contractor_culpable)
select c.id, c.org_unit_id, null, c.extension_days, c.updated_at::date, 'OTHER', 'Μεταφορά',
       'Μεταφορά από το πεδίο «Παρατάσεις (ημέρες)» πριν από το ADR-0035', false
  from ecapital.contract c
 where c.extension_days > 0
   and not exists (select 1 from ecapital.contract_extension e where e.contract_id = c.id);

-- After the carry-over, so the contracts it covers already hold their row.
drop trigger if exists contract_extension_days on ecapital.contract;
create trigger contract_extension_days
  before insert or update on ecapital.contract
  for each row execute function ecapital.contract_extension_days();

-- ---------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array['contract_section', 'contract_extension', 'contract_claim']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on ecapital.%I
         for each row execute function ecapital.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- --------------------------------------------------- row-level security --

-- The contract's children follow the contract, exactly as boq_item does
-- (0003, rewritten in 0023): whoever may read the unit reads them, whoever
-- holds `contractRecords` WRITE in the unit writes them. Activating the
-- penalty is APPROVE on the same row, and that is the route's `@Needs`; the
-- policy underneath is the WRITE floor, which APPROVE includes.
do $$
declare
  t text;
begin
  foreach t in array array['contract_section', 'contract_extension', 'contract_claim']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_read', t);
    execute format(
      'create policy %I on ecapital.%I for select using (ecapital.can_read_unit(org_unit_id))',
      t || '_read', t);
    execute format('drop policy if exists %I on ecapital.%I', t || '_write', t);
    execute format(
      'create policy %I on ecapital.%I for all
         using (ecapital.can_manage_contract(org_unit_id))
         with check (ecapital.can_manage_contract(org_unit_id))',
      t || '_write', t);
  end loop;
end $$;

-- The contract page's trail (0003's `audit_log_read_contract`) covers these
-- three too, for the same readers. Policies are OR'd.
drop policy if exists audit_log_read_contract_delay on ecapital.audit_log;
create policy audit_log_read_contract_delay on ecapital.audit_log
  for select using (
    entity_type in ('contract_section', 'contract_extension', 'contract_claim')
    and ecapital.can_read_unit(org_unit_id));

-- ---------------------------------------------------------- role matrix --

-- ADR-0035 §7: activating a penalty is `contractRecords` APPROVE, the
-- administrator's and the head of estates' by default
-- (packages/shared/src/role-matrix.ts). A cell is moved only while it still
-- holds the seeded default: `updated_at` is null until a person changes it
-- (0023's guard trigger), so the administrator's own choice survives.
update ecapital.role_permission
   set level = 'APPROVE'
 where area_key = 'contractRecords'
   and role in ('admin', 'estates_head')
   and level = 'WRITE'
   and updated_at is null;

-- --------------------------------------------------------------- grants --

grant select, insert, update, delete
  on ecapital.contract_section, ecapital.contract_extension, ecapital.contract_claim
  to ecapital_app;
grant execute on function ecapital.contract_extension_days() to ecapital_app;
grant execute on function ecapital.extension_recompute_contract() to ecapital_app;
