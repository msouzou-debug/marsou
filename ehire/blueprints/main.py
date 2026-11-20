from flask import Blueprint, jsonify, redirect, url_for

from ..auth import current_user

bp = Blueprint("main", __name__)


@bp.get("/")
def home():
    if current_user() is None:
        return redirect(url_for("auth.login"))
    return redirect("/requests")


@bp.get("/healthz")
def healthz():
    return jsonify(status="ok")
