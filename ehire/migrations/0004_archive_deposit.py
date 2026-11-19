"""0004: the eArchive deposit queue (contract 06).

Adds the table `archive_deposit`. A database built by 0001 from the newest models already has it, so this checks first.
Requests submitted before this release have no deposit row; only their final approval (if it comes) is deposited.
"""
from sqlalchemy import text

from ehire.migrations.helpers import has_index, has_table


def upgrade(connection):
    if not has_table(connection, "archive_deposit"):
        connection.execute(text(
            "CREATE TABLE archive_deposit ("
            "id INTEGER NOT NULL, "
            "request_id INTEGER NOT NULL, "
            "kind VARCHAR(10) NOT NULL, "
            "round INTEGER NOT NULL, "
            "state VARCHAR(10) NOT NULL, "
            "attempts INTEGER NOT NULL, "
            "last_error TEXT, "
            "pdf_storage_ref VARCHAR(300), "
            "pdf_sha256 VARCHAR(64), "
            "manifest_json TEXT, "
            "archive_ref VARCHAR(300), "
            "request_outcome VARCHAR(10), "
            "created_at DATETIME NOT NULL, "
            "sent_at DATETIME, "
            "PRIMARY KEY (id), "
            "CONSTRAINT uq_archive_request_kind UNIQUE (request_id, kind), "
            "FOREIGN KEY(request_id) REFERENCES request (id))"))
    if not has_index(connection, "archive_deposit", "ix_archive_deposit_state"):
        connection.execute(text("CREATE INDEX ix_archive_deposit_state ON archive_deposit (state)"))
