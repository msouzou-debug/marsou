"""While the database is behind the code, every request answers 503 with a short page (no database access in the
page itself). `flask upgrade-db` fixes it; no restart is needed. Gunicorn refuses to start in that state."""
from flask import make_response, request, session

from . import i18n
from .extensions import db
from .migrations import schema_is_current


def init_schema_guard(app):
    state = {"ok": False}

    @app.before_request
    def _schema_guard():
        if not app.config.get("EHR_CHECK_SCHEMA") or state["ok"] or request.endpoint == "static":
            return None
        try:
            current = schema_is_current(db.engine)
        except Exception:  # database unreachable counts as not ready
            app.logger.exception("schema check failed")
            current = False
        if current:
            state["ok"] = True
            return None
        lang = session.get("lang", app.config["DEFAULT_LANGUAGE"])
        html = app.jinja_env.get_template("errors/unavailable.html").render(
            lang=lang, title=i18n.translate("app.name", lang), message=i18n.translate("error.503", lang))
        resp = make_response(html, 503)
        resp.headers["Retry-After"] = "120"
        return resp
