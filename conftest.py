"""
Test harness: a real SQLite database with the module's own schema and seed.

Mirrors eFinance's dual-mode DB layer closely enough that the SQL in taep.py is the
SQL that runs in production — %s placeholders rewritten to ?, dict rows, foreign keys
and WAL on. Mocking db_execute would let broken SQL pass.
"""
import sqlite3
from datetime import datetime, date

import pytest

import taep


def _make_db(path):
    def connect():
        conn = sqlite3.connect(path, detect_types=sqlite3.PARSE_DECLTYPES, timeout=30)
        conn.row_factory = lambda cursor, row: {
            col[0]: row[i] for i, col in enumerate(cursor.description)}
        conn.execute("PRAGMA foreign_keys = ON")
        # Test-only: WAL plus a relaxed sync keeps the suite fast under the
        # connection-per-call pattern. Production settings live in eFinance's app.py.
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


@pytest.fixture
def ctx(tmp_path):
    """A module ctx with the shape eFinance's DESIGN.md specifies."""
    db_execute = _make_db(str(tmp_path / "test.db"))

    for statement in taep.SCHEMA_STATEMENTS:
        db_execute(taep.render_schema(statement, use_mysql=False))
    for statement in taep.ALTER_STATEMENTS:
        try:
            db_execute(taep.render_schema(statement, use_mysql=False))
        except Exception:
            pass

    activity = []

    return {
        "db_execute": db_execute,
        "log_activity": lambda entity_type, entity_id, action, details="": activity.append(
            (entity_type, entity_id, action, details)),
        "activity_log": activity,
        "user_entity": lambda: "NGH",
        "can_access_entity": lambda code: code == "NGH",
        "has_permission": lambda key: True,
        "ROLES": {"coder": "Κωδικοποιητής"},
        "CENTRAL_ROLES": (),
        "ENTITY_TYPES": {"hospital": "Νοσηλευτήριο"},
    }


@pytest.fixture
def seeded(ctx):
    """ctx with the master data loaded."""
    taep.seed(ctx)
    return ctx
