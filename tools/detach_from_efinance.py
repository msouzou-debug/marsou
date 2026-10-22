# -*- coding: utf-8 -*-
"""
Copies the ΤΑΕΠ data out of eFinance into a standalone database.

Detaching without this loses every issued costing number, and the one rule that has
never bent is that a number is never reissued. The episodes, their results, the number
ledger, the rate history and the parallel-run record all come across; nothing of
eFinance's does.

    python3 detach_from_efinance.py /opt/finance/finance.db /opt/taep/taep.db
    python3 detach_from_efinance.py ... --apply

Reports first and needs --apply to write.

The destination must be a path that does not exist yet. Do NOT start host.py first: its
first run seeds the master data, the copy would then land beside it, and two tariffs in
one table is a worse problem than no tariff at all. Copy first, start the host second —
its seed skips every table that already has rows.
"""
import re
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import taep   # noqa: E402

# Read off the module's own schema rather than typed out here. A hand-kept list drifts:
# the first version of this file named a taep_care_level table that does not exist, and
# because a missing table is skipped quietly, a *misspelled* real one would have been
# skipped just as quietly and its rows left behind.
TABLES = re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)",
                    " ".join(taep.SCHEMA_STATEMENTS))


def columns(conn, table):
    return [row[1] for row in conn.execute("PRAGMA table_info(%s)" % table)]


def main(argv):
    apply_changes = "--apply" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if len(paths) != 2:
        print(__doc__)
        return 1
    source_path, target_path = paths
    if not Path(source_path).exists():
        raise SystemExit("Δεν βρέθηκε η πηγή: %s" % source_path)

    source = sqlite3.connect(source_path)
    target = sqlite3.connect(target_path)
    # Off for the copy: the tables go across in schema order, which is not dependency
    # order, and a parent arriving after its child is not a problem in a bulk restore.
    target.execute("PRAGMA foreign_keys = OFF")

    # The destination must already have the schema — host.py creates it on first run.
    for statement in taep.SCHEMA_STATEMENTS:
        target.execute(taep.render_schema(statement, use_mysql=False))
    for statement in taep.ALTER_STATEMENTS:
        try:
            target.execute(taep.render_schema(statement, use_mysql=False))
        except sqlite3.OperationalError:
            pass
    target.commit()

    plan, skipped = [], []
    for table in TABLES:
        try:
            count = source.execute("SELECT COUNT(*) FROM %s" % table).fetchone()[0]
        except sqlite3.OperationalError:
            skipped.append(table)
            continue
        existing = target.execute("SELECT COUNT(*) FROM %s" % table).fetchone()[0]
        plan.append((table, count, existing))

    if not plan:
        raise SystemExit("Η πηγή %s δεν περιέχει πίνακες ΤΑΕΠ. Λάθος αρχείο;"
                         % source_path)

    width = max(len(t) for t, _, _ in plan)
    print("Από : %s" % source_path)
    print("Προς: %s\n" % target_path)
    for table, count, existing in plan:
        note = "" if existing == 0 else "  ΠΡΟΣΟΧΗ: ο προορισμός έχει ήδη %d" % existing
        print("  %-*s %6d γραμμές%s" % (width, table, count, note))
    if skipped:
        print("\nΔεν υπάρχουν στην πηγή: %s" % ", ".join(skipped))

    occupied = [t for t, _, existing in plan if existing]
    if occupied and not apply_changes:
        print("\nΟ προορισμός δεν είναι κενός. Η αντιγραφή θα προσθέσει γραμμές "
              "δίπλα στις υπάρχουσες, κάτι που για τους αριθμούς κοστολόγησης "
              "είναι λάθος. Αδειάστε τον προορισμό πρώτα.")
    if not apply_changes:
        print("\nΔοκιμαστική εκτέλεση. Ξανατρέξτε με --apply.")
        return 0
    if occupied:
        raise SystemExit("Άρνηση: ο προορισμός έχει ήδη δεδομένα ΤΑΕΠ.")

    moved = 0
    for table, count, _ in plan:
        if not count:
            continue
        names = [c for c in columns(source, table) if c in columns(target, table)]
        joined = ", ".join(names)
        placeholders = ", ".join("?" * len(names))
        rows = source.execute("SELECT %s FROM %s" % (joined, table)).fetchall()
        target.executemany(
            "INSERT INTO %s (%s) VALUES (%s)" % (table, joined, placeholders), rows)
        moved += len(rows)
    target.commit()

    # The one invariant worth re-proving after a move.
    issued = target.execute("SELECT COUNT(*), COUNT(DISTINCT costing_number) "
                            "FROM taep_costing_number").fetchone()
    print("\nΑντιγράφηκαν %d γραμμές." % moved)
    print("Αριθμοί κοστολόγησης: %d, μοναδικοί: %d" % issued)
    if issued[0] != issued[1]:
        print("ΣΦΑΛΜΑ: διπλοί αριθμοί κοστολόγησης μετά την αντιγραφή.")
        return 1
    print("Τρέξτε τώρα τον έλεγχο ετοιμότητας στον νέο προορισμό.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
