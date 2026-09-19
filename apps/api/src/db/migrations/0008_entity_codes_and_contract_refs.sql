-- eCapital — entity codes and contract references (ADR-0019).
--
-- eCapital has to sit next to eMAP (procurement) and eFinance (invoices and
-- budget) on the ΟΚΥπΥ server, and be addressable from both:
--
--   1. org_unit.entity_code — the eFinance entity code (NGH, LAR, ARC …),
--      which is also the SAP Fund Center.
--   2. contract.ref (CAP-YYYY-NNNN, allocated here, immutable) and
--      contract.emap_ref (CON-YYYY-NNNN, typed by a user).
--
-- NO PATIENT DATA. Nothing below can hold a patient fact: an entity code and
-- two contract references.

-- ------------------------------------------------- org_unit.entity_code --

-- RULE (INTEGRATION-eMAP §2, ADR-0019): send codes, never names. This is the
-- string eFinance, eMAP and SAP Funds Management all key on for the same
-- place; the Greek name next to it is display text and gets edited.
--
-- Nullable and unique, not NOT NULL: eFinance carries HQ (Κεντρικά Γραφεία)
-- and CNS (Κοινοτική Νοσηλευτική Υπηρεσία), which have no eCapital org unit,
-- and inventing units to fill them would put two fictional hospitals in the
-- capital register. A unit with no code simply has no counterpart yet.
alter table ecapital.org_unit
  add column if not exists entity_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_unit_entity_code_key') then
    alter table ecapital.org_unit add constraint org_unit_entity_code_key unique (entity_code);
  end if;
end $$;

comment on column ecapital.org_unit.entity_code is
  'The eFinance entity code for this unit (NGH, LAR, ARC, …), which is also the SAP Fund Center. Null where eFinance has no counterpart. ADR-0019.';

-- ------------------------------ contract.ref and contract.emap_ref --

alter table ecapital.contract
  add column if not exists ref      text,
  add column if not exists emap_ref text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contract_ref_format_check') then
    alter table ecapital.contract
      add constraint contract_ref_format_check check (ref is null or ref ~ '^CAP-[0-9]{4}-[0-9]{4}$');
  end if;
  -- RULE (INTEGRATION-eMAP §4): eMAP's own format, exactly. A reference that
  -- does not match makes a link that lands nowhere, so it is refused here as
  -- well as in the form — the constraint is what refuses it whatever asks.
  if not exists (select 1 from pg_constraint where conname = 'contract_emap_ref_format_check') then
    alter table ecapital.contract
      add constraint contract_emap_ref_format_check
        check (emap_ref is null or emap_ref ~ '^CON-[0-9]{4}-[0-9]{4}$');
  end if;
end $$;

comment on column ecapital.contract.ref is
  'eCapital''s own contract reference, CAP-YYYY-NNNN, allocated by ecapital.allocate_contract_ref and never changed. eFinance routes a contract_ref by prefix: CON- to eMAP, CAP- to here. ADR-0019.';
comment on column ecapital.contract.emap_ref is
  'The eMAP contract this one was procured under, CON-YYYY-NNNN, when there is one. ADR-0019.';

-- The counter, one row per year. Same machinery as project_code_seq: the
-- application role has no policy on it and no grant, and reaches it only
-- through the SECURITY DEFINER function below.
create table if not exists ecapital.contract_ref_seq (
  year       integer primary key,
  next_seq   integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Row-level security on, no policy: exactly what 0002 does to
-- project_code_seq. The application role has no way in except the function
-- below, and the audit trigger records every number it hands out.
alter table ecapital.contract_ref_seq enable row level security;

drop trigger if exists contract_ref_seq_audit on ecapital.contract_ref_seq;
create trigger contract_ref_seq_audit
  after insert or update or delete on ecapital.contract_ref_seq
  for each row execute function ecapital.write_audit();

-- ADR-0019, the same pattern as ecapital.allocate_project_code: allocated
-- inside the caller's transaction behind a transaction-scoped advisory lock,
-- so two people pressing "create" in the same second queue rather than race.
--
-- The counter is per year and NOT per unit — unlike the project code, which
-- is read by people inside one hospital. This reference is read by eFinance,
-- which holds contracts from every unit in one list, so it has to be unique
-- across the organisation and carry no unit in it.
create or replace function ecapital.allocate_contract_ref(p_year integer)
returns text
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_seq integer;
begin
  perform pg_advisory_xact_lock(hashtext('ecapital.contract_ref'), p_year);

  insert into ecapital.contract_ref_seq (year, next_seq)
    values (p_year, 1)
    on conflict (year) do nothing;

  update ecapital.contract_ref_seq
     set next_seq = next_seq + 1, updated_at = now()
   where year = p_year
  returning next_seq - 1 into v_seq;

  return format('CAP-%s-%s', p_year, lpad(v_seq::text, 4, '0'));
end $$;

-- Back-fill the contracts that already exist, oldest award first so the
-- numbers read in the order the contracts were signed, then make the column
-- required. Runs inside the migration's own transaction.
do $$
declare
  r record;
begin
  for r in
    select id, extract(year from award_date)::integer as year
      from ecapital.contract
     where ref is null
     order by award_date, contract_no
  loop
    update ecapital.contract set ref = ecapital.allocate_contract_ref(r.year) where id = r.id;
  end loop;
end $$;

alter table ecapital.contract alter column ref set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contract_ref_key') then
    alter table ecapital.contract add constraint contract_ref_key unique (ref);
  end if;
end $$;

-- RULE (ADR-0019): the reference is immutable. It is printed on paper, it is
-- what eFinance stores against an invoice, and a reference that can be edited
-- is a reference that eventually points at a different contract. The service
-- never sends it in an update; this refuses it whatever asks, including psql.
create or replace function ecapital.refuse_contract_ref_change() returns trigger
language plpgsql as $$
begin
  if new.ref is distinct from old.ref then
    raise exception 'contract.ref cannot change (% -> %)', old.ref, new.ref
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists contract_ref_immutable on ecapital.contract;
create trigger contract_ref_immutable
  before update of ref on ecapital.contract
  for each row execute function ecapital.refuse_contract_ref_change();

-- The lookup eFinance's link lands on, and the register behind it. Folded
-- with ecapital.normalise for the same reason the project search is
-- (0002): a person pastes «ΑΛΦΑ 12/2026» and has to find «Άλφα 12/2026».
create index if not exists contract_ref_idx on ecapital.contract (ref);
create index if not exists contract_no_norm_idx on ecapital.contract (ecapital.normalise(contract_no));
create index if not exists contract_emap_ref_idx on ecapital.contract (emap_ref) where emap_ref is not null;

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Said again for the same reason 0002, 0003 and 0006 say it: the grant above
-- is written `on all tables`, and the application must not be able to write
-- to the audit log (R42) or to move either counter by hand.
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
revoke all on ecapital.contract_ref_seq from ecapital_app;
