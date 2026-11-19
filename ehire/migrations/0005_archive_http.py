"""0005: the real eArchive link (contract 06, version 2).

- `facility.archive_site_code`: the eArchive folder code of a facility (empty until an administrator sets it).
- `archive_deposit`: protocol_id, protocol_number, url, meta_json, error_code, next_attempt_at, legal_hold, disposed_at.
- Deposit kind `approved` becomes `decided` (a request has a `submitted` and a `decided` deposit; the decided one covers
  approved, rejected and withdrawn).
- A request that already ended as rejected or withdrawn and has only a `submitted` row with request_outcome set gets its
  `decided` deposit queued now, as the request would have had it under the new rule.
A database built by 0001 from the newest models already has the columns, so each step checks first.
"""
import json

from sqlalchemy import text

from ehire.migrations.helpers import has_column

# (table, column, the whole statement). Written out in full: no SQL is built from strings.
ADDED = (
    ("archive_deposit", "meta_json", "ALTER TABLE archive_deposit ADD COLUMN meta_json TEXT"),
    ("archive_deposit", "protocol_id", "ALTER TABLE archive_deposit ADD COLUMN protocol_id VARCHAR(60)"),
    ("archive_deposit", "protocol_number", "ALTER TABLE archive_deposit ADD COLUMN protocol_number VARCHAR(60)"),
    ("archive_deposit", "url", "ALTER TABLE archive_deposit ADD COLUMN url VARCHAR(500)"),
    ("archive_deposit", "error_code", "ALTER TABLE archive_deposit ADD COLUMN error_code VARCHAR(60)"),
    ("archive_deposit", "next_attempt_at", "ALTER TABLE archive_deposit ADD COLUMN next_attempt_at DATETIME"),
    ("archive_deposit", "legal_hold",
     "ALTER TABLE archive_deposit ADD COLUMN legal_hold BOOLEAN NOT NULL DEFAULT 0"),
    ("archive_deposit", "disposed_at", "ALTER TABLE archive_deposit ADD COLUMN disposed_at DATETIME"),
    ("facility", "archive_site_code", "ALTER TABLE facility ADD COLUMN archive_site_code VARCHAR(8)"),
)


def upgrade(connection):
    for table, column, statement in ADDED:
        if not has_column(connection, table, column):
            connection.execute(text(statement))
    connection.execute(text("UPDATE archive_deposit SET kind = 'decided' WHERE kind = 'approved'"))
    rows = connection.execute(text(
        "SELECT d.request_id, r.status, r.round FROM archive_deposit d JOIN request r ON r.id = d.request_id "
        "WHERE d.kind = 'submitted' AND d.request_outcome IN ('rejected', 'withdrawn') AND r.status IN ('rejected', 'withdrawn') "
        "AND NOT EXISTS (SELECT 1 FROM archive_deposit x WHERE x.request_id = d.request_id AND x.kind = 'decided')")).fetchall()
    for request_id, status, round_ in rows:
        last = connection.execute(text("SELECT MAX(id) FROM request_action WHERE request_id = :r"),
                                  {"r": request_id}).scalar()
        manifest = json.dumps({"as_of": {"action_id": last, "round": round_, "status": status}}, sort_keys=True)
        connection.execute(text(
            "INSERT INTO archive_deposit (request_id, kind, round, state, attempts, manifest_json, legal_hold, created_at) "
            "VALUES (:r, 'decided', :n, 'queued', 0, :m, 0, CURRENT_TIMESTAMP)"),
            {"r": request_id, "n": round_ or 1, "m": manifest})
        connection.execute(text(
            "INSERT INTO audit_log (at, event, request_id, object_type, detail_json) "
            "VALUES (CURRENT_TIMESTAMP, 'archive_queued', :r, 'archive_deposit', :d)"),
            {"r": request_id, "d": json.dumps({"kind": "decided", "round": round_ or 1, "by": "migration 0005"})})
