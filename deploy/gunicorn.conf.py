"""gunicorn settings for eHR. Read by `gunicorn -c deploy/gunicorn.conf.py wsgi:app`.

EHR_BIND overrides the address. Port 5008 is a proposal: Marios assigns the real one (eFinance 5004, eVendor 5005).

One sync worker, no threads, as eFinance does. SQLite has one writer, and one sync worker handles one request at a
time, so web requests never race each other; the cron commands are separate processes and meet the web app through
SQLite's lock (BEGIN IMMEDIATE and the busy timeout, ehr/dbsetup.py). EHR_WORKERS can raise the count on another
engine; on SQLite the server refuses to start with more than one.
"""
import os
import sys

bind = os.environ.get("EHR_BIND", "127.0.0.1:5008")
workers = int(os.environ.get("EHR_WORKERS", "1"))
accesslog = "-"
errorlog = "-"


def on_starting(server):
    """Refuse to start when the configuration is unsafe (production mode) or the database is behind the code.
    Fails loudly under systemd instead of serving 503 pages. Run `flask upgrade-db` first."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)
    from ehr import create_app
    from ehr.extensions import db
    from ehr.migrations import status

    try:
        app = create_app()
    except RuntimeError as err:
        sys.exit(str(err))
    uri = str(app.config.get("SQLALCHEMY_DATABASE_URI") or "").lower()
    count = int(getattr(getattr(server, "cfg", None), "workers", workers))  # gunicorn's own value, -w included
    if uri.startswith("sqlite") and count > 1:
        sys.exit("eHR: %d gunicorn workers on SQLite. SQLite allows one writer, so run exactly one worker "
                 "(EHR_WORKERS=1, no -w option)." % count)
    with app.app_context():
        current, latest, _ = status(db.engine)
    if current < latest:
        sys.exit("eHR: the database is at schema version %d but the code needs %d. "
                 "Stop the service, run `flask --app wsgi:app upgrade-db`, then start it again." % (current, latest))
