"""Time rules (contract 02, section 8: W1 to W5). Pure: now, holidays and settings come in."""
from datetime import datetime, timedelta

from .model import Event, Settings


def _as_date(value):
    return value.date() if isinstance(value, datetime) else value


def is_working_day(day, holidays=()):
    """W1."""
    return day.weekday() < 5 and day not in holidays


def working_days_between(start, end, holidays=()):
    """Working days in (start, end], by calendar date. 0 if end is not after start."""
    s, e = _as_date(start), _as_date(end)
    count = 0
    day = s + timedelta(days=1)
    while day <= e:
        if is_working_day(day, holidays):
            count += 1
        day += timedelta(days=1)
    return count


def add_working_days(start, n, holidays=()):
    """The date (or datetime, time kept) n working days after start."""
    day = _as_date(start)
    left = n
    while left > 0:
        day += timedelta(days=1)
        if is_working_day(day, holidays):
            left -= 1
    if isinstance(start, datetime):
        return datetime.combine(day, start.time(), tzinfo=start.tzinfo)
    return day


def _settings(settings):
    if settings is None:
        return Settings()
    if isinstance(settings, Settings):
        return settings
    base = Settings()
    return Settings(
        reminder_days=settings.get("reminder_days", base.reminder_days),
        escalation_days=settings.get("escalation_days", base.escalation_days),
        returned_timeout_days=settings.get("returned_timeout_days", base.returned_timeout_days))


def due_notifications(tasks, returned_requests, now, holidays, settings):
    """W3, W4, W5 warning. Returns a list of Event. The caller records reminded_at,
    escalated_at and withdrawal_warned so each fires once per clock start."""
    cfg = _settings(settings)
    events = []
    for task in tasks:
        if task.status != "open" or not task.assignee_user_id:  # W2: paused time never counts
            continue
        start = task.clock_started_at or task.opened_at
        if start is None:
            continue
        days = working_days_between(start, now, holidays)
        data = {"role": task.role, "step": task.step, "task_id": task.id, "working_days": days}
        if days >= cfg.reminder_days and not task.reminded_at:
            events.append(Event("reminder_due", task.request_id, task.assignee_user_id, data))
        if days >= cfg.escalation_days and not task.escalated_at and task.line_manager_id:
            data = dict(data, assignee=task.assignee_user_id)
            events.append(Event("escalation_due", task.request_id, task.line_manager_id, data))
    for req in returned_requests:
        if req.status != "returned" or req.returned_at is None or req.withdrawal_warned:
            continue
        days = working_days_between(req.returned_at, now, holidays)
        if days * 2 >= cfg.returned_timeout_days and days < cfg.returned_timeout_days:
            events.append(Event("withdrawal_warning", req.id, req.created_by,
                                {"working_days": days, "limit": cfg.returned_timeout_days}))
    return events


def due_withdrawals(returned_requests, now, holidays, settings):
    """W5: ids of returned requests at or past the limit. The caller applies T12 for each."""
    cfg = _settings(settings)
    return [r.id for r in returned_requests
            if r.status == "returned" and r.returned_at is not None
            and working_days_between(r.returned_at, now, holidays) >= cfg.returned_timeout_days]
