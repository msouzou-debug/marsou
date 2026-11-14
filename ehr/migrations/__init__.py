"""Database migrations without extra dependencies.

A migration is a module `ehr/migrations/NNNN_name.py` with an `upgrade(connection)` function, where NNNN is the
next whole number (0001, 0002 ...). `schema_version` records which ones ran. See README.md in this folder.
Written with SQLAlchemy Core so the same code can run on SQLite, PostgreSQL, MySQL or SQL Server.
"""
import importlib
import pkgutil
import re
from datetime import datetime, timezone

from sqlalchemy.engine import Engine
from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, func, inspect, select

_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+$")
metadata = MetaData()
schema_version = Table(
    "schema_version", metadata,
    Column("version", Integer, primary_key=True, autoincrement=False),
    Column("name", String(120), nullable=False),
    Column("applied_at", DateTime(timezone=True), nullable=False),
)


class Migration:
    def __init__(self, version, name, module):
        self.version, self.name, self.module = version, name, module


def discover():
    """All migrations in this folder, in order. Raises when numbers repeat or skip."""
    found = []
    for info in pkgutil.iter_modules(__path__):
        m = _NAME.match(info.name)
        if not m:
            continue
        module = importlib.import_module("%s.%s" % (__name__, info.name))
        if not callable(getattr(module, "upgrade", None)):
            raise RuntimeError("migration %s has no upgrade(connection)" % info.name)
        found.append(Migration(int(m.group(1)), info.name, module))
    found.sort(key=lambda mig: mig.version)
    for expected, mig in enumerate(found, start=1):
        if mig.version != expected:
            raise RuntimeError("migrations must be numbered 0001, 0002 ... without gaps or repeats; "
                               "expected %04d, found %s" % (expected, mig.name))
    return found


def latest_version():
    found = discover()
    return found[-1].version if found else 0


def current_version(bind):
    """Highest recorded version, 0 when the table is missing or empty. `bind` is an Engine or Connection."""
    if not inspect(bind).has_table("schema_version"):
        return 0
    if isinstance(bind, Engine):
        with bind.connect() as conn:
            return conn.execute(select(func.max(schema_version.c.version))).scalar() or 0
    return bind.execute(select(func.max(schema_version.c.version))).scalar() or 0


def status(bind):
    """(current, latest, pending migrations)."""
    cur = current_version(bind)
    found = discover()
    return cur, (found[-1].version if found else 0), [m for m in found if m.version > cur]


def _record(conn, mig):
    conn.execute(schema_version.insert().values(version=mig.version, name=mig.name, applied_at=datetime.now(timezone.utc)))


def upgrade(engine, log=lambda text: None):
    """Apply every pending migration in order, each in its own transaction, and record it. Returns the versions run.

    A migration that raises is rolled back and nothing after it runs. (PostgreSQL, SQL Server and SQLite roll DDL
    back with the transaction; MySQL does not. See README.md.)"""
    metadata.create_all(engine)  # only the schema_version table
    done = []
    for mig in status(engine)[2]:
        with engine.begin() as conn:
            if engine.dialect.name == "sqlite" and not conn.connection.dbapi_connection.in_transaction:
                # The Python driver would not open a transaction for DDL on its own. (The app's engine already did:
                # ehr/dbsetup.py opens every transaction with BEGIN IMMEDIATE.)
                conn.exec_driver_sql("BEGIN")
            log("applying %s" % mig.name)
            mig.module.upgrade(conn)
            _record(conn, mig)
        done.append(mig.version)
    return done


def stamp_latest(engine):
    """Record every migration as applied without running it. For `flask init-db` on a brand-new database, whose
    tables were just made from the current models."""
    metadata.create_all(engine)
    cur = current_version(engine)
    with engine.begin() as conn:
        for mig in discover():
            if mig.version > cur:
                _record(conn, mig)


def schema_is_current(engine):
    cur, latest, _ = status(engine)
    return cur >= latest
