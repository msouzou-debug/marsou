"""Users: add, edit, activate and deactivate. Never deleted. Passwords are stored hashed only."""
import re

from flask import abort, current_app, flash, redirect, render_template, request, url_for
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from ..auth import ad, current_user, hash_password, lockout, permission_required
from ..extensions import db
from ..models import AuditLog, Directorate, LoginAttempt, RoleAssignment, User, audit
from ..services import role_admin as ra
from ..services.request_flash import flash_key
from . import bp
from .roles import _user_arg, back, finish

USERNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{1,79}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _back(user_id=None):
    """Back to the page the form came from (`next`), else to the person page, else to the list."""
    if user_id is None:
        return back("users")
    return back("user_page", user_id=user_id)


def _read(creating):
    """Posted values, or (None, message_key, params) for the first problem."""
    form = request.form
    values = {"full_name": (form.get("full_name") or "").strip(), "email": (form.get("email") or "").strip(),
              "language": form.get("language") or "el"}
    if not values["full_name"]:
        return None, "validation.required", {}
    if values["language"] not in current_app.config["LANGUAGES"]:
        return None, "validation.choose", {}
    if values["email"] and not EMAIL.match(values["email"]):
        return None, "settings.user.email_invalid", {}
    manager = (form.get("line_manager_user_id") or "").strip()
    values["line_manager_user_id"] = None
    if manager:
        boss = db.session.get(User, int(manager)) if manager.isdigit() else None
        if boss is None or not boss.is_active:
            return None, "validation.choose", {}
        values["line_manager_user_id"] = boss.id
    values["email"] = values["email"] or None
    return values, None, {}


def _snapshot(user):
    return {"username": user.username, "full_name": user.full_name, "email": user.email, "language": user.language,
            "line_manager_user_id": user.line_manager_user_id, "is_active": user.is_active}


def _pending_ids(rows):
    """Directory users created by their first sign-in that no administrator has handled yet: inactive, never
    signed in, never activated or deactivated."""
    ids = [u.id for u in rows if u.auth_source == "ad" and not u.is_active]
    if not ids:
        return set()
    handled = {r[0] for r in db.session.query(AuditLog.user_id).filter(AuditLog.event == "login", AuditLog.user_id.in_(ids))}
    handled |= {int(r[0]) for r in db.session.query(AuditLog.object_id).filter(
        AuditLog.event == "user_changed", AuditLog.object_type == "user", AuditLog.object_id.in_([str(i) for i in ids]))}
    return set(ids) - handled


def _assignments_by_user():
    """Active role rows, loaded once: ({user_id: [rows held]}, {user_id: [rows covered as substitute]})."""
    held, covers = {}, {}
    for a in RoleAssignment.query.order_by(RoleAssignment.role, RoleAssignment.id).all():
        if not a.is_active_on():
            continue
        held.setdefault(a.user_id, []).append(a)
        if a.substitute_user_id:
            covers.setdefault(a.substitute_user_id, []).append(a)
    return held, covers


def _matches(user, held, covers, role, directorate):
    """True when the person holds, or covers for, `role` and/or something in `directorate` ("" = no filter,
    "central" = no Directorate)."""
    rows = held.get(user.id, []) + covers.get(user.id, [])
    for a in rows:
        if role and a.role != role:
            continue
        if directorate == "central" and a.directorate_id is not None:
            continue
        if directorate not in ("", "central") and a.directorate_id != int(directorate):
            continue
        return True
    return False


@bp.get("/users")
@permission_required("settings.manage")
def users():
    rows = User.query.order_by(User.is_active.desc(), User.full_name, User.username).all()
    pending = _pending_ids(rows)
    only_pending = request.args.get("show") == "pending"
    q = (request.args.get("q") or "").strip()
    role = request.args.get("role") or ""
    directorate = request.args.get("directorate") or ""
    status = request.args.get("status") or ""
    if role not in ra.ALL_ROLES:
        role = ""
    if directorate != "central" and not directorate.isdigit():
        directorate = ""
    if status not in ("active", "inactive"):
        status = ""
    held, covers = _assignments_by_user()
    shown = [u for u in rows if u.id in pending] if only_pending else list(rows)
    if q:
        needle = q.casefold()
        shown = [u for u in shown if needle in (u.full_name or "").casefold() or needle in u.username.casefold()]
    if status:
        shown = [u for u in shown if u.is_active == (status == "active")]
    if role or directorate:
        shown = [u for u in shown if _matches(u, held, covers, role, directorate)]
    directorates = Directorate.query.order_by(Directorate.id).all()
    return render_template("settings/users.html", rows=shown, held=held, covers=covers, pending=pending,
                           only_pending=only_pending, ad_configured=ad.configured(), me=current_user(),
                           managers=[u for u in rows if u.is_active], directorates=directorates,
                           roles=ra.ALL_ROLES, filters={"q": q, "role": role, "directorate": directorate,
                                                        "status": status},
                           filtered=bool(q or role or directorate or status), total=len(rows),
                           min_length=current_app.config["PASSWORD_MIN_LENGTH"])


@bp.get("/users/<int:user_id>")
@permission_required("settings.manage")
def user_page(user_id):
    user = db.session.get(User, user_id) or abort(404)
    held, covers = _assignments_by_user()
    mine = sorted(held.get(user.id, []), key=lambda a: (ra.ALL_ROLES.index(a.role) if a.role in ra.ALL_ROLES else 99,
                                                        a.directorate_id or 0))
    everyone = User.query.order_by(User.full_name, User.username).all()
    active = [u for u in everyone if u.is_active]
    directorates = Directorate.query.order_by(Directorate.id).all()
    return render_template("settings/user.html", u=user, mine=mine, covers=covers.get(user.id, []),
                           roles=ra.ALL_ROLES, directorates=directorates, people=[p for p in active if p.id != user.id],
                           managers=active, pending=user.id in _pending_ids([user]), me=current_user(),
                           ad_configured=ad.configured(), min_length=current_app.config["PASSWORD_MIN_LENGTH"],
                           dir_roles=[r for r in ra.ALL_ROLES if ra.needs_directorate(r)],
                           single_roles=[r for r in ra.ALL_ROLES if ra.is_single(r)],
                           sci_ids=[d.id for d in directorates if d.has_sci_director])


def _assignment_arg(user_id, aid, covering=False):
    """An active row held by this person (or, when covering, one where they are the substitute)."""
    row = db.session.get(RoleAssignment, aid) or abort(404)
    owner = row.substitute_user_id if covering else row.user_id
    if owner != user_id or not row.is_active_on():
        abort(404)
    return row


@bp.post("/users/<int:user_id>/roles/add")
@permission_required("settings.manage")
def user_role_add(user_id):
    user = db.session.get(User, user_id) or abort(404)
    raw = (request.form.get("directorate_id") or "").strip()
    directorate = db.session.get(Directorate, int(raw)) if raw.isdigit() else None
    sub = _user_arg("substitute_id")
    outcome = ra.add_to_role(current_user().id, user, request.form.get("role") or "", directorate, sub,
                             request.form.get("replace") == "1")
    return finish(outcome, "user_page", user_id=user.id)


@bp.post("/users/<int:user_id>/roles/<int:aid>/substitute")
@permission_required("settings.manage")
def user_role_substitute(user_id, aid):
    row = _assignment_arg(user_id, aid)
    if not ra.is_single(row.role):
        abort(404)
    return finish(ra.set_substitute(current_user().id, row, _user_arg("substitute_id")),
                  "user_page", user_id=user_id)


@bp.post("/users/<int:user_id>/roles/<int:aid>/remove")
@permission_required("settings.manage")
def user_role_remove(user_id, aid):
    row = _assignment_arg(user_id, aid)
    return finish(ra.remove_assignment(current_user().id, row), "user_page", user_id=user_id)


@bp.post("/users/<int:user_id>/covers/<int:aid>/remove")
@permission_required("settings.manage")
def user_cover_remove(user_id, aid):
    """Stop someone covering for a holder: clears the substitute on that row."""
    row = _assignment_arg(user_id, aid, covering=True)
    return finish(ra.set_substitute(current_user().id, row, None), "user_page", user_id=user_id)


@bp.post("/users/add")
@permission_required("settings.manage")
def users_add():
    username = (request.form.get("username") or "").strip()
    password = request.form.get("temp_password") or ""
    source = request.form.get("auth_source") or "local"
    if source not in ("local", "ad"):
        flash("validation.choose", "danger")
        return _back()
    if source == "ad":
        # Stored exactly as the sign-in page looks it up: the bare, lowercased account name (auth/ad.py).
        username = ad.normalise_username(username)
        if username is None:
            flash("settings.user.ad_username_invalid", "danger")
            return _back()
    elif not username or not USERNAME.match(username):
        flash("validation.required", "danger")
        return _back()
    values, key, params = _read(True)
    if values is None:
        flash_key(key, "danger", **params)
        return _back()
    minimum = current_app.config["PASSWORD_MIN_LENGTH"]
    if source == "local" and len(password) < minimum:
        flash_key("password.too_short", "danger", n=minimum)
        return _back()
    if User.query.filter(func.lower(User.username) == username.lower()).first():
        flash("settings.user.duplicate", "danger")
        return _back()
    if source == "local":
        extra = {"password_hash": hash_password(password), "must_change_password": True}
    else:  # a directory account has no password here; it is active so the person can sign in at once
        extra = {"password_hash": None, "must_change_password": False}
    user = User(username=username, auth_source=source, is_active=True, **extra, **values)
    db.session.add(user)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        flash("settings.user.duplicate", "danger")
        return _back()
    audit("user_changed", user_id=current_user().id, object_type="user", object_id=user.id,
          detail={"action": "add", "auth_source": source, "after": _snapshot(user)})  # never the password
    db.session.commit()
    flash("settings.saved", "success")
    return _back()


@bp.post("/users/<int:user_id>/edit")
@permission_required("settings.manage")
def users_edit(user_id):
    user = db.session.get(User, user_id) or abort(404)
    values, key, params = _read(False)
    if values is None:
        flash_key(key, "danger", **params)
        return _back(user_id)
    if values["line_manager_user_id"] == user.id:
        flash("validation.choose", "danger")
        return _back(user_id)
    before = _snapshot(user)
    for k, v in values.items():
        setattr(user, k, v)
    audit("user_changed", user_id=current_user().id, object_type="user", object_id=user.id,
          detail={"action": "edit", "before": before, "after": _snapshot(user)})
    db.session.commit()
    flash("settings.saved", "success")
    return _back(user_id)


@bp.post("/users/<int:user_id>/toggle")
@permission_required("settings.manage")
def users_toggle(user_id):
    user = db.session.get(User, user_id) or abort(404)
    return finish(ra.toggle_account(current_user().id, user), "user_page", user_id=user.id)


@bp.post("/users/<int:user_id>/password")
@permission_required("settings.manage")
def users_password(user_id):
    """An administrator sets a new temporary password for a local account. The person must change it at the next
    sign-in. The sign-in lock for the name is cleared. The password is never stored in clear or written to the log."""
    user = db.session.get(User, user_id) or abort(404)
    if user.auth_source != "local":
        flash("settings.user.password_ad", "danger")
        return _back(user_id)
    if user.id == current_user().id:
        flash("settings.user.password_own", "danger")
        return _back(user_id)
    password = request.form.get("new_password") or ""
    minimum = current_app.config["PASSWORD_MIN_LENGTH"]
    if len(password) < minimum:
        flash_key("password.too_short", "danger", n=minimum)
        return _back(user_id)
    user.password_hash = hash_password(password)
    user.must_change_password = True
    cleared = LoginAttempt.query.filter_by(username=lockout.key(user.username)).delete()
    audit("password_changed", user_id=current_user().id, object_type="user", object_id=user.id,
          detail={"by": "admin", "target_user_id": user.id, "attempts_cleared": cleared})
    db.session.commit()
    flash("settings.user.password_set", "success")
    return _back(user_id)
