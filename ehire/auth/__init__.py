"""Sign-in, sessions, permissions and visibility."""
import hashlib

from flask import Blueprint, abort, current_app, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import User, audit
from . import ad, lockout
from .lifetime import init_lifetime
from .decorators import login_required, permission_required, safe_next
from .current import current_user, sign_in, sign_out
from .visibility import can_see_request, visible_requests_query

bp = Blueprint("auth", __name__)

__all__ = ["bp", "login_required", "permission_required", "safe_next", "current_user",
           "can_see_request", "visible_requests_query", "hash_password"]

_EXEMPT = {"auth.password", "auth.logout", "static", "main.healthz"}


def hash_password(password):
    return generate_password_hash(password)


_DUMMY_HASH = []


def _dummy_hash():
    """A hash of a throwaway password, made once. Checking against it costs the same as a real check."""
    if not _DUMMY_HASH:
        _DUMMY_HASH.append(generate_password_hash("not-a-real-password"))
    return _DUMMY_HASH[0]


def _check_credentials(user, password):
    """The local check. Always spends one password-hash check, so an unknown user, an inactive user and an AD user
    (who has no local password) take as long as a wrong password."""
    if user is None or not user.is_active or user.auth_source != "local" or not user.password_hash:
        check_password_hash(_dummy_hash(), password)
        return False
    return check_password_hash(user.password_hash, password)


def _try_directory(user, username, password):
    """AD attempt for a name that is not a local account. Returns the AdResult, or None when AD is not tried.
    A name that belongs to a local user is never sent to AD: a person in the directory who shares that name must
    not get into the local account."""
    if not ad.enabled() or (user is not None and user.auth_source != "ad"):
        return None
    result = ad.authenticate(username, password)
    if not result.ok:
        current_app.logger.info("AD sign-in did not succeed: %s", result.failure)  # a class name, never a secret
    return result


def _create_ad_user(username, result):
    """First AD sign-in: an inactive account with no password and no roles, for an administrator to activate."""
    user = User(username=username.lower(), full_name=result.full_name or username.lower(), email=result.email,
                auth_source="ad", password_hash=None, must_change_password=False, is_active=False,
                language=current_app.config["DEFAULT_LANGUAGE"])
    db.session.add(user)
    db.session.flush()
    audit("ad_user_created", user_id=user.id, object_type="user", object_id=user.id,
          detail={"username": user.username, "full_name": user.full_name, "email": user.email})
    return user


def _refresh_from_ad(user, result):
    """Later sign-ins keep the name and email in step with the directory (only when the directory was searched)."""
    if result.looked_up:
        user.full_name = result.full_name or user.full_name
        user.email = result.email
    return user


def _failed_detail(user, username):
    """What the audit row keeps about a failed sign-in. A typed name that matches nobody may be a password typed
    into the wrong box, so it is stored only as a short hash."""
    if user is not None:
        return {"username": user.username}
    return {"unknown_user": True, "username_hash": hashlib.sha256(username.lower().encode("utf-8")).hexdigest()[:12]}


@bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("auth/login.html", error=None, next=safe_next(request.args.get("next"), ""))
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    nxt = safe_next(request.form.get("next"), "")
    ip = lockout.client_ip()
    user = User.query.filter(db.func.lower(User.username) == username.lower()).first() if username else None
    wait = lockout.locked_minutes(username, ip)
    ok = _check_credentials(user, password)  # runs even when locked: same timing either way
    method = "local" if ok else None
    if not ok and not wait:  # a locked name is never sent to AD
        found = _try_directory(user, username, password)
        if found is not None and found.ok:
            if user is None:
                try:
                    _create_ad_user(username, found)
                    lockout.clear(username)
                    db.session.commit()
                except IntegrityError:  # two first sign-ins at once: the other one made the account
                    db.session.rollback()
                return render_template("auth/login.html", error=None, notice="login.ad_pending", next=nxt)
            if user.is_active:
                ok, method = True, "ad"
                _refresh_from_ad(user, found)
    if wait:
        return render_template("auth/login.html", error="login.locked", error_params={"n": wait}, next=nxt), 429
    if not ok:
        started = lockout.record_failure(username, ip)
        audit("login_failed", user_id=user.id if user else None, detail=_failed_detail(user, username))
        if started:
            audit("login_locked", user_id=user.id if user else None, detail=_failed_detail(user, username))
        db.session.commit()
        if started:
            wait = lockout.locked_minutes(username, ip)
            return render_template("auth/login.html", error="login.locked", error_params={"n": wait}, next=nxt), 429
        return render_template("auth/login.html", error="login.failed", next=nxt)
    lockout.clear(username)
    sign_in(user)
    audit("login", user_id=user.id, detail={"method": method})
    db.session.commit()
    if user.must_change_password and user.auth_source == "local":
        return redirect(url_for("auth.password", next=nxt or None))
    return redirect(nxt or url_for("main.home"))


@bp.post("/logout")
def logout():
    sign_out()
    return redirect(url_for("auth.login"))


@bp.route("/password", methods=["GET", "POST"])
@login_required
def password():
    user = current_user()
    if user.auth_source != "local":
        abort(404)
    nxt = safe_next(request.values.get("next"), "")
    error = None
    if request.method == "POST":
        new, again = request.form.get("password") or "", request.form.get("repeat") or ""
        n = current_app.config["PASSWORD_MIN_LENGTH"]
        if new != again:
            error = ("password.mismatch", {})
        elif len(new) < n:
            error = ("password.too_short", {"n": n})
        else:
            user.password_hash = hash_password(new)
            user.must_change_password = False
            audit("password_changed", user_id=user.id)
            db.session.commit()
            return redirect(nxt or url_for("main.home"))
    return render_template("auth/password.html", error=error, next=nxt, forced=user.must_change_password)


def init_auth(app):
    app.register_blueprint(bp)
    init_lifetime(app)  # before the handler below: an expired session must count as signed out

    @app.before_request
    def _load_language_and_force_password():
        # Language: ?lang= wins, is kept in the session and stored on the user.
        lang = request.args.get("lang")
        user = current_user()
        if lang in app.config["LANGUAGES"]:
            session["lang"] = lang
            if user is not None and user.language != lang:
                user.language = lang
                db.session.commit()
        g.lang = session.get("lang", app.config["DEFAULT_LANGUAGE"])
        if user is not None and user.must_change_password and user.auth_source == "local":
            if request.endpoint not in _EXEMPT:
                return redirect(url_for("auth.password", next=safe_next(request.full_path.rstrip("?")) or None))

    app.jinja_env.globals["current_user"] = current_user
