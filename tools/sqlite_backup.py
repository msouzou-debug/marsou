# -*- coding: utf-8 -*-
"""
A consistent copy of a SQLite database, without the sqlite3 command line tool.

    python3 sqlite_backup.py /opt/finance/finance.db /tmp/finance-snapshot.db

The sqlite3 CLI is not installed on 10.227.56.22 and `cp` is not a substitute: the
database runs in WAL mode, so a plain copy can catch a half-written transaction and
miss everything still in the -wal file. Python's own sqlite3 exposes the same online
backup API that `.backup` uses, and it is in the standard library, so it is already
there wherever the application runs.

Refuses to overwrite, because the usual use of this is making the copy you are about
to trust.
"""
import os
import sqlite3
import sys


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 1
    source_path, target_path = argv
    if not os.path.exists(source_path):
        raise SystemExit("Δεν βρέθηκε η πηγή: %s" % source_path)
    if os.path.exists(target_path):
        raise SystemExit("Υπάρχει ήδη: %s. Σβήστε το ή δώστε άλλο όνομα."
                         % target_path)

    source = sqlite3.connect("file:%s?mode=ro" % source_path, uri=True)
    target = sqlite3.connect(target_path)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()

    # Prove the copy opens and reports the same number of tables before saying so.
    def tables(path):
        conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
        try:
            return sorted(row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"))
        finally:
            conn.close()

    before, after = tables(source_path), tables(target_path)
    print("%s → %s" % (source_path, target_path))
    print("Μέγεθος: %.1f MB" % (os.path.getsize(target_path) / 1048576.0))
    print("Πίνακες: %d στην πηγή, %d στο αντίγραφο" % (len(before), len(after)))
    if before != after:
        print("ΣΦΑΛΜΑ: οι πίνακες δεν ταιριάζουν. Μη χρησιμοποιήσετε το αντίγραφο.")
        return 1
    print("Το αντίγραφο ανοίγει και συμφωνεί με την πηγή.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
