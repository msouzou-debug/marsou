"""Who may see a request (contract 03, section 2). Anything else is a 404."""

from sqlalchemy import and_, or_

from .. import localtime
from ..extensions import db
from ..models import SEE_ALL_ROLES, Request, RoleAssignment, Task, UserDirectorate

# Directorate roles whose holders and substitutes see the whole Directorate. `requester` does not.
DIRECTORATE_VIEW_ROLES = ("dir_accountant", "sci_director", "dir_hr_officer", "dir_exec")


def _scope(user, on=None):
    """Return (sees_all, directorate_ids) for a user from holder and substitute assignments."""
    on = on or localtime.today()
    sees_all, dirs = False, set()
    rows = RoleAssignment.query.filter(
        or_(RoleAssignment.user_id == user.id, RoleAssignment.substitute_user_id == user.id)
    ).all()
    for a in rows:
        if not a.is_active_on(on):
            continue
        if a.role in SEE_ALL_ROLES:
            sees_all = True
        elif a.role in DIRECTORATE_VIEW_ROLES and a.directorate_id is not None:
            dirs.add(a.directorate_id)
    if user.has_permission("request.view_directorate"):
        dirs |= {r.directorate_id for r in UserDirectorate.query.filter_by(user_id=user.id)}
    return sees_all, dirs


def can_see_request(user, req):
    if user is None or req is None:
        return False
    if req.created_by == user.id:
        return True
    if req.status == "draft":
        return False
    sees_all, dirs = _scope(user)
    if sees_all or req.directorate_id in dirs:
        return True
    return db.session.query(Task.id).filter_by(request_id=req.id, assignee_user_id=user.id).first() is not None


def visible_requests_query(user):
    """A chainable Query of the requests this user may see. Same rules as can_see_request."""
    q = db.session.query(Request)
    if user is None:
        return q.filter(db.false())
    sees_all, dirs = _scope(user)
    submitted = Request.status != "draft"
    if sees_all:
        others = submitted
    else:
        task_ids = db.session.query(Task.request_id).filter(Task.assignee_user_id == user.id)
        conds = [Request.id.in_(task_ids)]
        if dirs:
            conds.append(Request.directorate_id.in_(dirs))
        others = and_(submitted, or_(*conds))
    return q.filter(or_(Request.created_by == user.id, others))
