# -*- coding: utf-8 -*-
"""
Finds costings that carry an X-ray but no charge for it.

Παναγιώτα Έλληνα confirmed on 05/11/2026 that there is no case where an X-ray is taken
and no charge applies. Since 03/11 the module blocks finalisation of a self-paying
episode that has AED005 «Ακτινογραφία» among its diagnostic interventions and no
SHSO-ER3 charge from the radiology price list — AED005 sets the weight and adds no
money, so the X-ray's price only reaches the costing through that charge.

Everything finalised BEFORE that rule could carry the service without the charge. Those
episodes were priced without the X-ray, and nobody would notice: the total is a valid
number, just a smaller one than it should be.

    sudo -u finance python3 /opt/finance/find_uncharged_xrays.py /opt/finance/finance.db

Read-only. It writes nothing and changes no costing. Each one it lists is for the Μονάδα
to decide on, and the revision screen («Αναθεώρηση») is how a finalised costing is
corrected — one at a time, with a reason recorded, which is the only honest way to
change a number a patient has already been given.
"""
import os
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import taep   # noqa: E402

QUERY = """
    SELECT e.id, e.episode_number, e.entity_code, e.taep_unit_code, e.status,
           e.examination_at, c.code_new AS category, c.name_el AS category_name,
           n.costing_number, r.total_cost
      FROM taep_episode e
      JOIN taep_financial_category c ON c.id = e.financial_category_id
      LEFT JOIN taep_costing_result r ON r.episode_id = e.id
      LEFT JOIN taep_costing_number n ON n.episode_id = e.id
     WHERE c.tariff_applies = 1
       AND e.status <> 'CANCELLED'
       AND EXISTS (SELECT 1 FROM taep_episode_service s
                    WHERE s.episode_id = e.id AND s.service_code = %s)
       AND NOT EXISTS (SELECT 1 FROM taep_episode_tariff_line l
                         JOIN taep_tariff t ON t.id = l.tariff_id
                        WHERE l.episode_id = e.id AND t.code = %s)
     ORDER BY e.examination_at
"""


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 1
    path = argv[0]
    if not os.path.exists(path):
        raise SystemExit("Δεν βρέθηκε: %s" % path)

    service = sorted(taep.RADIOLOGY_CHARGE_COMPULSORY)[0]        # AED005
    charge = taep.RADIOLOGY_SERVICE_CHARGES[service]             # SHSO-ER3

    conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=30)
    conn.row_factory = lambda cursor, row: {
        col[0]: row[i] for i, col in enumerate(cursor.description)}
    rows = conn.execute(QUERY.replace("%s", "?"), (service, charge)).fetchall()
    conn.close()

    print("Υπηρεσία %s (%s) χωρίς χρέωση %s, σε κατηγορίες που δέχονται χρεώσεις:\n"
          % (service, taep.RADIOLOGY_SERVICE_NAMES[service], charge))
    if not rows:
        print("Καμία. Κάθε ακτινογραφία έχει τη χρέωσή της.")
        return 0

    finalised = [r for r in rows if r["status"] == "FINALISED"]
    print("  %-14s %-5s %-11s %-10s %-9s %s"
          % ("Κοστολόγηση", "Νοσ.", "Ημερομηνία", "Κατηγορία", "Σύνολο", "Κατάσταση"))
    for row in rows:
        print("  %-14s %-5s %-11s %-10s %9s %s" % (
            row["costing_number"] or "—",
            row["entity_code"] or "—",
            str(row["examination_at"] or "")[:10],
            row["category"],
            ("%.2f" % float(row["total_cost"])) if row["total_cost"] is not None else "—",
            row["status"]))

    print("\n%d συνολικά, από τις οποίες %d οριστικοποιημένες."
          % (len(rows), len(finalised)))
    if finalised:
        print("Οι οριστικοποιημένες κοστολογήθηκαν χωρίς την ακτινογραφία. Η διόρθωση "
              "γίνεται από την οθόνη αναθεώρησης, μία‑μία και με αιτιολογία — το ποσό "
              "που δόθηκε στον ασθενή δεν αλλάζει σιωπηλά.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
