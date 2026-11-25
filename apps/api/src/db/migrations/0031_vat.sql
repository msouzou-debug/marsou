-- 0031 — VAT on commitments (ADR-0038, owner decision item 23, 25/11/2026:
-- «amounts should be with VAT across the tool»).
--
-- ΟΚΥπΥ provides VAT-exempt health services and cannot recover input VAT, so
-- the VAT on a contract is a real cost to the project. The model:
--
--   * a commitment signed excl. VAT — a contract, a variation, a payment
--     certificate — keeps its NET amount, as before, and gains a VAT RATE;
--   * VAT and GROSS are generated columns: computed by the database from the
--     net and the rate, never typed, never out of step;
--   * the contract's `current_gross` is its original gross plus each approved
--     variation's gross at that variation's own rate, kept by the same
--     trigger that keeps `current_value`. It is the commitment ledger;
--   * budgets (approved budget, budget lines, the cash-flow plan) are amounts
--     incl. VAT already and are not touched;
--   * an actual (`cost_txn.amount`) is GROSS. eFinance gives an invoice
--     line's net and its VAT rate apart, so its rows keep both halves in
--     `net_amount` and `vat_amount`; a SAP line is one figure and is taken
--     as gross.
--
-- EXISTING DATA (ADR-0038 §7): every contract, variation and certificate
-- already recorded is taken as NET at 19 % (STANDARD_19) — Cypriot public
-- works contracts are signed excl. VAT. Committed totals therefore rise by
-- 19 % on screen. eFinance's booked lines, posted net until now, are made
-- gross from the line's own VAT rate.
--
-- Not VAT-bearing, untouched: delay penalties, claims (as claimed), bonds.
--
-- Row-level security: no policy is added, dropped or changed. The new
-- columns live on tables whose policies already govern every column.
--
-- NO PATIENT DATA: rates and money.
--
-- Self-contained and idempotent: the type is created only when missing,
-- `add column if not exists`, `create or replace`, `drop … if exists` before
-- every trigger, and every data step guarded so a second run finds nothing
-- to do and writes no audit row.

-- ---------------------------------------------------------------- the rate --

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'ecapital' and t.typname = 'vat_rate') then
    create type ecapital.vat_rate as enum ('STANDARD_19', 'REDUCED_9', 'REDUCED_5', 'ZERO', 'EXEMPT');
  end if;
end $$;

-- The rate as a fraction. IMMUTABLE, so generated columns may call it.
create or replace function ecapital.vat_rate_value(p_rate ecapital.vat_rate) returns numeric
language sql immutable parallel safe as $$
  select case p_rate
           when 'STANDARD_19' then 0.19
           when 'REDUCED_9'   then 0.09
           when 'REDUCED_5'   then 0.05
           else 0
         end::numeric
$$;

-- RULE (ADR-0038 §1): VAT is rounded to the cent, half away from zero, per
-- row — `round(numeric, 2)` does exactly that, and packages/shared `vatOf`
-- does the same so the screen's live figure is the stored one.
create or replace function ecapital.vat_of(p_net numeric, p_rate ecapital.vat_rate) returns numeric
language sql immutable parallel safe as $$
  select round(p_net * ecapital.vat_rate_value(p_rate), 2)
$$;

comment on function ecapital.vat_of(numeric, ecapital.vat_rate) is
  'ADR-0038: the VAT on a net amount at a rate, to the cent, half away from zero.';

-- -------------------------------------------------------------- contract --

alter table ecapital.contract
  add column if not exists vat_rate ecapital.vat_rate not null default 'STANDARD_19';
alter table ecapital.contract
  add column if not exists original_vat numeric(14, 2)
    generated always as (ecapital.vat_of(original_value, vat_rate)) stored;
alter table ecapital.contract
  add column if not exists original_gross numeric(14, 2)
    generated always as (original_value + ecapital.vat_of(original_value, vat_rate)) stored;
alter table ecapital.contract
  add column if not exists current_gross numeric(14, 2) not null default 0;

comment on column ecapital.contract.original_value is
  'NET, excl. VAT: the value as signed (ADR-0038).';
comment on column ecapital.contract.current_value is
  'NET: original_value + the approved variations'' values. Kept by contract_current_value (0003).';
comment on column ecapital.contract.vat_rate is
  'ADR-0038: the contract''s VAT rate; a variation and a payment certificate take it as their default.';
comment on column ecapital.contract.current_gross is
  'ADR-0038: GROSS commitment = original_gross + Σ gross_value of the approved variations, each at its own rate. Kept by contract_current_value; never typed.';

-- ------------------------------------------------------------- variation --

-- The default fills the rows already there (ADR-0038 §7: 19 %) and is then
-- dropped: a new variation takes its contract's rate (trigger below) unless
-- the raiser chose another.
alter table ecapital.variation
  add column if not exists vat_rate ecapital.vat_rate not null default 'STANDARD_19';
alter table ecapital.variation alter column vat_rate drop default;
alter table ecapital.variation
  add column if not exists vat_amount numeric(14, 2)
    generated always as (ecapital.vat_of(value, vat_rate)) stored;
alter table ecapital.variation
  add column if not exists gross_value numeric(14, 2)
    generated always as (value + ecapital.vat_of(value, vat_rate)) stored;

comment on column ecapital.variation.value is 'NET, excl. VAT; negative for an omission (ADR-0038).';

-- ---------------------------------------------------- payment certificate --

alter table ecapital.payment_cert
  add column if not exists vat_rate ecapital.vat_rate not null default 'STANDARD_19';
alter table ecapital.payment_cert alter column vat_rate drop default;
alter table ecapital.payment_cert
  add column if not exists vat_amount numeric(14, 2)
    generated always as (ecapital.vat_of(net_payable, vat_rate)) stored;
alter table ecapital.payment_cert
  add column if not exists gross_payable numeric(14, 2)
    generated always as (net_payable + ecapital.vat_of(net_payable, vat_rate)) stored;

comment on column ecapital.payment_cert.net_payable is
  'NET, excl. VAT: work done + materials − retention − previously certified.';
comment on column ecapital.payment_cert.gross_payable is
  'ADR-0038: net_payable + its VAT — what finance pays.';

-- RULE (ADR-0038 §2): a variation or a certificate written without a rate
-- takes its contract's. BEFORE INSERT, so the NOT NULL above holds whatever
-- path writes the row. SECURITY DEFINER for the same reason the commitment
-- is: the contract's rate does not depend on who is looking.
create or replace function ecapital.inherit_contract_vat_rate() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  if new.vat_rate is null then
    select c.vat_rate into new.vat_rate from ecapital.contract c where c.id = new.contract_id;
  end if;
  return new;
end $$;

drop trigger if exists variation_inherit_vat_rate on ecapital.variation;
create trigger variation_inherit_vat_rate
  before insert on ecapital.variation
  for each row execute function ecapital.inherit_contract_vat_rate();

drop trigger if exists payment_cert_inherit_vat_rate on ecapital.payment_cert;
create trigger payment_cert_inherit_vat_rate
  before insert on ecapital.payment_cert
  for each row execute function ecapital.inherit_contract_vat_rate();

-- --------------------------------------------- the commitment, with VAT --

-- 0003's function, now keeping both figures. RULE (ADR-0038 §5): committed =
-- the contract plus its APPROVED variations, GROSS. Pending, returned and
-- rejected variations are proposals and count for nothing, net or gross.
create or replace function ecapital.contract_current_value() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  new.current_value := new.original_value + coalesce((
    select sum(v.value) from ecapital.variation v
     where v.contract_id = new.id and v.status = 'APPROVED'), 0);
  new.current_gross := new.original_value + ecapital.vat_of(new.original_value, new.vat_rate)
    + coalesce((
    select sum(v.gross_value) from ecapital.variation v
     where v.contract_id = new.id and v.status = 'APPROVED'), 0);
  return new;
end $$;

-- 0003's AFTER trigger on the variation, comparing both figures: the
-- contract is touched only when one of them actually moves.
create or replace function ecapital.variation_recompute_contract() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_contract      uuid;
  v_should        numeric(14, 2);
  v_current       numeric(14, 2);
  v_should_gross  numeric(14, 2);
  v_current_gross numeric(14, 2);
begin
  if tg_op = 'DELETE' then v_contract := old.contract_id; else v_contract := new.contract_id; end if;

  select c.current_value,
         c.original_value + coalesce((select sum(v.value) from ecapital.variation v
                                       where v.contract_id = c.id and v.status = 'APPROVED'), 0),
         c.current_gross,
         c.original_value + ecapital.vat_of(c.original_value, c.vat_rate)
           + coalesce((select sum(v.gross_value) from ecapital.variation v
                        where v.contract_id = c.id and v.status = 'APPROVED'), 0)
    into v_current, v_should, v_current_gross, v_should_gross
    from ecapital.contract c
   where c.id = v_contract;

  if v_should is null then return null; end if;
  if v_should is distinct from v_current or v_should_gross is distinct from v_current_gross then
    -- The BEFORE trigger on the contract is what puts the numbers in; this only asks it to.
    update ecapital.contract set updated_at = now() where id = v_contract;
  end if;
  return null;
end $$;

-- Existing contracts: work out the gross commitment once. Guarded, so a
-- second run touches no row and the audit trail gains nothing.
update ecapital.contract c
   set current_gross = c.original_value + ecapital.vat_of(c.original_value, c.vat_rate)
         + coalesce((select sum(v.gross_value) from ecapital.variation v
                      where v.contract_id = c.id and v.status = 'APPROVED'), 0)
 where c.current_gross is distinct from
       c.original_value + ecapital.vat_of(c.original_value, c.vat_rate)
         + coalesce((select sum(v.gross_value) from ecapital.variation v
                      where v.contract_id = c.id and v.status = 'APPROVED'), 0);

-- ---------------------------------------------------------------- actuals --

alter table ecapital.cost_txn
  add column if not exists net_amount numeric(14, 2),
  add column if not exists vat_amount numeric(14, 2);

comment on column ecapital.cost_txn.amount is
  'ADR-0038: GROSS, incl. VAT, sign as posted. A SAP line is one figure and is taken as gross.';
comment on column ecapital.cost_txn.net_amount is
  'ADR-0038: the net half of amount where the feed gave it apart (an eFinance invoice line); null otherwise.';
comment on column ecapital.cost_txn.vat_amount is
  'ADR-0038: the VAT half of amount where the feed gave it apart; null otherwise.';

-- eFinance's VAT rate on a line, as a fraction: it has been seen as «19» and
-- «19.00»; a value of 1 or less is read as a fraction already.
create or replace function ecapital.efinance_vat_fraction(p_rate numeric) returns numeric
language sql immutable parallel safe as $$
  select case when p_rate is null then null
              when p_rate > 1 then p_rate / 100
              else p_rate end
$$;

-- eFinance's booked lines, posted with the line's net total until now, are
-- made gross from the line's own rate. Only rows still holding the net
-- (`net_amount is null` and the amount equal to the line total), so a
-- second run changes nothing. A line with no rate stays as it was and is
-- taken as gross, like a SAP line.
update ecapital.cost_txn t
   set net_amount = l.line_total,
       vat_amount = round(l.line_total * ecapital.efinance_vat_fraction(l.vat_rate), 2),
       amount     = l.line_total + round(l.line_total * ecapital.efinance_vat_fraction(l.vat_rate), 2)
  from ecapital.efinance_invoice_line l
 where t.source = 'EFINANCE'
   and t.net_amount is null
   and t.source_ref like 'efinance:invoice:%'
   and l.invoice_id = split_part(t.source_ref, ':', 3)
   and l.line_no::text = split_part(t.source_ref, ':', 4)
   and l.line_total is not null
   and l.vat_rate is not null
   and t.amount = l.line_total;

-- --------------------------------------------------------------- grants --

grant execute on function ecapital.vat_rate_value(ecapital.vat_rate) to ecapital_app;
grant execute on function ecapital.vat_of(numeric, ecapital.vat_rate) to ecapital_app;
grant execute on function ecapital.efinance_vat_fraction(numeric) to ecapital_app;
grant execute on function ecapital.inherit_contract_vat_rate() to ecapital_app;
grant usage on type ecapital.vat_rate to ecapital_app;
