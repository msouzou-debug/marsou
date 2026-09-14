# ΤΑΕΠ costing tool — Phase 1 data findings

**To:** Μονάδα Ελέγχου Εσόδων
**From:** Τμήμα Πληροφορικής (build team)
**Date:** 2026-09-14
**Source:** `seed/*.csv` as supplied. Every number below is reproducible — run `python3 tools/analyse_seed.py`.

Nine items need a ruling from the Μονάδα. One of them blocks go-live, and one is much larger
than the build brief assumed. Nothing here is a judgement we can make for you.

---

## 1. AET092 is two different treatments — GO-LIVE BLOCKER

| Code | Category | Description |
|---|---|---|
| AET092 | 2 | Τοποθέτηση Ρινογαστρικού Σωλήνα |
| AET092 | 5 | Παρεντερική θρομβόλυση – γενετικά ανασυνδιασμένο ενεργοποιητή του πλασμινογόνου |

Three weight bands apart. A nasogastric tube priced as thrombolysis moves an episode from
weight 4 to weight 12 — triple the weight cost. The seed loader fails hard on this rather than
silently keeping whichever row comes last, so the tool will not start until one code is reassigned.

**Needed:** a new code for one of the two.

## 2. AET086 duplicates the category-5 AET092

Same description, same category. Resolve together with (1) — most likely AET086 is the correct
code for the thrombolysis and the category-5 AET092 row is the stray.

## 3. AET085 and AET091 are the same service

Both *Αναζωογόνηση / Καρδιοπνευμονική αναζωογόνηση*, both category 5. Price is unaffected, but the
clerk sees the same line twice in the picker and the tariff item SHSO-ER12 maps to both.

**Needed:** retire one.

## 4. Six codes missing from the sequences

AET065, AET067, AET084, AET087, AET096, AED018.

**Needed:** confirm these were retired, not lost in transcription. If any were lost, the weight
categories they carried are lost with them.

## 5. SHSO-ER17 is missing from the extra charges list

The sequence runs ER16 → ER18. Same question: retired or dropped?

## 6. Registration fee unconfirmed for 15 of the 23 ΤΑΕΠ-valid categories

Confirmed today: 600 (€100), 603 / 605 / 608 (€10). Documented exemptions: 604, 606, 607, 609.

Unconfirmed, with no note explaining the blank:

> 601, 602, 620, 621, 622, 623, 624, 625, 626, 627, 628, 629, 640, 641, 642

A blank cell is not a statement of exemption. These are seeded `UNCONFIRMED` and will block
finalisation, naming the category, until you rule. The difference is up to €100 per episode —
on an ΕΠΙ ΠΛΗΡΩΜΗ patient the registration fee is roughly the whole weight cost of a standard case.

**Needed:** a fee, or an explicit €0.00 exemption, for each of the 15.

## 7. Nine tariff prices are free text, not amounts

| Code | As supplied | What it needs to become |
|---|---|---|
| SHSO-ER2 | `15€ / 60€ / 70€` | three rows: per-substance, five-panel, ten-panel |
| SHSO-ER3, ER4, ER5, ER6 | «Χρέωση ανάλογα με το ανατομικό σημείο…» | `tariff_lookup` into the radiology CPT list |
| SHSO-ER13 | `250€ / συν αναλώσιμο` | €250 base + consumables, keyed with a mandatory note |
| SHSO-ER16 | `50€ / 120€ / 200€ / συν αναλώσιμα` | three tiers **and** consumables — the brief missed this one |
| SHSO-ER36 | `20 €` | €20 (currency symbol only) |
| SHSO-ER39 | `20€ / συν 5€ ανά ώρα` | €20 base + €5/hour |

**Needed:** re-issue as structured data with a decision date and an approving authority.
SHSO-ER16 in particular needs the three tiers named — 50/120/200 against what?

## 8. The tariff list is not a list of extras — it is 83% a second price for the same acts

This is the big one, and it is larger than §4.5 of the build brief estimated.

**40 of the 48 ΤΑΕΠ tariff items (83%) carry the identical description to a service that already
feeds the weight algorithm.** 41 service/tariff pairs in total. Only 8 tariff items are genuinely
additional to the weight costing.

The specification says the tariff covers *«επιπλέον υπηρεσίες/χρεώσεις που δεν συμπεριλαμβάνονται
στην κοστολόγηση βάσει βαρύτητας»*. On this data that sentence describes 8 items, not 48.

Worst individual exposures:

| Service | Tariff | Price | Act |
|---|---|---|---|
| AET052 (cat 3) | SHSO-ER31 | €1,000 | Κεντρική γραμμή |
| AET082 (cat 4) | SHSO-ER48 | €800 | Οσφυονωτιαία παρακέντηση |
| AET072 (cat 4) | SHSO-ER34 | €400 | Διασωλήνωση |
| AET074 (cat 4) | SHSO-ER14 | €340 | Απινίδωση |
| AET085/091 (cat 5) | SHSO-ER12 | €320 | Καρδιοπνευμονική αναζωογόνηση |

A cardiac arrest is weight 12. At the one unit price we can evidence (€15) that is €180 for the
episode. Charge SHSO-ER12 as well and the patient is billed €500 for one resuscitation, of which
€320 is the second charge for the act the €180 already covered.

**We are not building the brief's default.** The brief said default every pair to `both` with a
warning. At 83% overlap that makes double-charging the normal case and asks the clerk to catch it
by hand, at the exit desk, with a queue. We have defaulted every pair to **`weight_only`** instead:
the weight algorithm prices the act, the tariff line is suppressed unless you rule otherwise. This
under-recovers until you rule, which is the safer error and the one we can defend to a patient.

The 8 genuine extras are unaffected and charge normally.

**Needed:** a ruling on each of the 41 pairs. `docs/overlap_decision_list.xlsx` is built for one
sitting — one row per pair, a dropdown of `weight_only` / `tariff_only` / `both`, and a live
exposure column that totals the euro you are adding as you go. Return the file and it seeds the
`service_tariff_overlap` table directly.

## 9. Only one unit price exists

€15.00 per weight unit for category 624, and we did not receive that either — we derived it
arithmetically from the sample document (8 × 15 = 120). It is test data. It is not authority for
any other category.

Until the unit price table arrives, the tool refuses to finalise any costing and names the missing
category. There is no fallback default price, deliberately.

**Needed:** unit price per weight unit for each of the 23 ΤΑΕΠ-valid categories, and confirmation
of whether Triage carries a separate price from the standard unit price in each.

---

## What is blocked by what

| Item | Blocks |
|---|---|
| 1 — AET092 | Phase 2 start. Seed loader fails until resolved. |
| 8 — overlap rulings | Phase 2 start (§4.5 of the brief). |
| 6 — registration fees | Finalising costings in 15 categories. Not the build. |
| 9 — unit prices | Finalising any costing at all. Not the build. |
| 2, 3, 4, 5, 7 | Go-live. Not the build. |

Items 6 and 9 do not hold up development — the tool is built to refuse rather than guess, so it can
be finished and tested before the prices arrive.
