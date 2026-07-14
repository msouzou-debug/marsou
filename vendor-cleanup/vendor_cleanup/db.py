import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY,
    imported_at TEXT NOT NULL,
    source TEXT NOT NULL,              -- 'extracts' | 'combined' | 'fbl1n' | 'ticked_actions'
    files_json TEXT NOT NULL,          -- [{name, sha256, rows}, ...]
    vendor_count INTEGER
);

CREATE TABLE IF NOT EXISTS vendors (
    import_id INTEGER NOT NULL REFERENCES imports(id),
    supplier TEXT NOT NULL,
    name TEXT DEFAULT '',
    name_norm TEXT DEFAULT '',         -- normalized + transliterated, token-sorted
    vat TEXT DEFAULT '',
    vat_norm TEXT DEFAULT '',
    tin TEXT DEFAULT '',
    tin_norm TEXT DEFAULT '',
    telephone TEXT DEFAULT '',
    phone_norm TEXT DEFAULT '',
    company_codes TEXT DEFAULT '',     -- comma-separated
    ibans TEXT DEFAULT '',             -- semicolon-separated
    blocked TEXT DEFAULT '',           -- central block/deletion flags ('' or 'Y' / flag list)
    cc_blocked TEXT DEFAULT '',        -- company codes with payment/deletion block (from LFB1)
    PRIMARY KEY (import_id, supplier)
);

CREATE TABLE IF NOT EXISTS open_items (
    import_id INTEGER NOT NULL REFERENCES imports(id),
    supplier TEXT NOT NULL,
    item_count INTEGER DEFAULT 0,
    open_amount REAL DEFAULT 0,
    PRIMARY KEY (import_id, supplier)
);

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,  -- hash over members' supplier|name|vat|ibans
    member_key TEXT NOT NULL,          -- hash over sorted supplier ids (identity across imports)
    rules TEXT NOT NULL,               -- comma-separated rule names that fired
    score REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',  -- open|pending_approval|resolved|stale
    resolution TEXT DEFAULT '',        -- merge|not_duplicate (when resolved)
    first_seen_import INTEGER,
    last_seen_import INTEGER
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id),
    supplier TEXT NOT NULL,
    PRIMARY KEY (group_id, supplier)
);

CREATE TABLE IF NOT EXISTS group_edges (
    group_id INTEGER NOT NULL REFERENCES groups(id),
    supplier_a TEXT NOT NULL,
    supplier_b TEXT NOT NULL,
    rule TEXT NOT NULL,
    detail TEXT DEFAULT '',
    weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id),
    action TEXT NOT NULL,              -- merge|not_duplicate|defer|unmerge
    survivor TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    reviewer TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    approver TEXT DEFAULT '',
    approved_at TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'  -- pending|approved|rejected|superseded
);

CREATE TABLE IF NOT EXISTS whitelist (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                -- 'iban' | 'pair'
    value TEXT NOT NULL,               -- IBAN, or 'supplierA|supplierB' (sorted)
    reason TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (kind, value)
);

CREATE TABLE IF NOT EXISTS worklist_items (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                -- no_iban | no_vat | blocked_active
    supplier TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',  -- open|pending_approval|fixed|accepted|gone
    reason TEXT DEFAULT '',
    reviewer TEXT DEFAULT '',
    reviewed_at TEXT DEFAULT '',
    approver TEXT DEFAULT '',
    approved_at TEXT DEFAULT '',
    last_seen_import INTEGER,
    UNIQUE (kind, supplier)
);

CREATE TABLE IF NOT EXISTS sap_actions (
    id INTEGER PRIMARY KEY,
    action TEXT NOT NULL,              -- BLOCK | UPDATE
    supplier TEXT NOT NULL,
    survivor TEXT DEFAULT '',
    note TEXT DEFAULT '',
    source TEXT DEFAULT '',            -- 'decision:<id>' | 'worklist:<id>'
    status TEXT NOT NULL DEFAULT 'pending',  -- pending|held|exported|applied|cancelled
    hold_reason TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    applied_at TEXT DEFAULT '',
    UNIQUE (action, supplier, survivor)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_import ON vendors(import_id);
CREATE INDEX IF NOT EXISTS idx_groups_status ON groups(status);
CREATE INDEX IF NOT EXISTS idx_decisions_group ON decisions(group_id);
"""


def connect(settings):
    path = settings["paths"]["database"]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


def latest_import_id(conn, source=None):
    if source:
        row = conn.execute(
            "SELECT id FROM imports WHERE source = ? ORDER BY id DESC LIMIT 1", (source,)
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT id FROM imports WHERE source IN ('extracts','combined') ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return row["id"] if row else None


def current_vendors(conn):
    imp = latest_import_id(conn)
    if imp is None:
        return []
    return conn.execute("SELECT * FROM vendors WHERE import_id = ? ORDER BY supplier", (imp,)).fetchall()
