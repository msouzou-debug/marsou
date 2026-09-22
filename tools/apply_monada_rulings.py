# -*- coding: utf-8 -*-
"""
Applies the rulings of Μονάδα Ελέγχου Εσόδων (22/09/2026) to
seed/financial_categories.csv.

Ruling 2 — tariff charges:
    «οι έξτρα χρεώσεις με κωδικό SHSO- ισχύουν για τους επί πληρωμή ασθενείς
     (επί πληρωμή, βρετανικές βάσεις, ευρωκάρτα) και αποτελούν επιπλέον χρέωση»
    -> tariff_applies TRUE for 600, 602, 640 only. Elsewhere no tariff line arises,
       so the 41-pair overlap table is superseded and deleted.

Ruling 3 — registration fee:
    «οι ασθενείς δεν πληρώνουν κατά την εγγραφή, δίνουν μόνο προκαταβολή 100 ευρώ
     η κατηγορία επί πληρωμή, οι υπόλοιπες κατηγορίες δεν έχουν τέλη εγγραφής»
    -> registration_fee_eur 0.00 everywhere. The €100 on 600 is a PROKATAVOLI, an
       advance paid against the bill, so it is recorded as a deposit and NOT added
       to the cost. Adding it would overcharge every self-pay patient by €100.
       Flagged back to the Μονάδα for confirmation — see docs/monada-rulings.md.

    Note: 603, 605 and 608 carried €10.00 in the source file with a note saying the
    patient «πληρώνει όλα τα τέλη εγγραφής». The ruling overrides that. Both the old
    value and the note are kept in the CSV so the change is visible, not silent.
"""
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "seed" / "financial_categories.csv"

TARIFF_CATEGORIES = {"600", "602", "640"}   # ΕΠΙ ΠΛΗΡΩΜΗ, ΕΥΡΩΚΑΡΤΑ, ΒΡΕΤΑΝΙΚΕΣ ΒΑΣΕΙΣ
DEPOSITS = {"600": "100.00"}
RULING = "Μονάδα Ελέγχου Εσόδων 22/09/2026"

rows = list(csv.DictReader(open(PATH, encoding="utf-8")))
fields = list(rows[0]) + ["tariff_applies", "registration_deposit_eur",
                          "fee_source", "previous_registration_fee_eur"]

changed = []
for row in rows:
    code = row["code_new"]
    previous = row["registration_fee_eur"]

    row["previous_registration_fee_eur"] = previous
    row["registration_fee_eur"] = "0.00"
    row["fee_status"] = "SET"
    row["fee_source"] = RULING
    row["tariff_applies"] = "TRUE" if code in TARIFF_CATEGORIES else "FALSE"
    row["registration_deposit_eur"] = DEPOSITS.get(code, "")

    if previous not in ("", "0.00"):
        changed.append((code, row["name_el"], previous))

with open(PATH, "w", encoding="utf-8", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

print(f"updated {PATH.relative_to(ROOT)} ({len(rows)} categories)")
print(f"  tariff_applies TRUE : {', '.join(sorted(TARIFF_CATEGORIES))}")
print(f"  deposit recorded    : {', '.join(f'{k} €{v}' for k, v in DEPOSITS.items())}")
print(f"  fee now 0.00 for all {len(rows)} categories")
if changed:
    print("  previously non-zero, now 0.00 by ruling:")
    for code, name, previous in changed:
        print(f"    {code} {name[:38]:<40} was €{previous}")
