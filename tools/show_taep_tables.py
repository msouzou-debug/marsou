# -*- coding: utf-8 -*-
"""
Lists the ΤΑΕΠ tables in a database, with a row count each.

    python3 show_taep_tables.py /opt/finance/finance.db

This exists because the one-liner it replaces could not be typed. The route to that
server is PowerShell, then ssh, then bash, then Python, and a quote or a semicolon has
to survive all four — it does not. A file has no quotes.

The sqlite3 command line tool is not installed on 10.227.56.22; python3 is, because
eFinance runs on it.
"""
import os
import re
import sqlite3
import sys
from pathlib import Path

# Read off the schema rather than typed, so adding a table does not leave this script
# warning about a count that is correct.
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import taep                                                            # noqa: E402

EXPECTED = len(re.findall(r"CREATE TABLE IF NOT EXISTS taep_\w+",
                          " ".join(taep.SCHEMA_STATEMENTS)))


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 1
    path = argv[0]
    if not os.path.exists(path):
        raise SystemExit("Δεν βρέθηκε: %s" % path)

    conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    names = sorted(row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")
        if row[0].startswith("taep_"))
    width = max([len(n) for n in names] or [1])
    for name in names:
        count = conn.execute("SELECT COUNT(*) FROM %s" % name).fetchone()[0]
        print("  %-*s %8d" % (width, name, count))
    conn.close()

    print("\n%d πίνακες ΤΑΕΠ." % len(names))
    if "taep_parallel_check" in names:
        print("Η παράλληλη λειτουργία είναι εγκατεστημένη.")
    else:
        print("ΛΕΙΠΕΙ το taep_parallel_check: η παράλληλη λειτουργία δεν έχει "
              "εγκατασταθεί, ή η υπηρεσία δεν έχει επανεκκινήσει.")
        return 1
    if len(names) != EXPECTED:
        print("ΠΡΟΣΟΧΗ: περίμενα %d πίνακες. Ελέγξτε την έκδοση του taep.py."
              % EXPECTED)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
