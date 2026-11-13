"""eHR application factory."""
from flask import Flask, g, request, session

from . import i18n
from .config import Config
from .extensions import db


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)
    db.init_app(app)

    @app.before_request
    def _set_language():
        lang = request.args.get("lang")
        if lang in app.config["LANGUAGES"]:
            session["lang"] = lang
        g.lang = session.get("lang", app.config["DEFAULT_LANGUAGE"])

    @app.context_processor
    def _inject():
        return {"t": lambda key, **p: i18n.translate(key, g.lang, **p), "lang": g.lang}

    from .blueprints.main import bp as main_bp

    app.register_blueprint(main_bp)
    return app
