# -*- coding: utf-8 -*-
"""
Builds seed/tariff.csv — the ΤΑΕΠ tariff as structured rows.

Multi-tier prices are split here, not by hand (brief §4.3). The tier labels come
from the Μονάδα's ruling of 23/09/2026, item 5:

    SHSO-ER16  κατηγορία 1: Θεραπευτικό πλύσιμο οργάνου (πλύση)   €50
               κατηγορία 2: πλύση οφθαλμού 3 ώρες                 €120
               κατηγορία 3: Παρουσία οφθαλμιάτρου                 €200

SHSO-ER2's three tiers are named in its own description and need no ruling.

    python3 tools/build_tariff.py
"""
import csv
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "seed"

import sys
sys.path.insert(0, str(ROOT))
from taep import parse_tariff_price, money  # noqa: E402

# code -> [(suffix, tier label, amount, price_type)]
TIER_SPLITS = {
    "SHSO-ER2": [
        ("A", "Κάθε ουσία", "15.00", "fixed"),
        ("B", "Πενταπλό", "60.00", "fixed"),
        ("C", "Δεκαπλό", "70.00", "fixed"),
    ],
    "SHSO-ER16": [
        ("A", "Θεραπευτικό πλύσιμο οργάνου (πλύση)", "50.00", "fixed_plus_consumables"),
        ("B", "Πλύση οφθαλμού, 3 ώρες", "120.00", "fixed_plus_consumables"),
        ("C", "Παρουσία οφθαλμιάτρου", "200.00", "fixed_plus_consumables"),
    ],
}
RULING = "Μονάδα Ελέγχου Εσόδων 23/09/2026"

rows = list(csv.DictReader(open(SEED / "extra_charges.csv", encoding="utf-8")))
out = []
split_count = 0

for row in rows:
    code = row["code"].strip()
    if code in TIER_SPLITS:
        split_count += 1
        for suffix, label, amount, price_type in TIER_SPLITS[code]:
            out.append({
                "code": f"{code}-{suffix}",
                "parent_code": code,
                "group_el": row["group_el"],
                "description_el": f"{row['service_el']} — {label}",
                "tier_label_el": label,
                "price_type": price_type,
                "base_amount": amount,
                "hourly_amount": "",
                "price_raw": row["price_raw"],
                "load_status": "SPLIT",
                "source": RULING,
            })
        continue

    price_type, base, hourly, status = parse_tariff_price(code, row["price_raw"])
    out.append({
        "code": code,
        "parent_code": "",
        "group_el": row["group_el"],
        "description_el": row["service_el"],
        "tier_label_el": "",
        "price_type": price_type,
        "base_amount": "" if base is None else f"{money(base):.2f}",
        "hourly_amount": "" if hourly is None else f"{money(hourly):.2f}",
        "price_raw": row["price_raw"],
        "load_status": status,
        "source": "",
    })

path = SEED / "tariff.csv"
with open(path, "w", encoding="utf-8", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=list(out[0]))
    writer.writeheader()
    writer.writerows(out)

unresolved = [r for r in out if r["load_status"] not in ("OK", "SPLIT")]
print(f"wrote {path.relative_to(ROOT)}: {len(out)} rows from {len(rows)} source rows "
      f"({split_count} split into tiers)")
print(f"  unresolved: {len(unresolved)}")
for r in unresolved:
    print(f"    {r['code']} {r['load_status']} {r['price_raw'][:50]}")
