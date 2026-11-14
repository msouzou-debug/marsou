"""Position requests: list, form, route preview, request page (contract 03). Phase 1.

Routes gather input, ask ehr.workflow for every decision and store the result in one transaction.
"""
import io
import re
from datetime import datetime, timezone

from flask import Blueprint, abort, flash, g, jsonify, redirect, render_template, request, send_file, url_for
from sqlalchemy.orm import selectinload

from .. import i18n, localtime
from ..auth import can_see_request, current_user, login_required, permission_required, visible_requests_query
from ..extensions import db
from ..models import CATEGORIES, REASONS, OaySpecialty, Request, RequestFinancials, Task, audit
from ..services import request_export
from ..services import request_flow as flow
from ..services import request_form as form_rules
from ..services.request_amounts import format_amount, format_month
from ..services.request_cards import NEGATIVE, cards_for, financial_view, leaver_cost_rows, typed_ratio
from ..services.request_dates import format_date, format_datetime
from ..services import activity
from ..services.activity import get_provider
from ..services.request_engine import current_leavers, holidays, route_for, route_of
from ..services.request_flash import flash_key
from ..services.request_view import (answer_facts, checks_view, closed_banner, days_left, history_view, returned_info, status_line,
                                     stops_for, timeout_days, user_names)
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

def _tab_for(user):
    tab = request.args.get("tab")
    if tab not in TABS:
        tab = "waiting" if user.has_permission("request.act") else "mine"
    return tab


def _list_query(user, tab, q):
    """The requests this user may see on this tab, narrowed by the search. The list and the export share it."""
    query = visible_requests_query(user)
    if tab == "mine":
        query = query.filter(Request.created_by == user.id)
    elif tab == "waiting":
        open_tasks = db.session.query(Task.request_id).filter(Task.assignee_user_id == user.id,
                                                              Task.status == "open")
        query = query.filter(Request.id.in_(open_tasks), Request.status == "in_progress")
    if q:
        key = normalise_number(q)
        if key:
            escaped = key.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.filter(Request.number_search.like("%" + escaped + "%", escape="\\"))
    return query


@bp.get("")
@login_required
def index():
    user = current_user()
    tab = _tab_for(user)
    q = (request.args.get("q") or "").strip()
    query = _list_query(user, tab, q)
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
    return render_template("requests/list.html", rows=rows, tab=tab, tabs=TABS, q=q,
                           can_export=_may_export(user))


# ------------------------------------------------------------------ export

def _may_export(user):
    return user.has_permission("request.view_all") or user.has_permission("request.view_directorate")


@bp.get("/export.xlsx")
@login_required
def export():
    user = current_user()
    if not _may_export(user):
        abort(404)
    tab = _tab_for(user)
    q = (request.args.get("q") or "").strip()
    reqs = (_list_query(user, tab, q)
            .options(selectinload(Request.actions), selectinload(Request.tasks), selectinload(Request.position),
                     selectinload(Request.facility), selectinload(Request.cost_centre),
                     selectinload(Request.directorate), selectinload(Request.creator))
            .order_by(Request.id.desc()).all())
    now = _now()
    data = request_export.build(reqs, g.lang, user, now, holidays(db.session))
    audit("list_exported", user_id=user.id, object_type="request_list",
          detail={"rows": len(reqs), "tab": tab, "q": q})
    db.session.commit()
    response = send_file(io.BytesIO(data), mimetype=request_export.MIMETYPE, as_attachment=True,
                         download_name="eHR-requests-%s.xlsx" % localtime.local_date(now).strftime("%Y%m%d"), max_age=0)
    response.headers["Cache-Control"] = "private, no-store"
    return response


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

def _render_form(req, raw, errors=None, form_errors=(), lookups=None, note=""):
    lookups = lookups or form_rules.Lookups(current_user(), g.lang)
    errors = errors or {}
    resubmitting = req is not None and req.status == "returned"
    returned = None
    if resubmitting:
        raw["directorate_id"] = str(req.directorate_id)  # locked after the first submission
        returned = returned_info(req, user_names([], [a.actor_user_id for a in req.actions if a.actor_user_id]))
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
        employments=form_rules.EMPLOYMENTS, resubmitting=resubmitting, returned=returned, note=note,
        days_left=days_left(req, holidays(db.session), _now()) if resubmitting else None,
        locked_directorate=req.directorate.name(g.lang) if resubmitting and req.directorate else "",
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
    "name": "field.leaver_name", "resubmit_note": "form.resubmit_note",
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


def _own_editable(request_id):
    """The requester's own request while it is a draft or has been returned. Anything else answers 404."""
    req = db.session.get(Request, request_id)
    user = current_user()
    if req is None or req.created_by != user.id or req.status not in ("draft", "returned"):
        abort(404)
    return req


@bp.route("/<int:request_id>/edit", methods=["GET", "POST"])
@permission_required("request.create")
def edit(request_id):
    req = _own_editable(request_id)
    if request.method == "GET":
        return _render_form(req, _prepare_rows(form_rules.raw_from_request(req)))
    if req.status == "returned":
        return _handle_resubmit(req)
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

        result = flow.submit(req, user.id, now)
        if not result.ok:
            return _render_form(_reload(req), _prepare_rows(raw),
                                form_errors=["error." + c for c in result.errors], lookups=lookups)
    except Exception:
        db.session.rollback()
        raise
    flash_key("form.submitted", "success", number=req.number)
    return redirect(url_for("requests.detail", request_id=req.id))


# Errors that mean "the request is no longer in the state this page assumed": show the request, not an error page.
STALE = ("not_your_task", "request_closed", "request_returned", "wrong_step", "own_request", "not_requester")


def _handle_resubmit(req):
    """The requester corrects a returned request (T9a or T9b). The engine decides which; this gathers and stores."""
    user = current_user()
    lookups = form_rules.Lookups(user, g.lang)
    raw = form_rules.read_form(request.form)
    raw["directorate_id"] = str(req.directorate_id)
    note = (request.form.get("resubmit_note") or "").strip()
    intent = request.form.get("intent") or "resubmit"

    if intent in ("refresh", "add_leaver") or intent.startswith("remove_leaver:"):
        if "leavers" in form_rules.applicable(raw):
            if intent == "add_leaver" and len(raw["leavers"]) < form_rules.MAX_LEAVER_ROWS:
                raw["leavers"].append(_blank_leaver())
            elif intent.startswith("remove_leaver:"):
                try:
                    del raw["leavers"][int(intent.split(":", 1)[1])]
                except (ValueError, IndexError):
                    pass
        return _render_form(req, _prepare_rows(raw), lookups=lookups, note=note)

    form_rules.drop_blank_leavers(raw)
    errors = form_rules.validate(raw, lookups, True)
    errors.pop("directorate_id", None)
    if not note:
        errors["resubmit_note"] = "validation.required"
    if errors:
        return _render_form(req, _prepare_rows(raw), errors=errors, lookups=lookups, note=note)

    clean = form_rules.clear_inapplicable(raw)
    stored = form_rules.raw_from_request(req)
    changed = {n: clean[n] for n in form_rules.ALL_FIELDS if clean[n] != stored[n]}
    if clean["leavers"] != stored["leavers"]:
        changed["leavers"] = clean["leavers"]
    result = flow.resubmit(req, user.id, _now(), note, changed,
                           lambda round_: form_rules.store(req, clean, round_=round_, keep_history=True))
    if not result.ok:
        if result.errors[0] in STALE:
            flash_key("error." + result.errors[0], "danger")
            return redirect(url_for("requests.detail", request_id=req.id))
        return _render_form(_reload(req), _prepare_rows(raw), form_errors=["error." + c for c in result.errors],
                            lookups=lookups, note=note)
    flash_key("done.resubmit", "success")
    return redirect(url_for("requests.detail", request_id=req.id))


def _reload(req):
    return db.session.get(Request, req.id) if req.id is not None else None


# ------------------------------------------------------------------ request page

def empty_card_state():
    return {"role": None, "action": None, "errors": {}, "codes": [], "typed": {}, "withdraw_open": False}


def _render_detail(req, card_state=None, status=200):
    """The request page (contract 03, section 5). `card_state` carries a failed post: the card to open, the
    typed values and the error messages."""
    user = current_user()
    now = _now()
    days_off = holidays(db.session)
    stops = stops_for(req)
    ids = [t.assignee_user_id for t in req.tasks if t.assignee_user_id]
    ids += [i for a in req.actions for i in (a.actor_user_id, a.on_behalf_of_user_id) if i]
    ids.append(req.created_by)
    names = user_names(stops, ids)
    is_requester = req.created_by == user.id
    state = card_state or empty_card_state()
    cards = [] if is_requester else cards_for(req, user)
    for card in cards:
        task = card["task"]
        mine = state["role"] == card["role"]  # a failed post re-opens its own card with what was typed
        card.update(
            typed=state["typed"] if mine else {}, errors=state["errors"] if mine else {},
            codes=state["codes"] if mine else [], open_return=mine and state["action"] == "return",
            redirect_note=({"reason": task.redirect_reason, "holder": names.get(task.on_behalf_of_user_id)}
                           if task.redirect_reason else None),
            facts=answer_facts(req, card["earlier"]) if card["earlier"] is not None else [],
            focus=mine and bool(state["errors"] or state["codes"] or state.get("refresh")), fin=None)
        if card["role"] == "dir_accountant" and card["kind"] != "hold" and (route_of(req) or {}).get("financials_required"):
            card["typed"], card["fin"] = activity.card_view(req, card["typed"], force=bool(mine and state.get("refresh")))
    specialties = []
    if any(c["role"] == "dir_accountant" for c in cards):
        specialties = OaySpecialty.query.filter_by(is_active=True).order_by(OaySpecialty.name).all()
    leavers = current_leavers(req)
    return render_template(
        "requests/detail.html", req=req, stops=stops, names=names, is_requester=is_requester,
        line=status_line(req, days_off, now, names), cards=cards, card_state=state, specialties=specialties,
        banner=closed_banner(req, names), returned=returned_info(req, names) if req.status == "returned" else None,
        checks=checks_view(req, user, names, stops), history=history_view(req, user, names), leavers=leavers,
        can_withdraw=is_requester and req.status in ("in_progress", "returned"), timeout_days=timeout_days(),
        negative=NEGATIVE, provider=get_provider(), route=route_of(req) or {}, withdraw=state,
        leaver_rows=lambda typed: leaver_cost_rows(req, typed), typed_ratio=typed_ratio,
        format_amount=format_amount), status


@bp.get("/<int:request_id>")
@login_required
def detail(request_id):
    req = db.session.get(Request, request_id)
    if not can_see_request(current_user(), req):
        abort(404)
    return _render_detail(req)


from . import requests_actions  # noqa: E402,F401  registers POST /action and /withdraw
