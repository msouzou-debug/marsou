"""
A runnable ΤΑΕΠ environment: SQLite, the module's schema, its seed, and a Flask app.

Used by the pytest fixtures in conftest.py and by tools/make_acceptance_document.py,
which runs the acceptance scenarios outside pytest to generate the signed-off document.
One harness so the two cannot drift.
"""
import sqlite3
import tempfile
from functools import wraps
from pathlib import Path

import taep


def make_db(path):
    """db_execute with eFinance's contract: %s placeholders, dict rows, commit per call."""
    def connect():
        conn = sqlite3.connect(path, detect_types=sqlite3.PARSE_DECLTYPES, timeout=30)
        conn.row_factory = lambda cursor, row: {
            col[0]: row[i] for i, col in enumerate(cursor.description)}
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = OFF")
        conn.execute("PRAGMA busy_timeout = 30000")
        return conn

    def db_execute(sql, params=None, fetch=False, lastrowid=False):
        sql = sql.replace("%s", "?")
        conn = connect()
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


def make_ctx(directory, seed=True):
    """A module ctx with the keys eFinance's DESIGN.md specifies."""
    db_execute = make_db(str(Path(directory) / "taep.db"))
    for statement in taep.SCHEMA_STATEMENTS:
        db_execute(taep.render_schema(statement, use_mysql=False))
    for statement in taep.ALTER_STATEMENTS:
        try:
            db_execute(taep.render_schema(statement, use_mysql=False))
        except Exception:
            pass

    activity = []
    ctx = {
        "db_execute": db_execute,
        "log_activity": lambda entity_type, entity_id, action, details="":
            activity.append((entity_type, entity_id, action, details)),
        "activity_log": activity,
        "user_entity": lambda: "NGH",
        "can_access_entity": lambda code: code == "NGH",
        "has_permission": lambda key: True,
        "ROLES": {"coder": "Κωδικοποιητής"},
        "CENTRAL_ROLES": (),
        "ENTITY_TYPES": {"hospital": "Νοσηλευτήριο"},
    }
    if seed:
        taep.seed(ctx)
    return ctx


def make_app(ctx, directory):
    """A Flask app with the module registered, standing in for eFinance."""
    from flask import Flask, session

    base = Path(directory) / "base_templates"
    base.mkdir(exist_ok=True)
    (base / "base.html").write_text(
        "<!doctype html><html lang='el'><head><meta charset='utf-8'>"
        "<title>{% block title %}{% endblock %}</title></head><body>"
        "{% with messages = get_flashed_messages(with_categories=true) %}"
        "{% for category, message in messages %}"
        "<div class='flash flash-{{ category }}'>{{ message }}</div>"
        "{% endfor %}{% endwith %}"
        "{% block content %}{% endblock %}</body></html>", encoding="utf-8")

    app = Flask("taep_harness",
                template_folder=str(Path(__file__).resolve().parent / "templates"))
    app.secret_key = "harness-only"
    app.jinja_loader.searchpath.append(str(base))

    granted = set()

    def login_required(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if not session.get("user_id"):
                return "unauthorised", 401
            return view(*args, **kwargs)
        return wrapper

    def permission_required(key):
        def decorator(view):
            @wraps(view)
            def wrapper(*args, **kwargs):
                if granted and key not in granted:
                    return "forbidden", 403
                return view(*args, **kwargs)
            return wrapper
        return decorator

    ctx["login_required"] = login_required
    ctx["permission_required"] = permission_required
    ctx["granted_permissions"] = granted

    taep.register(app, ctx)
    app.ctx = ctx
    return app


class Harness:
    """ctx plus a logged-in client, for a scenario to drive."""

    def __init__(self, directory=None, user_id=1, entity="NGH"):
        self._temp = None
        if directory is None:
            self._temp = tempfile.TemporaryDirectory()
            directory = self._temp.name
        self.directory = directory
        self.ctx = make_ctx(directory)
        self.app = make_app(self.ctx, directory)
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess["user_id"] = user_id
            sess["hospital_code"] = entity

    def close(self):
        if self._temp is not None:
            self._temp.cleanup()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
