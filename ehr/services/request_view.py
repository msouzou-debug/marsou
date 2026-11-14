"""Data the request screens show: tracker stops, status line, names. No rules: the engine's tracker does the work."""
import json

from ehr import localtime
from ehr.extensions import db
from ehr.models import RequestFinancials, User, get_setting
from ehr.workflow import timing
from ehr.workflow.route import compute_route
from ehr.workflow.tracker import preview, tracker_view

from .request_engine import build_directory, build_state


def stops_for(req):
    """Tracker stops for a stored request. A draft shows the preview of its route, or six pending stops."""
    if req.route_snapshot_json:
        return tracker_view(build_state(req))
    if req.category and req.directorate_id:
        directory = build_directory(db.session, req.directorate_id)
        return preview(compute_route(req.category, directory.has_role("sci_director", req.directorate_id)))
    return [{"step": n, "state": "pending", "phase": None, "people": []} for n in range(1, 7)]


def user_names(stops, extra_ids=()):
    ids = set(extra_ids)
    for stop in stops:
        for p in stop["people"]:
            ids.update(i for i in (p["actor_user_id"], p["on_behalf_of_user_id"]) if i)
    if not ids:
        return {}
    return {u.id: u.full_name for u in User.query.filter(User.id.in_(ids))}


def status_line(req, holidays, now, names):
    """What the line under the tracker says, as plain data. The template turns it into strings."""
    status = req.status
    info = {"kind": status}
    if status == "in_progress":
        waiting = []
        for t in req.tasks:
            if t.status == "open":
                days = timing.working_days_between(t.clock_started_at or t.opened_at, now, holidays, localtime.zone())
                waiting.append({"role": t.role, "who": names.get(t.assignee_user_id), "days": days,
                                "reminded": t.reminded_at is not None, "escalated": t.escalated_at is not None})
        info["waiting"] = waiting
    elif status == "returned":
        info["days_left"] = days_left(req, holidays, now)
    elif status == "rejected":
        last = req.actions[-1] if req.actions else None  # the answer that closed the request (a "no" check or a reject)
        if last is not None:
            info.update(step=last.step, role=last.role, comment=last.comment)
    elif status == "withdrawn":
        last = req.actions[-1] if req.actions else None
        info["system"] = bool(last and last.comment == "system.auto_withdraw")
    return info


# ---------------------------------------------------------------- returned requests

def days_left(req, holidays, now):
    """Working days left before automatic withdrawal (W5), or None when the request is not returned."""
    if req.status != "returned" or req.returned_at is None:
        return None
    try:
        limit = int(get_setting("returned_timeout_days", 30))
    except (TypeError, ValueError):
        limit = 30
    return max(0, limit - timing.working_days_between(req.returned_at, now, holidays, localtime.zone()))


def timeout_days():
    try:
        return int(get_setting("returned_timeout_days", 30))
    except (TypeError, ValueError):
        return 30


def returned_info(req, names):
    """Who returned the request, when, and with what comment (the last return action)."""
    for a in reversed(req.actions):
        if a.action == "return":
            return {"role": a.role, "who": names.get(a.actor_user_id), "when": a.created_at, "comment": a.comment,
                    "step": a.step}
    return None


# ---------------------------------------------------------------- what each viewer may see

_OUTCOME_ACTIONS = ("check", "opinion", "approve", "reject")
_COMMENT_FOR_REQUESTER = ("return", "reject", "withdraw")
_STEP_ORDER = {"inputs": 0, "decision": 1, None: 0}


def comment_visible(viewer, req, action):
    """The requester sees comments on a return, rejection or withdrawal, and their own. Everyone else sees all."""
    if viewer is None or req.created_by != viewer.id:
        return True
    return action.action in _COMMENT_FOR_REQUESTER or action.actor_user_id == viewer.id


def _payload(action):
    try:
        return json.loads(action.payload_json) if action.payload_json else {}
    except ValueError:
        return {}


def _fact(label, value, is_key=True, **params):
    return {"label": label, "params": params, "value": value, "is_key": is_key}


def answer_facts(req, action):
    """The answer given in an action as [{label, params, value, is_key}]. Keys are string keys for the template."""
    p = _payload(action)
    role = action.role
    out = []
    if role == "dir_accountant":
        if p.get("position"):
            out.append(_fact("card.position_available", "answer." + p["position"]))
        if p.get("funds"):
            out.append(_fact("card.funds_available", "answer." + p["funds"]))
    elif role in ("sci_director", "medical_director", "nursing_director") and p.get("opinion"):
        out.append(_fact("card.opinion", "opinion." + p["opinion"]))
    elif role == "dir_hr_officer" and p.get("documentation"):
        out.append(_fact("card.documentation", "documentation." + p["documentation"]))
    elif role == "fin_mgmt_head":
        if p.get("credit"):
            out.append(_fact("card.credit", "answer." + p["credit"]))
        if p.get("commitment_article"):
            out.append(_fact("card.commitment_article", p["commitment_article"], False))
    elif role == "central_hr_officer":
        from .request_amounts import format_amount
        names = {str(l.id): l.name for l in req.leavers}
        for leaver_id, cost in (p.get("leaver_costs") or {}).items():
            out.append(_fact("card.leaver_cost", format_amount(cost), False, name=names.get(str(leaver_id), "")))
        if p.get("new_hire_cost") not in (None, ""):
            out.append(_fact("card.new_hire_cost", format_amount(p["new_hire_cost"]), False))
    return out


def checks_view(req, viewer, names, stops):
    """Latest answer per role and step (superseded ones stay in the history). Shaped for the viewer."""
    from .request_cards import financial_view

    states = {}
    for stop in stops:
        for person in stop["people"]:
            states[(stop["step"], person["role"])] = person["state"]
    latest = {}
    for a in req.actions:
        if a.action in _OUTCOME_ACTIONS and not a.is_superseded:
            latest[(a.step, a.role, a.phase)] = a
    requester = viewer is not None and req.created_by == viewer.id
    out = []
    for (step, role, phase), a in sorted(latest.items(), key=lambda kv: (kv[0][0], _STEP_ORDER.get(kv[0][2], 0))):
        item = {"step": step, "role": role, "action": a.action, "actor": names.get(a.actor_user_id),
                "behalf": names.get(a.on_behalf_of_user_id), "redirect": a.redirect_reason, "when": a.created_at,
                "state": states.get((step, role), "done"), "replaced": a.supersedes_action_id is not None,
                "comment": a.comment if comment_visible(viewer, req, a) else None,
                "facts": [], "financials": None}
        if not requester:
            item["facts"] = answer_facts(req, a)
            if role == "dir_accountant":
                rows = RequestFinancials.query.filter_by(request_id=req.id, round=a.round).order_by(
                    RequestFinancials.period).all()
                item["financials"] = financial_view(rows)
        out.append(item)
    return out


def history_view(req, viewer, names):
    out = []
    for a in req.actions:
        out.append({"action": a.action, "role": a.role, "system": a.role == "system", "actor": names.get(a.actor_user_id), "behalf": names.get(a.on_behalf_of_user_id),
                    "redirect": a.redirect_reason, "when": a.created_at, "round": a.round, "step": a.step,
                    "superseded": bool(a.is_superseded),
                    "comment": a.comment if (a.comment and comment_visible(viewer, req, a)
                                             and a.comment != "system.auto_withdraw") else None})
    return out


def closed_banner(req, names):
    """Plain facts for the banner of a closed request, or None."""
    if req.status == "rejected":
        a = req.actions[-1] if req.actions else None  # the answer that closed it: a "no" check or a reject
        if a is not None:
            return {"kind": "rejected", "step": a.step, "role": a.role, "who": names.get(a.actor_user_id),
                    "comment": a.comment, "when": a.created_at}
    elif req.status == "withdrawn":
        last = req.actions[-1] if req.actions else None
        system = bool(last and last.comment == "system.auto_withdraw")
        return {"kind": "withdrawn", "system": system, "comment": None if system or last is None else last.comment,
                "when": last.created_at if last else None}
    elif req.status == "approved":
        return {"kind": "approved", "when": req.closed_at}
    return None
