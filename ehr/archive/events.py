"""Notices from eArchive (note section 7): POST /api/v1/archive-events.

Not a browser form: there is no session and no CSRF token. The route is exempt from CSRF (ehr/security.py,
CSRF_EXEMPT_ENDPOINTS) and proves the caller in three ways instead: the connection comes from this machine, no
forwarding header is present (so nothing came through a proxy), and the bearer token is the shared EHR_ARCHIVE_TOKEN,
compared in constant time. eHR deletes nothing on these notices; it only records them on the deposit.
"""
import hmac
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request

from ..extensions import db
from ..models import ArchiveDeposit, Request, audit
from ..models.access import utcnow

bp = Blueprint("archive_events", __name__)

LOOPBACK = ("127.0.0.1", "::1")
FORWARD_HEADERS = ("X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-Port", "X-Real-IP",
                   "Forwarded", "CF-Connecting-IP", "CF-Ray", "True-Client-IP")
EVENTS = ("protocol.deleted", "legal_hold.set", "legal_hold.cleared")


def _no(status, code, message):
    return jsonify({"code": code, "message": message}), status


def _peer():
    """The address of the socket. With ProxyFix in front, REMOTE_ADDR may be rewritten from a header, so the
    original value is checked as well; both must be loopback."""
    orig = (request.environ.get("werkzeug.proxy_fix.orig") or {}).get("REMOTE_ADDR")
    return {request.remote_addr, orig or request.remote_addr}


def _when(text):
    try:
        value = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return utcnow()
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _find(source_ref, protocol_id):
    parts = source_ref.rsplit(":", 2)
    if len(parts) == 3 and parts[0] == "position_request":
        req = Request.query.filter_by(number=parts[1]).first()
        if req is not None:
            return ArchiveDeposit.query.filter_by(request_id=req.id, kind=parts[2]).first()
    if protocol_id:
        return ArchiveDeposit.query.filter_by(protocol_id=protocol_id).first()
    return None


@bp.post("/api/v1/archive-events")
def receive():
    if not _peer() <= set(LOOPBACK):
        return _no(403, "LOOPBACK_ONLY", "Only this machine may call this address.")
    if any(h in request.headers for h in FORWARD_HEADERS):
        return _no(403, "FORWARDED", "This address does not accept proxied requests.")
    token = (current_app.config.get("EHR_ARCHIVE_TOKEN") or "").strip()
    if not token:
        return _no(503, "NOT_CONFIGURED", "The link to eArchive is not set up.")
    header = request.headers.get("Authorization", "")
    sent = header[7:].strip() if header[:7].lower() == "bearer " else ""
    if not hmac.compare_digest(sent.encode("utf-8"), token.encode("utf-8")):
        return _no(401, "UNAUTHORIZED", "Missing or wrong token.")
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or not isinstance(body.get("event"), str) or not body["event"]:
        return _no(400, "BAD_BODY", "A JSON object with an event is needed.")
    event = body["event"][:60]
    source_ref = str(body.get("source_ref") or "")[:120]
    protocol_id = str(body.get("protocol_id") or "")[:60] or None
    detail = {"event": event, "source_ref": source_ref, "protocol_number": str(body.get("protocol_number") or "")[:60]}
    row = _find(source_ref, protocol_id) if event in EVENTS else None
    if row is None:
        # An unknown event or record still gets 200, so later notices are not held up behind it.
        audit("archive_event_ignored", object_type="archive_deposit", detail=detail)
        db.session.commit()
        return jsonify({"status": "ignored"}), 200
    applied = False
    if event == "protocol.deleted":
        if row.disposed_at is None:
            row.disposed_at, applied = _when(body.get("at")), True
    elif event == "legal_hold.set":
        applied, row.legal_hold = not row.legal_hold, True
    else:
        applied, row.legal_hold = bool(row.legal_hold), False
    audit("archive_event", request_id=row.request_id, object_type="archive_deposit", object_id=row.id,
          detail=dict(detail, kind=row.kind, applied=applied))
    db.session.commit()
    return jsonify({"status": "ok"}), 200
