"""Sign-in, sessions, permissions and visibility."""
from flask import Blueprint, abort, current_app, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from ..extensions import db
from ..models import User, audit
from .decorators import login_required, permission_required, safe_next
from .current import current_user, sign_in, sign_out
from .visibility import can_see_request, visible_requests_query

bp = Blueprint("auth", __name__)

__all__ = ["bp", "login_required", "permission_required", "safe_next", "current_user",
           "can_see_request", "visible_requests_query", "ad_authenticate", "hash_password"]

_EXEMPT = {"auth.password", "auth.logout", "static", "main.healthz"}


def hash_password(password):
    return generate_password_hash(password)


def ad_authenticate(username, password):
    """STUB. Active Directory sign-in is pending the owner's decision (ADR 0001, open items).

    Until then users with auth_source 'ad' cannot sign in. Replace the body with an LDAP bind
    when the decision is made; keep the signature.
    """
    return False


def _check_credentials(user, password):
    if user is None or not user.is_active:
        return False
    if user.auth_source == "ad":
        return bool(ad_authenticate(user.username, password))
    return bool(user.password_hash) and check_password_hash(user.password_hash, password)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("auth/login.html", error=None, next=safe_next(request.args.get("next"), ""))
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    nxt = safe_next(request.form.get("next"), "")
    user = User.query.filter(db.func.lower(User.username) == username.lower()).first() if username else None
    if not _check_credentials(user, password):
        audit("login_failed", user_id=user.id if user else None, detail={"username": username[:80]})
        db.session.commit()
        return render_template("auth/login.html", error="login.failed", next=nxt)
    sign_in(user)
    audit("login", user_id=user.id)
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
