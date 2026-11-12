# -*- coding: utf-8 -*-
"""
Finds costings that carry an imaging service but no charge for it.

Five diagnostic interventions set the weight and add no money of their own — the
examination's price reaches the costing only through an extra charge:

    AED005  Ακτινογραφία                      SHSO-ER3
    AED019  Υπερηχογράφημα                    SHSO-ER4
    AED020  Μαγνητική τομογραφία              SHSO-ER6
    AED021  Αξονική Τομογραφία                SHSO-ER5
    AED022  Τομογραφία Ουροποιογεννητικού     SHSO-ER7   (flat €65)

Παναγιώτα Έλληνα confirmed on 05/11/2026 that there is no case where an X-ray is taken
and no charge applies, and made all five compulsory. Since then the module refuses to
finalise a self-paying episode that has one of these services and not its charge.

Everything finalised BEFORE that could carry the service without the charge. Those
episodes were priced without the examination, and nothing on them shows it: the total is
a valid number, just a smaller one than it should be.

    sudo -u finance python3 /opt/finance/find_uncharged_imaging.py /opt/finance/finance.db

Read-only. It writes nothing and changes no costing. Only categories that accept extra
charges are reported: elsewhere there is no charge to add, so it is not a billing error.

Each one is for the Μονάδα to decide on. The revision screen («Αναθεώρηση») is how a
finalised costing is corrected — one at a time and with a reason, which is the only
honest way to change a number a patient has already been given. Since 05/11/2026 that
screen can change the services themselves as well as the charges.
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
       -- Since 12/11/2026 any examination from the radiology list on the costing
       -- satisfies the four tariff_lookup services, as it does on the screen. The third
       -- parameter is 1 for those four and 0 for AED022.
       AND NOT (%s = 1 AND EXISTS (SELECT 1 FROM taep_episode_tariff_line x
                                    WHERE x.episode_id = e.id
                                      AND COALESCE(x.radiology_cpt, '') <> ''))
     ORDER BY e.examination_at
"""


def params(service):
    """The query's parameters for one compulsory service."""
    return (service, taep.RADIOLOGY_SERVICE_CHARGES[service],
            1 if service in taep.RADIOLOGY_EXAM_SATISFIES else 0)


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 1
    path = argv[0]
    if not os.path.exists(path):
        raise SystemExit("Δεν βρέθηκε: %s" % path)

    conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=30)
    conn.row_factory = lambda cursor, row: {
        col[0]: row[i] for i, col in enumerate(cursor.description)}

    # One pass per pair, so the report is grouped the way the Μονάδα will review it. An
    # episode missing two charges appears under both, which is why the totals at the end
    # count episodes and not rows.
    by_service = {}
    for service in sorted(taep.RADIOLOGY_CHARGE_COMPULSORY):
        charge = taep.RADIOLOGY_SERVICE_CHARGES[service]
        rows = conn.execute(QUERY.replace("%s", "?"),
                            params(service)).fetchall()
        if rows:
            by_service[service] = (charge, rows)
    conn.close()

    if not by_service:
        print("Καμία κοστολόγηση με απεικονιστική υπηρεσία χωρίς τη χρέωσή της.")
        return 0

    header = ("  %-14s %-5s %-11s %-10s %9s  %s"
              % ("Κοστολόγηση", "Νοσ.", "Ημερομηνία", "Κατηγορία", "Σύνολο",
                 "Κατάσταση"))
    episodes, finalised = set(), set()
    for service, (charge, rows) in by_service.items():
        print("\n%s %s — χωρίς χρέωση %s   (%d)"
              % (service, taep.RADIOLOGY_SERVICE_NAMES[service], charge, len(rows)))
        print(header)
        for row in rows:
            episodes.add(row["id"])
            if row["status"] == "FINALISED":
                finalised.add(row["id"])
            print("  %-14s %-5s %-11s %-10s %9s  %s" % (
                row["costing_number"] or "—",
                row["entity_code"] or "—",
                str(row["examination_at"] or "")[:10],
                row["category"],
                ("%.2f" % float(row["total_cost"]))
                if row["total_cost"] is not None else "—",
                row["status"]))

    print("\n%d κοστολογήσεις συνολικά, από τις οποίες %d οριστικοποιημένες."
          % (len(episodes), len(finalised)))
    if finalised:
        print("Οι οριστικοποιημένες κοστολογήθηκαν χωρίς την εξέταση. Η διόρθωση "
              "γίνεται από την οθόνη αναθεώρησης, μία‑μία και με αιτιολογία — το ποσό "
              "που δόθηκε στον ασθενή δεν αλλάζει σιωπηλά.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
