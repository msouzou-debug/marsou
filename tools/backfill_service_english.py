# -*- coding: utf-8 -*-
"""
Fills taep_service.description_en on a database that was seeded before the column existed.

seed() only loads a table when it is empty, so an installation seeded before 21/10/2026
has all 125 services with no English description. The ALTER adds the column; nothing
fills it. Until it is filled, searching a service by its English term finds nothing —
and the codes are English, so that is the term half the desk will reach for.

Self-contained, like check_readiness.py: it imports taep.py and reads seed/services.csv,
and needs nothing else from the repository.

    python3 backfill_service_english.py              # says what it would do
    python3 backfill_service_english.py --apply      # does it

Safe to run twice. Only rows with no English are touched, and the Greek description is
never written to.
"""
import csv
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))            # when copied beside taep.py
sys.path.insert(0, str(HERE.parent))     # when run from the repository

import taep   # noqa: E402

try:                                     # the helpers already written for the server
    from check_readiness import resolve_database
except ImportError:                      # running from the repository
    sys.path.insert(0, str(HERE))
    from check_readiness import resolve_database


def seed_rows():
    """code -> English description, from the file the module seeds from."""
    path = Path(taep.SEED_DIR) / "services.csv"
    if not path.exists():
        raise SystemExit("Δεν βρέθηκε το %s" % path)
    with open(path, encoding="utf-8") as handle:
        return {row["code"].strip(): (row.get("description_en") or "").strip()
                for row in csv.DictReader(handle)}


def main(argv):
    apply_changes = "--apply" in argv
    db, label = resolve_database()
    if db is None:
        print("Δεν βρέθηκε βάση δεδομένων.")
        print("Ορίστε FINANCE_DB=/διαδρομή/finance.db ή "
              "FINANCE_SETTINGS=/opt/finance/settings.json.")
        return 2
    print("Βάση: %s" % label)

    try:
        db("SELECT description_en FROM taep_service LIMIT 1", fetch=True)
    except Exception:
        print("Η στήλη description_en δεν υπάρχει ακόμη.")
        print("Επανεκκινήστε το eFinance πρώτα — το ALTER εκτελείται στην εκκίνηση.")
        return 2

    english = seed_rows()
    rows = db("SELECT code, description_en FROM taep_service", fetch=True) or []
    if not rows:
        print("Ο πίνακας taep_service είναι κενός — δεν έχει εκτελεστεί το seed.")
        return 2

    todo, unknown, already = [], [], 0
    for row in rows:
        code = row["code"]
        if (row["description_en"] or "").strip():
            already += 1
            continue
        if code not in english:
            unknown.append(code)
            continue
        if english[code]:
            todo.append((english[code], code))

    print("Υπηρεσίες στη βάση            : %d" % len(rows))
    print("Έχουν ήδη αγγλική περιγραφή   : %d" % already)
    print("Θα συμπληρωθούν               : %d" % len(todo))
    if unknown:
        # Not fatal, but it means the table and the CSV have drifted apart and someone
        # should know which way.
        print("ΠΡΟΣΟΧΗ: %d κωδικοί της βάσης δεν υπάρχουν στο services.csv: %s"
              % (len(unknown), ", ".join(sorted(unknown)[:10])))

    if not todo:
        print("\nΔεν υπάρχει τίποτα να γίνει.")
        return 0

    if not apply_changes:
        for value, code in todo[:5]:
            print("   %-10s -> %s" % (code, value[:60]))
        if len(todo) > 5:
            print("   … και άλλες %d" % (len(todo) - 5))
        print("\nΔοκιμαστική εκτέλεση. Ξανατρέξτε με --apply για να γραφτούν.")
        return 0

    for value, code in todo:
        # Only where it is still empty, so a concurrent run cannot overwrite.
        db("""UPDATE taep_service SET description_en = %s
              WHERE code = %s AND (description_en IS NULL OR description_en = '')""",
           (value, code))

    check = db("""SELECT COUNT(*) AS n FROM taep_service
                  WHERE description_en IS NOT NULL AND description_en <> ''""",
               fetch=True)[0]["n"]
    print("\nΣυμπληρώθηκαν %d. Σύνολο με αγγλική περιγραφή: %d από %d."
          % (len(todo), check, len(rows)))
    return 0 if check == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
