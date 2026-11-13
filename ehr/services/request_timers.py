"""Reminders, escalations, the returned-request warning and automatic withdrawal (W3 to W5, T12).

`run_timers(now)` is what `flask run-timers` calls (cron, once an hour or day). The pure rules live in
ehr.workflow.timing; this module reads the data, stamps the marks so each fires once, and passes the events on.
"""
from ehr.extensions import db
from ehr.models import Request, Task, User
from ehr.workflow import timing

from .notify import notify
from .request_engine import build_state, holidays
from .request_flow import engine_settings, system_withdraw


def run_timers(now):
    """Returns {'reminders': n, 'escalations': n, 'warnings': n, 'withdrawn': n}."""
    days_off, settings = holidays(db.session), engine_settings()
    managers = {u.id: u.line_manager_user_id for u in User.query.filter(User.line_manager_user_id.isnot(None))}

    tasks = []
    open_requests = Request.query.filter(Request.status == "in_progress").all()
    for req in open_requests:
        tasks.extend(t for t in build_state(req, managers).tasks if t.status == "open")
    returned = Request.query.filter(Request.status == "returned").all()

    events = timing.due_notifications(tasks, returned, now, days_off, settings)
    counts = {"reminders": 0, "escalations": 0, "warnings": 0, "withdrawn": 0}
    for event in events:
        if event.kind == "reminder_due":
            db.session.get(Task, event.data["task_id"]).reminded_at = now
            counts["reminders"] += 1
        elif event.kind == "escalation_due":
            db.session.get(Task, event.data["task_id"]).escalated_at = now
            counts["escalations"] += 1
        elif event.kind == "withdrawal_warning":
            db.session.get(Request, event.request_id).withdrawal_warned = True
            counts["warnings"] += 1
    notify(events)
    db.session.commit()

    for request_id in timing.due_withdrawals(returned, now, days_off, settings):
        req = db.session.get(Request, request_id)
        if system_withdraw(req, now).ok:
            counts["withdrawn"] += 1
    return counts
