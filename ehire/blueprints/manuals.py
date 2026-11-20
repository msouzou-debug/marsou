"""Manuals: the user guide for everyone who is signed in, the administrator guide and the UAT files for administrators.

The files are built by scripts/manuals/ and published into ehire/manuals/ (PDF for reading in the browser, the UAT
workbook as Excel). They are not under static/, so nothing is served to someone who is not signed in."""
import os

from flask import Blueprint, abort, g, render_template, send_from_directory

from ..auth import current_user, login_required

bp = Blueprint("manuals", __name__, url_prefix="/manuals")

FOLDER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "manuals")

# key, file stem, extension, admin only
ITEMS = (
    ("user_guide", "eHire-user-guide", "pdf", False),
    ("admin_guide", "eHire-admin-guide", "pdf", True),
    ("uat_plan", "eHire-UAT-plan", "pdf", True),
    ("uat_scripts", "eHire-UAT-test-scripts", "xlsx", True),
)
MIMES = {"pdf": "application/pdf",
         "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


def _lang():
    return "en" if g.get("lang") == "en" else "el"


def _visible(user):
    admin = user.has_permission("settings.manage")
    out = []
    for key, stem, ext, admin_only in ITEMS:
        if admin_only and not admin:
            continue
        name = "%s-%s.%s" % (stem, _lang(), ext)
        if os.path.isfile(os.path.join(FOLDER, name)):
            out.append({"key": key, "ext": ext, "name": name})
    return out


@bp.get("")
@login_required
def index():
    return render_template("manuals/index.html", items=_visible(current_user()))


@bp.get("/<key>")
@login_required
def show(key):
    for item in _visible(current_user()):
        if item["key"] == key:
            inline = item["ext"] == "pdf"
            resp = send_from_directory(FOLDER, item["name"], mimetype=MIMES[item["ext"]],
                                       as_attachment=not inline, download_name=item["name"], max_age=0)
            resp.headers["Cache-Control"] = "private, no-store"
            resp.headers["X-Content-Type-Options"] = "nosniff"
            return resp
    abort(404)
