"""Changing who holds a role (contract 01, role_assignment). The roles page and the person page both call these
functions, so they cannot disagree. Every change is audited as `role_changed`.

None of these commit: the caller does, so the change and the move of waiting tasks (reassign.py) are one transaction.
Each returns an Outcome; `flash_outcome` turns it into messages.
"""
from dataclasses import dataclass, field
from datetime import timedelta

from ehire import localtime
from ehire.extensions import db
from ehire.i18n import plural_key
from ehire.models import CENTRAL_ROLES, RoleAssignment, User, audit

from .reassign import names_moved_to, settle_open_tasks
from .request_flash import flash_key

MULTI_HOLDER_CENTRAL_ROLES = ("viewer", "admin")  # many holders, never a Directorate
SINGLE_DIRECTORATE_ROLES = ("dir_accountant", "sci_director", "dir_hr_officer", "dir_exec")
ALL_ROLES = ("requester",) + SINGLE_DIRECTORATE_ROLES + CENTRAL_ROLES + MULTI_HOLDER_CENTRAL_ROLES


@dataclass
class Outcome:
    ok: bool = True
    key: str = "settings.saved"
    params: dict = field(default_factory=dict)
    moves: list = field(default_factory=list)


def fail(key, **params):
    return Outcome(False, key, params)


def flash_outcome(outcome):
    """Flash the result: the saved message (or the refusal), then what happened to waiting tasks."""
    if not outcome.ok:
        flash_key(outcome.key, "danger", **outcome.params)
        return
    flash_key(outcome.key, "success", **outcome.params)
    moved = [m for m in outcome.moves if m.after is not None]
    left = [m for m in outcome.moves if m.after is None]
    if moved:
        flash_key(plural_key("settings.reassigned", len(moved)), "success", n=len(moved),
                  who=", ".join(names_moved_to(moved)))
    if left:
        flash_key(plural_key("settings.unassigned_now", len(left)), "warning", n=len(left))


def is_single(role):
    return role in SINGLE_DIRECTORATE_ROLES or role in CENTRAL_ROLES


def needs_directorate(role):
    return role == "requester" or role in SINGLE_DIRECTORATE_ROLES


def roles_for(directorate):
    """Single-holder roles that exist for a Directorate (or for the centre when None)."""
    if directorate is None:
        return CENTRAL_ROLES
    return tuple(r for r in SINGLE_DIRECTORATE_ROLES if r != "sci_director" or directorate.has_sci_director)


def active_rows(role, directorate_id):
    rows = RoleAssignment.query.filter_by(role=role, directorate_id=directorate_id).order_by(RoleAssignment.id).all()
    return [a for a in rows if a.is_active_on()]


def active_admin_ids():
    """Ids of the active users who hold the admin role now."""
    return {a.user_id for a in active_rows("admin", None) if a.user is not None and a.user.is_active}


def _ended_yesterday():
    return localtime.today() - timedelta(days=1)


def _snapshot(role, directorate_id):
    return [{"user_id": a.user_id, "substitute_user_id": a.substitute_user_id}
            for a in active_rows(role, directorate_id)]


def _audit(actor_id, role, did, **detail):
    audit("role_changed", user_id=actor_id, object_type="role_assignment", object_id=role,
          detail={"role": role, "directorate_id": did, **detail})


def _name(user):
    return user.full_name or user.username


# ---------------------------------------------------------------- single-holder roles

def set_single(actor_id, role, directorate, holder, substitute):
    """Set the holder and substitute of a single-holder role. holder None clears it. The caller has checked that
    `role` exists for `directorate` (roles_for) and that the people are active."""
    did = directorate.id if directorate else None
    if holder is not None and substitute is not None and holder.id == substitute.id:
        return fail("settings.same_person")
    before = _snapshot(role, did)
    current = active_rows(role, did)
    if holder is None:
        for a in current:
            a.active_to = _ended_yesterday()
    else:
        existing = RoleAssignment.query.filter_by(user_id=holder.id, role=role, directorate_id=did).first()
        for a in current:
            if existing is None or a.id != existing.id:
                a.active_to = _ended_yesterday()
        if existing is None:
            existing = RoleAssignment(user_id=holder.id, role=role, directorate_id=did)
            db.session.add(existing)
        existing.active_from = existing.active_to = None
        existing.substitute_user_id = substitute.id if substitute else None
    db.session.flush()
    _audit(actor_id, role, did, before=before, after=_snapshot(role, did))
    return Outcome(moves=settle_open_tasks(actor_id, role=role, directorate_id=did))


def set_substitute(actor_id, assignment, substitute):
    """Change only the substitute on an active single-holder row."""
    if substitute is not None and substitute.id == assignment.user_id:
        return fail("settings.same_person")
    did = assignment.directorate_id
    before = _snapshot(assignment.role, did)
    assignment.substitute_user_id = substitute.id if substitute else None
    db.session.flush()
    _audit(actor_id, assignment.role, did, before=before, after=_snapshot(assignment.role, did))
    return Outcome(moves=settle_open_tasks(actor_id, role=assignment.role, directorate_id=did))


def add_to_role(actor_id, user, role, directorate, substitute, replace):
    """The person page's "add a role". For a single-holder role that already has another active holder, refuses
    with that person's name unless `replace` is true."""
    if not user.is_active:
        return fail("settings.person.add_inactive")
    if role not in ALL_ROLES:
        return fail("validation.choose")
    if needs_directorate(role) and directorate is None:
        return fail("validation.required")
    if not needs_directorate(role):
        directorate = None
    if role == "requester":
        return add_requester(actor_id, user, directorate)
    if role in MULTI_HOLDER_CENTRAL_ROLES:
        return add_multi(actor_id, user, role)
    if role not in roles_for(directorate):
        return fail("validation.choose")
    others = [a for a in active_rows(role, directorate.id if directorate else None) if a.user_id != user.id]
    if others and not replace:
        return fail("settings.person.holder_exists", who=_name(others[0].user))
    if substitute is None:
        mine = [a for a in active_rows(role, directorate.id if directorate else None) if a.user_id == user.id]
        if mine and mine[0].substitute_user_id:
            substitute = db.session.get(User, mine[0].substitute_user_id)
    return set_single(actor_id, role, directorate, user, substitute)


# ---------------------------------------------------------------- requesters, viewers, administrators

def _ensure_row(user, role, did):
    row = RoleAssignment.query.filter_by(user_id=user.id, role=role, directorate_id=did).first()
    if row is None:
        row = RoleAssignment(user_id=user.id, role=role, directorate_id=did)
        db.session.add(row)
    row.active_from = row.active_to = None
    return row


def add_requester(actor_id, user, directorate):
    _ensure_row(user, "requester", directorate.id)
    _audit(actor_id, "requester", directorate.id, action="add", user_id=user.id)
    return Outcome()


def remove_requester(actor_id, user, directorate):
    row = RoleAssignment.query.filter_by(user_id=user.id, role="requester", directorate_id=directorate.id).first()
    if row is None:
        return fail("validation.choose")
    row.active_to = _ended_yesterday()
    _audit(actor_id, "requester", directorate.id, action="remove", user_id=user.id)
    return Outcome()


def add_multi(actor_id, user, role):
    _ensure_row(user, role, None)
    _audit(actor_id, role, None, action="add", user_id=user.id)
    return Outcome()


def remove_multi(actor_id, user, role):
    """Remove a viewer or administrator. Nobody removes their own admin role; the last active administrator stays."""
    row = RoleAssignment.query.filter_by(user_id=user.id, role=role, directorate_id=None).first()
    if row is None or not row.is_active_on():
        return fail("validation.choose")
    if role == "admin":
        if user.id == actor_id:
            return fail("settings.admin_self_remove")
        if active_admin_ids() == {user.id}:
            return fail("settings.last_admin")
    row.active_to = _ended_yesterday()
    _audit(actor_id, role, None, action="remove", user_id=user.id)
    return Outcome()


def remove_assignment(actor_id, assignment):
    """Remove one active row from the person page, whatever its kind."""
    role, user = assignment.role, assignment.user
    if role == "requester":
        return remove_requester(actor_id, user, assignment.directorate)
    if role in MULTI_HOLDER_CENTRAL_ROLES:
        return remove_multi(actor_id, user, role)
    return set_single(actor_id, role, assignment.directorate, None, None)


# ---------------------------------------------------------------- accounts

def toggle_account(actor_id, user):
    """Switch an account on or off. A switched-off account keeps no waiting task; a switched-on one picks up the
    tasks nobody holds."""
    if user.id == actor_id and user.is_active:
        return fail("settings.self_deactivate")
    if user.is_active and active_admin_ids() == {user.id}:
        return fail("settings.last_admin")
    user.is_active = not user.is_active
    audit("user_changed", user_id=actor_id, object_type="user", object_id=user.id,
          detail={"action": "activate" if user.is_active else "deactivate"})
    if user.is_active:
        moves = settle_open_tasks(actor_id, unassigned_only=True)
    else:
        moves = settle_open_tasks(actor_id, user_id=user.id, cause="account_deactivated")
    return Outcome(moves=moves)
