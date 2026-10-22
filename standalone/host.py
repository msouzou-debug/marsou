# -*- coding: utf-8 -*-
"""
A standalone host for the ΤΑΕΠ costing module.

The module never knew it was inside eFinance. It asks a host for seven things through
`ctx` — a database, login, permissions, the user's hospital, entity access and an audit
log — and this file supplies them. **taep.py is not modified and not copied**: one file,
two hosts. A fork would drift, and the one thing worse than two systems is two systems
that nearly agree about a price.

What this host deliberately does NOT do:

  * Active Directory. Accounts live in its own table with hashed passwords. If this
    becomes permanent, wire it to AD rather than letting a second password store age.
  * Anything beyond ΤΑΕΠ. No invoices, no budget, no vendors.

    python3 host.py                                       # development, port 5055
    gunicorn --workers 1 --bind 0.0.0.0:5055 "host:create_app()"

One gunicorn worker, not four. SQLite takes one writer at a time and the costing-number
allocator reads the last number before writing the next; a second worker would hand two
clerks the same number. Raise the worker count only together with moving to a server
database.
"""
import csv
import datetime as dt
import json
import os
import secrets
import sqlite3
import sys
from functools import wraps
from pathlib import Path

from flask import (Flask, abort, flash, redirect, render_template, request,
                   session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))     # the repository
sys.path.insert(0, str(HERE))            # when deployed beside taep.py

import taep   # noqa: E402

CONFIG = json.loads((HERE / "settings.json").read_text(encoding="utf-8")) \
    if (HERE / "settings.json").exists() else {}
DB_PATH = os.environ.get("TAEP_DB") or CONFIG.get("db_path") or str(HERE / "taep.db")

# Mirrors eFinance's model so the two hosts agree about who may do what. A central role
# sees every hospital; everyone else sees their own.
ROLES = {
    "clerk": "Κωδικοποιητής",
    "cashier": "Ταμίας",
    "rates_admin": "Διαχειριστής Τιμών",
    "admin": "Διαχειριστής",
}
CENTRAL_ROLES = ("admin",)
ROLE_PERMISSIONS = {
    "clerk": ("taep.view", "taep.create", "taep.finalise"),
    "cashier": ("taep.view",),
    "rates_admin": ("taep.view", "taep.rates"),
    "admin": tuple(taep.PERMISSIONS.values()),
}

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS host_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(60) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(120),
        role VARCHAR(30) NOT NULL,
        hospital_code VARCHAR(10),
        active TINYINT DEFAULT 1
    )""",
    """CREATE TABLE IF NOT EXISTS host_entity (
        code VARCHAR(10) PRIMARY KEY,
        name_el VARCHAR(200) NOT NULL,
        entity_type VARCHAR(20),
        sort_order INT
    )""",
    """CREATE TABLE IF NOT EXISTS host_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type VARCHAR(40),
        entity_id INT,
        action VARCHAR(40),
        details TEXT,
        user_id INT,
        at DATETIME
    )""",
]


def make_db(path):
    """db_execute with eFinance's contract: %s placeholders, dict rows, commit per call.

    Deliberately identical in shape to eFinance's, including committing per call. The
    module was written against that constraint — the costing-number allocator in
    particular depends on it — so a host that held transactions open would be a
    different system wearing the same code.
    """
    def db_execute(sql, params=None, fetch=False, lastrowid=False):
        sql = sql.replace("%s", "?")
        conn = sqlite3.connect(path, timeout=30)
        conn.row_factory = lambda cursor, row: {
            col[0]: row[i] for i, col in enumerate(cursor.description)}
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 30000")
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


_db = make_db(DB_PATH)


def db_execute(sql, params=None, fetch=False, lastrowid=False):
    """The one db_execute everything holds, including ctx, so use_database() below can
    repoint the host at another file without anything going stale."""
    return _db(sql, params, fetch, lastrowid)


def use_database(path):
    """Point the host at a database file. Called by the tests and by
    tools/detach_from_efinance.py; a deployment sets TAEP_DB or settings.json instead."""
    global DB_PATH, _db
    DB_PATH = str(path)
    _db = make_db(DB_PATH)
    return db_execute


def init_db():
    for statement in SCHEMA:
        db_execute(statement)
    for statement in taep.SCHEMA_STATEMENTS:
        db_execute(taep.render_schema(statement, use_mysql=False))
    for statement in taep.ALTER_STATEMENTS:
        try:
            db_execute(taep.render_schema(statement, use_mysql=False))
        except Exception:
            pass                      # the column is already there

    if not db_execute("SELECT code FROM host_entity LIMIT 1", fetch=True):
        path = Path(taep.SEED_DIR) / "entities.csv"
        with open(path, encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                db_execute("""INSERT INTO host_entity
                              (code, name_el, entity_type, sort_order)
                              VALUES (%s,%s,%s,%s)""",
                           (row["code"], row["name_el"], row["type"],
                            int(row["sort_order"])))


def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    rows = db_execute("SELECT * FROM host_user WHERE id=%s AND active=1",
                      (uid,), fetch=True)
    return rows[0] if rows else None


def has_permission(key):
    user = current_user()
    if not user:
        return False
    return key in ROLE_PERMISSIONS.get(user["role"], ())


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_user():
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapper


def permission_required(key):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if not current_user():
                return redirect(url_for("login", next=request.path))
            if not has_permission(key):
                flash("Δεν έχετε δικαίωμα πρόσβασης.", "danger")
                return redirect(url_for("home"))
            return view(*args, **kwargs)
        return wrapper
    return decorator


def user_entity():
    user = current_user()
    return user["hospital_code"] if user else None


def can_access_entity(code):
    user = current_user()
    if not user:
        return False
    if user["role"] in CENTRAL_ROLES:
        return True
    return bool(code) and code == user["hospital_code"]


def log_activity(entity_type, entity_id, action, details=""):
    db_execute("""INSERT INTO host_activity
                  (entity_type, entity_id, action, details, user_id, at)
                  VALUES (%s,%s,%s,%s,%s,%s)""",
               (entity_type, entity_id, action, details,
                session.get("user_id"), dt.datetime.now()))


ctx = {
    "db_execute": db_execute,
    "login_required": login_required,
    "permission_required": permission_required,
    "has_permission": has_permission,
    "user_entity": user_entity,
    "can_access_entity": can_access_entity,
    "log_activity": log_activity,
    "ROLES": ROLES,
    "CENTRAL_ROLES": CENTRAL_ROLES,
    "ENTITY_TYPES": {"hospital": "Νοσηλευτήριο", "central": "Κεντρικά Γραφεία"},
}


def create_app():
    app = Flask(__name__, template_folder=str(HERE / "templates"))
    app.secret_key = CONFIG.get("secret_key") or os.environ.get("TAEP_SECRET")
    if not app.secret_key:
        # A fresh key per process means every restart signs everyone out, and the
        # operator blames the network. Loud, because the symptom points elsewhere.
        app.secret_key = secrets.token_hex(32)
        print("ΠΡΟΣΟΧΗ: δεν βρέθηκε secret_key. Οι συνεδρίες θα χάνονται σε κάθε "
              "επανεκκίνηση. Ορίστε secret_key στο settings.json.", file=sys.stderr)
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    # True behind nginx/TLS, which is how this is meant to run. The trap: with it on,
    # a browser sent to plain http://host:5055 will log in and bounce straight back to
    # the login screen, because the cookie is never stored.
    app.config["SESSION_COOKIE_SECURE"] = bool(CONFIG.get("cookie_secure", False))

    # The module's own templates live beside it, not here.
    app.jinja_loader.searchpath.append(str(HERE.parent / "templates"))
    app.jinja_env.globals["current_user"] = current_user

    init_db()
    taep.seed(ctx)

    @app.route("/")
    @login_required
    def home():
        if has_permission("taep.create"):
            return redirect(url_for("taep_new"))
        return redirect(url_for("taep_list"))

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = (request.form.get("username") or "").strip()
            rows = db_execute(
                "SELECT * FROM host_user WHERE username=%s AND active=1",
                (username,), fetch=True)
            user = rows[0] if rows else None
            if user and check_password_hash(user["password_hash"],
                                            request.form.get("password") or ""):
                session.clear()
                session["user_id"] = user["id"]
                session["role"] = user["role"]
                session["hospital_code"] = user["hospital_code"]
                log_activity("host_user", user["id"], "LOGIN", username)
                return redirect(request.args.get("next") or url_for("home"))
            # One message for a wrong name and a wrong password, so neither can be
            # confirmed by trying.
            flash("Λάθος όνομα χρήστη ή κωδικός.", "danger")
        return render_template("login.html")

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    taep.register(app, ctx)
    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0",
                     port=int(os.environ.get("PORT", 5055)), debug=False)
