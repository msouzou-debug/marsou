# Rulings of Μονάδα Ελέγχου Εσόδων — 22/09/2026

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

## Still open

1. **Triage amount.** The 60/120/180 ruling says nothing about weight 1. A triage-only
   costing is blocked until it is set — deliberately, rather than guessing at €15.
2. **The €100 προκαταβολή** — deposit or additive fee? See above.
3. **The financial-category table with the αρμόδια αρχή** for each category. Item 6 says
   «δες πίνακα», but no such table was attached; the workbook we received holds only Care
   Levels, Investigations and Treatments. `requires_payer` and `payer_el` stay empty.
4. **Costing number.** The Μονάδα does not recognise OKY1054 and has asked us for more
   information. We only have the one sample document.
5. **SHSO-ER16 tiers.** Keeping all codes is settled, but the coder still has to know what
   €50 / €120 / €200 correspond to before they can choose between them.
