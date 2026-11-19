"""Configuration. Values come from environment variables so nothing secret is committed."""
import os


def _flag(name, default=False):
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


class Config:
    # "production" turns on the start-up checks in ehire/security.py (real secret, CSRF on, SQLite file placed safely, no debug, AD over verified LDAPS).
    EHIRE_ENV = os.environ.get("EHIRE_ENV", "development")
    # True when users reach the app over HTTPS (through the organisation's reverse proxy): Secure cookie and HSTS.
    EHIRE_HTTPS = _flag("EHIRE_HTTPS")
    # Number of reverse proxies in front of gunicorn that set X-Forwarded-For/-Proto. 0 trusts none.
    EHIRE_PROXY_HOPS = int(os.environ.get("EHIRE_PROXY_HOPS", "0"))
    SECRET_KEY = os.environ.get("EHIRE_SECRET_KEY", "dev-only-change-me")
    # SQLite is the production engine (Marios, 14/11/2026; ADR 0001). In production the file must be an absolute path
    # outside the code folder, in a folder the service user can write (WAL creates -wal and -shm files beside it).
    SQLALCHEMY_DATABASE_URI = os.environ.get("EHIRE_DATABASE_URI", "sqlite:///ehire.sqlite3")
    # SQLite only: how long a writer waits for the lock before "database is locked" (milliseconds).
    EHIRE_SQLITE_BUSY_TIMEOUT_MS = int(os.environ.get("EHIRE_SQLITE_BUSY_TIMEOUT_MS", "5000"))
    # Active Directory sign-in next to local accounts (ehire/auth/ad.py). Off by default. LDAPS only, certificate checked.
    EHIRE_AD_ENABLED = _flag("EHIRE_AD_ENABLED")
    EHIRE_AD_SERVER = os.environ.get("EHIRE_AD_SERVER", "").strip()
    EHIRE_AD_PORT = int(os.environ.get("EHIRE_AD_PORT", "636"))
    EHIRE_AD_DOMAIN = os.environ.get("EHIRE_AD_DOMAIN", "").strip()  # users bind as <username>@<domain>
    EHIRE_AD_BASE_DN = os.environ.get("EHIRE_AD_BASE_DN", "").strip()  # empty: no lookup of name and email
    EHIRE_AD_UID_ATTRIBUTE = os.environ.get("EHIRE_AD_UID_ATTRIBUTE", "sAMAccountName").strip()
    EHIRE_AD_CA_FILE = os.environ.get("EHIRE_AD_CA_FILE", "").strip()  # the organisation's internal CA, from IT
    EHIRE_AD_TIMEOUT = float(os.environ.get("EHIRE_AD_TIMEOUT", "5"))  # seconds, connect and receive
    EHIRE_AD_USE_SSL = _flag("EHIRE_AD_USE_SSL", True)  # leave on. Off is for a throwaway test server, never production
    # Times are stored in UTC and shown in this zone (zoneinfo name). Also the day boundary for working-day counts.
    EHIRE_TIMEZONE = os.environ.get("EHIRE_TIMEZONE", "Europe/Nicosia")
    DEFAULT_LANGUAGE = "el"
    LANGUAGES = ("el", "en")
    SESSION_COOKIE_NAME = "ehire_session"  # must differ from eFinance on the same host
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _flag("EHIRE_HTTPS")
    SESSION_IDLE_MINUTES = int(os.environ.get("EHIRE_SESSION_IDLE_MINUTES", "30"))  # signed out after this long without a request
    SESSION_MAX_HOURS = int(os.environ.get("EHIRE_SESSION_MAX_HOURS", "12"))  # signed out this long after signing in
    # Sign-in protection: failures per username (and per address) in the window lock it for the same time.
    LOGIN_MAX_FAILURES = 5
    LOGIN_IP_MAX_FAILURES = 20
    LOGIN_WINDOW_MINUTES = 15
    # Uploads: OOXML files (docx, xlsx) are inspected before they are accepted or converted.
    EHIRE_MAX_UNZIPPED_MB = int(os.environ.get("EHIRE_MAX_UNZIPPED_MB", "200"))
    # When true, every request answers 503 while the database is behind the code (`flask upgrade-db` fixes it).
    EHIRE_CHECK_SCHEMA = True
    CSRF_ENABLED = True  # honoured as False only when TESTING is also true
    PASSWORD_MIN_LENGTH = 8
    # Documents. Empty storage dir means <instance folder>/storage. Empty soffice path means "look on PATH".
    EHIRE_STORAGE_DIR = os.environ.get("EHIRE_STORAGE_DIR", "")
    EHIRE_SOFFICE_BIN = os.environ.get("EHIRE_SOFFICE_BIN", "")
    EHIRE_CONVERT_TIMEOUT = int(os.environ.get("EHIRE_CONVERT_TIMEOUT", "60"))
    # eArchive deposits (docs/contracts/06-earchive-deposit.md). The transport is the `archive_transport` setting
    # (none, folder, http). The folder transport writes each deposit into EHIRE_ARCHIVE_DROP_DIR.
    EHIRE_ARCHIVE_DROP_DIR = os.environ.get("EHIRE_ARCHIVE_DROP_DIR", "")
    # The http transport talks to eArchive on this machine (docs/contracts/06-earchive-deposit.md). The URL must be
    # loopback and plain http; the token comes from the environment file only and is never stored or logged.
    EHIRE_ARCHIVE_URL = os.environ.get("EHIRE_ARCHIVE_URL", "http://127.0.0.1:5011")
    EHIRE_ARCHIVE_TOKEN = os.environ.get("EHIRE_ARCHIVE_TOKEN", "")
    # eArchive's public web address (http or https). Empty: the protocol number is shown as text. Set: it links to
    # <address>/protocols/<protocol_id>, for every request including old ones.
    EHIRE_ARCHIVE_WEB_URL = os.environ.get("EHIRE_ARCHIVE_WEB_URL", "")
    ARCHIVE_AUTO_FLUSH = True  # after a successful request that queued a deposit, hand over deposits that are ready
    ARCHIVE_RENDER_AFTER_REQUEST = False  # PDFs are made by `flask send-archive`: LibreOffice takes seconds
    # Email. The link in every message is built from EHIRE_BASE_URL. SMTP and Graph settings are read from the
    # environment when a message is sent (see ehire/mail/backends.py); nothing secret is stored here or in the database.
    EHIRE_BASE_URL = os.environ.get("EHIRE_BASE_URL", "http://127.0.0.1:5008")
    MAIL_AUTO_FLUSH = True  # best-effort send right after a successful web request; `flask send-mail` is the safety net
    MAIL_MAX_AGE_HOURS = 48  # with a real backend, older queued mail is marked failed instead of sent late
    # OAY activity figures from eFinance (docs/contracts/05-efinance-activity-link.md). Empty URL or token means
    # "not configured": the setting can't be switched to eFinance. The token lives here, never in the database.
    EHIRE_EFINANCE_URL = os.environ.get("EHIRE_EFINANCE_URL", "")
    EHIRE_EFINANCE_TOKEN = os.environ.get("EHIRE_EFINANCE_TOKEN", "")
    EHIRE_EFINANCE_TIMEOUT = float(os.environ.get("EHIRE_EFINANCE_TIMEOUT", "5"))
    EHIRE_EFINANCE_CA_FILE = os.environ.get("EHIRE_EFINANCE_CA_FILE", "")  # optional private CA bundle
    MAX_CONTENT_LENGTH = 120 * 1024 * 1024  # a whole post; each file is also held to the max_file_mb setting


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    CSRF_ENABLED = False
    MAIL_AUTO_FLUSH = False
    ARCHIVE_AUTO_FLUSH = False
    EHIRE_CHECK_SCHEMA = False  # tests build tables with create_all
