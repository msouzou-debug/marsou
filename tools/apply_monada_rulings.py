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

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "seed" / "financial_categories.csv"

TARIFF_CATEGORIES = {"600", "602", "640"}   # ΕΠΙ ΠΛΗΡΩΜΗ, ΕΥΡΩΚΑΡΤΑ, ΒΡΕΤΑΝΙΚΕΣ ΒΑΣΕΙΣ
DEPOSITS = {"600": "100.00"}
RULING = "Μονάδα Ελέγχου Εσόδων 22/09/2026"
# Triage confirmed at €10.00 on 23/09/2026; it lives in taep.TRIAGE_PRICE, not here,
# because it is national and not a property of the financial category.

# The Μονάδα's own registration-fee table, sent 23/09/2026. Its ΤΑΕΠ column is carried
# alongside our value as a cross-reference, NOT applied: it says 603/605/608 are €10,00
# while their written confirmation of the same date zeroes them. Recorded so the
# disagreement is one line to settle, rather than buried in a spreadsheet.
FEE_TABLE = ROOT / "seed" / "source" / "registration_fees_by_category.xlsx"
table = {}
sheet = load_workbook(FEE_TABLE, data_only=True)["Sheet1"]
for r in range(3, sheet.max_row + 1):
    code = sheet.cell(r, 3).value
    if code and str(code).strip().isdigit():
        table[str(code).strip()] = sheet.cell(r, 5).value   # column E = ΤΑΕΠ

# Read the ORIGINAL file, never the file we last wrote. Reading our own output made
# the script non-idempotent: a second run recorded the already-zeroed fee as the
# "previous" value and destroyed the real one.
SOURCE = ROOT / "seed" / "source" / "financial_categories_original.csv"
rows = list(csv.DictReader(open(SOURCE, encoding="utf-8")))
fields = list(rows[0]) + ["tariff_applies", "registration_deposit_eur",
                          "fee_source", "previous_registration_fee_eur",
                          "monada_table_taep_fee", "fee_conflict"]

changed = []
conflicts = []
for row in rows:
    code = row["code_new"]
    previous = row["registration_fee_eur"]

    row["previous_registration_fee_eur"] = previous
    row["registration_fee_eur"] = "0.00"
    row["fee_status"] = "SET"
    row["fee_source"] = RULING
    row["tariff_applies"] = "TRUE" if code in TARIFF_CATEGORIES else "FALSE"
    row["registration_deposit_eur"] = DEPOSITS.get(code, "")

    from_table = table.get(code)
    row["monada_table_taep_fee"] = "" if from_table is None else str(from_table)
    # A conflict is a numeric non-zero fee in their table against our 0.00.
    conflicting = isinstance(from_table, (int, float)) and from_table and code not in DEPOSITS
    row["fee_conflict"] = "TRUE" if conflicting else "FALSE"
    if conflicting:
        conflicts.append((code, row["name_el"], from_table))

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
if conflicts:
    print("\n  UNRESOLVED — the Μονάδα's own fee table disagrees with their written")
    print("  confirmation of 23/09 that these are zero. Carried, not applied:")
    for code, name, value in conflicts:
        print(f"    {code} {name[:38]:<40} table €{value}  vs  applied €0.00")
