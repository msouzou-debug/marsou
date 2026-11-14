"""Helpers for the notification tests. Invented data only."""
import re
from datetime import datetime, timezone

from ehr.extensions import db
from ehr.models import AuditLog, MailOutbox, Request, RequestAction, Task, User
from tests.requests.flowhelpers import act, as_user, create, reload, step2  # noqa: F401  (re-exported)

HREF = re.compile(r'href="([^"]+)"')
URLS = re.compile(r"https?://[^\s\"'<>]+")


def uid(username):
    return User.query.filter_by(username=username).one().id


def mails(event=None, to=None, request_id=None):
    db.session.expire_all()
    q = MailOutbox.query.order_by(MailOutbox.id)
    if event:
        q = q.filter_by(event=event)
    if to:
        q = q.filter_by(to_user_id=uid(to))
    if request_id:
        q = q.filter_by(request_id=request_id)
    return q.all()


def counts():
    """Row counts that an email link must never change."""
    db.session.expire_all()
    return (Request.query.count(), Task.query.count(), RequestAction.query.count(),
            AuditLog.query.filter(AuditLog.event.in_(("request_action", "request_submitted"))).count())


def at(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


def run_timers(app, when):
    result = app.test_cli_runner().invoke(args=["run-timers", "--at", when.isoformat()])
    assert result.exit_code == 0, result.output
    return dict((k, int(v)) for k, v in (p.split("=") for p in result.output.split()))


def send_mail(app):
    result = app.test_cli_runner().invoke(args=["send-mail"])
    assert result.exit_code == 0, result.output
    return dict((k, int(v)) for k, v in (p.split("=") for p in result.output.split()))


# Keys these tests and pages need that the strings agent has not written yet. Must be empty when every key exists
# (test_keys.py fails on an entry that has been written, so the set cannot go stale).
KNOWN_MISSING = set()


def shown(page, key, lang="en", **params):
    """True when the page shows the string for `key` (HTML-unescaped), or the raw key while it is in KNOWN_MISSING."""
    import html
    from ehr import i18n
    page = html.unescape(page)
    if key in KNOWN_MISSING:
        return key in page
    return i18n.translate(key, lang, **params) in page
