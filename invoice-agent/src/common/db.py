"""SQLite with migrations from day one (§7). Each migration runs once, in
order, tracked in schema_migrations."""

import os
import sqlite3

MIGRATIONS = [
    (
        1,
        """
        CREATE TABLE files (
            id INTEGER PRIMARY KEY,
            sha256 TEXT NOT NULL UNIQUE,
            original_name TEXT NOT NULL,
            path TEXT NOT NULL,
            source TEXT NOT NULL,            -- mailbox | folder
            mailbox_message_id TEXT DEFAULT '',
            received_at TEXT NOT NULL,
            invoice_id INTEGER
        );

        CREATE TABLE vendors (
            account TEXT PRIMARY KEY,        -- SAP vendor account
            name TEXT DEFAULT '',
            vat TEXT DEFAULT '',
            known_ibans TEXT DEFAULT '',     -- semicolon-separated
            blocked TEXT DEFAULT '',
            first_seen TEXT DEFAULT ''
        );

        CREATE TABLE invoices (
            id INTEGER PRIMARY KEY,
            file_id INTEGER REFERENCES files(id),
            status TEXT NOT NULL DEFAULT 'ingested',
            -- ingested -> extracted -> validated -> analyzed -> park_ready -> parked
            --   -> approved | rejected | on_hold | needs_review
            vendor_account TEXT DEFAULT '',
            vendor_name TEXT DEFAULT '',
            vendor_vat TEXT DEFAULT '',
            invoice_number TEXT DEFAULT '',
            invoice_date TEXT DEFAULT '',
            due_date TEXT DEFAULT '',
            currency TEXT DEFAULT 'EUR',
            net_by_rate TEXT DEFAULT '{}',   -- JSON {rate: net}
            vat_by_rate TEXT DEFAULT '{}',   -- JSON {rate: vat}
            net_total REAL DEFAULT 0,
            vat_total REAL DEFAULT 0,
            gross_total REAL DEFAULT 0,
            iban TEXT DEFAULT '',
            po_number TEXT DEFAULT '',
            entity TEXT DEFAULT '',
            extraction_source TEXT DEFAULT '',  -- xml | text | ocr | llm
            confidence TEXT DEFAULT '{}',       -- JSON {field: confidence}
            review_reason TEXT DEFAULT '',
            chain_snapshot TEXT DEFAULT '',     -- JSON of the approval chain at routing time
            created_at TEXT NOT NULL
        );

        CREATE TABLE invoice_lines (
            id INTEGER PRIMARY KEY,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id),
            line_no INTEGER NOT NULL,
            description TEXT DEFAULT '',
            quantity REAL DEFAULT 1,
            unit_price REAL DEFAULT 0,
            line_total REAL DEFAULT 0,
            vat_rate REAL DEFAULT 0,
            gl_account TEXT DEFAULT '',
            cost_center TEXT DEFAULT ''
        );

        CREATE TABLE findings (
            id INTEGER PRIMARY KEY,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id),
            rule TEXT NOT NULL,
            severity TEXT NOT NULL,          -- INFO | WARNING | CRITICAL
            detail TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            cleared_by TEXT DEFAULT '',
            cleared_at TEXT DEFAULT ''
        );

        CREATE TABLE approvals (
            id INTEGER PRIMARY KEY,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id),
            step INTEGER NOT NULL,
            role TEXT NOT NULL,
            user TEXT DEFAULT '',
            action TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|delegated
            acted_at TEXT DEFAULT '',
            note TEXT DEFAULT '',
            notified_at TEXT DEFAULT '',
            reminded_at TEXT DEFAULT '',
            escalated_at TEXT DEFAULT ''
        );

        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY,
            ts TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            detail TEXT NOT NULL,
            prev_hash TEXT NOT NULL,
            hash TEXT NOT NULL
        );

        CREATE TABLE settings_history (
            id INTEGER PRIMARY KEY,
            changed_at TEXT NOT NULL,
            actor TEXT NOT NULL,
            file TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            diff TEXT DEFAULT ''
        );

        CREATE TABLE runs (
            id INTEGER PRIMARY KEY,
            started_at TEXT NOT NULL,
            finished_at TEXT DEFAULT '',
            trigger TEXT NOT NULL,           -- schedule | manual
            stats TEXT DEFAULT '{}'
        );

        CREATE INDEX idx_invoices_status ON invoices(status);
        CREATE INDEX idx_invoices_vendor ON invoices(vendor_account);
        CREATE INDEX idx_findings_invoice ON findings(invoice_id);
        CREATE INDEX idx_approvals_invoice ON approvals(invoice_id);
        """,
    ),
]


def connect(settings):
    path = settings["db_path"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    migrate(conn)
    return conn


def migrate(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)")
    applied = {r["version"] for r in conn.execute("SELECT version FROM schema_migrations")}
    for version, sql in MIGRATIONS:
        if version not in applied:
            conn.executescript(sql)
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))",
                (version,),
            )
    conn.commit()
