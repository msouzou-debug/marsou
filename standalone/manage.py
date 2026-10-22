# -*- coding: utf-8 -*-
"""
Accounts for the standalone host.

    python3 manage.py add-user maria "Μαρία Γεωργίου" clerk NGH
    python3 manage.py set-password maria
    python3 manage.py list-users
    python3 manage.py disable-user maria

A password is read from the terminal, never taken as an argument — an argument lands in
the shell history and in the process list.
"""
import getpass
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from werkzeug.security import generate_password_hash   # noqa: E402
import host                                            # noqa: E402


def read_password():
    first = getpass.getpass("Κωδικός: ")
    if len(first) < 10:
        raise SystemExit("Ο κωδικός πρέπει να έχει τουλάχιστον 10 χαρακτήρες.")
    if first != getpass.getpass("Επανάληψη: "):
        raise SystemExit("Οι κωδικοί δεν ταιριάζουν.")
    return generate_password_hash(first)


def main(argv):
    host.init_db()
    db = host.db_execute
    if not argv:
        print(__doc__)
        return 1
    command = argv[0]

    if command == "add-user":
        if len(argv) != 5:
            raise SystemExit("add-user <username> <full name> <role> <hospital>")
        username, full_name, role, hospital = argv[1:]
        if role not in host.ROLES:
            raise SystemExit("Άγνωστος ρόλος. Επιτρεπτοί: %s"
                             % ", ".join(sorted(host.ROLES)))
        if not db("SELECT code FROM host_entity WHERE code=%s", (hospital,),
                  fetch=True):
            raise SystemExit("Άγνωστο νοσηλευτήριο: %s" % hospital)
        if db("SELECT id FROM host_user WHERE username=%s", (username,), fetch=True):
            raise SystemExit("Υπάρχει ήδη χρήστης %s" % username)
        db("""INSERT INTO host_user
              (username, password_hash, full_name, role, hospital_code, active)
              VALUES (%s,%s,%s,%s,%s,1)""",
           (username, read_password(), full_name, role, hospital))
        print("Δημιουργήθηκε ο χρήστης %s (%s, %s)." % (username, role, hospital))
        if role in host.CENTRAL_ROLES:
            print("ΠΡΟΣΟΧΗ: ο ρόλος %s βλέπει ΟΛΑ τα νοσηλευτήρια." % role)
        return 0

    if command == "set-password":
        if len(argv) != 2:
            raise SystemExit("set-password <username>")
        rows = db("SELECT id FROM host_user WHERE username=%s", (argv[1],), fetch=True)
        if not rows:
            raise SystemExit("Δεν βρέθηκε ο χρήστης %s" % argv[1])
        db("UPDATE host_user SET password_hash=%s WHERE id=%s",
           (read_password(), rows[0]["id"]))
        print("Ο κωδικός άλλαξε.")
        return 0

    if command == "disable-user":
        if len(argv) != 2:
            raise SystemExit("disable-user <username>")
        if not db("SELECT id FROM host_user WHERE username=%s", (argv[1],), fetch=True):
            raise SystemExit("Δεν βρέθηκε ο χρήστης %s" % argv[1])
        db("UPDATE host_user SET active=0 WHERE username=%s", (argv[1],))
        print("Ο χρήστης %s απενεργοποιήθηκε." % argv[1])
        return 0

    if command == "list-users":
        rows = db("""SELECT username, full_name, role, hospital_code, active
                     FROM host_user ORDER BY username""", fetch=True) or []
        if not rows:
            print("Κανένας χρήστης. Ξεκινήστε με add-user.")
        for row in rows:
            print("%-14s %-24s %-12s %-5s %s"
                  % (row["username"], row["full_name"] or "", row["role"],
                     row["hospital_code"] or "—",
                     "" if row["active"] else "(ανενεργός)"))
        return 0

    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
