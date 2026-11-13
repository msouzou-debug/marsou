"""eHR application factory."""
from urllib.parse import urlencode

from flask import Flask, g, render_template, request

from . import i18n
from .config import Config
from .extensions import db


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)
    db.init_app(app)

    from . import models  # noqa: F401  registers the tables
    from .auth import init_auth, current_user
    from .security import init_csrf

    init_auth(app)  # first: it sets g.lang
    init_csrf(app)

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

    @app.errorhandler(404)
    @app.errorhandler(403)
    def _not_found(_e):
        return render_template("errors/error.html", message_key="error.404"), 404

    @app.errorhandler(500)
    def _server_error(_e):
        return render_template("errors/error.html", message_key="error.500"), 500

    from .seed import register_cli

    register_cli(app)
    return app
