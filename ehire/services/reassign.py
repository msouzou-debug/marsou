"""Waiting tasks follow the role holders (contract 02, C8).

After a holder or substitute changes, or an account is switched off or on, the open tasks of requests in progress are
checked. A task stays where it is while its assignee is still the holder or the substitute of that role and the
account is active (so coming back from out of office never pulls a task back). Any other task is offered to whoever
`resolve_assignee` gives now, which still skips the requester (C3) and people out of office (C4). If nobody is left
the task stays open with no assignee, as at submission (C5), and the administrators get `task_unassigned`.

Everything here runs in the caller's transaction. The caller commits.
"""
from dataclasses import dataclass

from ehire.extensions import db
from ehire.models import Request, Task, User, audit
from ehire.workflow.assign import resolve_assignee
from ehire.workflow.model import Event

from .notify import notify
from .request_engine import _ASSIGNABLE, build_directory


@dataclass(frozen=True)
class Move:
    task_id: int
    request_id: int
    role: str
    before: object
    after: object  # None when nobody is left


def _still_valid(task, directorate_id, directory, active_ids):
    """The assignee is an active person who is the holder or the substitute of this role now."""
    if task.assignee_user_id is None or task.assignee_user_id not in active_ids:
        return False
    return task.assignee_user_id in (directory.holder(task.role, directorate_id),
                                     directory.substitute(task.role, directorate_id))


def settle_open_tasks(actor_id, *, role=None, directorate_id=None, user_id=None, unassigned_only=False,
                      cause="holder_changed"):
    """Move the open tasks whose assignee is no longer valid. Returns the list of Move.

    role / directorate_id limit the check (directorate_id None means every Directorate, for central roles);
    user_id limits it to that person's tasks; unassigned_only to tasks nobody holds."""
    db.session.flush()
    query = (db.session.query(Task, Request).join(Request, Request.id == Task.request_id)
             .filter(Task.status == "open", Request.status == "in_progress", Task.role.in_(_ASSIGNABLE)))
    if role is not None:
        query = query.filter(Task.role == role)
    if directorate_id is not None:
        query = query.filter(Request.directorate_id == directorate_id)
    if user_id is not None:
        query = query.filter(Task.assignee_user_id == user_id)
    if unassigned_only:
        query = query.filter(Task.assignee_user_id.is_(None))
    active_ids = {row[0] for row in db.session.query(User.id).filter(User.is_active.is_(True))}
    directories, moves, events = {}, [], []
    for task, req in query.order_by(Task.id).all():
        if req.directorate_id not in directories:
            directories[req.directorate_id] = build_directory(db.session, req.directorate_id)
        directory = directories[req.directorate_id]
        if _still_valid(task, req.directorate_id, directory, active_ids):
            continue
        assignee, behalf, reason = resolve_assignee(task.role, req.directorate_id, req.created_by, directory)
        if assignee == task.assignee_user_id:
            continue  # nobody better, or the same person by another route
        before = task.assignee_user_id
        why = "account_deactivated" if before is not None and before not in active_ids else cause
        task.assignee_user_id, task.on_behalf_of_user_id, task.redirect_reason = assignee, behalf, reason
        audit("task_redirected", user_id=actor_id, request_id=req.id, object_type="task", object_id=task.id,
              detail={"role": task.role, "from": before, "to": assignee, "on_behalf_of": behalf, "reason": reason,
                      "cause": why})
        data = {"role": task.role, "step": task.step, "phase": task.phase, "on_behalf_of": behalf,
                "redirect_reason": reason}
        events.append(Event("task_opened" if assignee else "task_unassigned", req.id, assignee, data))
        moves.append(Move(task.id, req.id, task.role, before, assignee))
    db.session.flush()
    notify(events, actor_user_id=actor_id)
    return moves


def names_moved_to(moves):
    """Distinct full names of the people who received tasks, in order."""
    names = []
    for m in moves:
        if m.after is not None:
            user = db.session.get(User, m.after)
            name = (user.full_name or user.username) if user else ""
            if name and name not in names:
                names.append(name)
    return names
