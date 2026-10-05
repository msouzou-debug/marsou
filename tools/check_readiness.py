# -*- coding: utf-8 -*-
"""
Go-live readiness check, from the command line.

Self-contained on purpose: it imports taep.py and nothing else from this repository, so
it can be copied to the eFinance server on its own. The test harness is NOT a dependency
— an earlier version imported it, which made this script impossible to run where it is
actually needed.

Run it after installing, once per hospital, before letting a clerk near it. Exits
non-zero if anything blocks, so it works inside a deploy script.

    FINANCE_DB=/opt/finance/finance.db python3 check_readiness.py     # SQLite
    python3 check_readiness.py --mysql                                # settings.json
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))            # when copied beside taep.py
sys.path.insert(0, str(HERE.parent))     # when run from the repository

import taep   # noqa: E402


def sqlite_db(path):
    import sqlite3

    def db_execute(sql, params=None, fetch=False, lastrowid=False):
        sql = sql.replace("%s", "?")
        conn = sqlite3.connect(path, timeout=30)
        conn.row_factory = lambda cursor, row: {
            col[0]: row[i] for i, col in enumerate(cursor.description)}
        try:
            cursor = conn.cursor()
            cursor.execute(sql, params or ())
            if fetch:
                rows = cursor.fetchall()
                cursor.close()
                return rows
            if lastrowid:
                rid = cursor.lastrowid
                conn.commit()
                cursor.close()
                return rid
            conn.commit()
            cursor.close()
        finally:
            conn.close()

    return db_execute


def mysql_db(settings):
    """Read-only use of eFinance's own MySQL settings. Same shape as its db_execute."""
    import mysql.connector

    config = {
        "host": settings["db_host"],
        "port": int(settings.get("db_port", 3306)),
        "user": settings["db_user"],
        "password": settings["db_pass"],
        "database": settings["db_name"],
        "connection_timeout": 10,
    }

    def db_execute(sql, params=None, fetch=False, lastrowid=False):
        conn = mysql.connector.connect(**config)
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute(sql, params or ())
            if fetch:
                rows = cursor.fetchall()
                cursor.close()
                return rows
            if lastrowid:
                rid = cursor.lastrowid
                conn.commit()
                cursor.close()
                return rid
            conn.commit()
            cursor.close()
        finally:
            conn.close()

    return db_execute


def resolve_database():
    """Pick the database the same way eFinance does: settings.json, else SQLite."""
    override = os.environ.get("FINANCE_DB")
    if override:
        return sqlite_db(override), f"SQLite {override}"

    settings_path = Path(os.environ.get("FINANCE_SETTINGS",
                                        "/opt/finance/settings.json"))
    if settings_path.exists():
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        if settings.get("db_host"):
            return (mysql_db(settings),
                    f"MySQL {settings['db_name']} @ {settings['db_host']}")
        local = settings_path.parent / "finance.db"
        if local.exists():
            return sqlite_db(str(local)), f"SQLite {local}"

    return None, None


def main():
    db_execute, described = resolve_database()
    if db_execute is None:
        print("Δεν βρέθηκε βάση δεδομένων.\n"
              "Ορίστε FINANCE_DB=/διαδρομή/finance.db ή "
              "FINANCE_SETTINGS=/opt/finance/settings.json.", file=sys.stderr)
        return 2

    print(f"Έλεγχος: {described}\n")
    ctx = {"db_execute": db_execute, "log_activity": lambda *a, **k: None}

    try:
        findings = taep.readiness_report(ctx)
    except Exception as exc:
        print(f"Ο έλεγχος απέτυχε: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    for finding in findings:
        marker = "ΕΜΠΟΔΙΟ " if finding["level"] == "blocker" else "ΠΡΟΣΟΧΗ "
        print(f"  {marker} [{finding['check']}] {finding['detail']}")
    if not findings:
        print("  Όλοι οι έλεγχοι πέρασαν.")

    print(f"\n{taep.readiness_summary(findings)}")
    return 1 if any(f["level"] == "blocker" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
