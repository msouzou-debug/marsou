"""Glue between the database and the workflow engine (contract 02 and 03).

Routes call these helpers; no business rule lives here. The engine decides, these functions
read the data it needs (build_directory, build_state) and write what it returns (store_result).
"""
import json
from datetime import date

from sqlalchemy import or_

from ehr.models import PublicHoliday, RequestAction, RoleAssignment, Task, User
from ehr.workflow.model import ActionRecord, Directory, RequestState, TaskState
from ehr.workflow.route import compute_route

# Roles the engine resolves through the directory. `requester`, `viewer` and `admin` are never assigned tasks.
_ASSIGNABLE = ("dir_accountant", "sci_director", "dir_hr_officer", "dir_exec", "fin_mgmt_head",
               "central_hr_officer", "medical_director", "nursing_director", "ceo")


def current_leavers(req):
    """Leaver rows of the current round. Earlier rounds stay in the table for history."""
    return [l for l in req.leavers if (l.round or 1) == (req.round or 1)]


def build_directory(session, directorate_id, on=None):
    """A Directory for one Directorate: holders and substitutes of its roles and of the central roles."""
    on = on or date.today()
    active = {u.id for u in session.query(User.id).filter(User.is_active.is_(True))}
    holders, substitutes = {}, {}
    rows = session.query(RoleAssignment).filter(
        RoleAssignment.role.in_(_ASSIGNABLE),
        or_(RoleAssignment.directorate_id == directorate_id, RoleAssignment.directorate_id.is_(None)),
    ).order_by(RoleAssignment.id)
    for a in rows:
        if not a.is_active_on(on) or a.user_id not in active:
            continue
        key = (a.role, a.directorate_id)
        holders.setdefault(key, a.user_id)
        if a.substitute_user_id in active:
            substitutes.setdefault(key, a.substitute_user_id)
    out = set()
    managers = {}
    for u in session.query(User).filter(User.is_active.is_(True)):
        if u.line_manager_user_id:
            managers[u.id] = u.line_manager_user_id
        if u.out_of_office and (u.out_of_office_from is None or u.out_of_office_from <= on) \
                and (u.out_of_office_to is None or u.out_of_office_to >= on):
            out.add(u.id)
    return Directory(holders=holders, substitutes=substitutes, out_of_office=frozenset(out), line_managers=managers)


def route_for(session, directorate_id, category):
    """The route the engine will use at submit: it asks the directory whether the Directorate has a Scientific Director."""
    directory = build_directory(session, directorate_id)
    return compute_route(category, directory.has_role("sci_director", directorate_id))


def holidays(session):
    return {h.date for h in session.query(PublicHoliday)}


def route_of(req):
    return json.loads(req.route_snapshot_json) if req.route_snapshot_json else None


def build_state(req, line_managers=None):
    """RequestState for the engine from the stored request, its actions and tasks.

    line_managers ({user_id: manager_id}) is only needed for the timers (W4)."""
    actions = tuple(ActionRecord(
        id=a.id, round=a.round, step=a.step, phase=a.phase, role=a.role,
        actor_user_id=a.actor_user_id, on_behalf_of_user_id=a.on_behalf_of_user_id,
        redirect_reason=a.redirect_reason, action=a.action,
        payload=json.loads(a.payload_json) if a.payload_json else {}, comment=a.comment,
        supersedes_action_id=a.supersedes_action_id, is_superseded=bool(a.is_superseded),
        created_at=a.created_at) for a in req.actions)
    tasks = tuple(TaskState(
        id=t.id, request_id=t.request_id, round=t.round, step=t.step, phase=t.phase,
        role=t.role, assignee_user_id=t.assignee_user_id, on_behalf_of_user_id=t.on_behalf_of_user_id,
        redirect_reason=t.redirect_reason, status=t.status, may_replace=bool(t.may_replace),
        opened_at=t.opened_at, clock_started_at=t.clock_started_at, reminded_at=t.reminded_at,
        escalated_at=t.escalated_at, line_manager_id=(line_managers or {}).get(t.assignee_user_id))
        for t in req.tasks)
    return RequestState(
        id=req.id, status=req.status, current_step=req.current_step or 1, step3_phase=req.step3_phase,
        returned_from_step=req.returned_from_step, round=req.round or 1, category=req.category or "medical",
        directorate_id=req.directorate_id, created_by=req.created_by, route=route_of(req), reason=req.reason,
        leaver_ids=tuple(l.id for l in current_leavers(req)), returned_at=req.returned_at,
        withdrawal_warned=bool(req.withdrawal_warned), actions=actions, tasks=tasks)


def store_result(session, req, result, now):
    """Write an engine Result to the database. The caller holds the transaction and commits.

    Returns the new RequestAction row (or None). `returned_at` is stored as given (None unless just returned),
    which also restarts the W5 warning, so `withdrawal_warned` is cleared.
    """
    req.status = result.status
    req.current_step = result.current_step
    req.step3_phase = result.step3_phase
    req.round = result.round
    req.returned_from_step = result.returned_from_step
    req.returned_at = result.returned_at
    req.withdrawal_warned = False
    if result.category is not None:
        req.category = result.category
    if result.route is not None:
        req.route_snapshot_json = json.dumps(result.route, ensure_ascii=False)
    if result.closed_at is not None:
        req.closed_at = result.closed_at
    session.flush()

    row = None
    a = result.action
    if a is not None:
        if a.action == "submit" and req.submitted_at is None:
            req.submitted_at = now
        row = RequestAction(
            request_id=req.id, round=a.round, step=a.step, phase=a.phase, role=a.role, actor_user_id=a.actor_user_id,
            on_behalf_of_user_id=a.on_behalf_of_user_id, redirect_reason=a.redirect_reason, action=a.action,
            payload_json=json.dumps(dict(a.payload), ensure_ascii=False) if a.payload else None,
            comment=a.comment, supersedes_action_id=a.supersedes_action_id, created_at=now)
        session.add(row)
    for action_id in result.superseded_action_ids:
        old = session.get(RequestAction, action_id)
        if old is not None:
            old.is_superseded = True

    by_id = {t.id: t for t in req.tasks}
    for op in result.task_ops:
        if op.op == "open":
            session.add(Task(
                request_id=req.id, round=op.round or req.round, step=op.step, role=op.role, phase=op.phase,
                assignee_user_id=op.assignee_user_id, on_behalf_of_user_id=op.on_behalf_of_user_id,
                redirect_reason=op.redirect_reason, status="open", opened_at=now, clock_started_at=now))
            continue
        task = by_id.get(op.task_id)
        if task is None:
            continue
        if op.op == "close":
            task.status, task.closed_at = "closed", now
        elif op.op == "pause":
            task.status = "paused"
        elif op.op == "resume":
            task.status, task.clock_started_at = "open", now
            task.reminded_at = task.escalated_at = None
        elif op.op == "reassign":
            task.assignee_user_id = op.assignee_user_id
            task.on_behalf_of_user_id = op.on_behalf_of_user_id
            task.redirect_reason = op.redirect_reason
        elif op.op == "allow_replace":
            task.may_replace = True
        elif op.op == "clear_replace":
            task.may_replace = False
    session.flush()
    return row
