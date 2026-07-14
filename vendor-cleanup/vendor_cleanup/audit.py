"""Append-only, hash-chained audit log.

Same implementation as the invoice agent (shared module): each entry's hash is
sha256(prev_hash | ts | actor | action | detail), so any tampering with a past
row breaks the chain from that point on.
"""

import hashlib
from datetime import datetime, timezone

GENESIS = "0" * 64


def _hash(prev_hash, ts, actor, action, detail):
    payload = "|".join([prev_hash, ts, actor, action, detail])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def log(conn, actor, action, detail=""):
    row = conn.execute("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1").fetchone()
    prev_hash = row["hash"] if row else GENESIS
    ts = datetime.now(timezone.utc).isoformat()
    h = _hash(prev_hash, ts, actor, action, detail)
    conn.execute(
        "INSERT INTO audit_log (ts, actor, action, detail, prev_hash, hash) VALUES (?,?,?,?,?,?)",
        (ts, actor, action, detail, prev_hash, h),
    )
    conn.commit()
    return h


def verify_chain(conn):
    """Recompute the chain; return (ok, first_bad_id)."""
    prev = GENESIS
    for row in conn.execute("SELECT * FROM audit_log ORDER BY id"):
        if row["prev_hash"] != prev:
            return False, row["id"]
        if _hash(prev, row["ts"], row["actor"], row["action"], row["detail"]) != row["hash"]:
            return False, row["id"]
        prev = row["hash"]
    return True, None
