-- 0018 — Community Nursing gets its own unit, and eFinance's own entity keys
-- are carried alongside eArchive's (owner decisions, 20/09/2026).
--
-- Two decisions, one migration, because they touch the same row and the same
-- reasoning: eFinance's `CNS` used to be the one entity code with nothing on
-- this side of the join (ADR-0019, ADR-0024), and yesterday's errata guessed
-- it away as "Central Nursing Services, no unit, files under HQ". Both halves
-- of that guess were wrong.
--
--   1. **CNS is «Κοινοτική Νοσηλευτική Υπηρεσία» (Community Nursing
--      Service), and it files under its own eArchive folder, not HQ's.** It
--      gets a real `org_unit` row: id `community-nursing`, code and
--      entity_code `CNS` (ADR-0024's rule — the code is eArchive's site
--      abbreviation — applies to this unit exactly as it does to the other
--      eleven), type SERVICE, directorate PFY (ASSUMPTION, recorded here and
--      in ADR-0024's addendum: nothing in any brief says which directorate
--      Community Nursing sits under, and Primary Healthcare is the closest
--      fit among the six — flag it for the owner to confirm). No cost
--      centre, no projects yet — same as HQ was on the day it was opened.
--   2. **eFinance keeps its own entity keys permanently.** ADR-0024 §2 called
--      the six codes eFinance and eCapital now disagree on "a lookup, not a
--      column, until eFinance aligns" — eFinance has since said it will not
--      align: `PAP`, `LGH`, `TRD`, `ARC`, `CHR`, `MH`, `HC` are foreign keys
--      across twelve of eFinance's own tables and in SAP, and renaming them
--      is not on the table. So the lookup becomes a column after all:
--      `org_unit.efinance_code`, alongside `entity_code` rather than instead
--      of it. `entity_code` keeps meaning what ADR-0024 made it mean — our
--      own key, the same string as `code` — and does not move again.
--
-- Inserted here rather than left to the seed script, unlike HQ (0009): HQ's
-- own header comment records that choice deliberately, so a server that
-- never runs `pnpm --filter @ecapital/api seed` never had an HQ row either.
-- CNS is different — it is a real, decided organisational fact from the day
-- this migration runs, the same footing as the unique reference-table rows
-- 0013 seeds — so `on conflict do nothing` here means a fresh database and a
-- migrated one end up with exactly the same row, with or without seed ever
-- running. The seed script also carries it (apps/api/src/db/seed-data.ts),
-- so a re-seed keeps it in step with the other eleven rather than skipping it.
--
-- NO PATIENT DATA. An organisational code, a name and a directorate label —
-- nothing below can hold a patient fact.

-- ------------------------------------------- 1. org_unit.efinance_code --

-- RULE (ADR-0022's addendum, ADR-0024 §2 superseded): eFinance's own entity
-- code, kept forever, not translated away. Nullable and unique, exactly like
-- entity_code: a unit eFinance has no entity for yet simply has none.
alter table ecapital.org_unit
  add column if not exists efinance_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_unit_efinance_code_key') then
    alter table ecapital.org_unit add constraint org_unit_efinance_code_key unique (efinance_code);
  end if;
end $$;

comment on column ecapital.org_unit.efinance_code is
  'eFinance''s own entity code, kept permanently alongside entity_code rather than translated into it (ADR-0022 addendum, 20/09/2026 — supersedes ADR-0024 §2''s "lookup, not a column, until eFinance aligns"). Differs from entity_code on PAF, KYP, NAM, POL, MHS, PHC; equal to it everywhere else. Null where eFinance has no entity for this unit.';

-- Backfill for the eleven units this migration finds already seeded, keyed
-- by the eArchive code migration 0012 gave them (which is entity_code, which
-- is code — ADR-0024). A unit this finds with none of these codes is left
-- alone: a server that has not run seed yet has no org_unit rows at all, and
-- `update … from (values …)` simply touches zero rows.
update ecapital.org_unit o
   set efinance_code = m.efinance_code,
       updated_at    = now()
  from (values
          ('NGH', 'NGH'),
          ('LAR', 'LAR'),
          ('PAF', 'PAP'),
          ('LGH', 'LGH'),
          ('KYP', 'TRD'),
          ('NAM', 'ARC'),
          ('POL', 'CHR'),
          ('FAM', 'FAM'),
          ('MHS', 'MH'),
          ('PHC', 'HC'),
          ('HQ',  'HQ')
       ) as m(code, efinance_code)
 where o.code = m.code
   and o.efinance_code is distinct from m.efinance_code;

-- ------------------------------------------- 2. the CNS unit, idempotent --

-- `on conflict do nothing`, the same discipline 0013 seeds budget_code with:
-- re-running this migration, or a `community-nursing` row a since-run seed
-- already wrote, is not clobbered.
insert into ecapital.org_unit
  (id, code, name_el, name_en, type, directorate, cost_centre, entity_code, efinance_code, timezone)
values
  ('community-nursing', 'CNS', 'Κοινοτική Νοσηλευτική Υπηρεσία', 'Community Nursing Service',
   'SERVICE', 'PFY', null, 'CNS', 'CNS', 'Europe/Nicosia')
on conflict (id) do nothing;
