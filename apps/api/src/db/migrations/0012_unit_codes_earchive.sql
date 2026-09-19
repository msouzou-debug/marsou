-- 0012 — the unit codes follow eArchive, and the Ambulance Service leaves
-- ΟΚΥπΥ (owner decisions, 19/09/2026; ADR-0024).
--
-- Two decisions, one migration, because the second one changes the same rows
-- the first one does and running them apart would leave a database in which
-- the codes are right and the register still holds a unit that is not ours.
--
--   1. eFinance, eArchive and eCapital all key a place by eArchive's site
--      abbreviation from now on. `org_unit.code` AND `org_unit.entity_code`
--      both become that string, and the project codes ADR-0014 builds out of
--      the unit code are re-prefixed to match. Names do not change — Τροόδους
--      keeps its name and takes the code KYP — and neither do the unit ids.
--   2. `ambulance` (Υπηρεσία Ασθενοφόρων, AMB) is deleted with everything
--      that hangs off it. The Ambulance Service is no longer part of ΟΚΥπΥ,
--      so its capital works are not eCapital's register to keep.
--
-- The legacy eFinance codes (PAP, LGH, ARC, CHR, MH, HC, TRD) are not lost:
-- ADR-0024 keeps the table as a lookup «until eFinance aligns», in the ADR
-- and in INTEGRATION-eFinance-eMAP-eCapital.md §6. Nothing in the database
-- needs them — `entity_code` is what a join uses, and both sides of that join
-- are being moved to the same strings.
--
-- NO PATIENT DATA. Everything below is an organisational code or a row that
-- describes a building, a project or a contract.

-- ------------------------------------------------ 1. the ambulance unit --
--
-- Deleted children first, in foreign-key order. Most of these would cascade
-- from the project or the contract above them, but naming each table is what
-- makes the order reviewable, and `org_unit_id` is on every one of them
-- (0001, 0002, 0003, 0005, 0006, 0011) precisely so a unit can be asked what
-- belongs to it without walking the tree.
--
-- If anything is left pointing at the unit after this, the delete below
-- raises with the table and the constraint named, and the whole migration
-- rolls back. That is the intended answer: a row this migration does not
-- know about is a row somebody has to look at, not one to remove blindly.
do $$
declare
  v_tables text[] := array[
    -- M2 cost
    'cost_warning', 'payment_cert', 'cost_txn', 'allocation_rule', 'forecast_inputs',
    'email_outbox',
    -- M1 site log
    'rfi', 'site_instruction', 'defect',
    -- M1 contracts
    'variation', 'boq_item', 'contract',
    -- M1 import and register
    'import_exception', 'budget_line', 'project_note',
    'milestone', 'risk', 'issue', 'project', 'project_code_seq',
    -- M0 estate and access
    'area', 'floor', 'building', 'app_user_org_unit', 'role_mapping', 'org_unit_alias'];
  v_table       text;
  v_bad_table   text;
  v_constraint  text;
begin
  if not exists (select 1 from ecapital.org_unit where id = 'ambulance') then
    return;
  end if;

  foreach v_table in array v_tables loop
    if to_regclass('ecapital.' || v_table) is not null
       and exists (select 1 from information_schema.columns
                    where table_schema = 'ecapital'
                      and table_name = v_table
                      and column_name = 'org_unit_id') then
      execute format('delete from ecapital.%I where org_unit_id = %L', v_table, 'ambulance');
    end if;
  end loop;

  begin
    delete from ecapital.org_unit where id = 'ambulance';
  exception when foreign_key_violation then
    get stacked diagnostics v_bad_table = table_name, v_constraint = constraint_name;
    raise exception
      'migration 0012 will not delete the ambulance unit: ecapital.% still has rows pointing at it (%). Decide what happens to them and run this again.',
      coalesce(v_bad_table, '?'), coalesce(v_constraint, '?')
      using errcode = 'restrict_violation';
  end;
end $$;

-- ------------------------------------------------- 2. the eArchive codes --
--
-- One statement for the eleven rows that are left. The audit trigger records
-- one row per unit whose code actually moved: 0004 already returns early from
-- an update that changes nothing, so NGH, LAR, PAF, FAM and HQ — which keep
-- the code they had — leave no audit row for a change that did not happen.
--
-- No transient unique collision: no unit's new code or new entity code is
-- another unit's old one, so the two unique indexes hold row by row and the
-- update needs no deferral.
update ecapital.org_unit o
   set code        = m.new_code,
       entity_code = m.new_code,
       updated_at  = now()
  from (values
          ('nicosia-general',   'NGH'),
          ('larnaca-general',   'LAR'),
          ('paphos-general',    'PAF'),
          ('limassol-general',  'LGH'),
          ('troodos',           'KYP'),
          ('namiii',            'NAM'),
          ('polis-chrysochous', 'POL'),
          ('famagusta-general', 'FAM'),
          ('dypsy',             'MHS'),
          ('pfy',               'PHC'),
          ('hq',                'HQ')
       ) as m(id, new_code)
 where o.id = m.id
   and (o.code is distinct from m.new_code or o.entity_code is distinct from m.new_code);

comment on column ecapital.org_unit.code is
  'The unit code, which is eArchive''s site abbreviation and, since ADR-0024, the same string as entity_code. Project codes are built out of it (ADR-0014).';
comment on column ecapital.org_unit.entity_code is
  'The entity code eFinance, eArchive and SAP Funds Management key this place by. Since ADR-0024 it is eArchive''s site abbreviation and equal to `code`; eFinance''s legacy strings (PAP, LGH, ARC, CHR, MH, HC, TRD) are kept as a lookup in ADR-0024 until eFinance aligns. Null where there is no counterpart.';

-- ------------------------------------------- 3. the project codes follow --
--
-- ADR-0014: `<unit code>-<year>-<seq>`. The year and the sequence are facts
-- about the project and do not move; only the prefix does, and only for the
-- six units whose code changed (LMS→LGH, TRD→KYP, NAM3→NAM, PCH→POL,
-- DYP→MHS, PFY→PHC).
--
-- The regexp guard is deliberate. A code that is not in ADR-0014's shape is
-- left exactly as it is rather than being reassembled out of parts that may
-- not mean what this statement assumes they mean.
update ecapital.project p
   set code       = o.code || '-' || split_part(p.code, '-', 2) || '-' || split_part(p.code, '-', 3),
       updated_at = now()
  from ecapital.org_unit o
 where o.id = p.org_unit_id
   and p.code ~ '^[A-Z0-9]+-[0-9]{4}-[0-9]{3}$'
   and split_part(p.code, '-', 1) <> o.code;

-- `ecapital.project_code_seq` needs nothing. ADR-0014 keys the counter by
-- `org_unit_id` and the year, never by the code — the code is read off
-- `org_unit` at the moment a number is handed out (`allocate_project_code`
-- in 0002) — so a unit that is renamed keeps its counter and the next project
-- it opens continues the same run of numbers under the new prefix. The
-- ambulance unit's counter row went with it above, through the cascade on
-- that table's own foreign key.
--
-- There is no CHECK or regular expression on `org_unit.code` or on
-- `project.code` anywhere in the schema (0001 and 0002 declare both as plain
-- unique text), so there is none to widen for the codes themselves. The two
-- format constraints the schema does carry are on `contract.ref` and
-- `contract.emap_ref` (0008), and neither `CAP-YYYY-NNNN` nor
-- `CON-YYYY-NNNN` carries a unit code — which is exactly why ADR-0019 made
-- the contract counter per year and not per unit. Contract references are
-- untouched by this migration. The one CHECK that does need widening is on
-- the importer's rule names, below.

-- ------------------------------------------- 4. V15, «unit not in scope» --
--
-- The one CHECK in the schema that carries a code of any kind: 0005 listed
-- the rules the capex importer may record, so that a typo in a rule name is a
-- failed insert rather than a line in a report nobody can look up, and 0011
-- widened it with the SAP extract's own six. The errata of 19/09/2026 add
-- V15 — a row whose unit is not ΟΚΥπΥ's — so the list grows by one more.
-- ADR-0024 and the CAPEX-03 errata both carry the rule's own sentence.
--
-- Rewritten rather than widened in place, exactly as 0011 rewrote it: a CHECK
-- cannot be altered, and dropping and recreating it inside this transaction
-- is what an `alter` would do anyway.
alter table ecapital.import_exception
  drop constraint if exists import_exception_rule_known;
alter table ecapital.import_exception
  add constraint import_exception_rule_known
  check (rule in ('V01','V02','V03','V04','V05','V06','V07',
                  'V08','V09','V10','V11','V12','V13','V14',
                  -- ADR-0024: the unit named in column D is not ΟΚΥπΥ's.
                  'V15',
                  -- R14, the SAP extract's own exceptions.
                  'ROW_UNREADABLE', 'AMOUNT_UNREADABLE', 'DATE_UNREADABLE',
                  'COLUMN_MISSING', 'UNMATCHED', 'SKIPPED'));
