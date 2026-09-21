-- 0019 — Community Nursing is named exactly as eArchive names its folder
-- (owner decision, 21/09/2026; ADR-0024's addendum, errata bullet of the
-- same date).
--
-- 0018 opened the `community-nursing` unit as «Κοινοτική Νοσηλευτική
-- Υπηρεσία» / "Community Nursing Service". eArchive's own folder for it
-- (Φ. ΤΥ.12) reads «Κοινοτική Νοσηλευτική», and the owner asked that the two
-- match word for word so a person reading a filed paper and a person reading
-- eCapital's unit switcher see the same name. 0018 is checksummed and stays
-- as shipped; this migration carries the rename for a database 0018 has
-- already run on. The seed writes the short name directly.
--
-- Idempotent: only a row still carrying 0018's name is touched, so a server
-- seeded after this file shipped, or this file run twice, changes nothing.
-- Both languages move together — one guard on the Greek is enough, the
-- English never diverged from it.
update ecapital.org_unit
   set name_el = 'Κοινοτική Νοσηλευτική',
       name_en = 'Community Nursing'
 where id = 'community-nursing'
   and name_el = 'Κοινοτική Νοσηλευτική Υπηρεσία';
