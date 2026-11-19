"""Sign-in protection: lock a username, and separately an address, after repeated failures.

Rules (config): LOGIN_MAX_FAILURES failures for one username inside LOGIN_WINDOW_MINUTES lock that username for
the same number of minutes; LOGIN_IP_MAX_FAILURES failures from one address do the same for the address. The rule
treats unknown usernames exactly like real ones, so it leaks nothing. While locked, further attempts are not
recorded, so the lock ends a fixed time after the failure that caused it.

An attacker can keep a known username locked by trying again every window. An admin who is locked out uses
`flask unlock-user <username>` on the server.
"""
import math
from datetime import timedelta

from flask import current_app, request

from ..extensions import db
from ..models import LoginAttempt, utcnow


def key(username):
    return (username or "").strip().lower()[:80]


def _aware(value):
    from datetime import timezone

    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _remaining(column, value, limit, now, window):
    """Whole minutes left on the lock for rows matching `column == value`, or 0."""
    since = now - window
    rows = (db.session.query(LoginAttempt.at).filter(column == value, LoginAttempt.at >= since)
            .order_by(LoginAttempt.at.desc()).limit(limit).all())
    if len(rows) < limit:
        return 0
    left = _aware(rows[0][0]) + window - now
    return max(1, math.ceil(left.total_seconds() / 60))


def locked_minutes(username, ip, now=None):
    """Minutes the user must still wait (the longer of the username and address locks), or 0 when not locked."""
    cfg = current_app.config
    now = now or utcnow()
    window = timedelta(minutes=cfg["LOGIN_WINDOW_MINUTES"])
    by_name = _remaining(LoginAttempt.username, key(username), cfg["LOGIN_MAX_FAILURES"], now, window) if key(username) else 0
    by_ip = _remaining(LoginAttempt.ip, ip, cfg["LOGIN_IP_MAX_FAILURES"], now, window) if ip else 0
    return max(by_name, by_ip)


def record_failure(username, ip, now=None):
    """Store one failure. Returns True when this failure started a lock (so the caller audits it once)."""
    now = now or utcnow()
    db.session.add(LoginAttempt(username=key(username), ip=ip, at=now))
    db.session.flush()
    # Housekeeping: a day is far longer than any window.
    db.session.query(LoginAttempt).filter(LoginAttempt.at < now - timedelta(days=1)).delete(synchronize_session=False)
    return locked_minutes(username, ip, now) > 0


def clear(username):
    db.session.query(LoginAttempt).filter(LoginAttempt.username == key(username)).delete(synchronize_session=False)


def client_ip():
    return request.remote_addr
