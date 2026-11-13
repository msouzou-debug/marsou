"""Who gets a task (contract 02, section 5: C1 to C6)."""
from .model import Event, TaskOp


def _candidates(role, directorate_id, directory):
    holder = directory.holder(role, directorate_id)
    out = []
    if holder:
        out.append(holder)
    sub = directory.substitute(role, directorate_id)
    if sub and sub not in out:
        out.append(sub)
    node = holder or sub
    while node:
        node = directory.manager_of(node)
        if not node or node in out:
            break
        out.append(node)
    return holder, out


def resolve_assignee(role, directorate_id, requester_id, directory):
    """Return (assignee, on_behalf_of, redirect_reason). assignee is None when nobody is left (C5)."""
    holder, candidates = _candidates(role, directorate_id, directory)
    conflict = False
    out = False
    for cand in candidates:
        if cand == requester_id:  # C3
            conflict = True
            continue
        if directory.is_out(cand):  # C2, C4
            out = True
            continue
        if cand == holder:
            return cand, None, None
        reason = "conflict_of_interest" if conflict else ("out_of_office" if out else None)
        return cand, holder, reason
    reason = "conflict_of_interest" if conflict else ("out_of_office" if out else None)
    return None, holder, reason


def reassign_for_out_of_office(user_id, requests, directory):
    """C6. Call after the directory shows user_id as out of office.

    Returns (task_ops, events): a 'reassign' op for each open task of that user that has
    someone else to go to. Switching off does not move anything back.
    """
    ops, events = [], []
    for req in requests:
        if req.status != "in_progress":
            continue
        for task in req.tasks:
            if task.status != "open" or task.assignee_user_id != user_id:
                continue
            assignee, behalf, reason = resolve_assignee(
                task.role, req.directorate_id, req.created_by, directory)
            if assignee == user_id:
                continue
            ops.append(TaskOp("reassign", role=task.role, task_id=task.id, assignee_user_id=assignee,
                              on_behalf_of_user_id=behalf, redirect_reason=reason,
                              step=task.step, phase=task.phase, round=task.round))
            data = {"role": task.role, "step": task.step, "on_behalf_of": behalf,
                    "redirect_reason": reason}
            kind = "task_redirected" if assignee else "task_unassigned"
            events.append(Event(kind, req.id, assignee, data))
    return ops, events
