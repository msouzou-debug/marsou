"""CSRF protection: one token per session, checked on every unsafe request."""
import hmac
import secrets

from flask import abort, current_app, request, session

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def csrf_token():
    token = session.get("_csrf")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf"] = token
    return token


def csrf_enabled():
    cfg = current_app.config
    return not (cfg.get("TESTING") and not cfg.get("CSRF_ENABLED", True))


def _check_csrf():
    if request.method in SAFE_METHODS or not csrf_enabled():
        return
    sent = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token") or ""
    expected = session.get("_csrf", "")
    if not expected or not hmac.compare_digest(sent, expected):
        abort(400)


def init_csrf(app):
    app.before_request(_check_csrf)
    app.jinja_env.globals["csrf_token"] = csrf_token
