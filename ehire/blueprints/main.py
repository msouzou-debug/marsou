from flask import Blueprint, current_app, jsonify, redirect, render_template, url_for

from ..auth import current_user

bp = Blueprint("main", __name__)


@bp.get("/")
def home():
    if current_user() is None:
        return redirect(url_for("auth.login"))
    if current_app.config.get("REQUESTS_READY"):
        return redirect("/requests")
    return render_template("home.html")


@bp.get("/healthz")
def healthz():
    return jsonify(status="ok")
