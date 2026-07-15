"""File registration + SHA-256 dedupe (Stage 1). A hash already in the DB is
skipped so re-runs and re-sent emails never create duplicates."""

import hashlib
import os
import shutil
from datetime import datetime, timezone


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def is_known(conn, sha256):
    return conn.execute("SELECT 1 FROM files WHERE sha256=?", (sha256,)).fetchone() is not None


def register_file(conn, sha256, original_name, path, source, mailbox_message_id=""):
    cur = conn.execute(
        """INSERT INTO files (sha256, original_name, path, source, mailbox_message_id, received_at)
           VALUES (?,?,?,?,?,?)""",
        (sha256, original_name, path, source, mailbox_message_id,
         datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    return cur.lastrowid


def archive_file(settings, conn, file_id, vendor_account):
    """File the original under archive/{vendor}/{yyyy-mm}/{hash}.{ext} once the
    vendor is known; before that it stays in archive/_unassigned/."""
    row = conn.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()
    vendor = vendor_account or "_unassigned"
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    ext = os.path.splitext(row["original_name"])[1].lstrip(".").lower() or "bin"
    dest_dir = os.path.join(settings["folders"]["archive_root"], vendor, month)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{row['sha256']}.{ext}")
    if os.path.abspath(row["path"]) != os.path.abspath(dest):
        shutil.copy2(row["path"], dest)
        conn.execute("UPDATE files SET path=? WHERE id=?", (dest, file_id))
        conn.commit()
    return dest
