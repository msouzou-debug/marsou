"""Session lifetime. The cookie is signed, so the two time stamps in it cannot be forged by the user.

`_born` is when the user signed in; the session ends `SESSION_MAX_HOURS` later whatever the user does.
`_last` is the last request; the session ends after `SESSION_IDLE_MINUTES` without one.
"""
import time

from flask import g, request, session


def _expired(now, cfg):
    born, last = session.get("_born"), session.get("_last")
    if born is None or last is None:  # a session from before these stamps existed: start counting now
        return False
    idle = cfg["SESSION_IDLE_MINUTES"] * 60
    longest = cfg["SESSION_MAX_HOURS"] * 3600
    return (idle > 0 and now - last > idle) or (longest > 0 and now - born > longest)


def init_lifetime(app):
    app.config["PERMANENT_SESSION_LIFETIME"] = max(1, app.config["SESSION_MAX_HOURS"]) * 3600

    @app.before_request
    def _session_lifetime():
        g.pop("_user", None)  # never trust a user cached by an earlier request (tests share one app context)
        if request.endpoint == "static" or "user_id" not in session:
            return
        now = time.time()
        if _expired(now, app.config):
            lang = session.get("lang")
            session.clear()
            if lang:
                session["lang"] = lang
            return
        session["_born"] = session.get("_born", now)
        session["_last"] = now
        session.permanent = True
