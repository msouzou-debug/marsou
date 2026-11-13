from flask import Blueprint, jsonify, render_template

bp = Blueprint("main", __name__)


@bp.get("/")
def home():
    return render_template("home.html")


@bp.get("/healthz")
def healthz():
    return jsonify(status="ok")
