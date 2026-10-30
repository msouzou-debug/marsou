# -*- coding: utf-8 -*-
"""
Why the ICD-10 box is empty: the server half of the answer.

Reported 30/10/2026 — the diagnosis dropdown on the entry screen does nothing. That
box is the only thing in ΤΑΕΠ that asks the server per keystroke, so it is the only
thing that can fail this way, and there are three places it can break: the catalogue
never loaded, it loaded without the folded search column, or the search itself returns
nothing. This answers all three against the live database, read-only.

    sudo -u finance python3 /opt/finance/check_diagnosis_search.py /opt/finance/finance.db

It writes nothing. If every line below says OK, the server is fine and the fault is in
the browser — open /taep/api/diagnoses?q=πνευμον while logged in and read what comes
back.
"""
import os
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))            # when copied beside taep.py
sys.path.insert(0, str(HERE.parent))     # when run from the repository

import taep   # noqa: E402

# Greek and English, a code, and a word that is in the catalogue in both languages, so
# a failure says which half is wrong rather than only that something is.
PROBES = ["J18", "j18.9", "I10", "πνευμον", "ΠΝΕΥΜΟΝ", "pneumon", "διαβητ"]


def read_only(path):
    def db_execute(sql, params=None, fetch=False, lastrowid=False):
        conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=30)
        conn.row_factory = lambda cursor, row: {
            col[0]: row[i] for i, col in enumerate(cursor.description)}
        try:
            cursor = conn.cursor()
            cursor.execute(sql.replace("%s", "?"), params or ())
            return cursor.fetchall() if fetch else None
        finally:
            conn.close()
    return db_execute


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 1
    path = argv[0]
    if not os.path.exists(path):
        raise SystemExit("Δεν βρέθηκε: %s" % path)

    db = read_only(path)
    ctx = {"db_execute": db}
    problems = 0

    total = db("SELECT COUNT(*) AS n FROM taep_diagnosis", fetch=True)[0]["n"]
    active = db("SELECT COUNT(*) AS n FROM taep_diagnosis WHERE active = 1",
                fetch=True)[0]["n"]
    folded = db("SELECT COUNT(*) AS n FROM taep_diagnosis "
                "WHERE search_text IS NOT NULL AND search_text <> ''",
                fetch=True)[0]["n"]

    print("1. Ο κατάλογος")
    print("   γραμμές          %6d" % total)
    print("   ενεργές          %6d" % active)
    print("   με search_text   %6d" % folded)
    if total == 0:
        print("   ΕΜΠΟΔΙΟ: ο κατάλογος είναι κενός. Το seed/icd10.csv δεν υπήρχε")
        print("            στην επανεκκίνηση — δες docs/deployment-runbook.md §1c.")
        print("\nΑυτό εξηγεί τα υπόλοιπα, άρα δεν τα ελέγχει.")
        return 1
    elif folded < active:
        print("   ΕΜΠΟΔΙΟ: %d ενεργές γραμμές χωρίς search_text. Η αναζήτηση "
              "ψάχνει σε αυτή τη στήλη, άρα δεν βρίσκει τίποτα." % (active - folded))
        problems += 1
    else:
        print("   OK")

    print("\n2. Η αναζήτηση")
    for term in PROBES:
        hits = taep.search_diagnoses(ctx, term)
        first = ("%s — %s" % (hits[0]["code"], hits[0]["description_el"]))[:46] \
            if hits else "—"
        print("   %-10s %3d  %s" % (term, len(hits), first))
        if not hits:
            problems += 1

    # The catalogue is one file; a code that is missing means the wrong file loaded,
    # which looks exactly like a broken box to a clerk typing that code.
    print("\n3. Η στήλη που διαβάζει η αναζήτηση, σε μία γραμμή")
    row = db("SELECT code, search_text FROM taep_diagnosis WHERE code = %s",
             ("J18.9",), fetch=True)
    if row:
        print("   J18.9  search_text = %r" % row[0]["search_text"][:70])
    else:
        print("   Ο κωδικός J18.9 δεν υπάρχει — λάθος αρχείο φορτώθηκε.")
        problems += 1

    print("\n%s" % ("Ο διακομιστής απαντά σωστά. Το πρόβλημα είναι στον browser: "
                    "άνοιξε\n/taep/api/diagnoses?q=πνευμον συνδεδεμένος και δες τι "
                    "επιστρέφει." if not problems
                    else "%d πρόβλημα(τα) στον διακομιστή — δες πιο πάνω." % problems))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
