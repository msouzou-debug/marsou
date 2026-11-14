"""Audit log view (contract 03, section 1): read-only, newest first, 50 per page, filters in the query string.

Nothing here writes. Viewing the log is not itself audited, to keep the log readable. There is no export."""
import json
import re
from datetime import datetime, time, timedelta, timezone

from flask import Blueprint, render_template, request, url_for
from sqlalchemy import or_

from ..auth import current_user, permission_required, visible_requests_query
from ..extensions import db
from ..models import AuditLog, Request, User, search_key
from ..services.request_dates import format_datetime, parse_date

bp = Blueprint("audit", __name__)

PER_PAGE = 50
VALUE_MAX = 80
SECRET_KEY = re.compile(r"pass|secret|token|csrf|cookie", re.I)


def _like(text):
    """Contains-match with LIKE wildcards in the user's text taken literally."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _day_start(day):
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


def detail_pairs(raw):
    """(key, shown, full) triples from detail_json. Long values are cut for display; `full` is the whole value.
    Keys that look like secrets are never shown, even if one was stored by mistake."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        data = {"detail": raw}
    if not isinstance(data, dict):
        data = {"detail": data}
    pairs = []
    for key, value in data.items():
        if SECRET_KEY.search(str(key)):
            full = shown = "***"
        else:
            full = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
            shown = full if len(full) <= VALUE_MAX else full[: VALUE_MAX - 1] + "…"
        pairs.append((str(key), shown, full))
    return pairs


def _filters():
    args = request.args
    f = {"request": (args.get("request") or "").strip()[:40], "user": (args.get("user") or "").strip()[:80],
         "event": (args.get("event") or "").strip()[:60], "from": (args.get("from") or "").strip()[:10],
         "to": (args.get("to") or "").strip()[:10]}
    errors = set()
    dates = {}
    for name in ("from", "to"):
        if f[name]:
            try:
                dates[name] = parse_date(f[name])
            except ValueError:
                errors.add(name)
    return f, dates, errors


def _query(f, dates):
    q = AuditLog.query
    if f["request"]:
        key = search_key(f["request"]) or ""
        ids = [r[0] for r in db.session.query(Request.id).filter(Request.number_search.like(_like(key), escape="\\"))] if key else []
        q = q.filter(AuditLog.request_id.in_(ids)) if ids else q.filter(db.false())
    if f["user"]:
        like = _like(f["user"].lower())
        ids = [r[0] for r in db.session.query(User.id).filter(
            or_(db.func.lower(User.username).like(like, escape="\\"), db.func.lower(User.full_name).like(like, escape="\\")))]
        q = q.filter(AuditLog.user_id.in_(ids)) if ids else q.filter(db.false())
    if f["event"]:
        q = q.filter(AuditLog.event == f["event"])
    if "from" in dates:
        q = q.filter(AuditLog.at >= _day_start(dates["from"]))
    if "to" in dates:
        q = q.filter(AuditLog.at < _day_start(dates["to"] + timedelta(days=1)))
    return q


@bp.get("/audit")
@permission_required("audit.view")
def index():
    f, dates, errors = _filters()
    q = _query(f, dates)
    total = q.count()
    pages = max(1, -(-total // PER_PAGE))
    try:
        page = int(request.args.get("page", "1"))
    except ValueError:
        page = 1
    page = min(max(page, 1), pages)
    rows = q.order_by(AuditLog.at.desc(), AuditLog.id.desc()).limit(PER_PAGE).offset((page - 1) * PER_PAGE).all()

    user_ids = {r.user_id for r in rows if r.user_id}
    names = {u.id: u.full_name or u.username for u in User.query.filter(User.id.in_(user_ids))} if user_ids else {}
    req_ids = {r.request_id for r in rows if r.request_id}
    numbers, visible = {}, set()
    if req_ids:
        numbers = {i: n for i, n in db.session.query(Request.id, Request.number).filter(Request.id.in_(req_ids))}
        visible = {r[0] for r in visible_requests_query(current_user()).with_entities(Request.id).filter(Request.id.in_(req_ids))}
    entries = [{
        "when": format_datetime(r.at), "user": names.get(r.user_id) if r.user_id else None, "event": r.event,
        "request_id": r.request_id,
        "number": numbers.get(r.request_id) or (("#%d" % r.request_id) if r.request_id else None),
        "can_open": r.request_id in visible, "pairs": detail_pairs(r.detail_json)} for r in rows]

    events = [e[0] for e in db.session.query(AuditLog.event).distinct().order_by(AuditLog.event)]
    keep = {k: v for k, v in request.args.items() if k in f and v and k != "page"}

    def page_url(n):
        return url_for("audit.index", **keep, page=n) if n > 1 else url_for("audit.index", **keep)

    return render_template("audit/index.html", entries=entries, f=f, errors=errors, events=events, page=page,
                           pages=pages, total=total, prev_url=page_url(page - 1) if page > 1 else None,
                           next_url=page_url(page + 1) if page < pages else None)
