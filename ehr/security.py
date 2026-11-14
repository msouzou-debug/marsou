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
    # Compare bytes: compare_digest raises TypeError (a 500) for a str with non-ASCII characters.
    if not expected or not hmac.compare_digest(sent.encode("utf-8"), expected.encode("utf-8")):
        abort(400)


def init_csrf(app):
    app.before_request(_check_csrf)
    app.jinja_env.globals["csrf_token"] = csrf_token


# ---------------------------------------------------------------------------------------------- start-up checks

DEFAULT_SECRET = "dev-only-change-me"


class ConfigError(RuntimeError):
    """The app refuses to start with this configuration."""


def check_production_config(app):
    """In production (EHR_ENV=production) refuse unsafe settings with a message that says what to change."""
    cfg = app.config
    if cfg.get("EHR_ENV") != "production":
        return
    problems = []
    secret = cfg.get("SECRET_KEY") or ""
    if secret == DEFAULT_SECRET or len(secret) < 16:
        problems.append("EHR_SECRET_KEY is missing, too short (under 16 characters) or still the default. "
                        "Set a long random value in the environment file.")
    if not cfg.get("CSRF_ENABLED", True) or cfg.get("TESTING"):
        problems.append("CSRF protection is off or TESTING is on. Production must run with CSRF on and TESTING off.")
    if cfg.get("DEBUG") or app.debug:
        problems.append("Debug mode is on. Never run production in debug mode.")
    if str(cfg.get("SQLALCHEMY_DATABASE_URI") or "").lower().startswith("sqlite"):
        problems.append("EHR_DATABASE_URI points at SQLite. SQLite is for development and tests only.")
    if problems:
        raise ConfigError("eHR will not start in production mode:\n- " + "\n- ".join(problems))


# ---------------------------------------------------------------------------------------------- response headers

# No inline scripts exist in the templates or static files. Inline style attributes do (templates by several
# authors), and they cannot carry a nonce, so style-src keeps 'unsafe-inline'. Scripts stay strict.
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
# Endpoints whose page may be framed by this same site (the email-log preview sets its own CSP too).
SAMEORIGIN_ENDPOINTS = {"settings.outbox_show"}


def init_security_headers(app):
    @app.after_request
    def _headers(resp):
        h = resp.headers
        h.setdefault("Content-Security-Policy", CSP)
        h.setdefault("X-Content-Type-Options", "nosniff")
        h["X-Frame-Options"] = "SAMEORIGIN" if request.endpoint in SAMEORIGIN_ENDPOINTS else "DENY"
        h.setdefault("Referrer-Policy", "same-origin")
        h.setdefault("Permissions-Policy", PERMISSIONS_POLICY)
        if request.endpoint != "static":
            h.setdefault("Cache-Control", "no-store")
        if current_app.config.get("EHR_HTTPS"):
            h.setdefault("Strict-Transport-Security", "max-age=31536000")  # no includeSubDomains: shared host
        return resp
