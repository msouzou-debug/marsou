"""Runs one action through the workflow engine and stores the outcome in one transaction.

The engine decides every rule. This module reads the data the engine needs, calls it, and writes what it
returns (action row, task changes, request fields, the step 2 financials, the step 4 costs, audit rows).
Routes and `flask seed-cases` both call these functions.
"""
import json
from datetime import date
from decimal import Decimal

from flask import g
from sqlalchemy import select

from ehr import localtime
from ehr.extensions import db
from ehr.models import (Request, RequestFinancials, RequestLeaver, Task, audit, get_setting)
from ehr.workflow import engine
from ehr.workflow.model import NewAction

from .activity import LINES, PERIODS
from .notify import notify
from .numbering import next_number
from .request_engine import (build_directory, build_state, current_leavers, holidays, store_result)

SETTING_DEFAULTS = {"reminder_days": 2, "escalation_days": 5, "returned_timeout_days": 30}


def engine_settings():
    out = {}
    for key, default in SETTING_DEFAULTS.items():
        try:
            out[key] = int(get_setting(key, default))
        except (TypeError, ValueError):
            out[key] = default
    return out


def lock_request(req):
    """Re-read the request row under a lock (a no-op on SQLite) so two posts cannot both act."""
    db.session.execute(select(Request.id).where(Request.id == req.id).with_for_update())
    db.session.refresh(req)


def run(req, new_action, now, before=None, after=None):
    """Apply `new_action` to `req`. Returns the engine Result; on errors nothing is written.

    before(result): runs before the result is stored (numbering, resubmit field changes).
    after(result, action_row): runs after it (financials, leaver costs).
    """
    try:
        lock_request(req)
        directory = build_directory(db.session, req.directorate_id)
        result = engine.apply(build_state(req), new_action, directory, now, holidays(db.session),
                              engine_settings(), tz=localtime.zone())
        if not result.ok:
            db.session.rollback()
            return result
        if before:
            before(result)
        row = store_result(db.session, req, result, now)
        if after:
            after(result, row)
        a = result.action
        audit("request_submitted" if new_action.action == "submit" else "request_action",
              user_id=new_action.actor_user_id, request_id=req.id, object_type="request", object_id=req.id,
              detail={"action": a.action if a else new_action.action, "role": a.role if a else None,
                      "step": a.step if a else None, "phase": a.phase if a else None,
                      "round": req.round, "status": req.status, "number": req.number,
                      "action_id": row.id if row is not None else None})
        notify(result.events, actor_user_id=new_action.actor_user_id)
        db.session.commit()
        return result
    except Exception:
        db.session.rollback()
        raise


# ---------------------------------------------------------------- requester actions

def submit(req, user_id, now):
    return run(req, NewAction(user_id, "submit", "requester"), now,
               before=lambda result: setattr(req, "number", next_number(db.session, now.year)))


def resubmit(req, user_id, now, note, changed_fields, apply_fields):
    """T9a / T9b. `apply_fields(round)` copies the corrected form values onto the request and writes the
    current leavers with the new round; it runs only when the engine accepts."""
    action = NewAction(user_id, "resubmit", "requester", comment=note, changed_fields=changed_fields)
    return run(req, action, now, before=lambda result: apply_fields(result.round))


def withdraw(req, user_id, now, comment):
    return run(req, NewAction(user_id, "withdraw", "requester", comment=comment), now)


def system_withdraw(req, now):
    """T12. The engine checks the timeout against the same holidays and settings."""
    return run(req, NewAction(None, "withdraw", "system", system=True), now)


# ---------------------------------------------------------------- approver actions

def act(req, user_id, action, role, payload, comment, now):
    """check, opinion, approve, reject or return by the assignee of a task."""
    new_action = NewAction(user_id, action, role, payload=payload, comment=comment)

    def after(result, row):
        a = result.action
        if a is None or a.action != "check":
            return
        if a.role == "dir_accountant":
            _store_financials(req, a.payload, result.status)
        elif a.role == "central_hr_officer":
            _store_leaver_costs(req, a.payload)

    return run(req, new_action, now, after=after)


def _store_financials(req, payload, status):
    """Step 2 figures, one row per period, for the round just checked. Nothing is stored for a rejection."""
    if status != "in_progress" or not isinstance(payload.get("prev_year"), dict):
        return
    source, snapshot = _source_of(req, payload)
    for period in PERIODS:
        values = payload[period]
        row = RequestFinancials.query.filter_by(request_id=req.id, round=req.round, period=period).first()
        if row is None:
            row = RequestFinancials(request_id=req.id, round=req.round, period=period)
            db.session.add(row)
        row.visits = int(values["visits"])
        row.procedures = int(values["procedures"])
        row.revenue = Decimal(str(values["revenue"]))
        row.payroll_cost = Decimal(str(values["payroll_cost"]))
        row.headcount = Decimal(str(values["headcount"]))
        row.oay_specialty_id = int(payload["oay_specialty_id"])
        row.oay_data_month = _iso_date(payload.get("oay_data_month"))
        row.payroll_to_month = _iso_date(payload["payroll_to_month"])
        row.source = source
        row.source_snapshot_json = snapshot


def _source_of(req, payload):
    """('provider', snapshot json) when the figures came from a data provider; ('manual', reason json) when a
    provider was asked and had none; ('manual', None) when nobody was asked. Set by read_action in this request."""
    outcome = g.get("activity_outcome")
    if (outcome is None or outcome.request_id != req.id
            or str(outcome.specialty_id) != str(payload.get("oay_specialty_id"))):
        return "manual", None
    snapshot = json.dumps(outcome.snapshot, ensure_ascii=False, sort_keys=True)
    return ("provider" if outcome.ok else "manual"), snapshot


def _iso_date(value):
    return date.fromisoformat(value[:10]) if value else None


def _store_leaver_costs(req, payload):
    costs = payload.get("leaver_costs") or {}
    for leaver in current_leavers(req):
        value = costs.get(leaver.id, costs.get(str(leaver.id)))
        if value not in (None, ""):
            leaver.annual_employer_cost = Decimal(str(value))


def keep_answer(req, user_id, task_id, now):
    """T10 without a new answer. The engine has no path for this: clear `may_replace` and write an audit row.

    Returns an error code or None.
    """
    lock_request(req)
    if req.status in ("approved", "rejected", "withdrawn"):
        db.session.rollback()
        return "request_closed"
    if req.status == "returned":
        db.session.rollback()
        return "request_returned"
    task = db.session.get(Task, task_id) if task_id else None
    if (task is None or task.request_id != req.id or task.assignee_user_id != user_id
            or task.status != "closed" or not task.may_replace or req.status != "in_progress"):
        db.session.rollback()
        return "not_your_task"
    task.may_replace = False
    audit("answer_kept", user_id=user_id, request_id=req.id, object_type="task", object_id=task.id,
          detail={"role": task.role, "step": task.step, "phase": task.phase, "round": req.round})
    db.session.commit()
    return None
