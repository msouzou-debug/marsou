"""Approver and requester actions on a request page: POST /action and POST /withdraw (contract 03, sections 4 and 6).

The route gathers what was posted, hands it to the engine through ehr.services.request_flow, and shows the
outcome. No rule is decided here.
"""
from flask import abort, redirect, request, url_for

from ..auth import can_see_request, current_user, login_required
from ..extensions import db
from ..models import Request
from ..services import request_flow as flow
from ..services.request_cards import APPROVER_ACTIONS, ASSIGNABLE_ROLES, read_action
from ..services.request_flash import flash_key
from .requests import STALE, _now, _render_detail, bp, empty_card_state


def _request_or_404(request_id):
    req = db.session.get(Request, request_id)
    if not can_see_request(current_user(), req):
        abort(404)
    return req


def _back(req):
    return redirect(url_for("requests.detail", request_id=req.id))


def _stale(req, code):
    """The task is no longer the person's, or the request moved on: show its current state with the reason."""
    flash_key("error." + code, "danger")
    return _back(req)


def _current_task(req, user, role):
    found = None
    for task in req.tasks:
        if task.assignee_user_id == user.id and task.role == role and (
                task.status == "open" or (task.status == "closed" and task.may_replace)):
            found = task
    return found


@bp.post("/<int:request_id>/action")
@login_required
def action(request_id):
    user = current_user()
    req = _request_or_404(request_id)
    kind = (request.form.get("action") or "").strip()
    role = (request.form.get("role") or "").strip()

    if kind == "keep":  # T10 without a new answer
        code = flow.keep_answer(req, user.id, _int(request.form.get("task_id")), _now())
        if code:
            return _stale(req, code)
        flash_key("done.keep_answer", "success")
        return _back(req)

    if kind not in APPROVER_ACTIONS or role not in ASSIGNABLE_ROLES:
        return _stale(req, "wrong_step")
    task = _current_task(req, user, role)
    if task is not None and _int(request.form.get("task_id")) != task.id:
        return _stale(req, "wrong_step")  # the form belongs to an earlier task of the same role

    payload, comment, errors = read_action(req, role, kind, request.form)
    if errors:
        return _failed(req, role, kind, errors, [])
    result = flow.act(req, user.id, kind, role, payload, comment, _now())
    if not result.ok:
        code = result.errors[0]
        if code in STALE:
            return _stale(req, code)
        return _failed(req, role, kind, {}, ["error." + c for c in result.errors])
    flash_key("done." + kind, "success")
    return _back(req)


def _failed(req, role, kind, errors, codes):
    state = empty_card_state()
    state.update(role=role, action=kind, errors=errors, codes=codes, typed=request.form)
    db.session.rollback()
    return _render_detail(req, state)


@bp.post("/<int:request_id>/withdraw")
@login_required
def withdraw(request_id):
    user = current_user()
    req = _request_or_404(request_id)
    comment = (request.form.get("comment") or "").strip()
    result = flow.withdraw(req, user.id, _now(), comment)
    if not result.ok:
        code = result.errors[0]
        if code in STALE:
            return _stale(req, code)
        state = empty_card_state()
        state.update(role="withdraw", action="withdraw", codes=["error." + c for c in result.errors],
                     typed=request.form, withdraw_open=True)
        return _render_detail(req, state)
    flash_key("done.withdraw", "success")
    return _back(req)


def _int(text):
    try:
        return int(text)
    except (TypeError, ValueError):
        return None
