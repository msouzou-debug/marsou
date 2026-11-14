"""Configuration. Values come from environment variables so nothing secret is committed."""
import os


class Config:
    SECRET_KEY = os.environ.get("EHR_SECRET_KEY", "dev-only-change-me")
    # Engine is undecided until Marios confirms what eFinance uses (ADR 0001).
    SQLALCHEMY_DATABASE_URI = os.environ.get("EHR_DATABASE_URI", "sqlite:///ehr.sqlite3")
    DEFAULT_LANGUAGE = "el"
    LANGUAGES = ("el", "en")
    SESSION_COOKIE_NAME = "ehr_session"  # must differ from eFinance on the same host
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    CSRF_ENABLED = True  # honoured as False only when TESTING is also true
    PASSWORD_MIN_LENGTH = 8
    # Documents. Empty storage dir means <instance folder>/storage. Empty soffice path means "look on PATH".
    EHR_STORAGE_DIR = os.environ.get("EHR_STORAGE_DIR", "")
    EHR_SOFFICE_BIN = os.environ.get("EHR_SOFFICE_BIN", "")
    EHR_CONVERT_TIMEOUT = int(os.environ.get("EHR_CONVERT_TIMEOUT", "60"))
    # Email. The link in every message is built from EHR_BASE_URL. SMTP and Graph settings are read from the
    # environment when a message is sent (see ehr/mail/backends.py); nothing secret is stored here or in the database.
    EHR_BASE_URL = os.environ.get("EHR_BASE_URL", "http://127.0.0.1:5006")
    MAIL_AUTO_FLUSH = True  # best-effort send right after a successful web request; `flask send-mail` is the safety net
    MAIL_MAX_AGE_HOURS = 48  # with a real backend, older queued mail is marked failed instead of sent late
    MAX_CONTENT_LENGTH = 120 * 1024 * 1024  # a whole post; each file is also held to the max_file_mb setting


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    CSRF_ENABLED = False
    MAIL_AUTO_FLUSH = False
