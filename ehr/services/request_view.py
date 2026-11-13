"""Data the request screens show: tracker stops, status line, names. No rules: the engine's tracker does the work."""
from ehr.extensions import db
from ehr.models import User
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
                days = timing.working_days_between(t.clock_started_at or t.opened_at, now, holidays)
                waiting.append({"role": t.role, "who": names.get(t.assignee_user_id), "days": days,
                                "reminded": t.reminded_at is not None, "escalated": t.escalated_at is not None})
        info["waiting"] = waiting
    elif status == "rejected":
        rejects = [a for a in req.actions if a.action == "reject"]
        if rejects:
            info.update(step=rejects[-1].step, role=rejects[-1].role, comment=rejects[-1].comment)
    elif status == "withdrawn":
        last = req.actions[-1] if req.actions else None
        info["system"] = bool(last and last.comment == "system.auto_withdraw")
    return info
