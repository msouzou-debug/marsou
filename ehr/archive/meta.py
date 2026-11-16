"""The `meta` part of a deposit (eArchive note, section 3, schema v1: strict, unknown fields are refused).

Everything here is Greek and comes from the JSON string files in Greek, whatever language the user reads. The subject
carries no personal names. Built once per deposit and stored (`meta_json`), so a retry sends the same bytes.
"""
import json
import os
from decimal import Decimal, InvalidOperation

from .. import localtime
from ..extensions import db
from ..models import ArchiveDeposit, Request, User
from ..services.request_view import timeout_days
from . import pdf
from .transports import FILE_ROLE_FIELD, ROLE_ATTACHMENT, ROLE_MAIN, BlockedError

SCHEMA_VERSION = 1
SOURCE_SYSTEM, SOURCE_MODULE = "eHR", "position_request"
DIRECTION, CLASSIFICATION = "INTERNAL", "HIGHLY_SENSITIVE"  # the long-absence text can describe sick leave
CURRENCY = "EUR"
ATTR_MAX = 300
MAX_FILES, MAX_ATTACHMENTS = 20, 19
MAX_FILE_BYTES, MAX_DEPOSIT_BYTES = 50 * 1024 * 1024, 200 * 1024 * 1024
ACCEPTED_EXTENSIONS = {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "tif", "tiff", "gif",
                       "webp", "html", "htm", "txt", "csv", "xml", "eml", "msg", "zip"}
META_FIELDS = ("schema_version", "outbox_id", "sent_at", "source_system", "source_module", "source_ref", "sender_ref",
               "doc_type", "subject", "direction", "sender_name", "letter_date", "event_date", "category",
               "classification", "personal_data", "personal_data_category", "folder_hints", "attributes", "amount",
               "currency", "related", "approvals", "files")


def source_ref(number, kind):
    return "position_request:%s:%s" % (number, kind)


def _t(key, **params):
    return pdf.t(key, **params)


def _iso(value):
    return localtime.to_local(value).isoformat(timespec="seconds") if value else None


def _cut(value):
    return (value or "").strip()[:ATTR_MAX]


def site_code(req):
    """The facility's eArchive code, or BlockedError('NO_SITE'): the deposit waits for an administrator to set it."""
    code = (req.facility.archive_site_code or "").strip() if req.facility else ""
    if not code:
        name = req.facility.name_el if req.facility else ""
        raise BlockedError("NO_SITE", _t("archive.error.no_site", facility=name), local=True)
    return code


def count_error(n_attachments):
    return BlockedError("TOO_MANY_FILES", _t("archive.error.too_many_files", n=MAX_ATTACHMENTS), local=True)


def check_limits(manifest):
    """Raises BlockedError when the deposit does not fit eArchive's limits. Nothing is dropped silently."""
    files = manifest.get("files") or []
    if len(files) > MAX_FILES:
        raise count_error(len(files) - 1)
    total = 0
    for f in files:
        name, size = f.get("name") or "", int(f.get("size") or 0)
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in ACCEPTED_EXTENSIONS:
            raise BlockedError("FILE_TYPE", 'eArchive does not accept the file type of "%s".' % name, local=True)
        if size > MAX_FILE_BYTES:
            raise BlockedError("FILE_TOO_BIG", 'The file "%s" is larger than 50 MB.' % name, local=True)
        total += size
    if total > MAX_DEPOSIT_BYTES:
        raise BlockedError("DEPOSIT_TOO_BIG", "The deposit is larger than 200 MB.", local=True)


def _amount(actions):
    for a in reversed(actions):
        if a.role == "central_hr_officer" and a.action == "check" and not a.is_superseded and a.payload_json:
            try:
                value = json.loads(a.payload_json).get("new_hire_cost")
                if value not in (None, ""):
                    return float(Decimal(str(value)))
            except (ValueError, InvalidOperation, AttributeError):
                return None
    return None


def _approvals(req, actions, names):
    out = []
    if not actions or actions[0].action != "submit":
        out.append({"actor_name": names.get(req.created_by) or _t("audit.system"), "role": _t("role.requester"),
                    "action": _t("history.submit"), "at": _iso(req.submitted_at)})
    for a in actions:
        system = a.role == "system" or a.actor_user_id is None
        text = (_t("history.withdraw_system", n=timeout_days()) if (a.action == "withdraw" and a.role == "system")
                else _t("history." + a.action))
        if a.is_superseded:
            text += " (%s)" % _t("history.superseded")
        entry = {"actor_name": _t("audit.system") if system else (pdf._who(a, names) or _t("audit.system")),
                 "role": _t("audit.system") if system else (_t("role." + a.role) if a.role else ""),
                 "action": text, "at": _iso(a.created_at)}
        if not entry["role"]:
            entry["role"] = _t("role.requester") if a.action in ("submit", "resubmit", "withdraw") else ""
        comment = (a.comment or "").strip()
        if comment.startswith("system."):
            comment = _t(comment)
        if comment:
            entry["comment"] = comment
        out.append(entry)
    return out


def build(row, manifest, now=None):
    """The meta dict of a rendered deposit. `manifest` is the final manifest (files with sizes and hashes)."""
    req = db.session.get(Request, row.request_id)
    as_of = pdf._as_of(row)
    cutoff = as_of.get("action_id")
    status = as_of.get("status") or req.status
    number = req.number or ""
    actions = [a for a in req.actions if cutoff is None or a.id <= cutoff]
    ids = {i for a in actions for i in (a.actor_user_id, a.on_behalf_of_user_id) if i} | {req.created_by}
    names = {u.id: u.full_name for u in User.query.filter(User.id.in_(ids))}
    decided = row.kind == "decided"

    position = req.position.title_el if req.position else ""
    cost_name = req.cost_centre.name_el if req.cost_centre else ""
    n = req.positions_count or 1
    subject = (_t("archive.subject.one", position=position, cost_centre=cost_name) if n == 1
               else _t("archive.subject.many", n=n, position=position, cost_centre=cost_name))
    attributes = {
        "cost_centre": _cut(("%s %s" % (req.cost_centre.code, cost_name)) if req.cost_centre else ""),
        "staff_category": _cut(_t("category." + req.category) if req.category else ""),
        "position_title": _cut(position), "posts": str(n)}
    submitted = req.submitted_at or row.created_at
    meta = {
        "schema_version": SCHEMA_VERSION, "outbox_id": row.id, "sent_at": _iso(now or localtime.now()),
        "source_system": SOURCE_SYSTEM, "source_module": SOURCE_MODULE, "source_ref": source_ref(number, row.kind),
        "sender_ref": number, "doc_type": _t("archive.doc_type." + (status if decided else "submitted")),
        "subject": subject[:500], "direction": DIRECTION,
        "sender_name": req.directorate.name_el if req.directorate else "",
        "letter_date": localtime.local_date(submitted).isoformat(), "category": _t("archive.category"),
        "classification": CLASSIFICATION, "personal_data": True,
        "personal_data_category": _t("archive.pd_category"),
        "folder_hints": [{"hospital": site_code(req)}],
        "attributes": {k: v for k, v in attributes.items() if v},
        "approvals": _approvals(req, actions, names),
    }
    if decided:
        closed = req.closed_at or (actions[-1].created_at if actions else row.created_at)
        meta["event_date"] = localtime.local_date(closed).isoformat()
        amount = _amount(actions)
        if amount is not None:
            meta["amount"], meta["currency"] = amount, CURRENCY
        if ArchiveDeposit.query.filter_by(request_id=req.id, kind="submitted").first() is not None:
            meta["related"] = [{"source_ref": source_ref(number, "submitted"), "relation": "SUPERSEDES"}]
    files, att = [], 0
    for f in manifest["files"]:
        if f["role"] == "request_pdf":
            part, role = "main", ROLE_MAIN
        else:
            att += 1
            part, role = "att%d" % att, ROLE_ATTACHMENT
        files.append({"part_name": part, "filename": f["name"], "size": f["size"], "sha256": f["sha256"],
                      FILE_ROLE_FIELD: role})
    files.sort(key=lambda e: e[FILE_ROLE_FIELD] != ROLE_MAIN)  # MAIN first
    meta["files"] = files
    return meta
