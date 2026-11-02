# -*- coding: utf-8 -*-
"""
Carries a corrected seed/icd10.csv to a server that already holds the catalogue.

seed() fills a table only when it is empty — correctly, so it cannot overwrite a
deliberate correction. The cost is that a corrected file never reaches an installation
that is already running, and nothing says so.

That matters here more than it looks. On 02/11/2026 the Μονάδα's catalogue was found to
have 34 descriptions with a letter typed on the wrong keyboard: «Tριχομονάδωση» opening
with a Latin T, «Οισοφάγος του Βarrett» with a Greek Β. The two letters are drawn
identically, so nobody could see it — and fold_greek() does not map between alphabets,
so a clerk typing «Τριχ» in Greek never found that diagnosis at all.

    sudo -u finance python3 /opt/finance/sync_diagnoses.py /opt/finance/finance.db
    sudo -u finance python3 /opt/finance/sync_diagnoses.py /opt/finance/finance.db --apply

Reports by default and writes nothing. --apply rewrites description_el, description_en
and the derived search_text for the rows that differ, in one transaction. It never
inserts or deletes a code: a catalogue that has gained or lost diagnoses is a new
delivery from the Μονάδα, not drift, and goes in through the runbook (§1c).
"""
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
        conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=60)
        conn.row_factory = lambda cursor, row: {
            col[0]: row[i] for i, col in enumerate(cursor.description)}
        try:
            return conn.execute(sql.replace("%s", "?"),
                                params or ()).fetchall() if fetch else None
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

    # The comparison lives in taep.diagnosis_text_drift, so readiness and this script
    # cannot disagree about what counts as stale.
    drift = taep.diagnosis_text_drift({"db_execute": read_only(path)})
    if not drift:
        print("Ο κατάλογος διαγνώσεων συμφωνεί με το icd10.csv. Καμία αλλαγή.")
        return 0

    print("%d διαγνώσεις με διαφορετικό κείμενο:" % len(drift))
    for code, stored, want in drift:
        print("  %-8s %s" % (code, want[:60]))
        print("  %-8s (παλιό: %s)" % ("", stored[:60]))

    if not apply_changes:
        print("\nΤίποτα δεν γράφτηκε. Για να εφαρμοστούν: πρόσθεσε --apply")
        return 1

    expected = {row["code"]: row for row in taep._read_seed("icd10.csv")}
    conn = sqlite3.connect(path, timeout=60)
    conn.executemany(
        "UPDATE taep_diagnosis SET description_el = ?, description_en = ?, "
        "search_text = ? WHERE code = ?",
        [(expected[code]["description_el"],
          expected[code]["description_en"],
          taep.fold_greek(" ".join((code, expected[code]["description_el"],
                                    expected[code]["description_en"] or ""))),
          code)
         for code, _stored, _want in drift])
    conn.commit()
    conn.close()
    print("\nΕνημερώθηκαν %d γραμμές, μαζί με τη στήλη αναζήτησης. Δεν χρειάζεται "
          "επανεκκίνηση." % len(drift))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
