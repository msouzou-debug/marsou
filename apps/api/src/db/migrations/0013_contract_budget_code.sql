-- 0013 — one CAPEX budget code per contract (owner decision, 19/09/2026;
-- errata "One CAPEX budget code per contract"; ADR-0025).
--
-- eFinance's draft write route for a contract (ADR-0022,
-- INTEGRATION-eFinance-eMAP-eCapital.md §5, `PUT /api/v1/capital/contracts/
-- {cap_ref}`) carries `budget_code` as one of the two join keys against
-- eFinance's own budget position. eCapital has to be able to say which of
-- eFinance's capital budget codes a contract is charged to before that
-- route is ever called, so the column and the reference table that backs it
-- come first.
--
-- `budget_code` is a reference table, the same shape as `org_unit`: a small,
-- rarely-written list everybody who signs in may read, and only the two
-- roles that own the money screens may change. The live list is meant to
-- come from eFinance's own `GET /api/v1/master/budget-codes?kind=capex`
-- (§4/§5 of the integration doc); until that read endpoint exists, eCapital
-- carries this table as a reference it can refresh by hand or, once the API
-- side of this migration is built, through `POST /budget-codes/sync`.
--
-- Twenty rows are seeded here: the five the owner named by number and
-- description, and fifteen placeholders. **The fifteen placeholders are
-- not eFinance's real codes or descriptions** — nobody has published the
-- other fifteen of eFinance's twenty CAPEX budget codes yet, so this
-- migration invents plausible ones, in the same numeric band as the five
-- real ones, and marks every one of them in `description_el` with
-- «(προσωρινή περιγραφή)» so nobody mistakes a placeholder for a confirmed
-- eFinance string. `source = 'SEED'` says the same thing in a column a
-- query can filter on; a row eFinance's sync has actually confirmed carries
-- `source = 'EFINANCE'` instead (see the API side of this change).
--
-- NO PATIENT DATA. A budget code is a four-digit SAP commitment item and two
-- sentences describing it; a contract's budget code is one more column
-- alongside its contract number and its value.

-- ---------------------------------------------------------- budget_code --

create table if not exists ecapital.budget_code (
  code            text primary key,
  description_el  text not null,
  description_en  text not null,
  -- A loose grouping for the select and for reporting later (works,
  -- equipment, vehicles, buildings, it, ...). Not a closed list: the real
  -- twenty, once eFinance's read endpoint exists, may group differently
  -- than this migration's placeholders guessed.
  category        text,
  -- CAPEX-01 §2 (INTEGRATION doc §2): eFinance's 203 operational codes and
  -- its capital subset are the same axis at different scales. Every row
  -- eCapital carries here is the capital subset, so this defaults true and
  -- nothing today writes false — the column exists so a future sync of
  -- eFinance's operational codes (should one ever be needed) has somewhere
  -- to say "not this list".
  is_capex        boolean not null default true,
  -- A code eFinance's sync no longer returns is not deleted — a contract may
  -- still point at it — it is marked inactive instead (CAPEX-03 §5's own
  -- discipline for a row an import no longer sees).
  active          boolean not null default true,
  -- SEED: written by this migration, unconfirmed. EFINANCE: written by
  -- POST /budget-codes/sync from eFinance's own read endpoint.
  source          text not null default 'SEED',
  -- When `source` last moved to EFINANCE. Null for a row no sync has ever
  -- touched.
  synced_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint budget_code_source_known check (source in ('SEED', 'EFINANCE'))
);

comment on table ecapital.budget_code is
  'CAPEX budget codes (SAP Commitment Items), the capital subset of eFinance''s master data (INTEGRATION-eFinance-eMAP-eCapital.md §2, §5). A reference table: readable by every signed-in role, written by admin and finance only, or by POST /budget-codes/sync once eFinance''s read endpoint exists.';
comment on column ecapital.budget_code.description_el is
  'Fifteen of the twenty seeded rows carry «(προσωρινή περιγραφή)» — invented placeholders, not eFinance''s confirmed text. The five without it (7402, 7501, 7502, 7551, 7585) are the descriptions the owner actually named (19/09/2026).';

-- Twenty rows: the five the owner named, and fifteen plausible placeholders
-- in the same numeric band. `on conflict do nothing` so re-seeding never
-- clobbers a row `POST /budget-codes/sync` has already brought up to date
-- with eFinance's own text.
insert into ecapital.budget_code (code, description_el, description_en, category, is_capex, active, source)
values
  -- ---- the five the owner named (19/09/2026) — real eFinance text -------
  ('7402', 'Ιατρικός και λοιπός εξοπλισμός', 'Medical and other equipment', 'equipment', true, true, 'SEED'),
  ('7501', 'Μηχανήματα και εξοπλισμός', 'Machinery and equipment', 'equipment', true, true, 'SEED'),
  ('7502', 'Κλιματισμός', 'Air conditioning', 'equipment', true, true, 'SEED'),
  ('7551', 'Επιβατικά οχήματα', 'Passenger vehicles', 'vehicles', true, true, 'SEED'),
  ('7585', 'Ασθενοφόρα', 'Ambulances', 'vehicles', true, true, 'SEED'),
  -- ---- fifteen placeholders — invented, not eFinance's confirmed text ---
  ('7401', 'Κτίρια (προσωρινή περιγραφή)', 'Buildings (placeholder description)', 'buildings', true, true, 'SEED'),
  ('7403', 'Έπιπλα και λοιπός εξοπλισμός γραφείου (προσωρινή περιγραφή)', 'Furniture and office equipment (placeholder description)', 'equipment', true, true, 'SEED'),
  ('7404', 'Ηλεκτρονικός εξοπλισμός και λογισμικό (προσωρινή περιγραφή)', 'Electronic equipment and software (placeholder description)', 'it', true, true, 'SEED'),
  ('7405', 'Εξοπλισμός επικοινωνιών (προσωρινή περιγραφή)', 'Communications equipment (placeholder description)', 'it', true, true, 'SEED'),
  ('7406', 'Εργαστηριακός εξοπλισμός (προσωρινή περιγραφή)', 'Laboratory equipment (placeholder description)', 'equipment', true, true, 'SEED'),
  ('7503', 'Εργαλεία και μηχανήματα συντήρησης (προσωρινή περιγραφή)', 'Tools and maintenance machinery (placeholder description)', 'equipment', true, true, 'SEED'),
  ('7504', 'Εξοπλισμός ασφαλείας (προσωρινή περιγραφή)', 'Security equipment (placeholder description)', 'equipment', true, true, 'SEED'),
  ('7505', 'Επίπλωση νοσηλευτικών μονάδων (προσωρινή περιγραφή)', 'Ward furnishing (placeholder description)', 'equipment', true, true, 'SEED'),
  ('7506', 'Ανελκυστήρες (προσωρινή περιγραφή)', 'Lifts (placeholder description)', 'buildings', true, true, 'SEED'),
  ('7507', 'Ηλεκτρομηχανολογικές εγκαταστάσεις (προσωρινή περιγραφή)', 'Electromechanical installations (placeholder description)', 'works', true, true, 'SEED'),
  ('7552', 'Φορτηγά οχήματα (προσωρινή περιγραφή)', 'Goods vehicles (placeholder description)', 'vehicles', true, true, 'SEED'),
  ('7553', 'Δίκυκλα οχήματα (προσωρινή περιγραφή)', 'Motorcycles (placeholder description)', 'vehicles', true, true, 'SEED'),
  ('7561', 'Ανακαινίσεις κτιρίων (προσωρινή περιγραφή)', 'Building renovations (placeholder description)', 'works', true, true, 'SEED'),
  ('7562', 'Έργα υποδομής (προσωρινή περιγραφή)', 'Infrastructure works (placeholder description)', 'works', true, true, 'SEED'),
  ('7563', 'Περιβάλλων χώρος και οδοποιία (προσωρινή περιγραφή)', 'Grounds and roadworks (placeholder description)', 'works', true, true, 'SEED')
on conflict (code) do nothing;

-- ---------------------------------------------------- contract.budget_code --

-- RULE (owner decision 19/09/2026, errata "One CAPEX budget code per
-- contract"): a contract carries at most one. Nullable because a contract
-- recorded before this migration has none yet; the API refuses to leave it
-- null on a brand-new contract (ADR-0025), which is a service rule and not
-- one this column can express on its own — a contract mid-transition to
-- AWARDED from an older build should not suddenly fail a NOT NULL it was
-- never asked to satisfy.
alter table ecapital.contract
  add column if not exists budget_code text references ecapital.budget_code (code) on delete restrict;
create index if not exists contract_budget_code_idx on ecapital.contract (budget_code)
  where budget_code is not null;
comment on column ecapital.contract.budget_code is
  'The one CAPEX budget code this contract is charged to (owner decision 19/09/2026, ADR-0025). References ecapital.budget_code(code); on delete restrict because a code a contract points at is not eFinance''s to remove from under it — deactivate it instead.';

-- --------------------------------------------------------------- audit --

drop trigger if exists budget_code_audit on ecapital.budget_code;
create trigger budget_code_audit
  after insert or update or delete on ecapital.budget_code
  for each row execute function ecapital.write_audit();

-- --------------------------------------------------------- row-level security --

alter table ecapital.budget_code enable row level security;

-- Reference data, same discipline as org_unit's own read side: every
-- signed-in role may read it, because every screen that offers a budget
-- code select — S07a for every unit, not just the caller's own — needs the
-- same twenty rows regardless of which unit the caller works in. There is
-- no org_unit_id on this table to scope by; it is not that kind of table.
drop policy if exists budget_code_read on ecapital.budget_code;
create policy budget_code_read on ecapital.budget_code
  for select using (true);

-- RULE (owner decision 19/09/2026): admin and finance only, the same two
-- roles ADR-0021's `can_manage_budget_line` already trusts with the
-- project's approved budget. Nobody else edits the reference list, and
-- `POST /budget-codes/sync` runs as one of these two roles as well.
drop policy if exists budget_code_write on ecapital.budget_code;
create policy budget_code_write on ecapital.budget_code
  for all
  using (ecapital.has_role('admin') or ecapital.has_role('finance'))
  with check (ecapital.has_role('admin') or ecapital.has_role('finance'));

-- R42: the same audit-log read rule the cost tables use, keyed here on
-- entity_type alone since budget_code carries no org_unit_id to check.
drop policy if exists audit_log_read_budget_code on ecapital.audit_log;
create policy audit_log_read_budget_code on ecapital.audit_log
  for select using (
    entity_type = 'budget_code'
    and (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly')
      or ecapital.has_role('executive_readonly') or ecapital.has_role('finance')));

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Same revoke as every migration before it: the grant above is written `on
-- all tables`, so say it again (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
revoke all on ecapital.contract_ref_seq from ecapital_app;
