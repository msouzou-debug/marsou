# -*- coding: utf-8 -*-
"""
Shows what the server holds for one ΤΑΕΠ episode: services, extra charges, stored result.

For support questions of the form "I entered X and the screen shows Y". The screen is
rendered from these rows, so this separates "it was never stored" from "it was stored and
is not being shown" — two faults with nothing in common.

    sudo -u finance python3 /opt/finance/show_episode.py /opt/finance/finance.db <search>

<search> is an identification number, an episode number, a costing number, or the
internal id. Every episode that matches is shown, newest first, at most five.

Read-only: opens the database with mode=ro and writes nothing.
"""
import os
import sqlite3
import sys


def rows(conn, sql, params=()):
    return conn.execute(sql, params).fetchall()


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 1
    path, search = argv[0], argv[1].strip()
    if not os.path.exists(path):
        raise SystemExit("Δεν βρέθηκε: %s" % path)

    conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=30)
    conn.row_factory = lambda cursor, row: {
        col[0]: row[i] for i, col in enumerate(cursor.description)}

    episodes = rows(conn, """
        SELECT e.id, e.episode_number, e.id_type, e.id_number, e.status, e.revision,
               e.entity_code, e.examination_at, e.updated_at, e.diagnosis_code,
               c.code_new AS category, c.tariff_applies, n.costing_number
          FROM taep_episode e
          LEFT JOIN taep_financial_category c ON c.id = e.financial_category_id
          LEFT JOIN taep_costing_number n ON n.episode_id = e.id
         WHERE e.id_number = ? OR e.episode_number = ? OR n.costing_number = ?
               OR CAST(e.id AS TEXT) = ?
         ORDER BY e.updated_at DESC LIMIT 5""", (search, search, search, search))

    if not episodes:
        print("Καμία καταχώρηση για «%s»." % search)
        return 1

    for e in episodes:
        print("=" * 72)
        print("Καταχώρηση #%s  επεισόδιο %s  κοστολόγηση %s"
              % (e["id"], e["episode_number"], e["costing_number"] or "—"))
        print("  %s %s · κατηγορία %s (χρεώσεις τιμοκαταλόγου: %s) · %s · έκδοση %s"
              % (e["id_type"], e["id_number"], e["category"],
                 "ναι" if e["tariff_applies"] else "όχι", e["status"],
                 e["revision"] or 1))
        print("  εξέταση %s · τελευταία αλλαγή %s · διάγνωση %s"
              % (e["examination_at"], e["updated_at"], e["diagnosis_code"] or "—"))

        services = rows(conn, """
            SELECT s.service_code, t.service_type, t.category, s.added_at
              FROM taep_episode_service s
              LEFT JOIN taep_service t ON t.code = s.service_code
             WHERE s.episode_id = ? ORDER BY t.service_type, s.service_code""",
                        (e["id"],))
        print("\n  Υπηρεσίες (%d):" % len(services))
        for s in services:
            print("    %-8s %-13s κατ.%s  καταχωρήθηκε %s"
                  % (s["service_code"], s["service_type"], s["category"], s["added_at"]))

        lines = rows(conn, """
            SELECT t.code, l.radiology_cpt, l.quantity, l.line_total, l.suppressed,
                   l.added_at
              FROM taep_episode_tariff_line l
              LEFT JOIN taep_tariff t ON t.id = l.tariff_id
             WHERE l.episode_id = ? ORDER BY l.id""", (e["id"],))
        print("\n  Επιπλέον χρεώσεις αποθηκευμένες (%d):" % len(lines))
        for l in lines:
            print("    %-10s εξέταση %-8s ποσ. %s  ποσό %s%s  καταχωρήθηκε %s"
                  % (l["code"], l["radiology_cpt"] or "—", l["quantity"],
                     l["line_total"], "  (εκτός)" if l["suppressed"] else "",
                     l["added_at"]))

        result = rows(conn, """SELECT weight, weight_cost, tariff_total, total_cost,
                                      calculated_at
                                 FROM taep_costing_result WHERE episode_id = ?""",
                      (e["id"],))
        # eFinance's own audit table, which the module writes through ctx['log_activity'].
        # Read defensively: its columns are eFinance's, not ours, and the standalone host
        # keeps its own. Every column is printed rather than guessed at.
        try:
            log = rows(conn, """SELECT * FROM activity_log
                                 WHERE entity_type = 'taep_episode' AND entity_id = ?
                                 ORDER BY rowid DESC LIMIT 12""", (e["id"],))
        except sqlite3.Error:
            log = None
        if log is not None:
            print("\n  Τελευταίες εγγραφές ιστορικού (%d, νεότερη πρώτη):" % len(log))
            for entry in log:
                print("    " + " · ".join(
                    "%s" % value for key, value in entry.items()
                    if key not in ("entity_type", "entity_id") and value not in (None, "")))

        print("\n  Αποθηκευμένος υπολογισμός:")
        if result:
            r = result[0]
            print("    βαρύτητα %s · βαρύτητα € %s · τιμοκατάλογος € %s · σύνολο € %s"
                  % (r["weight"], r["weight_cost"], r["tariff_total"], r["total_cost"]))
            print("    υπολογίστηκε %s" % r["calculated_at"])
        else:
            print("    κανένας")
        print()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
