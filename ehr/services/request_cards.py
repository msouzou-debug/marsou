"""Action cards: which cards a person sees on a request, and how a posted card becomes an engine payload.

No rule lives here. The engine says whether an answer is allowed; this module only shows the forms and turns
typed text into values (amounts, months, choices).
"""
from decimal import Decimal

from ehr.models import OaySpecialty
from ehr.workflow.route import DEPARTURE_REASONS

from .activity import LINES, PERIODS, get_provider
from .request_amounts import (format_amount, format_month, format_whole, parse_amount, parse_month, parse_whole,
                              ratio)
from .request_engine import current_leavers, route_of

# Actions an approver may post, and the roles the route can ask. Anything else is refused as `wrong_step`.
APPROVER_ACTIONS = ("check", "opinion", "approve", "reject", "return")
ASSIGNABLE_ROLES = ("dir_accountant", "sci_director", "dir_hr_officer", "dir_exec", "fin_mgmt_head",
                    "central_hr_officer", "medical_director", "nursing_director", "ceo")

CARD_TEMPLATE = {
    "dir_accountant": "requests/cards/accountant.html",
    "dir_hr_officer": "requests/cards/hr.html",
    "sci_director": "requests/cards/opinion.html",
    "medical_director": "requests/cards/opinion.html",
    "nursing_director": "requests/cards/opinion.html",
    "dir_exec": "requests/cards/decision.html",
    "ceo": "requests/cards/decision.html",
    "fin_mgmt_head": "requests/cards/finmgmt.html",
    "central_hr_officer": "requests/cards/central_hr.html",
}
# What the form posts for the one-answer cards: the action, and the payload key that holds the answer.
ANSWER_ACTION = {"dir_hr_officer": "check", "sci_director": "opinion", "medical_director": "opinion",
                 "nursing_director": "opinion"}
# Choices that make the browser ask for a comment before sending (the engine decides; this is only help).
NEGATIVE = {"position": "no", "funds": "no", "opinion": "negative", "documentation": "incomplete", "credit": "no"}


def cards_for(req, user):
    """Cards for the viewer: [{kind: answer | replace | hold, role, task, template, earlier}]."""
    out = []
    for task in req.tasks:
        if task.assignee_user_id != user.id:
            continue
        kind = None
        if req.status == "in_progress" and task.status == "open":
            kind = "answer"
        elif req.status == "in_progress" and task.status == "closed" and task.may_replace:
            kind = "replace"
        elif req.status == "returned" and task.status == "paused":
            kind = "hold"
        if kind is None:
            continue
        card = {"kind": kind, "role": task.role, "task": task, "template": CARD_TEMPLATE.get(task.role),
                "earlier": None}
        if kind == "replace":
            for action in req.actions:
                if (action.role == task.role and action.step == task.step and action.phase == task.phase
                        and action.action in ("check", "opinion") and not action.is_superseded):
                    card["earlier"] = action
        out.append(card)
    return out


# ---------------------------------------------------------------- reading a posted card

def _text(form, name):
    return (form.get(name) or "").strip()


def read_action(req, role, action, form):
    """(payload, comment, errors). `errors` maps a field name to a string key; it holds typed-value problems only."""
    comment = _text(form, "comment")
    errors = {}
    payload = {}
    if action == "return":
        return payload, comment, errors
    if role == "dir_accountant":
        payload = {"position": _text(form, "position"), "funds": _text(form, "funds")}
        route = route_of(req) or {}
        if route.get("financials_required") and "no" not in (payload["position"], payload["funds"]):
            payload.update(_read_financials(req, form, errors))
    elif role in ("sci_director", "medical_director", "nursing_director"):
        payload = {"opinion": _text(form, "opinion")}
    elif role == "dir_hr_officer":
        payload = {"documentation": _text(form, "documentation")}
    elif role == "fin_mgmt_head":
        payload = {"credit": _text(form, "credit"), "commitment_article": _text(form, "commitment_article")}
    elif role == "central_hr_officer":
        payload = _read_costs(req, form, errors)
    return payload, comment, errors


def _amount(form, name, errors, whole=False):
    text = _text(form, name)
    if not text:
        return ""
    try:
        return parse_whole(text) if whole else str(parse_amount(text))
    except ValueError:
        errors[name] = "validation.amount"
        return ""


def _read_financials(req, form, errors):
    provider = get_provider()
    out = {}
    specialty = _text(form, "oay_specialty_id")
    out["oay_specialty_id"] = ""
    if specialty:
        row = None
        if specialty.isdigit():
            row = OaySpecialty.query.filter_by(id=int(specialty), is_active=True).first()
        if row is None:
            errors["oay_specialty_id"] = "validation.choose"
        else:
            out["oay_specialty_id"] = row.id
    for name in ("payroll_to_month", "oay_data_month"):
        text = _text(form, name)
        out[name] = ""
        if text:
            try:
                out[name] = parse_month(text).isoformat()
            except ValueError:
                errors[name] = "validation.month"
    for period in PERIODS:
        values = {}
        snapshot = provider.snapshot(req.facility_id, out.get("oay_specialty_id") or None, period) or {}
        for line in LINES:
            field = "fin.%s.%s" % (period, line)
            if provider.is_read_only(line) and line in snapshot:
                values[line] = snapshot[line]
            else:
                values[line] = _amount(form, field, errors, whole=line in ("visits", "procedures"))
        out[period] = values
    return out


def _read_costs(req, form, errors):
    payload = {"new_hire_cost": _amount(form, "new_hire_cost", errors), "leaver_costs": {}}
    if req.reason in DEPARTURE_REASONS:
        for leaver in current_leavers(req):
            payload["leaver_costs"][leaver.id] = _amount(form, "leaver_cost.%d" % leaver.id, errors)
    return payload


# ---------------------------------------------------------------- showing values

def leaver_cost_rows(req, typed=None, stored_payload=None):
    """[(leaver, typed text)] for the central HR card."""
    rows = []
    for leaver in current_leavers(req):
        text = (typed.get("leaver_cost.%d" % leaver.id) if typed else None)
        rows.append((leaver, text or ""))
    return rows


def financial_view(rows):
    """Stored RequestFinancials rows (one round) as {'periods': {period: {...formatted...}}, months...} or None."""
    if not rows:
        return None
    by_period = {r.period: r for r in rows}
    first = rows[0]
    periods = {}
    for period in PERIODS:
        r = by_period.get(period)
        if r is None:
            continue
        value = ratio(r.revenue, r.payroll_cost) if r.revenue is not None else None
        periods[period] = {
            "visits": format_whole(r.visits), "procedures": format_whole(r.procedures),
            "revenue": format_amount(r.revenue), "payroll_cost": format_amount(r.payroll_cost),
            "headcount": format_amount(r.headcount),
            "ratio": format_amount(value) if value is not None else ""}
    return {"periods": periods, "specialty": first.oay_specialty_id, "payroll_to_month": format_month(first.payroll_to_month),
            "oay_data_month": format_month(first.oay_data_month)}


def typed_ratio(form, period):
    """Revenue per 1 of payroll from the typed text of a card, for a re-drawn form. '' when it can't be worked out."""
    try:
        value = ratio(parse_amount(form.get("fin.%s.revenue" % period)), parse_amount(form.get("fin.%s.payroll_cost" % period)))
    except ValueError:
        return ""
    return format_amount(value) if value is not None else ""
