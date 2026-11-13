"""Position requests: list, form, route preview, request page (contract 03). Phase 1.

Routes gather input, ask ehr.workflow for every decision and store the result in one transaction.
"""
import re
from datetime import datetime, timezone

from flask import Blueprint, abort, flash, g, jsonify, redirect, render_template, request, url_for
from sqlalchemy.orm import selectinload

from .. import i18n
from ..auth import can_see_request, current_user, login_required, permission_required, visible_requests_query
from ..extensions import db
from ..models import CATEGORIES, REASONS, Request, Task, audit
from ..services import request_form as form_rules
from ..services.notify import notify
from ..services.numbering import next_number
from ..services.request_dates import format_date, format_datetime
from ..services.request_engine import build_directory, build_state, holidays, route_for, store_result
from ..services.request_view import status_line, stops_for, user_names
from ..workflow import engine
from ..workflow.model import NewAction
from ..workflow.numbering import normalise_number
from ..workflow.tracker import preview

bp = Blueprint("requests", __name__, url_prefix="/requests")

TABS = ("waiting", "mine", "all")
LIST_LIMIT = 200


def _now():
    return datetime.now(timezone.utc)


def _translate(key, **params):
    return i18n.translate(key, g.get("lang", "el"), **params)


@bp.app_template_filter("ehr_date")
def _ehr_date(value):
    return format_date(value)


@bp.app_template_filter("ehr_datetime")
def _ehr_datetime(value):
    return format_datetime(value)


def _int_arg(name):
    try:
        return int(request.args.get(name, ""))
    except ValueError:
        return None


# ------------------------------------------------------------------ list

@bp.get("")
@login_required
def index():
    user = current_user()
    tab = request.args.get("tab")
    if tab not in TABS:
        tab = "waiting" if user.has_permission("request.act") else "mine"
    query = visible_requests_query(user)
    if tab == "mine":
        query = query.filter(Request.created_by == user.id)
    elif tab == "waiting":
        open_tasks = db.session.query(Task.request_id).filter(Task.assignee_user_id == user.id,
                                                              Task.status == "open")
        query = query.filter(Request.id.in_(open_tasks), Request.status == "in_progress")
    q = (request.args.get("q") or "").strip()
    if q:
        key = normalise_number(q)
        if key:
            escaped = key.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.filter(Request.number_search.like("%" + escaped + "%", escape="\\"))
    reqs = (query.options(selectinload(Request.actions), selectinload(Request.tasks),
                          selectinload(Request.position), selectinload(Request.facility),
                          selectinload(Request.cost_centre))
            .order_by(Request.id.desc()).limit(LIST_LIMIT).all())
    now, days_off = _now(), holidays(db.session)
    rows = []
    for r in reqs:
        stops = stops_for(r)
        names = user_names(stops, [t.assignee_user_id for t in r.tasks if t.assignee_user_id])
        rows.append({"req": r, "stops": stops, "line": status_line(r, days_off, now, names)})
    return render_template("requests/list.html", rows=rows, tab=tab, tabs=TABS, q=q)


# ------------------------------------------------------------------ dependent lists (form helpers)

@bp.get("/route-preview")
@permission_required("request.create")
def route_preview():
    lookups = form_rules.Lookups(current_user(), g.lang)
    directorate_id, category = _int_arg("directorate_id"), request.args.get("category")
    stops = []
    if directorate_id in lookups.directorate_ids and category in CATEGORIES:
        stops = preview(route_for(db.session, directorate_id, category))
    return render_template("requests/_route_preview.html", stops=stops)


@bp.get("/options")
@permission_required("request.create")
def options():
    lookups = form_rules.Lookups(current_user(), g.lang)
    which = request.args.get("list")
    if which == "facility":
        directorate_id = _int_arg("directorate_id")
        rows = lookups.facility_options(directorate_id) if directorate_id in lookups.directorate_ids else []
    elif which == "position":
        category = request.args.get("category")
        rows = lookups.position_options(category) if category in CATEGORIES else []
    else:
        abort(404)
    return jsonify(options=[{"id": i, "label": label} for i, label, _group in rows])


# ------------------------------------------------------------------ form

def _render_form(req, raw, errors=None, form_errors=(), lookups=None):
    lookups = lookups or form_rules.Lookups(current_user(), g.lang)
    errors = errors or {}
    d_id = form_rules._int(raw["directorate_id"])
    stops = []
    if d_id in lookups.directorate_ids and raw["category"] in CATEGORIES:
        stops = preview(route_for(db.session, d_id, raw["category"]))
    return render_template(
        "requests/form.html", req=req, raw=raw, errors=errors, form_errors=form_errors, lookups=lookups,
        show=form_rules.applicable(raw), stops=stops, summary=_summary(errors),
        directorate_options=[(d.id, d.name(g.lang), None) for d in lookups.directorates],
        cost_centre_options=[(c.id, c.code + " " + c.name(g.lang), None) for c in lookups.cost_centres],
        specialty_options=[(s.id, s.name, None) for s in lookups.specialties],
        category_options=[(c, "category." + c, None) for c in CATEGORIES],
        reason_options=[(r, "reason." + r, None) for r in REASONS],
        employments=form_rules.EMPLOYMENTS,
        facilities=lookups.facility_options(d_id if d_id in lookups.directorate_ids else None),
        positions=lookups.position_options(raw["category"] if raw["category"] in CATEGORIES else None),
        max_leavers=form_rules.MAX_LEAVER_ROWS)


_LABELS = {
    "directorate_id": "field.directorate", "facility_id": "field.facility", "cost_centre_id": "field.cost_centre",
    "category": "field.category", "position_id": "field.position", "positions_count": "field.positions_count",
    "oay_specialty_id": "field.oay_specialty", "reason": "field.reason", "need_text": "field.need_text",
    "alternatives_text": "field.alternatives_text", "new_need_origin": "field.new_need_origin",
    "new_need_cover_so_far": "field.new_need_cover_so_far", "new_need_plan": "field.new_need_plan",
    "absence_flag": "field.absence_flag", "absence_text": "form.absence_detail",
    "external_funding_flag": "field.external_funding_flag", "external_funding_text": "form.external_funding_detail",
    "leavers": "field.leaver_name", "leave_date": "field.leave_date", "employment": "field.employment",
    "name": "field.leaver_name",
}
_LEAVER_ERROR = re.compile(r"^leavers\[(\d+)\]\.(\w+)$")


def _summary(errors):
    """[(anchor id, label key, message key)] for the list at the top of the form."""
    out = []
    for name, message in errors.items():
        m = _LEAVER_ERROR.match(name)
        if m:
            out.append(("f-leavers-%s-%s" % m.groups(), _LABELS[m.group(2)], message))
        else:
            out.append(("f-" + name, _LABELS.get(name, "validation.summary"), message))
    return out


def _blank_leaver():
    return {"name": "", "leave_date": "", "employment": ""}


def _prepare_rows(raw):
    """A departure reason always shows at least one row."""
    if "leavers" in form_rules.applicable(raw) and not raw["leavers"]:
        raw["leavers"] = [_blank_leaver()]
    return raw


@bp.get("/new")
@permission_required("request.create")
def new():
    lookups = form_rules.Lookups(current_user(), g.lang)
    raw = form_rules.empty_raw()
    if len(lookups.directorates) == 1:
        raw["directorate_id"] = str(lookups.directorates[0].id)
    return _render_form(None, raw, lookups=lookups)


def _own_draft(request_id):
    req = db.session.get(Request, request_id)
    user = current_user()
    # Returned requests come in Phase 2: they answer 404 here until then.
    if req is None or req.created_by != user.id or req.status != "draft":
        abort(404)
    return req


@bp.route("/<int:request_id>/edit", methods=["GET", "POST"])
@permission_required("request.create")
def edit(request_id):
    req = _own_draft(request_id)
    if request.method == "GET":
        return _render_form(req, _prepare_rows(form_rules.raw_from_request(req)))
    return _handle_post(req)


@bp.post("")
@permission_required("request.create")
def create():
    return _handle_post(None)


def _handle_post(req):
    user = current_user()
    lookups = form_rules.Lookups(user, g.lang)
    raw = form_rules.read_form(request.form)
    intent = request.form.get("intent") or "draft"

    # Changes that only re-draw the form: no validation, nothing stored.
    if intent in ("refresh", "add_leaver") or intent.startswith("remove_leaver:"):
        if "leavers" in form_rules.applicable(raw):
            if intent == "add_leaver" and len(raw["leavers"]) < form_rules.MAX_LEAVER_ROWS:
                raw["leavers"].append(_blank_leaver())
            elif intent.startswith("remove_leaver:"):
                try:
                    del raw["leavers"][int(intent.split(":", 1)[1])]
                except (ValueError, IndexError):
                    pass
        return _render_form(req, _prepare_rows(raw), lookups=lookups)

    submit = intent == "submit"
    form_rules.drop_blank_leavers(raw)
    errors = form_rules.validate(raw, lookups, submit)
    if errors:
        return _render_form(req, _prepare_rows(raw), errors=errors, lookups=lookups)

    now = _now()
    try:
        if req is None:
            req = Request(created_by=user.id, status="draft", round=1)
            db.session.add(req)
        form_rules.store(req, raw)
        db.session.flush()
        if not submit:
            audit("request_draft_saved", user_id=user.id, request_id=req.id, object_type="request",
                  object_id=req.id)
            db.session.commit()
            flash("form.draft_saved", "success")
            return redirect(url_for("requests.edit", request_id=req.id))

        directory = build_directory(db.session, req.directorate_id)
        result = engine.apply(build_state(req), NewAction(user.id, "submit", "requester"), directory, now)
        if not result.ok:
            db.session.rollback()
            return _render_form(_reload(req), _prepare_rows(raw),
                                form_errors=["error." + c for c in result.errors], lookups=lookups)
        req.number = next_number(db.session, now.year)
        store_result(db.session, req, result, now)
        audit("request_submitted", user_id=user.id, request_id=req.id, object_type="request",
              object_id=req.id, detail={"number": req.number, "step": result.current_step})
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    notify(result.events)
    # base.html shows a flash through t(); the message needs {number}, so it is translated here.
    flash(_translate("form.submitted", number=req.number), "success")
    return redirect(url_for("requests.detail", request_id=req.id))


def _reload(req):
    return db.session.get(Request, req.id) if req.id is not None else None


# ------------------------------------------------------------------ request page

@bp.get("/<int:request_id>")
@login_required
def detail(request_id):
    user = current_user()
    req = db.session.get(Request, request_id)
    if not can_see_request(user, req):
        abort(404)
    stops = stops_for(req)
    task_ids = [t.assignee_user_id for t in req.tasks if t.assignee_user_id]
    action_ids = [i for a in req.actions for i in (a.actor_user_id, a.on_behalf_of_user_id) if i]
    names = user_names(stops, task_ids + action_ids)
    line = status_line(req, holidays(db.session), _now(), names)
    return render_template("requests/detail.html", req=req, stops=stops, names=names, line=line,
                           show=form_rules.applicable(form_rules.raw_from_request(req)))
