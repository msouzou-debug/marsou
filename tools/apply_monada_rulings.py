# -*- coding: utf-8 -*-
"""
Applies the rulings of Μονάδα Ελέγχου Εσόδων (22/09/2026) to
seed/financial_categories.csv.

Ruling 2 — tariff charges:
    «οι έξτρα χρεώσεις με κωδικό SHSO- ισχύουν για τους επί πληρωμή ασθενείς
     (επί πληρωμή, βρετανικές βάσεις, ευρωκάρτα) και αποτελούν επιπλέον χρέωση»
    -> tariff_applies TRUE for 600, 602, 640 only. Elsewhere no tariff line arises,
       so the 41-pair overlap table is superseded and deleted.

Ruling 3 — registration fee, as finally settled on 29/09/2026:
    22/09: «οι ασθενείς δεν πληρώνουν κατά την εγγραφή, δίνουν μόνο προκαταβολή 100
           ευρώ η κατηγορία επί πληρωμή, οι υπόλοιπες κατηγορίες δεν έχουν τέλη»
    23/09: «επιβεβαιώνω και τα δύο» — deposit not added; 603/605/608 zero
    29/09: «Ναι έχεις δίκαιο είναι 10 ευρώ για αυτές τις κατηγορίες»

    Final position:
      600  registration fee €0.00, plus a €100.00 deposit paid against the bill and
           NOT added to the cost (confirmed 23/09 and unchanged since)
      603, 605, 608  registration fee €10.00, added to the cost (29/09)
      everything else  €0.00

    Their own fee table agreed with the 29/09 answer all along, which is why the
    disagreement was carried rather than resolved quietly. Δικαιούχος Α gets free
    treatment but pays registration fees; a self-paying patient pays the whole bill
    and leaves a deposit instead. Both readings now line up.

Ruling 29/09 — αρμόδια αρχή:
    The workbook gained an «Αμρόδια Αρχή» column (their spelling). It populates
    payer_el and requires_payer: TRUE wherever a third party settles, FALSE for 600
    («Επιπληρωμή» — the patient pays) and for the rows marked «Δεν εφαρμόζεται».
"""
import csv
from decimal import Decimal
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "seed" / "financial_categories.csv"

TARIFF_CATEGORIES = {"600", "602", "640"}   # ΕΠΙ ΠΛΗΡΩΜΗ, ΕΥΡΩΚΑΡΤΑ, ΒΡΕΤΑΝΙΚΕΣ ΒΑΣΕΙΣ
DEPOSITS = {"600": "100.00"}
# 29/09: these three pay a €10.00 ΤΑΕΠ registration fee, added to the cost.
FEE_CATEGORIES = {"603": "10.00", "605": "10.00", "608": "10.00"}
# The patient settles their own bill in these; no third party is billed.
SELF_SETTLING = {"Επιπληρωμή", "Δεν εφαρμόζεται"}
RULING = "Μονάδα Ελέγχου Εσόδων 22/09/2026"
# Triage confirmed at €10.00 on 23/09/2026; it lives in taep.TRIAGE_PRICE, not here,
# because it is national and not a property of the financial category.

# The Μονάδα's own registration-fee table, sent 23/09/2026. Its ΤΑΕΠ column is carried
# alongside our value as a cross-reference, NOT applied: it says 603/605/608 are €10,00
# while their written confirmation of the same date zeroes them. Recorded so the
# disagreement is one line to settle, rather than buried in a spreadsheet.
FEE_TABLE = ROOT / "seed" / "source" / "registration_fees_and_authority.xlsx"
table = {}
authority = {}
sheet = load_workbook(FEE_TABLE, data_only=True)["Sheet1"]
for r in range(3, sheet.max_row + 1):
    code = sheet.cell(r, 3).value
    if code and str(code).strip().isdigit():
        code = str(code).strip()
        table[code] = sheet.cell(r, 5).value                  # column E = ΤΑΕΠ
        authority[code] = (sheet.cell(r, 11).value or "")     # column K = Αμρόδια Αρχή

# Read the ORIGINAL file, never the file we last wrote. Reading our own output made
# the script non-idempotent: a second run recorded the already-zeroed fee as the
# "previous" value and destroyed the real one.
SOURCE = ROOT / "seed" / "source" / "financial_categories_original.csv"
rows = list(csv.DictReader(open(SOURCE, encoding="utf-8")))
fields = list(rows[0]) + ["tariff_applies", "registration_deposit_eur",
                          "fee_source", "previous_registration_fee_eur",
                          "monada_table_taep_fee", "fee_conflict"]
fields = [f for f in fields if f not in ("payer_el", "requires_payer")] + \
         ["payer_el", "requires_payer"]

changed = []
conflicts = []
for row in rows:
    code = row["code_new"]
    previous = row["registration_fee_eur"]

    row["previous_registration_fee_eur"] = previous
    row["registration_fee_eur"] = FEE_CATEGORIES.get(code, "0.00")
    row["fee_status"] = "SET"
    row["fee_source"] = RULING
    row["tariff_applies"] = "TRUE" if code in TARIFF_CATEGORIES else "FALSE"
    row["registration_deposit_eur"] = DEPOSITS.get(code, "")

    from_table = table.get(code)
    row["monada_table_taep_fee"] = "" if from_table is None else str(from_table)
    # A conflict now means our applied fee still disagrees with their table. After the
    # 29/09 answer the only remaining difference is 600, where the table's €100 is the
    # deposit rather than a fee — so that one is expected and not flagged.
    applied = Decimal(row["registration_fee_eur"])
    tabled = Decimal(str(from_table)) if isinstance(from_table, (int, float)) else None
    conflicting = (tabled is not None and tabled != applied and code not in DEPOSITS)
    row["fee_conflict"] = "TRUE" if conflicting else "FALSE"
    if conflicting:
        conflicts.append((code, row["name_el"], from_table, applied))

    payer = str(authority.get(code, "")).strip()
    row["payer_el"] = payer
    row["requires_payer"] = "FALSE" if (not payer or payer in SELF_SETTLING) else "TRUE"

    if previous not in ("", "0.00") and row["registration_fee_eur"] != previous:
        changed.append((code, row["name_el"], previous, row["registration_fee_eur"]))

with open(PATH, "w", encoding="utf-8", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

print(f"updated {PATH.relative_to(ROOT)} ({len(rows)} categories)")
print(f"  tariff_applies TRUE : {', '.join(sorted(TARIFF_CATEGORIES))}")
print(f"  deposit recorded    : {', '.join(f'{k} €{v}' for k, v in DEPOSITS.items())}")
fees = {r["code_new"]: r["registration_fee_eur"] for r in rows
        if r["registration_fee_eur"] != "0.00"}
print(f"  registration fee non-zero : "
      f"{', '.join(f'{k} €{v}' for k, v in sorted(fees.items())) or 'none'}")
payers = {}
for r in rows:
    if r["requires_payer"] == "TRUE":
        payers.setdefault(r["payer_el"], []).append(r["code_new"])
print(f"  third-party payers        : {len([r for r in rows if r['requires_payer'] == 'TRUE'])} categories")
for payer, codes in sorted(payers.items()):
    print(f"    {payer:<26} {', '.join(codes)}")
if changed:
    print("  fee changed from the original file by ruling:")
    for code, name, previous, now in changed:
        print(f"    {code} {name[:38]:<40} €{previous} -> €{now}")
if conflicts:
    print("\n  STILL DISAGREEING with the Μονάδα's own fee table:")
    for code, name, value, applied in conflicts:
        print(f"    {code} {name[:38]:<40} table €{value}  vs  applied €{applied}")
