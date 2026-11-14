"""Hands engine events to the mailer (contract 02, section 7).

`notify(events, actor_user_id)` renders one email per recipient and stores it in `mail_outbox` inside the caller's
transaction, so an action that rolls back sends nothing. Sending happens after the commit (ehr.mail.outbox).
Emails inform; they carry one link to the request and no token.
"""
import logging

from flask import current_app, g, has_request_context

from ehr.extensions import db
from ehr.mail.layout import EVENT_KIND, render_email
from ehr.models import MailOutbox, Request, RoleAssignment, User, audit
from ehr.workflow.model import Event

log = logging.getLogger(__name__)

# Events that reach the person who caused them. The submission confirmation (it carries the new number) is the
# one exception to "nobody is mailed about their own action"; flip this set to remove it.
TELL_THE_ACTOR = {"request_submitted"}


def _admins():
    """Active users holding the admin role, oldest first."""
    ids = [a.user_id for a in RoleAssignment.query.filter_by(role="admin").order_by(RoleAssignment.id)
           if a.is_active_on()]
    users = User.query.filter(User.id.in_(ids), User.is_active.is_(True)).order_by(User.id).all() if ids else []
    return users


def _expand(events):
    """Adjust what the engine sends to what the notifier needs.

    - C6 (reassign) reports `task_redirected` to the new assignee; for that person it is a new task.
    - A task opened for someone else because the holder made the request also tells the requester (conflict_of_interest).
    """
    out = []
    for ev in events or ():
        data = dict(ev.data or {})
        if ev.kind == "task_redirected" and "assignee" not in data:
            out.append(Event("task_opened", ev.request_id, ev.recipient_user_id, data))
            ev = out[-1]
        else:
            out.append(ev)
        if ev.kind == "task_opened" and data.get("redirect_reason") == "conflict_of_interest" \
                and data.get("on_behalf_of") and ev.recipient_user_id:
            req = db.session.get(Request, ev.request_id)
            if req is not None and data["on_behalf_of"] == req.created_by:
                out.append(Event("task_redirected", ev.request_id, data["on_behalf_of"],
                                 dict(data, assignee=ev.recipient_user_id, redirect_reason="conflict_of_interest")))
    return out


def notify(events, actor_user_id=None):
    """Queue one email per recipient. The caller commits. Returns the number of rows added."""
    base_url = current_app.config.get("EHR_BASE_URL", "")
    env = current_app.jinja_env
    seen, queued = set(), 0
    for ev in _expand(events):
        if ev.kind not in EVENT_KIND or ev.request_id is None:
            continue
        req = db.session.get(Request, ev.request_id)
        if req is None:
            continue
        if ev.recipient_user_id is None:
            recipients = _admins()
        else:
            user = db.session.get(User, ev.recipient_user_id)
            recipients = [user] if user is not None else []
        for user in recipients:
            if not user.is_active or (user.id == actor_user_id and ev.kind not in TELL_THE_ACTOR):
                continue  # inactive people get nothing; nobody is mailed about their own action
            key = (ev.kind, user.id, ev.request_id, (ev.data or {}).get("role"), (ev.data or {}).get("step"))
            if key in seen:
                continue
            seen.add(key)
            try:
                subject, html, text = render_email(ev, req, user, user.language, base_url, env)
            except Exception:  # noqa: BLE001  a template problem must not break the user's action
                log.exception("could not render %s for request %s", ev.kind, ev.request_id)
                continue
            email = (user.email or "").strip()
            row = MailOutbox(event=ev.kind, request_id=req.id, to_user_id=user.id, to_email=email or None,
                             language=user.language or "el", subject=subject, html=html, text=text,
                             state="queued" if email else "failed",
                             last_error=None if email else "The recipient has no email address.")
            db.session.add(row)
            db.session.flush()
            audit("mail_queued", user_id=actor_user_id, request_id=req.id, object_type="mail_outbox",
                  object_id=row.id, detail={"kind": ev.kind, "to_user_id": user.id, "state": row.state})
            queued += 1
    if queued and has_request_context():
        g.mail_pending = True
    return queued
