"""Role holders and substitutes (contract 01, role_assignment). Every change is audited.

The writing is in `ehire.services.role_admin`, shared with the person page. A change of holder or substitute moves the
waiting tasks at once (contract 02, C8, `ehire.services.reassign`); there is no button for it.
"""
import re

from flask import abort, redirect, render_template, request, url_for

from ..auth import current_user, permission_required
from ..extensions import db
from ..models import Directorate, RoleAssignment, User
from ..services import role_admin as ra
from ..services.role_admin import (MULTI_HOLDER_CENTRAL_ROLES, SINGLE_DIRECTORATE_ROLES, active_admin_ids,  # noqa: F401
                                   flash_outcome, roles_for)
from . import bp

NEXT_OK = re.compile(r"^/settings/(roles|users/\d+)$")  # the two pages that may send a change; never another URL


def back(endpoint="roles", **values):
    """Redirect to the page the form came from (hidden `next`), or to `endpoint`."""
    target = (request.form.get("next") or "").strip()
    return redirect(target if NEXT_OK.match(target) else url_for("settings." + endpoint, **values))


def _directorate_arg():
    raw = (request.form.get("directorate_id") or "").strip()
    if not raw:
        return None
    directorate = db.session.get(Directorate, int(raw)) if raw.isdigit() else None
    return directorate or abort(404)


def _user_arg(name):
    raw = (request.form.get(name) or "").strip()
    if not raw:
        return None
    user = db.session.get(User, int(raw)) if raw.isdigit() else None
    if user is None or not user.is_active:
        abort(404)
    return user


def finish(outcome, endpoint="roles", **values):
    """Commit a good outcome (the change and the moved tasks together), drop a refused one, flash, go back."""
    if outcome.ok:
        db.session.commit()
    else:
        db.session.rollback()
    flash_outcome(outcome)
    return back(endpoint, **values)


def _grouped():
    """Active rows by (role, directorate_id), oldest first, loaded once."""
    out = {}
    for a in RoleAssignment.query.order_by(RoleAssignment.id).all():
        if a.is_active_on():
            out.setdefault((a.role, a.directorate_id), []).append(a)
    return out


@bp.get("/roles")
@permission_required("settings.manage")
def roles():
    everyone = User.query.order_by(User.full_name, User.username).all()
    users = [u for u in everyone if u.is_active]
    by_id = {u.id: u for u in everyone}
    rows_by = _grouped()
    groups, empty = [], []
    for directorate in [None] + Directorate.query.order_by(Directorate.id).all():
        did = directorate.id if directorate else None
        rows = []
        for role in roles_for(directorate):
            current = rows_by.get((role, did), [])
            holder = by_id.get(current[0].user_id) if current else None
            row = {"role": role, "directorate_id": did, "anchor": "r-%d-%s" % (did or 0, role),
                   "holder": holder.id if holder else None,
                   "holder_inactive": holder is not None and not holder.is_active,
                   "substitute": current[0].substitute_user_id if current else None}
            rows.append(row)
            if holder is None or not holder.is_active:
                empty.append({"directorate": directorate, "role": role, "anchor": row["anchor"],
                              "inactive": holder is not None})
        requesters = [by_id[a.user_id] for a in rows_by.get(("requester", did), [])] if directorate else []
        groups.append({"directorate": directorate, "rows": rows, "requesters": requesters})
    others = [{"role": role, "holders": [by_id[a.user_id] for a in rows_by.get((role, None), [])]}
              for role in MULTI_HOLDER_CENTRAL_ROLES]
    return render_template("settings/roles.html", groups=groups, users=users, others=others, empty=empty)


@bp.post("/roles/save")
@permission_required("settings.manage")
def roles_save():
    directorate = _directorate_arg()
    role = request.form.get("role") or ""
    if role not in roles_for(directorate):
        abort(404)
    holder, sub = _user_arg("holder_id"), _user_arg("substitute_id")
    return finish(ra.set_single(current_user().id, role, directorate, holder, sub))


@bp.post("/roles/requester/add")
@permission_required("settings.manage")
def requester_add():
    directorate = _directorate_arg() or abort(404)
    user = _user_arg("user_id")
    if user is None:
        return finish(ra.fail("validation.required"))
    return finish(ra.add_requester(current_user().id, user, directorate))


@bp.post("/roles/requester/remove")
@permission_required("settings.manage")
def requester_remove():
    directorate = _directorate_arg() or abort(404)
    user = _user_arg("user_id") or abort(404)
    row = RoleAssignment.query.filter_by(user_id=user.id, role="requester", directorate_id=directorate.id).first()
    if row is None:
        abort(404)
    return finish(ra.remove_requester(current_user().id, user, directorate))


def _multi_role():
    role = request.form.get("role") or ""
    if role not in MULTI_HOLDER_CENTRAL_ROLES:
        abort(404)
    return role


@bp.post("/roles/holder/add")
@permission_required("settings.manage")
def holder_add():
    """Add a holder of `viewer` or `admin`. Many people may hold each; neither belongs to a Directorate."""
    role = _multi_role()
    user = _user_arg("user_id")
    if user is None:
        return finish(ra.fail("validation.required"))
    return finish(ra.add_multi(current_user().id, user, role))


@bp.post("/roles/holder/remove")
@permission_required("settings.manage")
def holder_remove():
    role = _multi_role()
    raw = (request.form.get("user_id") or "").strip()
    user = db.session.get(User, int(raw)) if raw.isdigit() else None  # an inactive holder can still be removed
    if user is None:
        abort(404)
    row = RoleAssignment.query.filter_by(user_id=user.id, role=role, directorate_id=None).first()
    if row is None or not row.is_active_on():
        abort(404)
    return finish(ra.remove_multi(current_user().id, user, role))
