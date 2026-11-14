"""CSRF protection: one token per session, checked on every unsafe request."""
import hmac
import os
import re
import secrets
from pathlib import Path

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


CODE_ROOT = Path(__file__).resolve().parent.parent
_AD_ATTRIBUTE = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,63}$")


def _sqlite_problems(cfg):
    """SQLite in production: the file is an absolute path outside the code folder, in a folder the service user can
    write, because WAL creates the -wal and -shm files beside it. Other engines are not checked here."""
    from sqlalchemy.engine import make_url

    uri = str(cfg.get("SQLALCHEMY_DATABASE_URI") or "")
    if not uri.lower().startswith("sqlite"):
        return []
    path = make_url(uri).database or ""
    if path in ("", ":memory:") or path.startswith("file:"):
        return ["EHR_DATABASE_URI is an in-memory or file: SQLite database. Production needs a file, "
                "for example sqlite:////var/lib/ehr/ehr.sqlite3."]
    if not os.path.isabs(path):
        return ["EHR_DATABASE_URI is a relative SQLite path (%s). Use an absolute path outside the code folder, "
                "for example sqlite:////var/lib/ehr/ehr.sqlite3 (four slashes)." % path]
    real = Path(os.path.realpath(path))
    if real == CODE_ROOT or CODE_ROOT in real.parents:
        return ["The SQLite file %s is inside the code folder %s. A release upgrade would replace it. "
                "Put it in its own folder, for example /var/lib/ehr/." % (path, CODE_ROOT)]
    folder = real.parent
    if not folder.is_dir() or not os.access(folder, os.W_OK | os.X_OK):
        return ["The folder %s for the SQLite file does not exist or is not writable by this user. "
                "SQLite in WAL mode creates ehr.sqlite3-wal and ehr.sqlite3-shm in the same folder." % folder]
    if real.exists() and not os.access(real, os.R_OK | os.W_OK):
        return ["The SQLite file %s exists but this user cannot read and write it." % path]
    return []


def _ad_problems(cfg):
    """Active Directory in production: LDAPS only, certificate checked against the organisation's CA file."""
    if not cfg.get("EHR_AD_ENABLED"):
        return []
    out = []
    if not cfg.get("EHR_AD_SERVER") or not cfg.get("EHR_AD_DOMAIN"):
        out.append("EHR_AD_ENABLED is on but EHR_AD_SERVER or EHR_AD_DOMAIN is empty.")
    if not cfg.get("EHR_AD_USE_SSL", True):
        out.append("EHR_AD_USE_SSL is off. Active Directory sign-in in production uses LDAPS only (port 636).")
    ca = cfg.get("EHR_AD_CA_FILE") or ""
    if not ca or not os.path.isfile(ca) or not os.access(ca, os.R_OK):
        out.append("EHR_AD_CA_FILE is empty or not a readable file. Active Directory needs the organisation's CA "
                   "certificate (PEM) from IT, to check the server certificate.")
    if not _AD_ATTRIBUTE.match(str(cfg.get("EHR_AD_UID_ATTRIBUTE") or "")):
        out.append("EHR_AD_UID_ATTRIBUTE must be a plain attribute name such as sAMAccountName.")
    return out


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
    problems.extend(_sqlite_problems(cfg))
    problems.extend(_ad_problems(cfg))
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
