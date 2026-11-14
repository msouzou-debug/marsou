"""Out of office: who may switch it on, what moves when they do (contract 02, C2 and C6).

New tasks follow `build_directory`, which honours the on/off flag and the from/to dates on the day it is asked, so
nothing has to run at midnight for correctness. Switching on also moves the holder's open tasks (C6).
Switching off moves nothing back.
"""

from ehr import localtime
from ehr.extensions import db
from ehr.models import Request, RoleAssignment, Task, User, audit
from ehr.workflow.assign import reassign_for_out_of_office

from .notify import notify
from .request_engine import _ASSIGNABLE, build_directory


def holder_assignments(user, on=None):
    return [a for a in user.active_assignments(on) if a.role in _ASSIGNABLE]


def is_approver(user):
    """Only holders of an approver role may switch (substitutes have no substitute of their own)."""
    return user is not None and user.is_active and bool(holder_assignments(user))


def substitutes_of(user, on=None):
    seen, out = set(), []
    for a in holder_assignments(user, on):
        sub = a.substitute
        if sub is not None and sub.is_active and sub.id not in seen and sub.id != user.id:
            seen.add(sub.id)
            out.append(sub)
    return out


def control_state(user):
    """What the requests list shows, or None when the user has no control."""
    if not is_approver(user):
        return None
    subs = substitutes_of(user)
    return {"on": bool(user.out_of_office), "date_from": user.out_of_office_from, "date_to": user.out_of_office_to,
            "substitutes": [s.full_name or s.username for s in subs], "has_substitute": bool(subs)}


def move_open_tasks(user, now, on=None):
    """C6. Move `user`'s open tasks to whoever the rules now give (respects conflict of interest and other absences).

    Returns the list of (task, new_assignee_id). Writes audit rows and queues task_opened mail; the caller commits.
    """
    on = on or localtime.today()
    tasks = (Task.query.join(Request, Request.id == Task.request_id)
             .filter(Task.assignee_user_id == user.id, Task.status == "open", Request.status == "in_progress")
             .order_by(Task.id).all())
    by_dir, moved, events = {}, [], []
    for task in tasks:
        by_dir.setdefault(db.session.get(Request, task.request_id).directorate_id, []).append(task.request_id)
    for directorate_id, request_ids in by_dir.items():
        directory = build_directory(db.session, directorate_id, on)
        reqs = [db.session.get(Request, rid) for rid in dict.fromkeys(request_ids)]
        ops, evs = reassign_for_out_of_office(user.id, reqs, directory)
        events.extend(evs)
        for op in ops:
            task = db.session.get(Task, op.task_id)
            before = task.assignee_user_id
            task.assignee_user_id = op.assignee_user_id
            task.on_behalf_of_user_id = op.on_behalf_of_user_id
            task.redirect_reason = op.redirect_reason
            audit("task_redirected", user_id=user.id, request_id=task.request_id, object_type="task",
                  object_id=task.id, detail={"role": task.role, "from": before, "to": op.assignee_user_id,
                                             "on_behalf_of": op.on_behalf_of_user_id, "reason": op.redirect_reason,
                                             "cause": "out_of_office_on"})
            moved.append((task, op.assignee_user_id))
    db.session.flush()
    notify(events, actor_user_id=user.id)
    return moved


def switch_on(user, date_from, date_to, now):
    today = localtime.local_date(now)
    user.out_of_office, user.out_of_office_from, user.out_of_office_to = True, date_from, date_to
    db.session.flush()
    moved = move_open_tasks(user, now, today)
    audit("out_of_office_changed", user_id=user.id, object_type="user", object_id=user.id,
          detail={"state": "on", "from": date_from, "to": date_to, "moved": len(moved)})
    db.session.commit()
    return moved


def switch_off(user):
    user.out_of_office, user.out_of_office_from, user.out_of_office_to = False, None, None
    audit("out_of_office_changed", user_id=user.id, object_type="user", object_id=user.id, detail={"state": "off"})
    db.session.commit()
