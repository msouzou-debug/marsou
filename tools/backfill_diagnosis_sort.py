# -*- coding: utf-8 -*-
"""
Fills taep_diagnosis.sort_text on an installation that already holds the catalogue.

The column is added by the ALTER at boot, which leaves it NULL on the 10.560 rows that
were seeded before it existed. Until it is filled, the alphabetical list the ICD-10 box
offers (Παναγιώτα Έλληνα, 02/11/2026) comes back in an arbitrary order, so readiness
reports it as a blocker.

    sudo -u finance python3 /opt/finance/backfill_diagnosis_sort.py /opt/finance/finance.db

One transaction, one connection — 10.560 rows through db_execute would be 10.560
connections, because it commits per call. Idempotent: run it again and it reports
nothing to do. It reads description_el and writes sort_text, and touches nothing else.
"""
import os
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import taep   # noqa: E402


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 1
    path = argv[0]
    if not os.path.exists(path):
        raise SystemExit("Δεν βρέθηκε: %s" % path)

    conn = sqlite3.connect(path, timeout=60)
    rows = conn.execute(
        "SELECT code, description_el FROM taep_diagnosis "
        "WHERE sort_text IS NULL OR sort_text = ''").fetchall()
    if not rows:
        total = conn.execute("SELECT COUNT(*) FROM taep_diagnosis").fetchone()[0]
        print("Καμία γραμμή προς συμπλήρωση — και οι %d έχουν sort_text." % total)
        conn.close()
        return 0

    print("Συμπλήρωση %d γραμμών…" % len(rows))
    conn.executemany("UPDATE taep_diagnosis SET sort_text = ? WHERE code = ?",
                     [(taep.fold_for_sort(description), code)
                      for code, description in rows])
    conn.commit()

    # The first few in the new order, so the operator sees it is alphabetical and not
    # merely non-empty.
    print("\nΗ αρχή του αλφαβητικού καταλόγου:")
    for code, description in conn.execute(
            "SELECT code, description_el FROM taep_diagnosis WHERE active = 1 "
            "ORDER BY sort_text, code LIMIT 5"):
        print("   %-8s %s" % (code, description[:58]))
    conn.close()
    print("\nΈτοιμο. Δεν χρειάζεται επανεκκίνηση.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
