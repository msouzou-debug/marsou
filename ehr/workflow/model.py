"""Plain data types shared by the workflow modules. Pure Python, standard library only."""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping, Optional, Tuple


@dataclass(frozen=True)
class Settings:
    reminder_days: int = 2
    escalation_days: int = 5
    returned_timeout_days: int = 30


@dataclass(frozen=True)
class ActionRecord:
    id: Optional[int] = None
    round: int = 1
    step: int = 1
    phase: Optional[str] = None
    role: Optional[str] = None
    actor_user_id: Optional[str] = None
    on_behalf_of_user_id: Optional[str] = None
    redirect_reason: Optional[str] = None
    action: str = ""
    payload: Mapping[str, Any] = field(default_factory=dict)
    comment: Optional[str] = None
    supersedes_action_id: Optional[int] = None
    is_superseded: bool = False
    created_at: Optional[datetime] = None


@dataclass(frozen=True)
class TaskState:
    id: Optional[int] = None
    request_id: Optional[int] = None
    round: int = 1
    step: int = 2
    phase: Optional[str] = None
    role: str = ""
    assignee_user_id: Optional[str] = None
    on_behalf_of_user_id: Optional[str] = None
    redirect_reason: Optional[str] = None
    status: str = "open"
    may_replace: bool = False
    opened_at: Optional[datetime] = None
    clock_started_at: Optional[datetime] = None
    reminded_at: Optional[datetime] = None
    escalated_at: Optional[datetime] = None
    line_manager_id: Optional[str] = None  # filled by the caller, used by W4 only


@dataclass(frozen=True)
class RequestState:
    id: Optional[int] = None
    status: str = "draft"
    current_step: int = 1
    step3_phase: Optional[str] = None
    returned_from_step: Optional[int] = None
    round: int = 1
    category: str = "medical"
    directorate_id: Optional[str] = None
    created_by: Optional[str] = None
    route: Optional[Mapping[str, Any]] = None
    reason: Optional[str] = None
    leaver_ids: Tuple[str, ...] = ()
    returned_at: Optional[datetime] = None
    withdrawal_warned: bool = False
    actions: Tuple[ActionRecord, ...] = ()
    tasks: Tuple[TaskState, ...] = ()


@dataclass(frozen=True)
class NewAction:
    actor_user_id: Optional[str] = None
    action: str = ""
    role: Optional[str] = None
    payload: Mapping[str, Any] = field(default_factory=dict)
    comment: Optional[str] = None
    changed_fields: Mapping[str, Any] = field(default_factory=dict)  # resubmit: field -> new value
    system: bool = False  # T12 only


@dataclass(frozen=True)
class Directory:
    holders: Mapping[Tuple[str, Optional[str]], str] = field(default_factory=dict)
    substitutes: Mapping[Tuple[str, Optional[str]], str] = field(default_factory=dict)
    out_of_office: frozenset = frozenset()
    line_managers: Mapping[str, str] = field(default_factory=dict)

    def _get(self, table, role, directorate_id):
        found = table.get((role, directorate_id))
        if found is None:
            found = table.get((role, None))
        return found

    def holder(self, role, directorate_id):
        return self._get(self.holders, role, directorate_id)

    def substitute(self, role, directorate_id):
        return self._get(self.substitutes, role, directorate_id)

    def has_role(self, role, directorate_id):
        return self.holder(role, directorate_id) is not None

    def is_out(self, user_id):
        return user_id in self.out_of_office

    def manager_of(self, user_id):
        return self.line_managers.get(user_id)


@dataclass(frozen=True)
class TaskOp:
    op: str  # open, pause, resume, close, reassign, allow_replace, clear_replace
    role: Optional[str] = None
    task_id: Optional[int] = None
    assignee_user_id: Optional[str] = None
    on_behalf_of_user_id: Optional[str] = None
    redirect_reason: Optional[str] = None
    step: Optional[int] = None
    phase: Optional[str] = None
    round: Optional[int] = None


@dataclass(frozen=True)
class Event:
    kind: str
    request_id: Optional[int] = None
    recipient_user_id: Optional[str] = None
    data: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Result:
    errors: Tuple[str, ...] = ()
    status: Optional[str] = None
    current_step: Optional[int] = None
    step3_phase: Optional[str] = None
    round: Optional[int] = None
    returned_from_step: Optional[int] = None
    category: Optional[str] = None
    route: Optional[Mapping[str, Any]] = None
    returned_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    action: Optional[ActionRecord] = None
    superseded_action_ids: Tuple[int, ...] = ()
    task_ops: Tuple[TaskOp, ...] = ()
    events: Tuple[Event, ...] = ()

    @property
    def ok(self):
        return not self.errors
