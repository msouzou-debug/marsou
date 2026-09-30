# -*- coding: utf-8 -*-
"""
Builds seed/hospitals.csv — the ΤΑΕΠ hospital number for each eFinance entity.

Ruling of 29/09/2026, item 3 gave seven numbers. They map one-to-one onto seven of
the eight hospitals eFinance seeds in its `entities` table. The remaining hospital is
Γενικό Νοσοκομείο Λευκωσίας, and the remaining number is 1054 from the sample
costing document — so 1054 is almost certainly Nicosia General.

That is an inference by elimination, not a ruling, so it is marked
confirmed = FALSE and the costing number for that hospital stays blocked until the
Μονάδα says so in one line. Everything else is confirmed.

Note two naming points for whoever confirms:
  * The Μονάδα's «Κυπερούντας» is eFinance's «Νοσοκομείο Τροόδους» (TRD) — the
    hospital at Kyperounta. Same place, different name.
  * The Μονάδα's «ΤΑΕΠ Παίδων Λευκωσίας» is «Αρχιεπίσκοπος Μακάριος ΙΙΙ» (ARC).

    python3 tools/build_hospitals.py
"""
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULING = "Μονάδα Ελέγχου Εσόδων 29/09/2026"

# eFinance entity code, eFinance name, ΤΑΕΠ number, Μονάδα's name for it, confirmed
HOSPITALS = [
    ("NGH", "Γενικό Νοσοκομείο Λευκωσίας", "1054", "", "FALSE"),
    ("LGH", "Γενικό Νοσοκομείο Λεμεσού", "1047", "Λεμεσός", "TRUE"),
    ("LAR", "Γενικό Νοσοκομείο Λάρνακας", "1048", "Λάρνακα", "TRUE"),
    ("PAP", "Γενικό Νοσοκομείο Πάφου", "1025", "Πάφος", "TRUE"),
    ("FAM", "Γενικό Νοσοκομείο Αμμοχώστου", "1049", "Αμμόχωστος", "TRUE"),
    ("ARC", "Νοσοκομείο Αρχιεπίσκοπος Μακάριος ΙΙΙ", "1106",
     "ΤΑΕΠ Παίδων Λευκωσίας", "TRUE"),
    ("CHR", "Νοσοκομείο Πόλεως Χρυσοχούς", "1026", "Πόλης Χρυσοχούς", "TRUE"),
    ("TRD", "Νοσοκομείο Τροόδους", "1055", "Κυπερούντας", "TRUE"),
]

path = ROOT / "seed" / "hospitals.csv"
with open(path, "w", encoding="utf-8", newline="") as handle:
    writer = csv.writer(handle)
    writer.writerow(["entity_code", "name_el", "taep_number", "monada_name_el",
                     "number_confirmed", "source"])
    for entity, name, number, monada_name, confirmed in HOSPITALS:
        writer.writerow([entity, name, number, monada_name, confirmed,
                         RULING if confirmed == "TRUE" else "inferred by elimination"])

confirmed = [h for h in HOSPITALS if h[4] == "TRUE"]
print(f"wrote {path.relative_to(ROOT)}: {len(HOSPITALS)} hospitals, "
      f"{len(confirmed)} numbers confirmed")
for entity, name, number, monada_name, ok in HOSPITALS:
    mark = "confirmed" if ok == "TRUE" else "INFERRED — needs one line"
    print(f"    {entity:<4} {number}  {name[:38]:<40} {mark}")
print("\n  eFinance seeds 8 hospitals; the build brief says nine. If a ninth exists at")
print("  ΤΑΕΠ it is neither in entities nor in the Μονάδα's list — ask.")
