"""Reminders, escalations, the returned-request warning and automatic withdrawal (W3 to W5, T12).

`run_timers(now)` is what `flask run-timers` calls. The rules live in ehr.workflow.timing (working days from the
public_holiday table, paused time never counted). This module reads the data, stamps the marks so each message goes
once per clock start, and hands the events to the notifier. Mail is only queued here; `flask send-mail` sends it.
"""
import dataclasses
from datetime import date

from ehr.extensions import db
from ehr.models import Request, Task, User
from ehr.services.notify import notify
from ehr.services.out_of_office import move_open_tasks
from ehr.services.request_engine import build_state, holidays
from ehr.services.request_flow import engine_settings, system_withdraw
from ehr.workflow import timing
from ehr.workflow.model import Event

# Stands in for a missing line manager so the engine still reports the escalation; it is sent to the admins.
NO_MANAGER = "__no_line_manager__"


def run_timers(now):
    """Returns {'reminders': n, 'escalations': n, 'warnings': n, 'withdrawn': n}."""
    days_off, settings = holidays(db.session), engine_settings()
    managers = {u.id: u.line_manager_user_id for u in User.query.filter(User.line_manager_user_id.isnot(None))}

    # Someone whose out-of-office window has started since they switched it on: their open tasks move now.
    for user in User.query.filter(User.out_of_office.is_(True), User.is_active.is_(True)).all():
        move_open_tasks(user, now=now, on=now.date() if hasattr(now, "date") else date.today())

    tasks = []
    for req in Request.query.filter(Request.status == "in_progress").all():
        for t in build_state(req, managers).tasks:
            if t.status == "open":
                tasks.append(t if t.line_manager_id else dataclasses.replace(t, line_manager_id=NO_MANAGER))
    returned = Request.query.filter(Request.status == "returned").all()

    events = []
    counts = {"reminders": 0, "escalations": 0, "warnings": 0, "withdrawn": 0}
    for event in timing.due_notifications(tasks, returned, now, days_off, settings):
        if event.kind == "reminder_due":
            db.session.get(Task, event.data["task_id"]).reminded_at = now
            counts["reminders"] += 1
        elif event.kind == "escalation_due":
            db.session.get(Task, event.data["task_id"]).escalated_at = now
            counts["escalations"] += 1
            if event.recipient_user_id == NO_MANAGER:  # assumption: no line manager means the admins are told
                event = Event(event.kind, event.request_id, None, event.data)
        elif event.kind == "withdrawal_warning":
            db.session.get(Request, event.request_id).withdrawal_warned = True
            counts["warnings"] += 1
        events.append(event)
    notify(events)
    db.session.commit()

    for request_id in timing.due_withdrawals(returned, now, days_off, settings):
        req = db.session.get(Request, request_id)
        if system_withdraw(req, now).ok:
            counts["withdrawn"] += 1
    return counts
