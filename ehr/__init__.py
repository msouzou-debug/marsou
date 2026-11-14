"""eHR application factory."""
from urllib.parse import urlencode

from flask import Flask, g, render_template, request

from . import i18n
from .config import Config
from .extensions import db


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)

    from .security import check_production_config, init_csrf, init_security_headers

    from . import localtime

    localtime.check(app)  # no time zone database: stop here with a clear message, never show UTC by mistake
    check_production_config(app)  # raises with a clear message before anything else starts
    if app.config.get("EHR_PROXY_HOPS", 0) > 0:
        from werkzeug.middleware.proxy_fix import ProxyFix

        hops = app.config["EHR_PROXY_HOPS"]
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops, x_host=hops)
    db.init_app(app)
    from .dbsetup import init_sqlite

    with app.app_context():
        init_sqlite(app, db.engine)  # WAL, busy timeout, foreign keys, BEGIN IMMEDIATE (SQLite only)

    from . import models  # noqa: F401  registers the tables
    from .auth import init_auth, current_user
    from .schema_guard import init_schema_guard
    from .services import out_of_office

    init_schema_guard(app)  # before anything touches the database
    init_auth(app)  # it sets g.lang
    init_csrf(app)
    init_security_headers(app)

    def translate(key, **params):
        return i18n.translate(key, g.get("lang", app.config["DEFAULT_LANGUAGE"]), **params)

    def lang_url(code):
        """The current page with the language switched, other query values kept."""
        args = {k: v for k, v in request.args.items() if k != "lang"}
        args["lang"] = code
        return request.path + "?" + urlencode(args)

    @app.context_processor
    def _inject():
        user = current_user()
        return {
            "t": translate,
            "lang": g.get("lang", app.config["DEFAULT_LANGUAGE"]),
            "lang_url": lang_url,
            "can": (lambda key: bool(user and user.has_permission(key))),
            "ooo_state": (lambda: out_of_office.control_state(user)),
        }

    from .blueprints.main import bp as main_bp
    from .settings import bp as settings_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(settings_bp)

    # The requests blueprint is built by another agent. Until it exists, "/" shows home.html.
    try:
        from .blueprints.requests import bp as requests_bp
    except ImportError:
        app.config["REQUESTS_READY"] = False
    else:
        app.register_blueprint(requests_bp)
        app.config["REQUESTS_READY"] = True

    from .blueprints.me import bp as me_bp

    app.register_blueprint(me_bp)

    from .mail.outbox import init_mail
    from .scheduler.cli import register as register_scheduler

    init_mail(app)
    register_scheduler(app)

    from .documents import bp as documents_bp

    app.register_blueprint(documents_bp)

    from .audit import bp as audit_bp

    app.register_blueprint(audit_bp)

    @app.errorhandler(404)
    @app.errorhandler(403)
    def _not_found(_e):
        return render_template("errors/error.html", message_key="error.404"), 404

    @app.errorhandler(500)
    def _server_error(_e):
        return render_template("errors/error.html", message_key="error.500"), 500

    from .seed import register_cli

    register_cli(app)

    from .cli import register as register_operator_cli

    register_operator_cli(app)
    return app
