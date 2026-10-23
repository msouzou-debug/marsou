# -*- coding: utf-8 -*-
"""
What the 22/10/2026 rulings change about costings that are ALREADY in the database.

    FINANCE_DB=/opt/finance/finance.db python3 pre_deploy_check.py

Read-only. Run it before the deploy, because two of the rulings change figures on
records people have already seen, and the Μονάδα should know the scale rather than
discover it from a patient.

  1. The registration fee leaves the total. Every stored costing on a category that
     carries a fee was computed with it included, so its stored total is €10 high.
     Nothing recomputes on its own — a stored result is what the patient was given.
  2. The deposit is no longer assumed. Every existing episode on a deposit category
     gets deposit_confirmed = 0, so the €100 stops being netted off until somebody
     confirms it.
"""
import os
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))


def connect():
    path = os.environ.get("FINANCE_DB")
    if not path:
        raise SystemExit("Ορίστε FINANCE_DB=/opt/finance/finance.db")
    if not os.path.exists(path):
        raise SystemExit("Δεν βρέθηκε: %s" % path)
    conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    conn.row_factory = lambda c, r: {d[0]: r[i] for i, d in enumerate(c.description)}
    return conn


def rows(conn, sql, params=()):
    try:
        return conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError as exc:
        raise SystemExit("Η βάση δεν έχει τους πίνακες ΤΑΕΠ: %s" % exc)


def main():
    conn = connect()
    print("Έλεγχος πριν την εγκατάσταση — %s\n" % os.environ["FINANCE_DB"])

    fee = rows(conn, """
        SELECT e.status, COUNT(*) AS episodes,
               SUM(r.registration_fee_applied) AS fee_total
        FROM taep_episode e
        JOIN taep_costing_result r ON r.episode_id = e.id
        WHERE r.registration_fee_applied > 0
          -- Identify the rows by their arithmetic, not by the category: a result whose
          -- total is weight + tariff + fee was computed under the old rule. One priced
          -- after the deploy carries the same fee and does not add it, so this stays
          -- correct if the script is run afterwards too.
          AND r.total_cost = r.weight_cost + r.tariff_total + r.registration_fee_applied
        GROUP BY e.status ORDER BY e.status""")
    print("1. Τέλος εγγραφής μέσα στο αποθηκευμένο σύνολο")
    if not fee:
        print("   Καμία κοστολόγηση σε κατηγορία με τέλος εγγραφής. Τίποτα να αλλάξει.")
    for row in fee:
        print("   %-18s %4d κοστολογήσεις, %8.2f € συνολικά τέλη μέσα στα σύνολα"
              % (row["status"], row["episodes"], row["fee_total"] or 0))
    if fee:
        print("   Τα αποθηκευμένα σύνολα ΔΕΝ ξαναϋπολογίζονται. Για οριστικοποιημένες,")
        print("   ο ασθενής κρατά έντυπο με το παλιό ποσό: αποφασίστε με τη Μονάδα αν")
        print("   χρειάζεται αναθεώρηση ανά περίπτωση.")

    deposit = rows(conn, """
        SELECT e.status, COUNT(*) AS episodes
        FROM taep_episode e
        JOIN taep_rate t ON t.financial_category_id = e.financial_category_id
        WHERE t.rate_type = 'REGISTRATION_DEPOSIT' AND t.amount > 0
          AND t.valid_to IS NULL
        GROUP BY e.status ORDER BY e.status""")
    print("\n2. Προκαταβολή που θεωρούνταν δεδομένη")
    if not deposit:
        print("   Καμία καταχώρηση σε κατηγορία με προκαταβολή. Τίποτα να αλλάξει.")
    for row in deposit:
        print("   %-18s %4d καταχωρήσεις" % (row["status"], row["episodes"]))
    if deposit:
        print("   Μετά την εγκατάσταση η προκαταβολή δεν αφαιρείται σε καμία από αυτές")
        print("   μέχρι να επιβεβαιωθεί στην οθόνη διόρθωσης.")

    print("\n3. Σύνολο καταχωρήσεων")
    for row in rows(conn, """SELECT status, COUNT(*) AS n FROM taep_episode
                             GROUP BY status ORDER BY status"""):
        print("   %-18s %4d" % (row["status"], row["n"]))
    numbers = rows(conn, """SELECT COUNT(*) AS n, COUNT(DISTINCT costing_number) AS d
                            FROM taep_costing_number""")[0]
    print("   Αριθμοί κοστολόγησης: %d, μοναδικοί: %d" % (numbers["n"], numbers["d"]))
    if numbers["n"] != numbers["d"]:
        print("   ΣΦΑΛΜΑ: διπλοί αριθμοί κοστολόγησης. Σταματήστε και αναφέρετε.")
        return 1
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
