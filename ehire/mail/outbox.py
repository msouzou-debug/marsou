"""Sends what is waiting in `mail_outbox` through the configured backend. Never raises into a user action."""
import logging
from datetime import timedelta

from flask import current_app, g, has_request_context
from sqlalchemy import and_, or_

from ..extensions import db
from ..models import MAX_ATTEMPTS, MailOutbox, User
from ..models.access import utcnow
from .backends import get_backend
from .layout import EVENT_KIND, STATUS

log = logging.getLogger(__name__)


def pending_query():
    return MailOutbox.query.filter(or_(
        MailOutbox.state == "queued",
        and_(MailOutbox.state == "failed", MailOutbox.attempts < MAX_ATTEMPTS))).order_by(MailOutbox.id)


def flush(limit=100, now=None):
    """Try each waiting row once. Returns {'sent': n, 'failed': n, 'expired': n}. Commits row by row."""
    counts = {"sent": 0, "failed": 0, "expired": 0}
    backend = get_backend()
    if not backend.delivers:
        return counts  # outbox_only: mail stays for admins to read
    now = now or utcnow()
    oldest = now - timedelta(hours=int(current_app.config.get("MAIL_MAX_AGE_HOURS", 48)))
    for row in pending_query().limit(limit).all():
        created = row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=now.tzinfo)
        if row.state == "queued" and created < oldest:
            row.state, row.last_error = "failed", "Expired: queued for more than the allowed hours before sending was on."
            row.attempts = MAX_ATTEMPTS
            counts["expired"] += 1
            db.session.commit()
            continue
        to = row.to_email
        if not to and row.to_user_id:  # an address may have been added since
            user = db.session.get(User, row.to_user_id)
            to = (user.email or "").strip() if user is not None else ""
            row.to_email = to or None
        row.attempts += 1
        try:
            if not to:
                raise ValueError("The recipient has no email address.")
            backend.send(to, row.subject, row.html, row.text)
        except Exception as exc:  # noqa: BLE001  any backend problem is recorded, never raised
            row.state, row.last_error = "failed", (str(exc) or type(exc).__name__)[:500]
            counts["failed"] += 1
        else:
            row.state, row.last_error, row.sent_at = "sent", None, now
            counts["sent"] += 1
        db.session.commit()
    return counts


def flush_quietly():
    """After a successful commit. A mail problem is logged and never reaches the user."""
    try:
        flush()
    except Exception:  # noqa: BLE001
        log.exception("sending queued mail failed")
        db.session.rollback()


def init_mail(app):
    """Best-effort send after a web request that queued mail and succeeded."""

    @app.template_global()
    def mail_status_key(event):
        """String key of the status label an event's email carries (for the email log)."""
        return STATUS[EVENT_KIND.get(event, "info")]["key"]

    @app.after_request
    def _send_after_commit(response):
        if has_request_context() and g.get("mail_pending") and response.status_code < 400 \
                and app.config.get("MAIL_AUTO_FLUSH", True):
            g.mail_pending = False
            flush_quietly()
        return response
