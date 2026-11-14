"""Role holders and substitutes (contract 01, role_assignment). Every change is audited.

Changing a holder never reroutes a request in progress (R4). The old holder's open tasks are only listed, with one
explicit button that offers them to whoever the assignment rules now give (C1 to C5).
"""
from datetime import timedelta

from flask import abort, flash, redirect, render_template, request, url_for

from .. import localtime
from ..auth import current_user, permission_required
from ..extensions import db
from ..models import CENTRAL_ROLES, Directorate, Request, RoleAssignment, Task, User, audit
from ..services.notify import notify
from ..services.request_engine import build_directory
from ..services.request_flash import flash_key
from ..workflow.assign import resolve_assignee
from ..workflow.model import Event
from . import bp

SINGLE_DIRECTORATE_ROLES = ("dir_accountant", "sci_director", "dir_hr_officer", "dir_exec")


def _active(role, directorate_id):
    rows = RoleAssignment.query.filter_by(role=role, directorate_id=directorate_id).order_by(RoleAssignment.id).all()
    return [a for a in rows if a.is_active_on()]


def _roles_for(directorate):
    if directorate is None:
        return CENTRAL_ROLES
    return tuple(r for r in SINGLE_DIRECTORATE_ROLES if r != "sci_director" or directorate.has_sci_director)


def _directorate_arg():
    raw = (request.form.get("directorate_id") or "").strip()
    if not raw:
        return None
    directorate = db.session.get(Directorate, int(raw)) if raw.isdigit() else None
    return directorate or abort(404)


def _user_arg(name, required=False):
    raw = (request.form.get(name) or "").strip()
    if not raw:
        return None
    user = db.session.get(User, int(raw)) if raw.isdigit() else None
    if user is None or not user.is_active:
        abort(404)
    return user


def _ended_yesterday():
    return localtime.today() - timedelta(days=1)


def stale_tasks(role, directorate_id):
    """Open tasks of this role (in this Directorate, or any for a central role) that are not with the current
    holder, and not acting for them. These are what a change of holder leaves behind."""
    current = _active(role, directorate_id)
    holder = current[0].user_id if current else None
    query = (Task.query.join(Request, Request.id == Task.request_id)
             .filter(Task.role == role, Task.status == "open", Request.status == "in_progress"))
    if directorate_id is not None:
        query = query.filter(Request.directorate_id == directorate_id)
    return [t for t in query.order_by(Task.id)
            if t.assignee_user_id != holder and t.on_behalf_of_user_id != holder]


def _snapshot(role, directorate_id):
    return [{"user_id": a.user_id, "substitute_user_id": a.substitute_user_id} for a in _active(role, directorate_id)]


@bp.get("/roles")
@permission_required("settings.manage")
def roles():
    users = User.query.filter(User.is_active.is_(True)).order_by(User.full_name, User.username).all()
    groups = []
    for directorate in [None] + Directorate.query.order_by(Directorate.id).all():
        rows = []
        for role in _roles_for(directorate):
            did = directorate.id if directorate else None
            current = _active(role, did)
            rows.append({"role": role, "directorate_id": did,
                         "holder": current[0].user_id if current else None,
                         "substitute": current[0].substitute_user_id if current else None,
                         "stale": len(stale_tasks(role, did))})
        requesters = []
        if directorate is not None:
            requesters = [a.user for a in _active("requester", directorate.id)]
        groups.append({"directorate": directorate, "rows": rows, "requesters": requesters})
    return render_template("settings/roles.html", groups=groups, users=users)


@bp.post("/roles/save")
@permission_required("settings.manage")
def roles_save():
    directorate = _directorate_arg()
    role = request.form.get("role") or ""
    if role not in _roles_for(directorate):
        abort(404)
    did = directorate.id if directorate else None
    holder, sub = _user_arg("holder_id"), _user_arg("substitute_id")
    if holder and sub and holder.id == sub.id:
        flash("settings.same_person", "danger")
        return redirect(url_for("settings.roles"))
    before = _snapshot(role, did)
    current = _active(role, did)
    if holder is None:
        for a in current:
            a.active_to = _ended_yesterday()
    else:
        existing = RoleAssignment.query.filter_by(user_id=holder.id, role=role, directorate_id=did).first()
        for a in current:
            if existing is None or a.id != existing.id:
                a.active_to = _ended_yesterday()
        if existing is None:
            existing = RoleAssignment(user_id=holder.id, role=role, directorate_id=did)
            db.session.add(existing)
        existing.active_from = existing.active_to = None
        existing.substitute_user_id = sub.id if sub else None
    db.session.flush()
    audit("role_changed", user_id=current_user().id, object_type="role_assignment", object_id=role,
          detail={"role": role, "directorate_id": did, "before": before, "after": _snapshot(role, did)})
    db.session.commit()
    flash("settings.saved", "success")
    return redirect(url_for("settings.roles"))


@bp.post("/roles/requester/add")
@permission_required("settings.manage")
def requester_add():
    directorate = _directorate_arg() or abort(404)
    user = _user_arg("user_id")
    if user is None:
        flash("validation.required", "danger")
        return redirect(url_for("settings.roles"))
    row = RoleAssignment.query.filter_by(user_id=user.id, role="requester", directorate_id=directorate.id).first()
    if row is None:
        row = RoleAssignment(user_id=user.id, role="requester", directorate_id=directorate.id)
        db.session.add(row)
    row.active_from = row.active_to = None
    audit("role_changed", user_id=current_user().id, object_type="role_assignment", object_id="requester",
          detail={"role": "requester", "directorate_id": directorate.id, "action": "add", "user_id": user.id})
    db.session.commit()
    flash("settings.saved", "success")
    return redirect(url_for("settings.roles"))


@bp.post("/roles/requester/remove")
@permission_required("settings.manage")
def requester_remove():
    directorate = _directorate_arg() or abort(404)
    user = _user_arg("user_id") or abort(404)
    row = RoleAssignment.query.filter_by(user_id=user.id, role="requester", directorate_id=directorate.id).first()
    if row is None:
        abort(404)
    row.active_to = _ended_yesterday()
    audit("role_changed", user_id=current_user().id, object_type="role_assignment", object_id="requester",
          detail={"role": "requester", "directorate_id": directorate.id, "action": "remove", "user_id": user.id})
    db.session.commit()
    flash("settings.saved", "success")
    return redirect(url_for("settings.roles"))


@bp.post("/roles/reassign")
@permission_required("settings.manage")
def roles_reassign():
    """One explicit button: offer the left-behind open tasks to whoever the rules give now."""
    directorate = _directorate_arg()
    role = request.form.get("role") or ""
    if role not in _roles_for(directorate):
        abort(404)
    did = directorate.id if directorate else None
    me = current_user()
    events, moved, names = [], 0, []
    for task in stale_tasks(role, did):
        req = db.session.get(Request, task.request_id)
        directory = build_directory(db.session, req.directorate_id)
        assignee, behalf, reason = resolve_assignee(role, req.directorate_id, req.created_by, directory)
        if assignee == task.assignee_user_id or assignee is None:
            continue
        before = task.assignee_user_id
        task.assignee_user_id, task.on_behalf_of_user_id, task.redirect_reason = assignee, behalf, reason
        audit("task_redirected", user_id=me.id, request_id=req.id, object_type="task", object_id=task.id,
              detail={"role": role, "from": before, "to": assignee, "on_behalf_of": behalf, "reason": reason,
                      "cause": "holder_changed"})
        events.append(Event("task_opened", req.id, assignee,
                            {"role": role, "step": task.step, "phase": task.phase, "on_behalf_of": behalf,
                             "redirect_reason": reason}))
        moved += 1
        name = db.session.get(User, assignee).full_name
        if name not in names:
            names.append(name)
    notify(events, actor_user_id=me.id)
    audit("role_changed", user_id=me.id, object_type="role_assignment", object_id=role,
          detail={"role": role, "directorate_id": did, "action": "reassign_open_tasks", "moved": moved})
    db.session.commit()
    if moved:
        flash_key("ooo.moved.one" if moved == 1 else "ooo.moved.many", "success", n=moved, who=", ".join(names))
    else:
        flash("settings.saved", "success")
    return redirect(url_for("settings.roles"))
