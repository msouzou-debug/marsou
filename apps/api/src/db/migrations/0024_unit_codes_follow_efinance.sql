-- 0024 — one code and one name per hospital, eFinance's (owner decision,
-- 19/10/2026; ADR-0034).
--
-- ADR-0024 moved the unit codes to eArchive's abbreviations. The owner has
-- now settled the other way round: every tool keys a place by eFinance's
-- entity code, because those strings are foreign keys across twelve eFinance
-- tables and in SAP and cannot move, while eArchive's can and will. Six
-- units change code; the other six already carry the same string in both
-- systems. Two names move to eFinance's spelling as well.
--
--   PAF → PAP   Γενικό Νοσοκομείο Πάφου
--   KYP → TRD   Νοσοκομείο Τροόδους
--   NAM → ARC   Νοσοκομείο Αρχιεπίσκοπος Μακάριος ΙΙΙ   (was «… Μακάριος Γ΄»)
--   POL → CHR   Νοσοκομείο Πόλεως Χρυσοχούς
--   MHS → MH    Διεύθυνση Υπηρεσιών Ψυχικής Υγείας
--   PHC → HC    Κέντρα Υγείας                          (was «Πρωτοβάθμια Φροντίδα Υγείας»)
--
-- `efinance_code` already holds these strings (0018), so after this
-- migration `code`, `entity_code` and `efinance_code` are one string on every
-- unit. The column stays: it is what the eFinance client sends, and keeping
-- it means a future divergence is a data change and not a code change.
--
-- WHAT DOES NOT MOVE. Unlike 0012, no reference is re-prefixed. Project
-- codes, asset tags and work order references carry the unit code they were
-- issued under and keep it (owner decision, 19/10/2026): a tag is on a
-- printed label and a work order reference is on a contractor's report. The
-- allocators read `org_unit.code` at the moment they hand a number out, so
-- the next project, asset or order a renamed unit opens takes the new prefix
-- and continues the same run of numbers. Building and area codes, cost
-- centres and the eArchive folder hints are untouched for the same reason.
--
-- NO PATIENT DATA. Everything below is an organisational code or a name.

-- No transient unique collision: none of the six new codes is another unit's
-- old code, so both unique indexes hold row by row and the update needs no
-- deferral. The audit trigger (0004) records one row per unit that actually
-- changes; a second run touches nothing.
update ecapital.org_unit o
   set code        = m.new_code,
       entity_code = m.new_code,
       name_el     = m.name_el,
       name_en     = m.name_en,
       updated_at  = now()
  from (values
          ('paphos-general',    'PAP', 'Γενικό Νοσοκομείο Πάφου',                   'Paphos General Hospital'),
          ('troodos',           'TRD', 'Νοσοκομείο Τροόδους',                       'Troodos Hospital'),
          ('namiii',            'ARC', 'Νοσοκομείο Αρχιεπίσκοπος Μακάριος ΙΙΙ',     'Archbishop Makarios III Hospital'),
          ('polis-chrysochous', 'CHR', 'Νοσοκομείο Πόλεως Χρυσοχούς',               'Polis Chrysochous Hospital'),
          ('dypsy',             'MH',  'Διεύθυνση Υπηρεσιών Ψυχικής Υγείας',        'Mental Health Services'),
          ('pfy',               'HC',  'Κέντρα Υγείας',                             'Health Centres')
       ) as m(id, new_code, name_el, name_en)
 where o.id = m.id
   and (o.code is distinct from m.new_code
        or o.entity_code is distinct from m.new_code
        or o.name_el is distinct from m.name_el
        or o.name_en is distinct from m.name_en);

-- A unit whose efinance_code was never filled (none of the twelve, but 0018
-- allowed it) now has one: the unit code is the eFinance code.
update ecapital.org_unit
   set efinance_code = code,
       updated_at    = now()
 where efinance_code is null;

comment on column ecapital.org_unit.code is
  'The unit code, which since ADR-0034 is eFinance''s entity code (also SAP''s Fund Center) and the same string as entity_code and efinance_code. New project codes, asset tags and work order references are built out of it (ADR-0014); existing ones keep the prefix they were issued under.';
comment on column ecapital.org_unit.entity_code is
  'The entity code eFinance, eArchive and SAP Funds Management key this place by. Since ADR-0034 it is eFinance''s code and equal to `code`; eArchive migrates its own site codes to the same strings. Null where there is no counterpart.';
comment on column ecapital.org_unit.efinance_code is
  'eFinance''s own entity code, what the eFinance client sends on a contract push and a budget-position read. Since ADR-0034 it equals `code` on every unit; kept as its own column so a future divergence is data, not code.';
