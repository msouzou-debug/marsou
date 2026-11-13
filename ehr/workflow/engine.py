"""The transition engine (contract 02, sections 3 to 7). Pure: no clock, no I/O."""
from dataclasses import replace
from typing import Mapping

from .assign import resolve_assignee
from .model import ActionRecord, Event, Result, TaskOp
from .route import (ACTIONS, CLOSED_STATUSES, DEPARTURE_REASONS, MATERIAL_FIELDS,
                    compute_route)
from .timing import working_days_between, _settings

APPROVER_ACTIONS = ("check", "opinion", "approve", "reject", "return")
INPUT_ACTIONS = ("check", "opinion", "approve", "reject")
ROLE_ACTIONS = {
    "dir_accountant": ("check",),
    "sci_director": ("opinion",),
    "dir_hr_officer": ("check",),
    "dir_exec": ("approve", "reject"),
    "fin_mgmt_head": ("check",),
    "central_hr_officer": ("check",),
    "medical_director": ("opinion",),
    "nursing_director": ("opinion",),
    "ceo": ("approve", "reject"),
}
FIN_KEYS = ("visits", "procedures", "revenue", "payroll_cost", "headcount")
SYSTEM_COMMENT = "system.auto_withdraw"


def _err(*codes):
    return Result(errors=tuple(codes))


def _blank(value):
    return value is None or (isinstance(value, str) and not value.strip())


def _norm_field(name):
    return name[:-3] if name.endswith("_id") else name


def _step_def(route, step):
    for s in route["steps"]:
        if s["step"] == step:
            return s
    return {}


def _step_roles(route, step, phase=None):
    s = _step_def(route, step)
    if step == 3:
        return [s["decision"]] if phase == "decision" else list(s["inputs"])
    if step == 4:
        return list(s["inputs"])
    return list(s.get("roles", []))


def _phase_for(state):
    return state.step3_phase if state.current_step == 3 else None


class _Build:
    """Collects the outcome of one call."""

    def __init__(self, state, directory, now):
        self.state, self.directory, self.now = state, directory, now
        self.ops, self.events = [], []
        self.status = state.status
        self.step = state.current_step
        self.phase = state.step3_phase
        self.round = state.round
        self.returned_from = state.returned_from_step
        self.category = state.category
        self.route = state.route
        self.returned_at = state.returned_at
        self.closed_at = None
        self.action = None
        self.superseded = []

    def emit(self, kind, recipient, **data):
        self.events.append(Event(kind, self.state.id, recipient, data))

    def record(self, step, phase, role, action, payload=None, comment=None, task=None,
               actor=None, supersedes=None, round_=None):
        self.action = ActionRecord(
            id=None, round=round_ or self.round, step=step, phase=phase, role=role,
            actor_user_id=actor, action=action, payload=dict(payload or {}), comment=comment,
            on_behalf_of_user_id=task.on_behalf_of_user_id if task else None,
            redirect_reason=task.redirect_reason if task else None,
            supersedes_action_id=supersedes, created_at=self.now)

    def open_role(self, role, step, phase):
        assignee, behalf, reason = resolve_assignee(
            role, self.state.directorate_id, self.state.created_by, self.directory)
        self.ops.append(TaskOp("open", role=role, assignee_user_id=assignee,
                               on_behalf_of_user_id=behalf, redirect_reason=reason,
                               step=step, phase=phase, round=self.round))
        data = {"role": role, "step": step, "phase": phase,
                "on_behalf_of": behalf, "redirect_reason": reason}
        if assignee is None:
            self.emit("task_unassigned", None, **data)
        else:
            self.emit("task_opened", assignee, **data)
            if reason == "out_of_office" and behalf:
                self.emit("task_redirected", behalf, **dict(data, assignee=assignee))

    def close_tasks(self, statuses=("open", "paused"), skip_id=None):
        for t in self.state.tasks:
            if t.status in statuses and t.id != skip_id:
                self.ops.append(TaskOp("close", role=t.role, task_id=t.id))

    def clear_flags(self):
        for t in self.state.tasks:
            if t.may_replace:
                self.ops.append(TaskOp("clear_replace", role=t.role, task_id=t.id))

    def finish_closed(self, status):
        self.status = status
        self.closed_at = self.now
        self.emit("request_" + status, self.state.created_by, step=self.step)

    def result(self):
        return Result(
            status=self.status, current_step=self.step, step3_phase=self.phase,
            round=self.round, returned_from_step=self.returned_from, category=self.category,
            route=self.route, returned_at=self.returned_at, closed_at=self.closed_at,
            action=self.action, superseded_action_ids=tuple(self.superseded),
            task_ops=tuple(self.ops), events=tuple(self.events))


def apply(state, action, directory, now, holidays=None, settings=None):
    """Apply one action. Returns Result with errors set, or the full outcome to store.

    holidays and settings are optional; when both are given, a system withdrawal (T12) is
    checked against the timeout."""
    if state.status in CLOSED_STATUSES:
        return _err("request_closed")
    kind = action.action
    if kind not in ACTIONS:
        return _err("wrong_step")
    if action.system:
        return _system_withdraw(state, action, directory, now, holidays, settings)
    if kind == "submit":
        return _submit(state, action, directory, now)
    if kind == "resubmit":
        return _resubmit(state, action, directory, now)
    if kind == "withdraw":
        return _withdraw(state, action, directory, now)
    return _approver(state, action, directory, now)


# ---------------------------------------------------------------- requester actions

def _submit(state, action, directory, now):
    if action.actor_user_id != state.created_by:
        return _err("not_requester")
    if state.status != "draft":
        return _err("wrong_step")
    b = _Build(state, directory, now)
    b.route = compute_route(state.category, directory.has_role("sci_director", state.directorate_id))
    b.status, b.step, b.phase, b.round = "in_progress", 2, None, 1
    b.record(1, None, "requester", "submit", action.payload, action.comment,
             actor=action.actor_user_id)
    b.emit("request_submitted", state.created_by)
    b.open_role("dir_accountant", 2, None)
    return b.result()


def _returner(state):
    for a in reversed(state.actions):
        if a.action == "return":
            return a.actor_user_id
    return None


def _resubmit(state, action, directory, now):
    if action.actor_user_id != state.created_by:
        return _err("not_requester")
    if state.status != "returned":
        return _err("wrong_step")
    changed = action.changed_fields or {}
    names = [_norm_field(f) for f in changed]
    if "directorate" in names:
        return _err("directorate_locked")
    material = [n for n in names if n in MATERIAL_FIELDS]
    b = _Build(state, directory, now)
    b.round = state.round + 1
    b.status = "in_progress"
    b.step = state.returned_from_step or state.current_step
    b.returned_from = None
    b.returned_at = None
    returner = _returner(state)
    payload = {"changed_fields": sorted(changed)}
    if material:  # T9b
        new_cat = changed.get("category") if isinstance(changed, Mapping) else None
        b.category = new_cat or state.category
        b.route = compute_route(b.category, directory.has_role("sci_director", state.directorate_id))
        b.step, b.phase = 2, None
        b.close_tasks(statuses=("paused", "open"))
        b.clear_flags()
        b.superseded = [a.id for a in state.actions
                        if a.step >= 2 and not a.is_superseded and a.id is not None]
        b.record(1, None, "requester", "resubmit", payload, action.comment,
                 actor=action.actor_user_id)
        if returner:
            b.emit("request_resubmitted", returner, material=True)
        b.open_role("dir_accountant", 2, None)
        return b.result()
    # T9a
    b.record(1, None, "requester", "resubmit", payload, action.comment, actor=action.actor_user_id)
    for t in state.tasks:
        if t.status == "paused":
            b.ops.append(TaskOp("resume", role=t.role, task_id=t.id, assignee_user_id=t.assignee_user_id))
            if t.assignee_user_id:
                b.emit("task_resumed", t.assignee_user_id, role=t.role, step=t.step)
    phase = _phase_for(replace(state, current_step=b.step))
    for a, t in _completed_input_tasks(state, b.step, phase):
        b.ops.append(TaskOp("allow_replace", role=t.role, task_id=t.id,
                            assignee_user_id=t.assignee_user_id))
        b.emit("new_material", t.assignee_user_id, role=t.role, step=b.step)
    if returner:
        b.emit("request_resubmitted", returner, material=False)
    return b.result()


def _completed_input_tasks(state, step, phase):
    """Pairs (action, closed task) for completed check/opinion inputs in this step and phase."""
    if step not in (3, 4):
        return []
    roles = _step_roles(state.route, step, phase)
    found = []
    for a in state.actions:
        if a.is_superseded or a.step != step or a.phase != phase:
            continue
        if a.action not in ("check", "opinion") or a.role not in roles:
            continue
        cand = [t for t in state.tasks if t.status == "closed" and t.role == a.role
                and t.step == step and t.phase == phase and t.assignee_user_id == a.actor_user_id]
        if cand:
            found.append((a, cand[-1]))
    return found


def _withdraw(state, action, directory, now):
    if action.actor_user_id != state.created_by:
        return _err("not_requester")
    if state.status not in ("in_progress", "returned"):
        return _err("wrong_step")
    if _blank(action.comment):
        return _err("comment_required")
    b = _Build(state, directory, now)
    b.record(state.current_step, _phase_for(state), "requester", "withdraw", {}, action.comment,
             actor=action.actor_user_id)
    _close_withdrawn(b)
    return b.result()


def _close_withdrawn(b):
    state = b.state
    b.close_tasks()
    b.clear_flags()
    b.finish_closed("withdrawn")
    told = {t.assignee_user_id for t in state.tasks
            if t.status == "open" and t.assignee_user_id and t.assignee_user_id != state.created_by}
    for uid in sorted(told):
        b.emit("request_withdrawn", uid, step=b.step)


def _system_withdraw(state, action, directory, now, holidays, settings):
    if action.action != "withdraw" or state.status != "returned":
        return _err("wrong_step")
    if holidays is not None and settings is not None and state.returned_at is not None:
        days = working_days_between(state.returned_at, now, holidays)
        if days < _settings(settings).returned_timeout_days:
            return _err("wrong_step")
    b = _Build(state, directory, now)
    b.record(state.current_step, _phase_for(state), "system", "withdraw", {},
             action.comment or SYSTEM_COMMENT, actor=None)
    _close_withdrawn(b)
    return b.result()


# ---------------------------------------------------------------- approver actions

def _find_open_task(state, actor, role):
    for t in state.tasks:
        if t.status == "open" and t.assignee_user_id == actor and (role is None or t.role == role):
            return t
    return None


def _find_replace_task(state, actor, role):
    found = None
    for t in state.tasks:
        if (t.status == "closed" and t.may_replace and t.assignee_user_id == actor
                and (role is None or t.role == role)):
            found = t
    return found


def _approver(state, action, directory, now):
    if state.status == "returned":
        return _err("request_returned")
    if state.status != "in_progress":
        return _err("wrong_step")
    if action.actor_user_id == state.created_by:
        return _err("own_request")
    kind = action.action
    task = _find_open_task(state, action.actor_user_id, action.role)
    replacing = False
    if task is None:
        if kind in ("check", "opinion"):
            task = _find_replace_task(state, action.actor_user_id, action.role)
            replacing = task is not None
        if task is None:
            return _err("not_your_task")
    role = task.role
    if kind != "return" and kind not in ROLE_ACTIONS.get(role, ()):
        return _err("wrong_step")
    phase = _phase_for(state)
    if task.step != state.current_step or task.phase != phase:
        return _err("wrong_step")
    if replacing and role not in _step_roles(state.route, state.current_step, phase):
        return _err("wrong_step")

    b = _Build(state, directory, now)
    payload = dict(action.payload or {})
    comment = action.comment

    if kind == "return":  # T8
        if _blank(comment):
            return _err("comment_required")
        b.record(b.step, phase, role, "return", {}, comment, task, action.actor_user_id)
        b.status, b.returned_from, b.returned_at = "returned", state.current_step, now
        for t in state.tasks:
            if t.status == "open":
                b.ops.append(TaskOp("pause", role=t.role, task_id=t.id))
        b.emit("request_returned", state.created_by, step=state.current_step, role=role)
        return b.result()

    verdict = _validate(state, role, kind, payload, comment)
    if isinstance(verdict, tuple):
        return _err(*verdict)

    supersedes = None
    if replacing:  # T10
        old = [a for a in state.actions if not a.is_superseded and a.step == state.current_step
               and a.phase == phase and a.role == role and a.action in ("check", "opinion")]
        if not old:
            return _err("wrong_step")
        supersedes = old[-1].id
        b.superseded.append(supersedes)
        b.ops.append(TaskOp("clear_replace", role=role, task_id=task.id))
    else:
        b.ops.append(TaskOp("close", role=role, task_id=task.id))
    b.record(b.step, phase, role, kind, payload, comment, task, action.actor_user_id, supersedes)

    if verdict == "reject":
        _reject(b, task.id if not replacing else None)
        return b.result()
    _progress(b, role, kind, payload, replacing)
    return b.result()


def _validate(state, role, kind, payload, comment):
    """Return 'reject', 'pass', or a tuple of error codes."""
    need_comment = _blank(comment)

    def choice(key, allowed):
        return payload.get(key) in allowed

    if role == "dir_accountant":
        if not choice("position", ("yes", "no", "arranged_centrally")) or not choice("funds", ("yes", "no")):
            return ("invalid_payload",)
        if payload["position"] == "no" or payload["funds"] == "no":  # T2b
            return ("comment_required",) if need_comment else "reject"
        if state.route["financials_required"] and not _financials_present(payload):
            return ("financials_required",)
        return "pass"
    if role in ("sci_director", "medical_director", "nursing_director"):
        if not choice("opinion", ("positive", "negative")):
            return ("invalid_payload",)
        if payload["opinion"] == "negative" and need_comment:
            return ("comment_required",)
        return "pass"
    if role == "dir_hr_officer":
        if not choice("documentation", ("complete", "incomplete")):
            return ("invalid_payload",)
        if payload["documentation"] == "incomplete" and need_comment:
            return ("comment_required",)
        return "pass"
    if role in ("dir_exec", "ceo"):
        if kind == "reject":
            return ("comment_required",) if need_comment else "reject"
        return "pass"
    if role == "fin_mgmt_head":
        if not choice("credit", ("yes", "no")):
            return ("invalid_payload",)
        if payload["credit"] == "no":  # T5a
            return ("comment_required",) if need_comment else "reject"
        if _blank(payload.get("commitment_article")):
            return ("commitment_article_required",)
        return "pass"
    if role == "central_hr_officer":
        costs = payload.get("leaver_costs") or {}
        leavers = state.leaver_ids if state.reason in DEPARTURE_REASONS else ()
        if _blank(payload.get("new_hire_cost")) or any(
                not isinstance(costs, Mapping) or _blank(costs.get(l)) for l in leavers):
            return ("leaver_costs_required",)
        return "pass"
    return ("wrong_step",)


def _financials_present(p):
    if _blank(p.get("oay_specialty_id")) or _blank(p.get("payroll_to_month")):
        return False
    for period in ("prev_year", "ytd"):
        d = p.get(period)
        if not isinstance(d, Mapping) or any(_blank(d.get(k)) for k in FIN_KEYS):
            return False
    return True


def _reject(b, own_task_id):
    b.close_tasks(skip_id=own_task_id)
    b.clear_flags()
    b.finish_closed("rejected")


def _active_inputs(b, step, phase):
    superseded = set(b.superseded)
    acts = [a for a in b.state.actions
            if not a.is_superseded and a.id not in superseded and a.step == step
            and a.phase == phase and a.action in INPUT_ACTIONS]
    acts.append(b.action)
    return acts


def _all_in(b, step, phase):
    have = {a.role for a in _active_inputs(b, step, phase)}
    return all(r in have for r in _step_roles(b.state.route, step, phase))


def _progress(b, role, kind, payload, replacing):
    state = b.state
    if role == "dir_accountant":  # T2a
        b.step, b.phase = 3, "inputs"
        for r in _step_roles(state.route, 3, "inputs"):
            b.open_role(r, 3, "inputs")
    elif role in ("sci_director", "dir_hr_officer"):  # T3
        if not replacing and _all_in(b, 3, "inputs"):
            b.phase = "decision"
            b.open_role("dir_exec", 3, "decision")
    elif role == "dir_exec":  # T4a
        b.clear_flags()
        b.step, b.phase = 4, None
        for r in _step_roles(state.route, 4):
            b.open_role(r, 4, None)
    elif role in ("fin_mgmt_head", "central_hr_officer"):  # T5b, T5c
        if _all_in(b, 4, None):
            _step4_done(b)
    elif role in ("medical_director", "nursing_director"):  # T6
        b.clear_flags()
        b.step, b.phase = 6, None
        b.open_role("ceo", 6, None)
    elif role == "ceo":  # T7a
        b.clear_flags()
        b.finish_closed("approved")


def _step4_done(b):
    """T5d."""
    b.clear_flags()
    s5 = _step_def(b.state.route, 5)
    b.phase = None
    if s5.get("applies"):
        b.step = 5
        b.open_role(s5["roles"][0], 5, None)
    else:
        b.step = 6
        b.open_role("ceo", 6, None)
