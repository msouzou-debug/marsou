"""SQLite as the production engine: one writer, WAL, and a lock taken when a write transaction starts.

Why BEGIN IMMEDIATE: SQLite ignores `SELECT ... FOR UPDATE`. A deferred transaction that reads first and writes
later can fail with "database is locked" that no busy timeout can wait out, and two such transactions can both read
the same number. BEGIN IMMEDIATE takes the write lock when the transaction starts and waits for it up to the busy
timeout, so number allocation and the "one action per task" check (ehr/services/request_flow.py) are serialised.
The cost: a request that holds a transaction open (a document preview waiting for LibreOffice) delays other
writers, such as the cron jobs, for that time. WAL still lets other readers through. No effect on other engines.
"""
from sqlalchemy import event


def sqlite_settings(connection):
    """What a connection reports, for tests and for `flask backup-db` / preflight."""
    cur = connection.cursor()
    try:
        return {
            "journal_mode": cur.execute("PRAGMA journal_mode").fetchone()[0],
            "busy_timeout": cur.execute("PRAGMA busy_timeout").fetchone()[0],
            "foreign_keys": cur.execute("PRAGMA foreign_keys").fetchone()[0],
            "synchronous": cur.execute("PRAGMA synchronous").fetchone()[0],
        }
    finally:
        cur.close()


def init_sqlite(app, engine):
    """Attach the connection settings and the transaction start to `engine`. Does nothing for other engines."""
    if engine.dialect.name != "sqlite":
        return
    busy = int(app.config.get("EHR_SQLITE_BUSY_TIMEOUT_MS", 5000))

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record):
        # Take over transaction control from the driver (it would not emit BEGIN before DDL, and not at all
        # before a SELECT): the "begin" listener below does it. Documented pysqlite recipe.
        dbapi_connection.isolation_level = None
        cur = dbapi_connection.cursor()
        timeout_sql = "PRAGMA busy_timeout=%d" % busy  # busy is an int from config; a PRAGMA takes no parameters
        cur.execute(timeout_sql)  # first: the next statements may have to wait for a lock
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

    @event.listens_for(engine, "begin")
    def _on_begin(conn):
        # An in-memory test database shares one connection between sessions, which may already be inside a
        # transaction. A file database never is at this point: each connection serves one transaction at a time.
        if not conn.connection.dbapi_connection.in_transaction:
            conn.exec_driver_sql("BEGIN IMMEDIATE")
