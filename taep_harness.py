"""
A runnable ΤΑΕΠ environment: SQLite, the module's schema, its seed, and a Flask app.

Used by the pytest fixtures in conftest.py and by tools/make_acceptance_document.py,
which runs the acceptance scenarios outside pytest to generate the signed-off document.
One harness so the two cannot drift.
"""
import shutil
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


_SEEDED_TEMPLATE = None


def _seeded_template():
    """A seeded database built once per process, for the tests to copy.

    The master data is 10.560 ICD-10 codes, 305 radiology prices, 257 countries, 125
    services and the rest — half a second to load, which was nothing when it was 550
    rows and is a two-minute suite once it is eleven thousand. Seeding once and copying
    the file keeps every test against the real seed rather than a convenient subset.

    Production is unaffected: this is the harness, and taep.seed() still runs exactly as
    it does on the server to build the template in the first place.
    """
    global _SEEDED_TEMPLATE
    if _SEEDED_TEMPLATE is None:
        directory = Path(tempfile.mkdtemp(prefix="taep-seed-"))
        path = directory / "template.db"
        ctx = _make_ctx_at(path, seed=True)
        if not ctx["db_execute"]("SELECT code FROM taep_diagnosis LIMIT 1", fetch=True):
            taep._insert_many(
                ctx["db_execute"], "taep_diagnosis",
                ["code", "description_el", "description_en", "search_text", "active"],
                [(code, greek, english,
                  taep.fold_greek(" ".join((code, greek, english))), 1)
                 for code, greek, english in STAND_IN_DIAGNOSES])
        # Fold the WAL back in, so one file is the whole database to copy.
        ctx["db_execute"]("PRAGMA wal_checkpoint(TRUNCATE)")
        _SEEDED_TEMPLATE = path
    return _SEEDED_TEMPLATE


# A diagnosis is required to finalise (Μονάδα 22/10/2026), so almost every test needs
# one — but the real catalogue is the Μονάδα's translation and is deliberately not in
# this repository, which is public. When it is absent the harness supplies three
# obviously-fake rows instead, so the suite runs on a bare clone. Tests that need the
# real thing skip themselves; see test_taep_diagnosis.py.
STAND_IN_DIAGNOSES = [
    ("ZZZ.1", "Δοκιμαστική διάγνωση — δεν είναι πραγματικός κωδικός ICD-10",
     "Test diagnosis, not a real ICD-10 code"),
    ("ZZZ.2", "Δεύτερη δοκιμαστική διάγνωση", "Second test diagnosis"),
    ("ZZZ.3", "Τρίτη δοκιμαστική διάγνωση", "Third test diagnosis"),
]


def sample_diagnosis(ctx):
    """A diagnosis code that exists in this ctx, real catalogue or not."""
    rows = ctx["db_execute"](
        "SELECT code FROM taep_diagnosis WHERE code='J18.9'", fetch=True)
    return "J18.9" if rows else STAND_IN_DIAGNOSES[0][0]


def make_ctx(directory, seed=True):
    """A module ctx with the keys eFinance's DESIGN.md specifies."""
    path = Path(directory) / "taep.db"
    if seed:
        shutil.copyfile(_seeded_template(), path)
        return _make_ctx_at(path, seed=False)
    return _make_ctx_at(path, seed=False)


def _make_ctx_at(path, seed):
    db_execute = make_db(str(path))
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
    # eFinance's templates call t() for every visible string, keyed on the Greek
    # source. Identity here: the harness has no translation table, and the module's
    # templates must render under the same contract they will meet in production.
    app.jinja_env.globals["t"] = lambda s: s
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

    def has_permission(key):
        """Mirrors eFinance: the real check the module's own decorators consult."""
        return not granted or key in granted

    ctx["login_required"] = login_required
    ctx["permission_required"] = permission_required
    ctx["has_permission"] = has_permission
    ctx["granted_permissions"] = granted

    # The same check the templates get. It used to be `lambda key: True`, which made
    # every permission-gated block in a template permanently visible and therefore
    # untestable — the cancel and delete boxes passed a test that could not have
    # failed. eFinance's base.html calls the real one, so the harness does too. With
    # `granted` empty it still answers True for everything, so nothing else moves.
    app.jinja_env.globals["has_permission"] = has_permission

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
