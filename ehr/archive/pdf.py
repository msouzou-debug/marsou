"""The request as a PDF and the manifest that goes with it (contract 06).

`prepare(row)` reads everything in one short database transaction and returns plain data (the HTML page, the file
list, the manifest). Nothing here holds a transaction while LibreOffice runs: `convert(html)` works on the HTML only.
The page is Greek, the organisation's language of record, whatever language the administrator uses.
"""
import base64
import hashlib
import json
import os
import shutil
import tempfile
from datetime import timezone

from flask import current_app

from .. import i18n, localtime
from ..documents import storage
from ..documents.convert import get_converter
from ..models import Request, RequestDocument, RequestFinancials, User
from ..models.request import _LOOKALIKES
from ..extensions import db
from ..services.request_amounts import format_amount
from ..services.request_cards import financial_view
from ..services.request_dates import format_date, format_datetime
from ..services.request_view import answer_facts, timeout_days
from .transports import ArchiveError, safe_name

LANG = "el"
LOGO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "img",
                    "okypy_logo_mail.png")
OUTCOME_ACTIONS = ("check", "opinion", "approve", "reject")
PHASE_ORDER = {"inputs": 0, "decision": 1, None: 0}
COST_LABELS = ("card.leaver_cost", "card.new_hire_cost")
PERIODS = ("prev_year", "ytd")
LINES = (("visits", "card.fin.visits", False), ("procedures", "card.fin.procedures", False),
         ("revenue", "card.fin.revenue", True), ("payroll_cost", "card.fin.payroll", True),
         ("headcount", "card.fin.headcount", False), ("ratio", "card.fin.ratio", True))


def t(key, **params):
    return i18n.translate(key, LANG, **params)


def ascii_number(number):
    """AEU-2026-0007 from the Greek-letter number: the Greek capitals that look like Latin letters become those
    letters (Theta is U, as in number search), so folder and file names are plain ASCII."""
    return "".join(_LOOKALIKES.get(ord(c), c) for c in (number or ""))


def folder_name(number, kind):
    return safe_name("%s-%s" % (ascii_number(number), kind))


def eur(value):
    return (format_amount(value) + " €") if value not in (None, "") else ""


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 16), b""):
            digest.update(block)
    return digest.hexdigest()


def logo_uri():
    with open(LOGO, "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode("ascii")


def _iso(value):
    """UTC, to the second, with a Z. A naive value read back from SQLite is already UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- pieces of the page

def _yes_no(flag, text):
    if flag is None:
        return ""
    return t("answer.yes" if flag else "answer.no") + ((": " + text) if text else "")


def _fields(req):
    lang = LANG
    pairs = [
        ("field.directorate", req.directorate.name(lang) if req.directorate else ""),
        ("field.facility", req.facility.name(lang) if req.facility else ""),
        ("field.cost_centre", (req.cost_centre.code + " " + req.cost_centre.name(lang)) if req.cost_centre else ""),
        ("field.category", t("category." + req.category) if req.category else ""),
        ("field.position", req.position.name(lang) if req.position else ""),
        ("field.positions_count", str(req.positions_count) if req.positions_count else ""),
        ("field.oay_specialty", req.oay_specialty.name if req.oay_specialty else ""),
        ("field.reason", t("reason." + req.reason) if req.reason else ""),
        ("field.need_text", req.need_text or ""),
        ("field.alternatives_text", req.alternatives_text or ""),
        ("field.new_need_origin", req.new_need_origin or ""),
        ("field.new_need_cover_so_far", req.new_need_cover_so_far or ""),
        ("field.new_need_plan", req.new_need_plan or ""),
        ("field.absence_flag", _yes_no(req.absence_flag, req.absence_text)),
        ("field.external_funding_flag", _yes_no(req.external_funding_flag, req.external_funding_text)),
    ]
    return [{"label": t(k), "value": v} for k, v in pairs if v]


def _leavers(req, round_):
    rows = [l for l in req.leavers if (l.round or 1) == round_]
    return [{"name": l.name, "date": format_date(l.leave_date),
             "employment": t("employment." + l.employment) if l.employment else "",
             "cost": eur(l.annual_employer_cost)} for l in rows]


def _financials(req, round_):
    """The figures of the newest round up to `round_` that has any, shaped for the table."""
    for r in range(round_, 0, -1):
        rows = RequestFinancials.query.filter_by(request_id=req.id, round=r).order_by(RequestFinancials.period).all()
        if rows:
            break
    else:
        return None
    view = financial_view(rows)
    periods = [p for p in PERIODS if p in view["periods"]]
    lines = []
    for key, label, money in LINES:
        cells = []
        for p in periods:
            value = view["periods"][p][key]
            cells.append((value + " €") if (money and value) else (value or "–"))
        lines.append({"label": t(label), "cells": cells})
    notes = []
    if view["oay_data_month"]:
        notes.append(t("card.fin.data_to", month=view["oay_data_month"]))
    if view["payroll_to_month"]:
        notes.append(t("card.fin.payroll_period", month=view["payroll_to_month"]))
    source = (t("card.fin.source.efinance", month=view["oay_data_month"]) if view["source"] == "provider"
              else t("card.fin.source.manual"))
    return {"title": t("pdf.financials"), "headers": [t("card.fin." + p) for p in periods],
            "lines": lines, "notes": " · ".join(notes), "source": source}


LABEL_FOR_RECORD = {"card.opinion": "history.opinion"}  # the card says "your opinion"; a record must not


def _fact_text(fact):
    label = t(LABEL_FOR_RECORD.get(fact["label"], fact["label"]), **fact["params"])
    label += "" if label[-1:] in (";", "?") else ":"
    value = t(fact["value"]) if fact["is_key"] else fact["value"]
    if fact["label"] in COST_LABELS and value:
        value += " €"
    return label, value


def _who(a, names):
    actor = names.get(a.actor_user_id)
    behalf = names.get(a.on_behalf_of_user_id)
    if actor and behalf:
        return t("tracker.acting_for", who=actor, holder=behalf)
    return actor or ""


def _checks(req, actions, names):
    latest = {}
    for a in actions:
        if a.action in OUTCOME_ACTIONS and not a.is_superseded:
            latest[(a.step, a.role, a.phase)] = a
    out = []
    for (step, role, phase), a in sorted(latest.items(), key=lambda kv: (kv[0][0], PHASE_ORDER.get(kv[0][2], 0))):
        facts = [_fact_text(f) for f in answer_facts(req, a)]
        out.append({"role": t("role." + role) if role else "", "step": t("step.%d" % step) if step else "",
                    "answer": facts or [("", t("history." + a.action))], "who": _who(a, names),
                    "when": format_datetime(a.created_at), "comment": a.comment or "",
                    "replaced": t("tracker.replaced") if a.supersedes_action_id else ""})
    return out


def _history(actions, names):
    out = []
    for a in actions:
        system = a.role == "system"
        title = t("history.withdraw_system", n=timeout_days()) if (a.action == "withdraw" and system) \
            else t("history." + a.action)
        comment = a.comment if a.comment and a.comment != "system.auto_withdraw" else ""
        out.append({"title": title, "superseded": t("history.superseded") if a.is_superseded else "",
                    "role": t("role." + a.role) if a.role and not system else "", "who": _who(a, names),
                    "when": format_datetime(a.created_at), "round": t("page.round", n=a.round), "comment": comment})
    return out


def _documents(req, round_):
    docs = (RequestDocument.query.filter_by(request_id=req.id).filter(RequestDocument.round <= round_)
            .order_by(RequestDocument.round, RequestDocument.uploaded_at, RequestDocument.id).all())
    ids = {d.uploaded_by for d in docs if d.uploaded_by}
    who = {u.id: u.full_name for u in User.query.filter(User.id.in_(ids))} if ids else {}
    return docs, who


# ---------------------------------------------------------------- prepare

def prepare(row, now=None):
    """Everything needed to render and send one deposit, as plain data. Reads only; the caller releases the
    transaction. Raises ArchiveError when a supporting file is missing on disk."""
    req = db.session.get(Request, row.request_id)
    if req is None:
        raise ArchiveError("The request of this deposit no longer exists.")
    now = now or localtime.now()
    as_of = _as_of(row)
    cutoff = as_of.get("action_id")
    status = as_of.get("status") or req.status
    round_ = row.round or req.round or 1
    actions = [a for a in req.actions if cutoff is None or a.id <= cutoff]
    ids = {i for a in actions for i in (a.actor_user_id, a.on_behalf_of_user_id) if i}
    ids.add(req.created_by)
    names = {u.id: u.full_name for u in User.query.filter(User.id.in_(ids))}
    docs, who = _documents(req, round_)

    doc_entries = []
    for i, d in enumerate(docs, 1):
        path = storage.abs_path(d.storage_ref) if d.storage_ref else None
        if not path or not os.path.isfile(path):
            raise ArchiveError("The stored file of document %d is missing." % d.id)
        doc_entries.append({
            "role": "document", "document_id": d.id, "stored_as": "%02d-%s" % (i, safe_name(d.file_name)),
            "name": d.file_name, "mime": d.mime, "size": d.size, "sha256": d.sha256, "round": d.round,
            "uploaded_by": who.get(d.uploaded_by, ""), "uploaded_at": _iso(d.uploaded_at), "path": path})

    number = req.number or ""
    when = format_datetime(row.created_at)
    context = {
        "title": t("pdf.title"), "number": number, "logo": logo_uri(),
        "status_at": t("pdf.status_at", date=when, status=t("status." + status)),
        "details_title": t("page.details"), "fields": _fields(req),
        "leavers_title": t("pdf.leavers"), "leavers": _leavers(req, round_),
        "leaver_headers": [t("field.leaver_name"), t("field.leave_date"), t("field.employment"),
                           t("card.leaver_cost", name="").rstrip(" :")],
        "financials": _financials(req, round_),
        "checks_title": t("page.checks"), "checks": _checks(req, actions, names),
        "history_title": t("page.history"), "history": _history(actions, names),
        "documents_title": t("pdf.documents_list"),
        "document_headers": [t("docs.title"), "→", t("page.round", n="").strip(), "", ""],
        "documents": [{"name": e["name"], "size": storage.size_text(e["size"], LANG),
                       "round": t("page.round", n=e["round"]), "who": e["uploaded_by"],
                       "when": format_datetime(docs[i].uploaded_at), "sha256": e["sha256"] or ""}
                      for i, e in enumerate(doc_entries)],
        "footer": t("pdf.generated", date=format_datetime(now)),
        "round_label": t("page.round", n=round_),
    }
    manifest = {
        "schema": 1, "key": "%s:%s" % (number, row.kind), "request_number": number, "kind": row.kind,
        "folder": folder_name(number, row.kind), "round": round_, "status": status,
        "submitted_at": _iso(req.submitted_at), "decided_at": _iso(req.closed_at) if row.kind == "decided" else None,
        "directorate": {"code": req.directorate.code, "name": req.directorate.name_el} if req.directorate else None,
        "facility": {"code": req.facility.code, "name": req.facility.name_el} if req.facility else None,
        "cost_centre_code": req.cost_centre.code if req.cost_centre else None,
        "staff_category": req.category, "position_title": req.position.title_el if req.position else None,
        "positions_count": req.positions_count, "requester_name": names.get(req.created_by),
    }
    return {"context": context, "manifest": manifest, "documents": doc_entries,
            "pdf_stored_as": "%s.pdf" % folder_name(number, row.kind)}


def _as_of(row):
    try:
        return (json.loads(row.manifest_json or "{}") or {}).get("as_of") or {}
    except ValueError:
        return {}


def render_html(context):
    return current_app.jinja_env.get_template("archive/request.html").render(**context)


def convert(html):
    """HTML to PDF bytes through the document converter (LibreOffice opens a .html file as Writer/Web and
    `--convert-to pdf` picks the writer_web_pdf_Export filter). Raises ArchiveError when it cannot."""
    converter = get_converter(current_app)
    if not converter.available():
        raise ArchiveError("No document converter is available, so the PDF could not be made.")
    with tempfile.TemporaryDirectory(prefix="ehr-archive-") as work:
        src, dst = os.path.join(work, "request.html"), os.path.join(work, "request.pdf")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write(html)
        if not converter.to_pdf(src, dst) or not os.path.isfile(dst) or os.path.getsize(dst) == 0:
            raise ArchiveError("The converter did not produce a PDF.")
        with open(dst, "rb") as fh:
            data = fh.read()
    if not data.startswith(b"%PDF"):
        raise ArchiveError("The converter output is not a PDF.")
    return data


def store_pdf(request_id, kind, data):
    """Write the PDF under <storage>/archive/<request id>/ and return (relative ref, sha256)."""
    ref = "archive/%d/%s-%s.pdf" % (request_id, kind, os.urandom(6).hex())
    path = storage.abs_path(ref)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    return ref, hashlib.sha256(data).hexdigest()


def remove_pdf(ref):
    try:
        os.remove(storage.abs_path(ref))
    except OSError:
        pass


def final_manifest(prepared, pdf_sha, pdf_size):
    """The manifest a transport receives: the PDF first, then each supporting document."""
    p = prepared
    files = [{"role": "request_pdf", "stored_as": p["pdf_stored_as"], "name": p["pdf_stored_as"],
              "mime": "application/pdf", "size": pdf_size, "sha256": pdf_sha}]
    for e in p["documents"]:
        files.append({k: v for k, v in e.items() if k != "path"})
    manifest = dict(p["manifest"])
    manifest["files"] = files
    return manifest
