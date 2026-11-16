"""The deposit queue: rows written inside the action's transaction, rendered and sent after the commit.

Same pattern as the email outbox. Nothing here may stop a user's action: `enqueue` only adds a row, and the flush
functions catch everything. Rules are in docs/contracts/06-earchive-deposit.md.
"""
import json
import logging
import os

from flask import current_app, g, has_request_context
from sqlalchemy import and_, or_

from ..extensions import db
from ..models import ARCHIVE_MAX_ATTEMPTS, ArchiveDeposit, RequestDocument, audit
from ..models.access import utcnow
from . import pdf
from .transports import ArchiveError, DepositFile, get_transport

log = logging.getLogger(__name__)


# ---------------------------------------------------------------- enqueue (inside the action's transaction)

def after_action(req, new_action, result, action_row, actor_user_id):
    """Called by request_flow.run after the result is stored and before the commit.

    - submit (the first one; a resubmission is another action) queues 'submitted';
    - the status becoming approved queues 'approved';
    - rejection or withdrawal marks the 'submitted' row, no new row.
    """
    if not result.ok:
        return
    as_of = {"action_id": action_row.id if action_row is not None else None, "status": req.status,
             "round": req.round}
    if new_action.action == "submit":
        _enqueue(req, "submitted", actor_user_id, as_of)
    if req.status == "approved":
        _enqueue(req, "approved", actor_user_id, as_of)
    elif req.status in ("rejected", "withdrawn"):
        row = ArchiveDeposit.query.filter_by(request_id=req.id, kind="submitted").first()
        if row is not None and row.request_outcome != req.status:
            row.request_outcome = req.status
            audit("archive_outcome", user_id=actor_user_id, request_id=req.id, object_type="archive_deposit",
                  object_id=row.id, detail={"outcome": req.status})


def _enqueue(req, kind, actor_user_id, as_of):
    if ArchiveDeposit.query.filter_by(request_id=req.id, kind=kind).first() is not None:
        return None
    row = ArchiveDeposit(request_id=req.id, kind=kind, round=req.round or 1, state="queued", attempts=0,
                         manifest_json=json.dumps({"as_of": as_of}, sort_keys=True), created_at=utcnow())
    db.session.add(row)
    db.session.flush()
    audit("archive_queued", user_id=actor_user_id, request_id=req.id, object_type="archive_deposit",
          object_id=row.id, detail={"kind": kind, "round": row.round})
    if has_request_context():
        g.archive_pending = True
    return row


# ---------------------------------------------------------------- flush

def pending_query(only_queued=False):
    if only_queued:
        return ArchiveDeposit.query.filter(ArchiveDeposit.state == "queued").order_by(ArchiveDeposit.id)
    return ArchiveDeposit.query.filter(or_(
        ArchiveDeposit.state == "queued",
        and_(ArchiveDeposit.state == "failed", ArchiveDeposit.attempts < ARCHIVE_MAX_ATTEMPTS))).order_by(
        ArchiveDeposit.id)


def flush(limit=50, render=True, only_queued=False):
    """Render missing PDFs (when `render`), then hand each waiting deposit to the transport.

    Returns {'rendered', 'stored', 'failed', 'waiting'}. Commits row by row; the database is never held open while
    LibreOffice or the transport works. Never raises.
    """
    counts = {"rendered": 0, "stored": 0, "failed": 0, "waiting": 0}
    try:
        transport = get_transport()
        ids = [r.id for r in pending_query(only_queued).limit(limit).all()]
        db.session.rollback()  # reading took the SQLite lock; give it back
    except Exception:  # noqa: BLE001
        log.exception("reading the archive queue failed")
        db.session.rollback()
        return counts
    for row_id in ids:
        try:
            _one(row_id, transport, render, counts)
        except Exception:  # noqa: BLE001  nothing may escape into a request or a cron run
            log.exception("archive deposit %s failed unexpectedly", row_id)
            db.session.rollback()
            counts["waiting"] += 1
    return counts


def _one(row_id, transport, render, counts):
    row = db.session.get(ArchiveDeposit, row_id)
    needs_pdf = row is not None and not row.pdf_storage_ref
    done = row is None or row.state == "stored"
    db.session.rollback()
    if done:
        return
    if needs_pdf:
        if not render or not render_deposit(row_id):
            counts["waiting"] += 1
            return
        counts["rendered"] += 1
    if not transport.delivers:
        counts["waiting"] += 1
        return
    if send_deposit(row_id, transport):
        counts["stored"] += 1
    else:
        counts["failed"] += 1


def _fail(row_id, message, count_attempt=True):
    """Record a problem on a row in a short transaction. Too many attempts turn it into `failed`."""
    db.session.rollback()
    row = db.session.get(ArchiveDeposit, row_id)
    if row is None:
        return
    row.last_error = (message or "error")[:500]
    if count_attempt:
        row.attempts += 1
    if row.pdf_storage_ref:
        row.state = "failed"
    elif row.attempts >= ARCHIVE_MAX_ATTEMPTS:
        row.state = "failed"
    if row.state == "failed":
        audit("archive_failed", request_id=row.request_id, object_type="archive_deposit", object_id=row.id,
              detail={"kind": row.kind, "attempts": row.attempts, "error": row.last_error})
    db.session.commit()


def render_deposit(row_id):
    """Make and store the PDF and the manifest of one deposit. True when the row now has them.

    Order: read everything (short transaction, released), convert (slow, no transaction), store the file, then record
    it in a short transaction. If conversion is unavailable the row stays queued with `last_error`."""
    ref = None
    try:
        row = db.session.get(ArchiveDeposit, row_id)
        prepared = pdf.prepare(row)
        request_id, kind = row.request_id, row.kind
        html = pdf.render_html(prepared["context"])
        db.session.rollback()  # release the lock before the slow part
        data = pdf.convert(html)
        ref, sha = pdf.store_pdf(request_id, kind, data)
        manifest = pdf.final_manifest(prepared, sha, len(data))
        row = db.session.get(ArchiveDeposit, row_id)
        if row.pdf_storage_ref:  # another run was faster; keep its file
            pdf.remove_pdf(ref)
            db.session.rollback()
            return True
        row.pdf_storage_ref, row.pdf_sha256 = ref, sha
        row.manifest_json = json.dumps(manifest, ensure_ascii=False, sort_keys=True)
        row.last_error = None
        db.session.commit()
        return True
    except Exception as exc:  # noqa: BLE001
        if ref:
            pdf.remove_pdf(ref)
        unavailable = isinstance(exc, ArchiveError) and "No document converter" in str(exc)
        if not isinstance(exc, ArchiveError):
            log.exception("could not make the PDF for deposit %s", row_id)
        _fail(row_id, str(exc) or type(exc).__name__, count_attempt=not unavailable)
        return False


def files_of(row):
    """The DepositFile list of a rendered row, checked against the disk: a changed or missing file is an error."""
    from ..documents import storage

    manifest = json.loads(row.manifest_json)
    out = []
    for entry in manifest["files"]:
        if entry["role"] == "request_pdf":
            path = storage.abs_path(row.pdf_storage_ref)
        else:
            doc = db.session.get(RequestDocument, entry["document_id"])
            if doc is None or not doc.storage_ref:
                raise ArchiveError("Document %s is no longer stored." % entry["document_id"])
            path = storage.abs_path(doc.storage_ref)
        if not os.path.isfile(path):
            raise ArchiveError("The file %s is missing on disk." % entry["stored_as"])
        if pdf.sha256_file(path) != entry["sha256"]:
            raise ArchiveError("The file %s does not match its recorded sha256." % entry["stored_as"])
        out.append(DepositFile(entry["stored_as"], entry["name"], entry["mime"], entry["size"], entry["sha256"],
                               path))
    return manifest, out


def send_deposit(row_id, transport):
    """Hand one rendered deposit to the transport. True when it is stored."""
    try:
        row = db.session.get(ArchiveDeposit, row_id)
        manifest, files = files_of(row)
        db.session.rollback()
        reference = transport.deposit(manifest, files)
        if not reference:
            raise ArchiveError("The transport returned no reference.")
    except Exception as exc:  # noqa: BLE001
        _fail(row_id, "%s: %s" % (type(exc).__name__, exc) if not isinstance(exc, ArchiveError) else str(exc))
        return False
    row = db.session.get(ArchiveDeposit, row_id)
    row.state, row.archive_ref, row.last_error, row.sent_at = "stored", str(reference)[:300], None, utcnow()
    row.attempts += 1
    audit("archive_stored", request_id=row.request_id, object_type="archive_deposit", object_id=row.id,
          detail={"kind": row.kind, "ref": row.archive_ref})
    db.session.commit()
    return True


def flush_quietly(**kwargs):
    """After a successful commit. A problem is logged and never reaches the user."""
    try:
        return flush(**kwargs)
    except Exception:  # noqa: BLE001
        log.exception("sending archive deposits failed")
        db.session.rollback()


def retry(row, user_id):
    """Admin button: a failed deposit goes back in the queue with a fresh count."""
    row.state, row.attempts = "queued", 0
    audit("archive_retry", user_id=user_id, request_id=row.request_id, object_type="archive_deposit", object_id=row.id,
          detail={"kind": row.kind})


def latest_for(req):
    """The newest deposit of a request, for the request page: 'approved' before 'submitted'."""
    if req is None or req.id is None:
        return None
    rows = ArchiveDeposit.query.filter_by(request_id=req.id).all()
    for kind in ("approved", "submitted"):
        for r in rows:
            if r.kind == kind:
                return r
    return None


def init_queue(app):
    @app.template_global()
    def archive_latest(req):
        return latest_for(req)

    @app.after_request
    def _flush_after_commit(response):
        if has_request_context() and g.get("archive_pending") and response.status_code < 400 \
                and app.config.get("ARCHIVE_AUTO_FLUSH", True):
            g.archive_pending = False
            flush_quietly(render=bool(app.config.get("ARCHIVE_RENDER_AFTER_REQUEST", False)), only_queued=True)
        return response
