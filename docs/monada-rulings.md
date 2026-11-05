# Rulings of Μονάδα Ελέγχου Εσόδων — 22/09 to 02/10/2026

What was decided, what it changed, and what it opened up. Source: the answered copy of
`TAEP_ekkremi_themata_Monada_Elegchou_Esodon.docx` plus `20230706_AE_Catalogue_5.xlsx`.

---

## The master data we were working from was corrupted

This matters more than any single ruling. The `services.csv` used in Phase 1 was a bad
extract, and four of the seven defects reported in the Phase 1 memo were artifacts of it:

| Phase 1 finding | Reality, per `20230706_AE_Catalogue_5.xlsx` |
|---|---|
| AET092 duplicated across categories 2 and 5 — "go-live blocker" | One row. Τοποθέτηση Ρινογαστρικού Σωλήνα, category 2. |
| AET086 duplicates the category-5 AET092 | AET086 is Παρεντερική θρομβόλυση, category 5. Distinct service. |
| AET085 and AET091 are the same service | AET091 is **Αναρρόφηση εκκρίσεων, category 1**. Not a duplicate. |
| Five treatment codes missing (AET065, 067, 084, 087, 096) | No gaps. AET001–AET098, all 98 present. |

Only AED018 is a genuine gap, and the Μονάδα confirmed SHSO-ER17 was retired.

The catalogue is now the source of truth: `seed/source/20230706_AE_Catalogue_5.xlsx`, with
`seed/services.csv` and `seed/care_levels.csv` generated from it by
`tools/import_catalogue.py`. 125 services — 27 investigations, 98 treatments.

The lesson is cheap to state and was expensive to learn: the loader's hard-fail on
duplicates did its job, but a hard fail cannot tell a corrupt extract from a real defect.
Findings from derived files get checked against the source before they go out.

---

## What changed in the pricing model

### There is no unit price (item 4)

> «δεν έχει τιμή μονάδας, η κοστολόγηση της βαρύτητας (60-120-180) γίνεται βάση του
> αλγόριθμου ΤΑΕΠ»

Weight maps straight to an amount, the same in every hospital and for every financial
category:

| Weight | Band | Amount |
|---|---|---|
| 4 | χαμηλού κόστους | €60,00 |
| 8 | μέσου κόστους | €120,00 |
| 12 | υψηλού κόστους | €180,00 |

The €15.00 we derived from the sample document was arithmetic (8 × 15 = 120), not a rate.
The scale reproduces it, which is why the golden case still returns €120.00.

This removes the per-category rate table the brief assumed, and with it §14 Q2 — there is
nothing to collect for 23 categories.

### Tariff charges apply to self-paying patients only (item 2)

> «οι έξτρα χρεώσεις με κωδικό SHSO- ισχύουν για τους επί πληρωμή ασθενείς … και
> αποτελούν επιπλέον χρέωση»

Tariff lines arise only for **600 ΕΠΙ ΠΛΗΡΩΜΗ, 602 ΕΥΡΩΚΑΡΤΑ, 640 ΒΡΕΤΑΝΙΚΕΣ ΒΑΣΕΙΣ**,
where they are additive. Everywhere else no tariff line arises at all.

This settles the overlap question wholesale and the 41-pair decision table is deleted. The
Μονάδα ruled with the double-charging exposure in front of them: for a self-paying patient
a resuscitation is €180 of weight plus €320 of tariff. That is their call to make, and
they made it knowing the figure.

Carried as `tariff_applies` on the financial category row, not as a branch on the code.

### Band labels come from the catalogue (item 5)

The Care Levels sheet carries both languages, so nothing was invented:
Διαλογή · Συνδυασμός διάγνωσης και θεραπείας χαμηλού / μέσου / υψηλού κόστους.

### Registration fee is zero everywhere (item 3) — read the note below

> «οι ασθενείς δεν πληρώνουν κατά την εγγραφή, δίνουν μόνο προκαταβολή 100 ευρώ η
> κατηγορία επί πληρωμή, οι υπόλοιπες κατηγορίες δεν έχουν τέλη εγγραφής»

`registration_fee_eur` is 0.00 for all 38 categories. The €100 on 600 is recorded
separately as `registration_deposit_eur`.

**This needs confirming before go-live, and it is worth €100 on every self-pay episode.**
A προκαταβολή is an advance paid *against* the bill, not a charge added *to* it. We have
modelled it that way: the deposit is not in the total. If the Μονάδα means it as an
additive fee, every ΕΠΙ ΠΛΗΡΩΜΗ costing is €100 short. If we had added it and it is a
deposit, every such patient would be overcharged by €100. We chose the direction that
does not overcharge, and we are asking.

Note also that 603, 605 and 608 carried €10.00 in the source file with a note reading
«πληρώνει όλα τα τέλη εγγραφής». The ruling overrides that note. Both the old value and
the note are retained in the CSV so the override is visible rather than silent.

---

## Settled without further work

| Item | Ruling |
|---|---|
| 10 — SHSO-ER17 | Retired. Confirmed. |
| 11 — free-text tariff prices | «θα επιλέγει ο κωδικοποιητής — διατήρησε όλους τους κωδικούς». All codes kept; the coder picks the tier. |
| 13 — ICD-10 diagnoses | Transcribed from the doctor's entry on the form. Print only, no effect on price. Confirmed. |
| 14 — tariff scope | National. One tariff for all nine hospitals. |

---

## Second round — 23/09/2026

| Item | Ruling | Applied as |
|---|---|---|
| Triage amount | «10 ευρώ» | `TRIAGE_PRICE = 10.00`. Its own amount, not on the 60/120/180 scale. |
| The €100 deposit | «επιβεβαιώνω και τα δύο» | Confirmed a deposit against the bill, not added to the cost. 603/605/608 confirmed zero. |
| Costing number | «κωδικός ανά νοσηλευτήριο και μοναδικός αύξων αριθμός» | `format_costing_number()`. Reproduces the sample: `OKY1054/0035`. |
| SHSO-ER16 tiers | €50 Θεραπευτικό πλύσιμο οργάνου · €120 Πλύση οφθαλμού 3 ώρες · €200 Παρουσία οφθαλμιάτρου | Split into ER16-A/B/C in `seed/tariff.csv`. |

`seed/tariff.csv` now carries all 48 source rows as 52 structured rows, **every one with
a resolved price**. The nine free-text prices from the Phase 1 memo are closed.

---

## Third round — 29/09/2026

### The registration fee, finally

Three statements, and the last one reverses the middle one:

| Date | Said |
|---|---|
| 22/09 | «οι υπόλοιπες κατηγορίες δεν έχουν τέλη εγγραφής» |
| 23/09 | «επιβεβαιώνω και τα δύο» — including that 603/605/608 are zero |
| 29/09 | «Ναι έχεις δίκαιο είναι 10 ευρώ για αυτές τις κατηγορίες» |

Final position, applied:

| Category | Fee | Deposit | Added to the cost |
|---|---|---|---|
| 600 ΕΠΙ ΠΛΗΡΩΜΗ | €0,00 | €100,00 | no — the deposit is paid against the bill |
| 603, 605, 608 ΔΙΚΑΙΟΥΧΟΣ Α | €10,00 | — | yes |
| all others | €0,00 | — | — |

Their own fee table said €10,00 for those three from the start. Carrying the
disagreement instead of resolving it quietly is what let one line settle it — and the
two readings now make sense together: Δικαιούχος Α gets free treatment but pays
registration fees, while a self-paying patient pays the whole bill and leaves a deposit
instead of a separate fee. `fee_conflict` is now FALSE on every row.

### The αρμόδια αρχή table arrived

The workbook gained the column (spelled «Αμρόδια Αρχή»). 29 of the 38 categories are
settled by a third party:

| Payer | Categories |
|---|---|
| Υπουργείο Υγείας | 602–612, 620–627, 642–646 |
| Υπουργείο Δικαιοσύνης | 601, 641 |
| Υπηρεσία Ασύλου | 628 |
| Υπουργείο Εξωτερικών | 629 |
| Βρετανικές Βάσεις | 640 |

`requires_payer` is FALSE for 600 («Επιπληρωμή» is the patient) and for the rows marked
«Δεν εφαρμόζεται». v1 prints the payer; v2 bills them.

Note a small tension, not a contradiction: 602 and 640 are `tariff_applies = TRUE`
(self-paying, so tariff charges arise) yet also carry a third-party payer. Both hold —
they are billed to a third party at self-pay rates.

### Hospital numbers — all eight, and a correction (29/09 and 02/10)

The 29/09 list gave seven numbers and we inferred the eighth. 02/10 confirmed that
inference and corrected one of our mappings.

**1054 is Γενικό Νοσοκομείο Λευκωσίας**, ΤΑΕΠ ενηλίκων. The Μονάδα also writes it as
«F1054»; the costing number uses 1054, as the sample document does. (eFinance's
`entities` table has an `oay_fcode` column that looks like where the F-prefixed form
belongs, but it is finer-grained than that — see below.)

**1106 is not Μακάριος ΙΙΙ.** We had mapped it there and that was wrong:

> «Το ΤΑΕΠ παίδων δεν είναι το ΝΑΜ ΙΙΙ αφού αυτή την στιγμή είναι στο Γενικό
> Λευκωσίας. Θα μεταστεγαστεί σύντομα όμως στο ΝΑΜΙΙΙ.»

«Κυπερούντας» is Νοσοκομείο Τροόδους, as we had it.

---

## A ΤΑΕΠ unit is not a hospital

This is the structural consequence, and it is worth stating plainly because it changes
the data model rather than just the data.

**Eight ΤΑΕΠ units across seven eFinance entities.** Γενικό Νοσοκομείο Λευκωσίας runs
two of them on one entity:

| Number | Unit | eFinance entity |
|---|---|---|
| 1054 | Γενικό Νοσοκομείο Λευκωσίας — ΤΑΕΠ ενηλίκων | NGH |
| 1106 | ΤΑΕΠ Παίδων Λευκωσίας | NGH |
| 1047 | Γενικό Νοσοκομείο Λεμεσού | LGH |
| 1048 | Γενικό Νοσοκομείο Λάρνακας | LAR |
| 1025 | Γενικό Νοσοκομείο Πάφου | PAP |
| 1049 | Γενικό Νοσοκομείο Αμμοχώστου | FAM |
| 1055 | Νοσοκομείο Τροόδους | TRD |
| 1026 | Νοσοκομείο Πόλης Χρυσοχού | CHR |

Μακάριος ΙΙΙ (ARC) runs no ΤΑΕΠ today.

So the two scopes come apart, and the schema now reflects it:

- **The costing-number sequence is per unit.** `taep_number_sequence` is keyed on
  `unit_code`. The two Nicosia units keep separate gapless series.
- **Access control stays per entity.** A Nicosia clerk sees Nicosia episodes whichever
  unit they work in, using eFinance's existing `entities` / `user_entities` scoping.
- `taep_episode` carries both `entity_code` and `taep_unit_code`.

The paediatric unit's move to Μακάριος ΙΙΙ is coming during the project, so
`host_entity_code` is effective-dated: close the row, open a new one, never update in
place — the same discipline as rates. When it moves, its episodes start being visible
to ARC users rather than NGH users, and that is a data change.

Eight, incidentally, not the nine the build brief repeats throughout.

---

## Nothing open

### The paediatric unit keeps 1106 across the move (05/10/2026)

Confirmed. ΤΑΕΠ Παίδων carries number 1106 and its running sequence when it moves to
Μακάριος ΙΙΙ. The relocation is therefore exactly one effective-dated row on
`taep_unit`: close `host_entity_code = NGH`, open `host_entity_code = ARC`. The number
and the sequence are untouched, and no episode already numbered is affected.

That is the last question from five rounds. Everything the Μονάδα was asked is answered
and applied.

---

## eFinance reply, 19/10/2026 — ARC and the abbreviations

**ARC exists and is in scope.** From the live `entities` table: code `ARC`, name
«Νοσοκομείο Αρχιεπίσκοπος Μακάριος ΙΙΙ», `type=hospital`, `active=1`, SAP company
code 1021.

**No row was added to `seed/taep_units.csv`, and that is deliberate.** The instruction
read "add ARC, that makes your list eight rows", which assumes one row per hospital. The
list already has eight rows, because a ΤΑΕΠ unit is not a hospital: Γενικό Νοσοκομείο
Λευκωσίας hosts two units, adults (1054) and paediatrics (1106). ARC's place in the model
is already there — it is where unit 1106 moves to, and `host_entity_code` is
effective-dated for exactly that.

Writing `ARC` as a host today would key new paediatric episodes to Μακάριος ΙΙΙ while the
unit is still physically at the General. The move is a dated change and the only missing
input is the date.

A second, separate unit at ARC would need its own ΟΑΥ ΤΑΕΠ number. The Μονάδα gave eight
numbers on 02/10/2026 — 1054, 1106, 1047, 1048, 1025, 1049, 1055, 1026 — and there is no
ninth. ΤΑΕΠ numbers are ΟΑΥ identifiers; the brief forbids extending them here. So that
would be a request to ΟΑΥ, not a CSV edit.

**On the coverage challenge.** The reply noted that eight entities is the whole set of
active hospitals, and that a subset turning out to be everything is worth questioning. The
set is not defined by which entities are hospitals: it is the eight numbered ΤΑΕΠ units
ΟΑΥ recognises. Today those sit on seven entities, ARC excluded. After the paediatric move
they sit on eight — still eight ΟΑΥ numbers, not nine. Χρυσοχούς (1026) and Τροόδους
(1055) are in because ΟΑΥ issued them numbers, which is the authority on the question.

**`AMB` and `CNS` cannot appear.** Nothing in `taep.py` reads the `entities` table. Units
come from `taep_unit`, seeded from the CSV, and an episode's `entity_code` is whatever
eFinance's `user_entity()` returns for the logged-in clerk. An inactive entity with no
unit therefore offers no unit to pick and no costing can be created against it.

**Abbreviations.** eFinance's codes are canonical. `host_entity_code` already used them.
Two `unit_code` values did not — `LIM` and `PAF` were competing abbreviations for Λεμεσός
and Πάφος, which is the divergence being eliminated. Renamed, and the two Nicosia units
now carry the entity code as their prefix:

| was | now |
|---|---|
| `NIC-ADULT` | `NGH-ADULT` |
| `NIC-PAED` | `NGH-PAED` |
| `LIM` | `LGH` |
| `PAF` | `PAP` |

`LAR`, `FAM`, `TRD` and `CHR` already matched. Every `unit_code` is now either an eFinance
entity code or that code with a suffix, used only where one entity hosts two units. Done
before any number was issued, so nothing was rewritten.

**Still outstanding.** The paediatric move date, and a `clerk` on `NGH`. Both existing
clerks sit on `HQ`, a central office, which hosts no ΤΑΕΠ unit — `unit_for_entity('HQ')`
returns nothing, so such an account cannot create a costing at all. That is the access rule
working, not a fault.


---

## The answers of 02/11/2026 (Παναγιώτα Έλληνα)

### The «επιπληρωμή» was never a surcharge

Five rounds of asking what percentage applied to Ευρωκάρτα and Βρετανικές Βάσεις, and
the answer is that there is no percentage. Every patient is priced on the weight of the
episode — 60, 120 or 180 — and for the three self-paying categories the tariff fields
open on top of it: the radiology price list and the ΤΑΕΠ extra charges. That is the
whole of it, and it is the 22/09 ruling restated.

So nothing is owed on the pricing side. What she reported instead is that the
extra-charges card does not open for 602 ΕΥΡΩΚΑΡΤΑ, and it should open for 600, 602 and
640 alike.

That was real, and it was not the screen. `tariff_applies` has been TRUE for all three
in `seed/financial_categories.csv` since 22/09, the screen has a single gate on that
column, and the live row disagreed. `seed()` fills a table only when it is empty —
correctly, so it cannot overwrite a deliberate correction — so a CSV corrected after the
first install never reached the server and nothing compared the two.

Fixed, and the class of fault closed: `taep.category_flag_drift()` compares the live
flags with the CSV, readiness reports a difference (blocker for `valid_for_ae` and
`tariff_applies`, warning for the two that only print), and
`tools/check_category_flags.py --apply` reconciles them.

### Registration fee: confirmed, and already built

«Θέλω και πεδίο επιβεβαίωσης ότι δόθηκαν τα 10 ευρώ (έτσι ώστε να αφαιρείται μετά από το
σύνολο). Αν δεν δόθηκαν δεν θα αφαιρούνται.»

That is exactly what was built on 23/10 and has been live since. The tick and the
receipt field are on the entry screen for 600, 603, 605 and 608 — the four categories
that take something at registration — and `deposit_state()` computes the balance only
when the tick is set. Measured on a 120,00 € costing in 603:

| tick | Τελικό Κόστος | Τέλος εγγραφής | Υπόλοιπο |
|---|---|---|---|
| not set | 120,00 € | 10,00 € (due) | — nothing netted off |
| set | 120,00 € | 10,00 € (taken) | 110,00 € |

Nothing to change. Worth showing her the two lines so she can see her rule in the
system rather than take our word for it.

### ΤΑΕΠ Παίδων — the move date is not known

So nothing is scheduled. The unit stays on NGH until somebody supplies a date, and the
change remains one effective-dated row. Nothing in the system needs the date in advance;
it only cannot be entered early.

### Access across hospitals — no change

«Όχι, να μείνει όπως έχει δημιουργηθεί — καμία αλλαγή.» Users with rights to every
hospital see and record against every hospital's units. Confirmed as built, and no
longer an open assumption.

### A list as well as a search on the ICD-10 box — in two controls, by code

Asked for in three steps, and worth recording in order because the first two answers
were mine and both were wrong.

1. «Both a search and a drop down list alphabetically.» I read "alphabetically" as the
   Greek description and built a folded sort column for it, because ordering on
   `description_el` puts «Άσθμα» before «Αβαρία» — 1.627 of the 10.560 descriptions open
   with an accented capital. That was a careful answer to a question I should have asked.
2. «Not alphabetically to start with A B C.» She means the **code**: A00, A01, … Z99,
   which is how ICD-10 is published. No sort column, no migration — `ORDER BY code`. The
   column was removed before it ever reached the server.
3. «Better if the search is on a separate box vs the drop down list.» Two controls, not
   one combined widget.

As built: a search field that asks the server, and beside it a plain `<select>` holding
the catalogue by code. The whole catalogue is fetched once, when the clerk first opens
the list — 1,1 MB, and only then, because most entries are typed rather than browsed.
Searching replaces the dropdown's contents and says how many were found; clearing it
restores the full list and keeps whatever was already chosen.

It is a plain `<select>`, with no Select2 and no jQuery. That field was dead twice on
30/10 — once because jQuery had not loaded when the script ran, once because eFinance's
own `$('.select2')` pass claimed the wrapper Select2 had built and put an empty box in
its place. A control the browser renders itself cannot fail either way.

### The 34 letters typed on the wrong keyboard

Found while building the list, corrected on instruction (02/11). The catalogue had 34
descriptions mixing the alphabets **in both directions**:

| | |
|---|---|
| A59.8 | «Tριχομονάδωση» — a Greek word opening with a Latin T |
| K22.7 | «Οισοφάγος του Βarrett» — a Latin name with a Greek Β |
| E27.2 | «Κρίση Αddison» — the same, mid-line |
| D56.4 | «[ΗΡFH]» — a Latin abbreviation with two Greek letters |
| Y58.0 | «Εμβόλιο ΒCG» |

They cannot be seen: the letters are drawn identically. And they broke the search
outright, because `fold_greek()` does not map between alphabets — a clerk typing «Τριχ»
in Greek never found A59.8 at all. That is why correcting the data was worth more than
handling it in the sort, which is what I had done first and which would have made the
Latin names worse.

Each one was decided per word, by its **exclusive** letters — the ones with no look-alike
in the other alphabet, such as Greek π or Latin F. A word those did not settle would have
been left alone and reported; none had to be. `tools/fix_icd10_text.py` holds the
rule, a test re-runs it over the seeded catalogue so a future delivery cannot reintroduce
one, and `tools/sync_diagnoses.py` carries a correction to a server that already holds
the catalogue, rebuilding `search_text` with it.

### The rest of the character defects, corrected on instruction (02/11)

I had listed five remaining items. Two of the five were not what I said, which is worth
recording:

- **B33.4 «(Καρδιο-)πνευμονικό σύνδρομο» is not a defect.** The English reads
  "(cardio-)pulmonary", so the optional prefix is ICD style. Left exactly as supplied.
- **The double spaces are 274 rows, not a handful** — 268 Greek and 6 English. And they
  are not cosmetic. `search_text` keeps the spacing of the description, so «Εντερίτιδα
  από» typed normally did not match «Εντερίτιδα  από» as stored. 268 diagnoses were
  unfindable by anyone typing the phrase the way it reads.

Corrected, 289 changes in all:

| class | rows | |
|---|---|---|
| runs of two or more spaces | 274 | A04.0 «Εντερίτιδα  από» → «Εντερίτιδα από» |
| karyotypes in Greek Χ/Υ | 13 | Q97.0 «47,ΧΧΧ» → «47,XXX» |
| two words run together | 1 | A23.3 «απόBrucella» → «από Brucella» |
| a leading backtick | 1 | I51.0 «\`Ελλείμματα» → «Ελλείμματα» |

On the karyotypes, Q96.1 settles that it was an error and not a convention:
«Καρυότυπος 46,Χ iso (Xq)» had a Greek Χ after the comma and a Latin X inside the
brackets, on one line. Nobody types a karyotype in Greek, so all 13 were unfindable.

The backtick is stripped only from the **start** of a description. The catalogue's other
three apostrophes are correct and are left alone: «Πυρετός O'nyong-nyong», «καθ' έξιν»
in O26.2, «απ' αυτό» in Z89.5. A blanket strip would have ruined all three, and there is
a test holding that line.

`tools/fix_icd10_text.py` holds every rule — renamed from `fix_icd10_letters.py`, since
it is no longer only letters — and a test re-runs the whole decision over the seeded
catalogue so a future delivery cannot reintroduce any of it.


---

## The answers and reports of 03/11/2026 (Παναγιώτα Έλληνα)

### A refused calculation was throwing away the clerk's work

«Επιλέγω μια υπηρεσία από τον τιμοκατάλογο αλλά δεν προστίθεται στο σύνολο και με το που
πατώ υπολογισμό αφαιρείται από τη λίστα μου.»

Reproduced. Adding «Ακτινογραφία» (SHSO-ER3) without choosing an examination is refused,
and rightly — the four `tariff_lookup` codes carry no amount of their own, the price IS
the examination's. But the route redirected, so the posted row was gone and the charge
had to be entered again from nothing just to read the same message twice.

The refusal stays. The row now comes back with it, quantity included, and the previous
calculation is left standing.

### The examination is mandatory on a radiology charge

Checked before anything is sent, with the message beside the field. Not the `required`
attribute: Select2 hides the real `<select>`, and a browser will not report a validation
error on a field nobody can focus.

Which uncovered a third fault nobody had reported. `show()` toggled `d-none` on the
original select, but Select2 renders a sibling wrapper in its place — so the examination
dropdown was **31px tall on every extra-charge row**, including fixed-price charges where
it means nothing. Measured in Chromium: 31px before, 0 after. That is most of why nothing
signalled which charges need an examination and which do not.

### AED005 without its charge blocks finalisation — AED005 only

Asked for on AED005, confirmed compulsory, then narrowed to that code alone when the rule
was put to her for all four.

AED005 sets the weight and adds no money: the X-ray's price lives in the radiology list
and arrives through an extra charge. Record the service and not the charge and the
episode is priced without the X-ray — revenue nobody notices is missing.

A blocker, not a refusal to calculate: the costing can be priced and read, but not
finalised. Same treatment as the diagnosis. Silent in a category that cannot carry extra
charges, where there is nothing the clerk could do.

`RADIOLOGY_SERVICE_CHARGES` records all four pairings because they are true;
`RADIOLOGY_CHARGE_COMPULSORY` is `{"AED005"}` and is the whole change if the others are
ever wanted. AED022 «Τομογραφία Ουροποιογεννητικού» is in neither — the tariff has no
matching code for it, **which may be a gap in their price list worth asking about.**

**Asked and answered, 05/11/2026.** The question was whether a self-pay X-ray always
carries a charge, since the blocker stops the episode when it does not. «No, there is no
case where an X-ray is taken and no charge applies.» So the blocker is unconditionally
right and nothing about it needs softening.

Her answer has a consequence for what is already in the database. Anything finalised
before 03/11 can carry AED005 without SHSO-ER3, and those costings were priced without
the X-ray. Nothing on them shows it — the total is a valid number, just a smaller one
than it should be. `tools/find_uncharged_xrays.py` reads them out of the live database,
read-only:

    sudo -u finance python3 /opt/finance/find_uncharged_xrays.py /opt/finance/finance.db

It lists only episodes in categories that accept charges, so a 609 case with an X-ray is
not reported as an error — there is no charge to add there. Each one it finds is the
Μονάδα's to decide on, through the revision screen, one at a time and with a reason: a
number a patient has already been given does not change silently.

The specimen costing itself is unaffected. OKY1054/0035 is category 624, which carries
no tariff charges, so the rule does not reach it — but its service list does include
AED005, which is why acceptance scenario ΣΑ-25 had to stop reusing that list under 600.

### The service pickers trapped the clerk

«Επιλέγω μία ή και περισσότερες διεργασίες αλλά το παράθυρο μένει ανοικτό και δεν μπορώ
να προχωρήσω στο επόμενο πεδίο.»

`closeOnSelect` was false on purpose, to save reopening a list of 125 between picks. The
wrong trade: it saves a click and costs the clerk their way out of the field. It closes
after each pick now, and multi-select still works.


---

## The reports of 05/11/2026 (Παναγιώτα Έλληνα)

### All five radiology services are compulsory, and AED022 does have a charge

Widened from AED005 alone to AED019, AED020, AED021 and AED022.

**A correction to what we told her on 03/11.** We reported that the tariff had no code
for AED022 «Τομογραφία Ουροποιογεννητικού με σκιαγραφικό». It has: **SHSO-ER7**, a flat
**€65**. It was missed because the scan that found the others looked only at the four
`tariff_lookup` codes, and SHSO-ER7 is a fixed price. So AED022 needs no examination
picking — only the charge.

AED021 and AED022 are a deliberate pair, which the price list says itself: AED021 reads
«Αξονική Τομογραφία (αποκλείει τομογραφία ουροποιογεννητικού συστήματος με σκιαγραφικό»,
and AED022 is exactly what it excludes.

| Service | Charge | |
|---|---|---|
| AED005 Ακτινογραφία | SHSO-ER3 | examination from the radiology list |
| AED019 Υπερηχογράφημα | SHSO-ER4 | examination from the radiology list |
| AED020 Μαγνητική τομογραφία | SHSO-ER6 | examination from the radiology list |
| AED021 Αξονική Τομογραφία | SHSO-ER5 | examination from the radiology list |
| AED022 Τομογραφία Ουροποιογεννητικού | SHSO-ER7 | flat €65 |

### «Ενημέρωση υπηρεσιών» is gone

«Το κουμπί ενημέρωση υπηρεσιών τι χρειάζεται? Επειδή αν ο χρήστης δεν το πατήσει δεν
καταχωρείται καμία υπηρεσία και η κοστολόγηση οδηγεί μόνο σε διαλογή.»

She was right, and it was worse than an extra click. Miss the button and Υπολογισμός
priced the episode as **triage only** — a valid number, quietly wrong, with nothing on
the screen to say the selection had never been saved.

There is no separate step now. The two pickers belong to the calculation form through
`form="calc-form"`, which HTML allows for a control outside it, so no card had to move.
`services_posted` is a hidden marker in that form: an empty multiple-select sends
nothing at all, so without it a post that is not about services would read as "the clerk
cleared them".

### Services can be corrected on a finalised costing

«Όταν κάνω επεξεργασία μέσω των καταχωρήσεων δεν μου επιτρέπει να αφαιρέσω την
ακτινογραφία … αν γίνει λάθος και θα θέλει ο χρήστης να το διορθώσει έτσι ώστε να αλλάξει
το συνολικό ποσό αυτό πρέπει να μπορεί να γίνεται.»

A finalised costing could have its patient details and its financial category revised but
not its services, so an X-ray recorded by mistake was permanent and the total with it.

It changes a figure the patient is holding, so it goes through the same machinery as any
other revision rather than quietly replacing rows: the superseded figures are copied to
`taep_costing_revision` first, the costing number does not move, the revision counter
goes up, the status stays FINALISED, and **a reason is required** — it is the only record
of why the amount changed.

On a finalised costing the pickers therefore belong to a revision form rather than the
calculation form, with the reason box beside them. Everything that can refuse — the
«both kinds or neither» rule, the pricing, the compulsory radiology charge — refuses
before the first write, because `db_execute` commits per call and a half-done revision
would stay half-done.
