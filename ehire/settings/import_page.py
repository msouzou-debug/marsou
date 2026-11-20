"""Settings > Import from Excel: download the template, upload, check everything, preview, confirm."""
import io
import json
import os
import secrets
import tempfile
import time

from flask import abort, flash, g, render_template, request, send_file, session, url_for, redirect

from ..auth import current_user, permission_required
from ..documents.storage import storage_root
from ..extensions import db
from ..services.request_flash import flash_key
from . import bp, import_xlsx as xl

LIFETIME = 3600  # seconds a checked file waits for its confirmation
SHOW_ERRORS = 200
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _folder():
    path = os.path.join(storage_root(), "import-tmp")
    os.makedirs(path, exist_ok=True)
    return path


def _purge():
    cutoff = time.time() - LIFETIME
    for name in os.listdir(_folder()):
        full = os.path.join(_folder(), name)
        if os.path.isfile(full) and os.path.getmtime(full) < cutoff:
            os.remove(full)


def _stash(data):
    """Keep the checked rows server-side. Returns the token, which also goes into the session."""
    _purge()
    token = secrets.token_urlsafe(24)
    payload = {"user_id": current_user().id, "created": time.time(), "data": data}
    with open(os.path.join(_folder(), token + ".json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    session["import_token"] = token
    return token


def _take(token):
    """The stashed rows for this token and this administrator, or None. The file is removed either way."""
    if not token or session.get("import_token") != token or not token.replace("-", "").replace("_", "").isalnum():
        return None
    path = os.path.join(_folder(), token + ".json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
    finally:
        os.remove(path)
    session.pop("import_token", None)
    if payload.get("user_id") != current_user().id or time.time() - payload.get("created", 0) > LIFETIME:
        return None
    return payload["data"]


def _page(**ctx):
    return render_template("settings/import.html", max_mb=xl.MAX_BYTES // (1024 * 1024), max_rows=xl.MAX_ROWS, **ctx)


def _errors_page(errors):
    errors = sorted(errors, key=lambda e: (list(xl.SHEETS).index(e[0]), e[1]))
    return _page(errors=errors[:SHOW_ERRORS], total=len(errors))


@bp.get("/import")
@permission_required("settings.manage")
def import_page():
    return _page()


@bp.get("/import/template.xlsx")
@permission_required("settings.manage")
def import_template():
    buffer = io.BytesIO()
    xl.build_template(g.get("lang", "el")).save(buffer)
    buffer.seek(0)
    response = send_file(buffer, mimetype=XLSX, as_attachment=True, download_name="ehire-import-template.xlsx")
    response.headers["Cache-Control"] = "no-store"  # the file holds names and emails
    return response


@bp.post("/import")
@permission_required("settings.manage")
def import_upload():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return _fail("import.err.file_missing")
    if not upload.filename.lower().endswith(".xlsx"):
        return _fail("import.err.file_type")
    fd, path = tempfile.mkstemp(suffix=".xlsx", dir=_folder())
    try:
        with os.fdopen(fd, "wb") as out:
            remaining = xl.MAX_BYTES + 1
            while remaining > 0:
                block = upload.stream.read(min(1 << 16, remaining))
                if not block:
                    break
                out.write(block)
                remaining -= len(block)
        try:
            xl.check_file(path, os.path.getsize(path))
            data, structural = xl.read_workbook(path)
        except xl.ImportProblem as problem:
            return _fail(problem.key, **problem.params)
    finally:
        os.remove(path)
    errors, ops = xl.validate(data, structural)
    if errors:
        return _errors_page(errors)
    summary = xl.summarise(ops)
    changes = sum(v["add"] + v["update"] for v in summary.values())
    return _page(summary=summary, changes=changes, token=_stash(data) if changes else "")


def _fail(key, **params):
    return _page(file_error=(key, params))


@bp.post("/import/confirm")
@permission_required("settings.manage")
def import_confirm():
    data = _take(request.form.get("token", ""))
    if data is None:
        flash("import.expired", "danger")
        return redirect(url_for("settings.import_page"))
    errors, ops = xl.validate(data, [])  # the database may have changed since the preview
    if errors:
        return _errors_page(errors)
    try:
        xl.apply(ops, current_user().id)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    summary = xl.summarise(ops)
    flash_key("import.done", "success", add=sum(v["add"] for v in summary.values()),
              update=sum(v["update"] for v in summary.values()))
    return redirect(url_for("settings.import_page"))


@bp.post("/import/cancel")
@permission_required("settings.manage")
def import_cancel():
    _take(request.form.get("token", ""))
    return redirect(url_for("settings.import_page"))
