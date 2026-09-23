# Rulings of Μονάδα Ελέγχου Εσόδων — 22/09 and 23/09/2026

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

## Still open

### 1. The registration fee table contradicts the written confirmation

The workbook sent on 23/09 (`seed/source/registration_fees_by_category.xlsx`) gives a
ΤΑΕΠ registration fee of **€10,00 for 603, 605 and 608** — the same values the original
seed carried, with the same note. The written answer on the same day confirmed those
three are zero.

We have applied the **written answer** (€0,00), because it answered that exact question
directly, and carried the table's figure beside it in `monada_table_taep_fee` with
`fee_conflict = TRUE`. One line from the Μονάδα settles it either way.

Small money — €10 on three categories — but it is a disagreement between two statements
made on the same day, and picking one silently is how a wrong number becomes permanent.

The table is useful corroboration elsewhere: its "Δεν εφαρμόζεται" rows at ΤΑΕΠ are
exactly 610, 611, 612 and 630–637, which matches eleven of the fifteen categories marked
`valid_for_ae = FALSE`. (643–646 show 0 rather than "not applicable"; the operator's
original marking stands and this is only a note.)

### 2. The αρμόδια αρχή table still has not arrived

Item 3 of the follow-up asked for the table of financial categories and the responsible
authority for each. The reply was «το στέλνω τώρα», but the workbook that arrived is the
registration-fee table: its columns are ΤΑΕΠ, Εξωνοσοκομειακή, Ενδονοσοκομειακή, Φάρμακα,
Εργαστηριακά and an empty Σχόλια. There is no authority column.

`requires_payer` and `payer_el` stay empty. This does not block v1, which only prints the
payer; it blocks v2, which bills them.

### 3. The nine hospitals' numbers

The costing number format is settled and reproduces the sample, but 1054 is the only
hospital number we have seen. The other eight are needed before any hospital but that one
can issue a number.
