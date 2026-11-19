"""Document routes (contract 03, section 1). Access to a document is access to its request, nothing more."""
import os

from flask import Blueprint, abort, current_app, flash, g, redirect, render_template, request, send_file, url_for
from werkzeug.exceptions import RequestEntityTooLarge

from ..auth import can_see_request, current_user, login_required, permission_required
from ..extensions import db
from ..models import Request, RequestDocument, audit
from ..services.request_flash import flash_key
from . import storage

bp = Blueprint("documents", __name__)

FILE_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox"


@bp.app_context_processor
def _inject():
    user = current_user()
    lang = g.get("lang", "el")
    return {
        "documents_of": lambda req: storage.documents_of(req, user, lang),
        "max_file_mb": storage.max_megabytes,
    }


# ------------------------------------------------------------------ helpers

def _own_request(request_id):
    """The requester's own request while it is a draft or returned. Anything else answers 404."""
    req = db.session.get(Request, request_id)
    user = current_user()
    if req is None or req.created_by != user.id or req.status not in ("draft", "returned"):
        abort(404)
    return req


def _visible(request_id, doc_id):
    req = db.session.get(Request, request_id)
    if not can_see_request(current_user(), req):
        abort(404)
    doc = db.session.get(RequestDocument, doc_id)
    if doc is None or doc.request_id != req.id or not doc.storage_ref:
        abort(404)
    return req, doc


def _detail(doc, **extra):
    data = {"file_name": doc.file_name, "round": doc.round, "sha256": doc.sha256}
    data.update(extra)
    return data


def _file_response(path, mimetype, name, attachment):
    resp = send_file(path, mimetype=mimetype, as_attachment=attachment, download_name=name, conditional=False,
                     max_age=0)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Content-Security-Policy"] = FILE_CSP
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


# ------------------------------------------------------------------ upload and remove

@bp.post("/requests/<int:request_id>/documents")
@permission_required("request.create")
def upload(request_id):
    req = _own_request(request_id)
    user = current_user()
    files = [f for f in request.files.getlist("documents") if f and f.filename]
    if not files:
        flash("docs.choose", "info")
        return redirect(url_for("requests.edit", request_id=req.id))
    added = 0
    for f in files:
        try:
            doc = storage.store_upload(req, f, user)
        except storage.UploadError as err:
            flash_key(err.key, "danger", **err.params)
            continue
        audit("document_added", user_id=user.id, request_id=req.id, object_type="document", object_id=doc.id,
              detail=_detail(doc, size=doc.size))
        added += 1
        db.session.commit()  # each accepted file stays, whatever happens to the next one
    if added == 1:
        flash("docs.added.one", "success")
    elif added:
        flash_key("docs.added.many", "success", n=added)
    return redirect(url_for("requests.edit", request_id=req.id))


@bp.errorhandler(RequestEntityTooLarge)
def _too_big(_e):
    rid = (request.view_args or {}).get("request_id")
    flash_key("docs.error.too_large", "danger", name="…", n=storage.max_megabytes())
    if rid and request.endpoint == "documents.upload":
        return redirect(url_for("requests.edit", request_id=rid))
    return render_template("errors/error.html", message_key="error.500"), 413


@bp.post("/requests/<int:request_id>/documents/<int:doc_id>/remove")
@login_required
def remove(request_id, doc_id):
    req = db.session.get(Request, request_id)
    user = current_user()
    if req is None or req.created_by != user.id:
        abort(404)
    doc = db.session.get(RequestDocument, doc_id)
    if doc is None or doc.request_id != req.id:
        abort(404)
    if not storage.is_removable(req, doc):
        flash("docs.error.locked", "danger")
        return redirect(url_for("requests.detail", request_id=req.id))
    detail = _detail(doc)
    audit("document_removed", user_id=user.id, request_id=req.id, object_type="document", object_id=doc.id,
          detail=detail)
    storage.remove_files(doc)
    db.session.delete(doc)
    db.session.commit()
    flash("docs.removed", "success")
    return redirect(url_for("requests.edit", request_id=req.id))


# ------------------------------------------------------------------ viewer and file

@bp.get("/requests/<int:request_id>/documents/<int:doc_id>")
@login_required
def viewer(request_id, doc_id):
    req, doc = _visible(request_id, doc_id)
    kind = storage.kind_of(doc)
    converted = False
    if kind == "office":
        if storage.ensure_pdf(doc):
            kind, converted = "pdf", True
        else:
            kind = "none"
    audit("document_view", user_id=current_user().id, request_id=req.id, object_type="document",
          object_id=doc.id, detail=_detail(doc))
    db.session.commit()
    return render_template(
        "documents/viewer.html", req=req, doc=doc, kind=kind, converted=converted,
        size=storage.size_text(doc.size, g.lang))


@bp.get("/requests/<int:request_id>/documents/<int:doc_id>/file")
@login_required
def file(request_id, doc_id):
    req, doc = _visible(request_id, doc_id)
    user = current_user()
    path = storage.abs_path(doc.storage_ref)
    if not os.path.isfile(path):
        current_app.logger.error("stored file missing for document %s", doc.id)
        abort(404)
    if request.args.get("download"):
        audit("document_download", user_id=user.id, request_id=req.id, object_type="document",
              object_id=doc.id, detail=_detail(doc))
        db.session.commit()
        return _file_response(path, doc.mime, doc.file_name, True)
    kind = storage.kind_of(doc)
    if kind == "office":
        pdf = storage.ensure_pdf(doc)
        if pdf is None:
            abort(404)
        path, mime, name = pdf, "application/pdf", doc.file_name.rsplit(".", 1)[0] + ".pdf"
    else:
        mime, name = doc.mime, doc.file_name
    if request.args.get("via") != "viewer":  # the viewer page already wrote its audit row
        audit("document_view", user_id=user.id, request_id=req.id, object_type="document", object_id=doc.id,
              detail=_detail(doc, inline=True))
        db.session.commit()
    return _file_response(path, mime, name, False)
