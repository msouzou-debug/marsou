# -*- coding: utf-8 -*-
"""
Builds seed/taep_units.csv — the ΤΑΕΠ units that issue costing numbers.

Ruling of 02/10/2026 settled two things and corrected one of our assumptions.

A ΤΑΕΠ unit is NOT the same thing as a hospital:

  * Γενικό Νοσοκομείο Λευκωσίας runs TWO units — ΤΑΕΠ ενηλίκων (1054) and
    ΤΑΕΠ Παίδων (1106) — on one eFinance entity.
  * Νοσοκομείο Αρχιεπίσκοπος Μακάριος ΙΙΙ runs NO ΤΑΕΠ today. We had mapped 1106
    to it, which was wrong: «Το ΤΑΕΠ παίδων δεν είναι το ΝΑΜ ΙΙΙ αφού αυτή την
    στιγμή είναι στο Γενικό Λευκωσίας. Θα μεταστεγαστεί σύντομα όμως στο ΝΑΜΙΙΙ».

So the costing-number sequence is per UNIT, while access control stays per eFinance
entity — a Nicosia clerk sees Nicosia episodes whichever unit they work in.

Eight units, not the nine the build brief repeats throughout.

The paediatric unit is due to move to Μακάριος ΙΙΙ. That is why host_entity_code
carries valid_from/valid_to: when it moves, close the row and open a new one, exactly
as rates work. Whether the unit keeps number 1106 after the move is the one thing
still to confirm.

    python3 tools/build_taep_units.py
"""
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULING = "Μονάδα Ελέγχου Εσόδων 02/10/2026"

# unit_code, name_el, taep_number, host entity, host valid_from, note
UNITS = [
    ("NIC-ADULT", "Γενικό Νοσοκομείο Λευκωσίας — ΤΑΕΠ ενηλίκων", "1054", "NGH",
     "", "Η Μονάδα αναφέρει τον κωδικό και ως «F1054»· ο αριθμός κοστολόγησης "
     "χρησιμοποιεί το 1054, όπως στο υπόδειγμα."),
    ("NIC-PAED", "ΤΑΕΠ Παίδων Λευκωσίας", "1106", "NGH",
     "", "Στεγάζεται προσωρινά στο Γενικό Λευκωσίας. Μεταστέγαση στο Νοσοκομείο "
     "Αρχιεπίσκοπος Μακάριος ΙΙΙ (ARC) αναμένεται."),
    ("LAR", "Γενικό Νοσοκομείο Λάρνακας", "1048", "LAR", "", ""),
    ("LIM", "Γενικό Νοσοκομείο Λεμεσού", "1047", "LGH", "", ""),
    ("PAF", "Γενικό Νοσοκομείο Πάφου", "1025", "PAP", "", ""),
    ("FAM", "Γενικό Νοσοκομείο Αμμοχώστου", "1049", "FAM", "", ""),
    ("TRD", "Νοσοκομείο Τροόδους", "1055", "TRD",
     "", "Η Μονάδα το αναφέρει ως «Νοσοκομείο Κυπερούντας». Ίδιο νοσηλευτήριο."),
    ("CHR", "Νοσοκομείο Πόλης Χρυσοχού", "1026", "CHR", "", ""),
]

path = ROOT / "seed" / "taep_units.csv"
with open(path, "w", encoding="utf-8", newline="") as handle:
    writer = csv.writer(handle)
    writer.writerow(["unit_code", "name_el", "taep_number", "host_entity_code",
                     "host_valid_from", "host_valid_to", "number_confirmed",
                     "note_el", "source"])
    for unit, name, number, entity, valid_from, note in UNITS:
        writer.writerow([unit, name, number, entity, valid_from, "", "TRUE",
                         note, RULING])

numbers = [u[2] for u in UNITS]
assert len(numbers) == len(set(numbers)), "duplicate ΤΑΕΠ number"
entities = {}
for unit, name, number, entity, _, _ in UNITS:
    entities.setdefault(entity, []).append(number)

print(f"wrote {path.relative_to(ROOT)}: {len(UNITS)} ΤΑΕΠ units across "
      f"{len(entities)} eFinance entities, all numbers confirmed")
for unit, name, number, entity, _, note in UNITS:
    flag = "  <- shares an entity" if len(entities[entity]) > 1 else ""
    print(f"    {number}  {unit:<10} {entity:<4} {name[:44]:<46}{flag}")
print("\n  ARC (Αρχιεπίσκοπος Μακάριος ΙΙΙ) runs no ΤΑΕΠ today; the paediatric unit")
print("  is expected to move there. host_entity_code is effective-dated for that.")
