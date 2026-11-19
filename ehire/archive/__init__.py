"""eArchive deposits (contract 06): queue, PDF, meta, transports, notices back from eArchive."""
from .cli import register as register_cli
from .queue import init_queue


def init_archive(app):
    from .events import bp as events_bp
    from .transports import check_url, check_web_url

    if app.config.get("EHIRE_ARCHIVE_URL"):
        check_url(app.config["EHIRE_ARCHIVE_URL"])  # refuse to start with an address that is not on this machine
    check_web_url(app.config.get("EHIRE_ARCHIVE_WEB_URL"))  # http or https only, or empty
    app.register_blueprint(events_bp)
    init_queue(app)
    register_cli(app)
