"""Configuration. Values come from environment variables so nothing secret is committed."""
import os


def _flag(name, default=False):
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


class Config:
    # "production" turns on the start-up checks in ehr/security.py (real secret, CSRF on, not SQLite, no debug).
    EHR_ENV = os.environ.get("EHR_ENV", "development")
    # True when users reach the app over HTTPS (through the organisation's reverse proxy): Secure cookie and HSTS.
    EHR_HTTPS = _flag("EHR_HTTPS")
    # Number of reverse proxies in front of gunicorn that set X-Forwarded-For/-Proto. 0 trusts none.
    EHR_PROXY_HOPS = int(os.environ.get("EHR_PROXY_HOPS", "0"))
    SECRET_KEY = os.environ.get("EHR_SECRET_KEY", "dev-only-change-me")
    # Engine is undecided until Marios confirms what eFinance uses (ADR 0001).
    SQLALCHEMY_DATABASE_URI = os.environ.get("EHR_DATABASE_URI", "sqlite:///ehr.sqlite3")
    # Times are stored in UTC and shown in this zone (zoneinfo name). Also the day boundary for working-day counts.
    EHR_TIMEZONE = os.environ.get("EHR_TIMEZONE", "Europe/Nicosia")
    DEFAULT_LANGUAGE = "el"
    LANGUAGES = ("el", "en")
    SESSION_COOKIE_NAME = "ehr_session"  # must differ from eFinance on the same host
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _flag("EHR_HTTPS")
    SESSION_IDLE_MINUTES = int(os.environ.get("EHR_SESSION_IDLE_MINUTES", "30"))  # signed out after this long without a request
    SESSION_MAX_HOURS = int(os.environ.get("EHR_SESSION_MAX_HOURS", "12"))  # signed out this long after signing in
    # Sign-in protection: failures per username (and per address) in the window lock it for the same time.
    LOGIN_MAX_FAILURES = 5
    LOGIN_IP_MAX_FAILURES = 20
    LOGIN_WINDOW_MINUTES = 15
    # Uploads: OOXML files (docx, xlsx) are inspected before they are accepted or converted.
    EHR_MAX_UNZIPPED_MB = int(os.environ.get("EHR_MAX_UNZIPPED_MB", "200"))
    # When true, every request answers 503 while the database is behind the code (`flask upgrade-db` fixes it).
    EHR_CHECK_SCHEMA = True
    CSRF_ENABLED = True  # honoured as False only when TESTING is also true
    PASSWORD_MIN_LENGTH = 8
    # Documents. Empty storage dir means <instance folder>/storage. Empty soffice path means "look on PATH".
    EHR_STORAGE_DIR = os.environ.get("EHR_STORAGE_DIR", "")
    EHR_SOFFICE_BIN = os.environ.get("EHR_SOFFICE_BIN", "")
    EHR_CONVERT_TIMEOUT = int(os.environ.get("EHR_CONVERT_TIMEOUT", "60"))
    # Email. The link in every message is built from EHR_BASE_URL. SMTP and Graph settings are read from the
    # environment when a message is sent (see ehr/mail/backends.py); nothing secret is stored here or in the database.
    EHR_BASE_URL = os.environ.get("EHR_BASE_URL", "http://127.0.0.1:5008")
    MAIL_AUTO_FLUSH = True  # best-effort send right after a successful web request; `flask send-mail` is the safety net
    MAIL_MAX_AGE_HOURS = 48  # with a real backend, older queued mail is marked failed instead of sent late
    # OAY activity figures from eFinance (docs/contracts/05-efinance-activity-link.md). Empty URL or token means
    # "not configured": the setting can't be switched to eFinance. The token lives here, never in the database.
    EHR_EFINANCE_URL = os.environ.get("EHR_EFINANCE_URL", "")
    EHR_EFINANCE_TOKEN = os.environ.get("EHR_EFINANCE_TOKEN", "")
    EHR_EFINANCE_TIMEOUT = float(os.environ.get("EHR_EFINANCE_TIMEOUT", "5"))
    EHR_EFINANCE_CA_FILE = os.environ.get("EHR_EFINANCE_CA_FILE", "")  # optional private CA bundle
    MAX_CONTENT_LENGTH = 120 * 1024 * 1024  # a whole post; each file is also held to the max_file_mb setting


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    CSRF_ENABLED = False
    MAIL_AUTO_FLUSH = False
    EHR_CHECK_SCHEMA = False  # tests build tables with create_all
