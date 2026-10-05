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
