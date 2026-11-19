"""Tracker view (contract 02, section 9). Templates render this and hold no rules."""
from .route import STEPS

_NEGATIVE = {"opinion": "negative", "documentation": "incomplete", "credit": "no"}
_INPUT_ACTIONS = ("check", "opinion", "approve", "reject")


def _person(role, phase=None):
    return {"role": role, "state": "waiting", "actor_user_id": None, "on_behalf_of_user_id": None,
            "redirect_reason": None, "replaced": False, "phase": phase}


def _stop_people(step_def):
    step = step_def["step"]
    if step == 3:
        return ([(r, "inputs") for r in step_def["inputs"]] + [(step_def["decision"], "decision")])
    if step == 4:
        return [(r, None) for r in step_def["inputs"]]
    return [(r, None) for r in step_def.get("roles", [])]


def preview(route):
    """Form preview: every stop pending, the not-applicable step marked."""
    stops = []
    for sd in route["steps"]:
        applies = sd.get("applies", True)
        stops.append({"step": sd["step"], "state": "pending" if applies else "not_applicable",
                      "phase": None,
                      "people": [_person(r, ph) for r, ph in _stop_people(sd)]})
    return stops


def _is_negative(a):
    if a.action == "reject":
        return True
    if a.payload.get("position") == "no" or a.payload.get("funds") == "no":
        return True
    return any(a.payload.get(k) == v for k, v in _NEGATIVE.items())


def tracker_view(state):
    route = state.route
    if not route:
        return []
    status = state.status
    at = state.current_step
    if status == "returned" and state.returned_from_step:
        at = state.returned_from_step
    stops = []
    for sd in route["steps"]:
        step = sd["step"]
        if not sd.get("applies", True):
            st = "not_applicable"
        elif status == "draft":
            st = "current" if step == 1 else "pending"
        elif status == "approved":
            st = "done"
        elif step < at:
            st = "done"
        elif step == at:
            st = {"in_progress": "current", "returned": "paused", "rejected": "stopped",
                  "withdrawn": "withdrawn"}.get(status, "current")
            if step == 1 and status in ("in_progress", "returned"):
                st = "done"
        else:
            st = "pending"
        stops.append({"step": step, "state": st,
                      "phase": state.step3_phase if step == 3 and st != "pending" else None,
                      "people": [_build_person(state, step, r, ph, st)
                                 for r, ph in _stop_people(sd)]})
    return stops


def _build_person(state, step, role, phase, stop_state):
    p = _person(role, phase)
    if step == 1:
        p["state"] = "done" if stop_state == "done" else "waiting"
        p["actor_user_id"] = None if stop_state == "pending" else state.created_by
        return p
    acts = [a for a in state.actions if a.step == step and a.role == role
            and (phase is None or a.phase == phase) and a.action in _INPUT_ACTIONS]
    active = [a for a in acts if not a.is_superseded]
    p["replaced"] = any(a.is_superseded for a in acts) and bool(active) and any(
        a.supersedes_action_id is not None for a in active)
    if active:
        a = active[-1]
        p["state"] = "negative" if _is_negative(a) else "done"
        p["actor_user_id"] = a.actor_user_id
        p["on_behalf_of_user_id"] = a.on_behalf_of_user_id
        p["redirect_reason"] = a.redirect_reason
        return p
    task = None
    for t in state.tasks:
        if t.role == role and t.step == step and t.phase == phase and t.status in ("open", "paused"):
            task = t
    if task is not None:
        p["state"] = "waiting" if task.status == "open" else "paused"
        p["actor_user_id"] = task.assignee_user_id
        p["on_behalf_of_user_id"] = task.on_behalf_of_user_id
        p["redirect_reason"] = task.redirect_reason
    elif acts:
        p["state"] = "replaced"  # an earlier answer was discarded by a material change (T9b)
    return p
