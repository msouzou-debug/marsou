"""Users: add, edit, activate and deactivate. Never deleted. Passwords are stored hashed only."""
import re

from flask import abort, current_app, flash, redirect, render_template, request, url_for
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from ..auth import current_user, hash_password, permission_required
from ..extensions import db
from ..models import User, audit
from ..services.request_flash import flash_key
from . import bp

USERNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{1,79}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _back():
    return redirect(url_for("settings.users"))


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


@bp.get("/users")
@permission_required("settings.manage")
def users():
    rows = User.query.order_by(User.is_active.desc(), User.full_name, User.username).all()
    return render_template("settings/users.html", rows=rows, managers=[u for u in rows if u.is_active],
                           min_length=current_app.config["PASSWORD_MIN_LENGTH"])


@bp.post("/users/add")
@permission_required("settings.manage")
def users_add():
    username = (request.form.get("username") or "").strip()
    password = request.form.get("temp_password") or ""
    if not username or not USERNAME.match(username):
        flash("validation.required", "danger")
        return _back()
    values, key, params = _read(True)
    if values is None:
        flash_key(key, "danger", **params)
        return _back()
    minimum = current_app.config["PASSWORD_MIN_LENGTH"]
    if len(password) < minimum:
        flash_key("password.too_short", "danger", n=minimum)
        return _back()
    if User.query.filter(func.lower(User.username) == username.lower()).first():
        flash("settings.user.duplicate", "danger")
        return _back()
    user = User(username=username, password_hash=hash_password(password), auth_source="local",
                must_change_password=True, is_active=True, **values)
    db.session.add(user)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        flash("settings.user.duplicate", "danger")
        return _back()
    audit("user_changed", user_id=current_user().id, object_type="user", object_id=user.id,
          detail={"action": "add", "after": _snapshot(user)})  # the password is never written to the log
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
        return _back()
    if values["line_manager_user_id"] == user.id:
        flash("validation.choose", "danger")
        return _back()
    before = _snapshot(user)
    for k, v in values.items():
        setattr(user, k, v)
    audit("user_changed", user_id=current_user().id, object_type="user", object_id=user.id,
          detail={"action": "edit", "before": before, "after": _snapshot(user)})
    db.session.commit()
    flash("settings.saved", "success")
    return _back()


@bp.post("/users/<int:user_id>/toggle")
@permission_required("settings.manage")
def users_toggle(user_id):
    user = db.session.get(User, user_id) or abort(404)
    if user.id == current_user().id and user.is_active:
        flash("settings.self_deactivate", "danger")
        return _back()
    user.is_active = not user.is_active
    audit("user_changed", user_id=current_user().id, object_type="user", object_id=user.id,
          detail={"action": "activate" if user.is_active else "deactivate"})
    db.session.commit()
    flash("settings.saved", "success")
    return _back()
