# -*- coding: utf-8 -*-
"""
Compares the live taep_financial_category rows against seed/financial_categories.csv.

seed() fills a table only when it is empty, which is right — it must not overwrite a
correction somebody made deliberately. The cost is that a CSV fixed after the first
install never reaches the server, and nothing says so.

That is how 30/10/2026 happened: Παναγιώτα Έλληνα reported that the «Επιπλέον Χρεώσεις
ΤΑΕΠ» card does not open for 602 ΕΥΡΩΚΑΡΤΑ. The CSV has carried tariff_applies TRUE for
600, 602 and 640 since 22/09, and the screen has one gate on that column, so a card that
does not open means the live row disagrees with the CSV.

    sudo -u finance python3 /opt/finance/check_category_flags.py /opt/finance/finance.db
    sudo -u finance python3 /opt/finance/check_category_flags.py /opt/finance/finance.db --apply

Reports by default and writes nothing. --apply updates only the columns that differ, one
statement per row, and prints each change. Names and codes are never touched: a
difference there is not drift, it is a question for the Μονάδα.
"""
import csv
import os
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import taep   # noqa: E402

def read_only(path):
    def db_execute(sql, params=None, fetch=False, lastrowid=False):
        conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=30)
        conn.row_factory = lambda cursor, row: {
            col[0]: row[i] for i, col in enumerate(cursor.description)}
        try:
            return conn.execute(sql.replace("%s", "?"), params or ()).fetchall() \
                if fetch else None
        finally:
            conn.close()
    return db_execute


def main(argv):
    apply_changes = "--apply" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if len(paths) != 1:
        print(__doc__)
        return 1
    path = paths[0]
    if not os.path.exists(path):
        raise SystemExit("Δεν βρέθηκε: %s" % path)

    # The comparison itself lives in taep.category_flag_drift, so the readiness screen
    # and this script cannot disagree about what counts as drift.
    drift = taep.category_flag_drift({"db_execute": read_only(path)})
    if not drift:
        print("Όλες οι σημαίες των οικονομικών κατηγοριών συμφωνούν με το CSV των "
              "αποφάσεων. Καμία αλλαγή.")
        return 0

    print("%d διαφορές:" % len(drift))
    for code, column, have, want in drift:
        level = taep.CATEGORY_FLAGS[column]
        print("  %-5s %-16s βάση=%-6s CSV=%-6s (%s)" % (code, column, have, want, level))

    if not apply_changes:
        print("\nΤίποτα δεν γράφτηκε. Για να εφαρμοστούν: πρόσθεσε --apply")
        return 1

    conn = sqlite3.connect(path, timeout=30)
    for code, column, _have, want in drift:
        conn.execute("UPDATE taep_financial_category SET %s = ? WHERE code_new = ?"
                     % column, (want, code))
    conn.commit()
    conn.close()
    print("\nΕφαρμόστηκαν %d αλλαγές. Δεν χρειάζεται επανεκκίνηση — οι οθόνες "
          "διαβάζουν τον πίνακα σε κάθε αίτημα." % len(drift))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
