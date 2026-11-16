"""eArchive deposits page: what is queued, stored or failed, the PDF for administrators, and a retry button."""
import json
import os

from flask import abort, current_app, redirect, render_template, send_file, url_for

from ..archive import pdf
from ..archive.queue import retry
from ..archive.transports import get_transport
from ..auth import current_user, permission_required
from ..documents import storage
from ..documents.routes import FILE_CSP
from ..extensions import db
from ..models import ArchiveDeposit, Request, audit
from ..services.request_flash import flash_key
from . import bp

LIMIT = 200


def _count(row):
    try:
        return len(json.loads(row.manifest_json or "{}").get("files") or ())
    except ValueError:
        return 0


@bp.get("/archive")
@permission_required("settings.manage")
def archive():
    rows = ArchiveDeposit.query.order_by(ArchiveDeposit.id.desc()).limit(LIMIT).all()
    numbers = {r.id: r.number for r in Request.query.filter(Request.id.in_({d.request_id for d in rows}))} if rows else {}
    return render_template("settings/archive.html", rows=rows, numbers=numbers, file_count=_count,
                           off=not get_transport().delivers)


@bp.get("/archive/<int:deposit_id>/pdf")
@permission_required("settings.manage")
def archive_pdf(deposit_id):
    row = db.session.get(ArchiveDeposit, deposit_id) or abort(404)
    if not row.pdf_storage_ref:
        abort(404)
    path = storage.abs_path(row.pdf_storage_ref)
    if not os.path.isfile(path):
        current_app.logger.error("archive PDF missing for deposit %s", row.id)
        abort(404)
    req = db.session.get(Request, row.request_id)
    audit("archive_pdf_view", user_id=current_user().id, request_id=row.request_id, object_type="archive_deposit",
          object_id=row.id, detail={"kind": row.kind, "sha256": row.pdf_sha256})
    db.session.commit()
    resp = send_file(path, mimetype="application/pdf", as_attachment=False, conditional=False, max_age=0,
                     download_name=pdf.folder_name(req.number if req else "", row.kind) + ".pdf")
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Content-Security-Policy"] = FILE_CSP
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


@bp.post("/archive/<int:deposit_id>/retry")
@permission_required("settings.manage")
def archive_retry(deposit_id):
    row = db.session.get(ArchiveDeposit, deposit_id) or abort(404)
    if row.state == "failed":
        retry(row, current_user().id)
        db.session.commit()
        flash_key("settings.archive.retried", "success")
    return redirect(url_for("settings.archive"))
