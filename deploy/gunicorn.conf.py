"""gunicorn settings for eHire. Read by `gunicorn -c deploy/gunicorn.conf.py wsgi:app`.

EHIRE_BIND overrides the address. Port 5008 is a proposal: Marios assigns the real one (eFinance 5004, eVendor 5005).

One sync worker, no threads, as eFinance does. SQLite has one writer, and one sync worker handles one request at a
time, so web requests never race each other; the cron commands are separate processes and meet the web app through
SQLite's lock (BEGIN IMMEDIATE and the busy timeout, ehire/dbsetup.py). EHIRE_WORKERS can raise the count on another
engine; on SQLite the server refuses to start with more than one.
"""
import os
import sys

bind = os.environ.get("EHIRE_BIND", "127.0.0.1:5008")
workers = int(os.environ.get("EHIRE_WORKERS", "1"))
accesslog = "-"
errorlog = "-"
# gunicorn 25.1 and later open a control socket for the `gunicornc` tool. Its default path is
# $XDG_RUNTIME_DIR/gunicorn.ctl, or $HOME/.gunicorn/gunicorn.ctl when that variable is not set (gunicorn/config.py,
# _get_default_control_socket). Under systemd the home of the `ehire` user is /opt/ehire, which root owns, so creating
# .gunicorn there failed with "Control server error: Permission denied" (gunicorn/ctl/server.py, _serve). Nothing here
# uses `gunicornc`, so the socket is switched off (gunicorn/arbiter.py, _start_control_server).
control_socket_disable = True


def on_starting(server):
    """Refuse to start when the configuration is unsafe (production mode) or the database is behind the code.
    Fails loudly under systemd instead of serving 503 pages. Run `flask upgrade-db` first."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)
    from ehire import create_app
    from ehire.extensions import db
    from ehire.migrations import status

    try:
        app = create_app()
    except RuntimeError as err:
        sys.exit(str(err))
    uri = str(app.config.get("SQLALCHEMY_DATABASE_URI") or "").lower()
    count = int(getattr(getattr(server, "cfg", None), "workers", workers))  # gunicorn's own value, -w included
    if uri.startswith("sqlite") and count > 1:
        sys.exit("eHire: %d gunicorn workers on SQLite. SQLite allows one writer, so run exactly one worker "
                 "(EHIRE_WORKERS=1, no -w option)." % count)
    with app.app_context():
        current, latest, _ = status(db.engine)
    if current < latest:
        sys.exit("eHire: the database is at schema version %d but the code needs %d. "
                 "Stop the service, run `flask --app wsgi:app upgrade-db`, then start it again." % (current, latest))
