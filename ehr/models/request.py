"""Requests and their workflow records (contract 01)."""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
                        UniqueConstraint, event)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..extensions import db
from .access import utcnow

REQUEST_STATUSES = ("draft", "in_progress", "returned", "approved", "rejected", "withdrawn")
REASONS = ("retirement", "resignation", "secondment_end", "contract_end", "new_need", "other")
DEPARTURE_REASONS = REASONS[:4]


def search_key(number):
    """Search form of a number. Delegates to the workflow module when it exists."""
    if not number:
        return None
    try:
        from ehr.workflow.numbering import normalise_number
    except ImportError:
        return _fallback_normalise(number)
    return normalise_number(number)


_LOOKALIKES = {  # code point of a Greek capital -> Latin letter
    0x391: "A", 0x392: "B", 0x395: "E", 0x396: "Z", 0x397: "H", 0x399: "I", 0x39A: "K",
    0x39C: "M", 0x39D: "N", 0x39F: "O", 0x3A1: "P", 0x3A4: "T", 0x3A5: "Y", 0x3A7: "X",
}
_DASHES_AND_SPACES = {ord(c) for c in " -"} | set(range(0x2010, 0x2016))


def _fallback_normalise(text):
    out = []
    for ch in text.upper():
        if ord(ch) in _DASHES_AND_SPACES:
            continue
        out.append(_LOOKALIKES.get(ord(ch), ch))
    return "".join(out)


class Request(db.Model):
    __tablename__ = "request"
    __table_args__ = (
        Index("ix_request_status_step", "status", "current_step"),
        Index("ix_request_directorate_id", "directorate_id"),
        Index("ix_request_created_by", "created_by"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String(40), unique=True, nullable=True)
    number_search: Mapped[str] = mapped_column(String(40), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    current_step: Mapped[int] = mapped_column(Integer, nullable=True)
    step3_phase: Mapped[str] = mapped_column(String(20), nullable=True)
    returned_from_step: Mapped[int] = mapped_column(Integer, nullable=True)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    directorate_id: Mapped[int] = mapped_column(ForeignKey("directorate.id"), nullable=True)
    facility_id: Mapped[int] = mapped_column(ForeignKey("facility.id"), nullable=True)
    cost_centre_id: Mapped[int] = mapped_column(ForeignKey("cost_centre.id"), nullable=True)
    category: Mapped[str] = mapped_column(String(20), nullable=True)
    position_id: Mapped[int] = mapped_column(ForeignKey("position.id"), nullable=True)
    positions_count: Mapped[int] = mapped_column(Integer, nullable=True)
    reason: Mapped[str] = mapped_column(String(30), nullable=True)
    oay_specialty_id: Mapped[int] = mapped_column(ForeignKey("oay_specialty.id"), nullable=True)
    need_text: Mapped[str] = mapped_column(Text, nullable=True)
    alternatives_text: Mapped[str] = mapped_column(Text, nullable=True)
    absence_flag: Mapped[bool] = mapped_column(Boolean, nullable=True)
    absence_text: Mapped[str] = mapped_column(Text, nullable=True)
    new_need_origin: Mapped[str] = mapped_column(Text, nullable=True)
    new_need_cover_so_far: Mapped[str] = mapped_column(Text, nullable=True)
    new_need_plan: Mapped[str] = mapped_column(Text, nullable=True)
    external_funding_flag: Mapped[bool] = mapped_column(Boolean, nullable=True)
    external_funding_text: Mapped[str] = mapped_column(Text, nullable=True)
    route_snapshot_json: Mapped[str] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    returned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawal_warned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    directorate = relationship("Directorate")
    facility = relationship("Facility")
    cost_centre = relationship("CostCentre")
    position = relationship("Position")
    oay_specialty = relationship("OaySpecialty")
    creator = relationship("User", foreign_keys=[created_by])
    leavers = relationship("RequestLeaver", order_by="RequestLeaver.id")
    actions = relationship("RequestAction", order_by="RequestAction.id")
    tasks = relationship("Task", order_by="Task.id")


@event.listens_for(Request, "before_insert")
@event.listens_for(Request, "before_update")
def _fill_number_search(mapper, connection, target):
    target.number_search = search_key(target.number)


class RequestLeaver(db.Model):
    __tablename__ = "request_leaver"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("request.id"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    leave_date: Mapped[date] = mapped_column(Date, nullable=True)
    employment: Mapped[str] = mapped_column(String(20), nullable=True)
    annual_employer_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=True)


class RequestAction(db.Model):
    __tablename__ = "request_action"
    __table_args__ = (Index("ix_request_action_request_created", "request_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("request.id"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    step: Mapped[int] = mapped_column(Integer, nullable=True)
    phase: Mapped[str] = mapped_column(String(10), nullable=True)  # 'inputs' | 'decision' (step 3 only)
    role: Mapped[str] = mapped_column(String(40), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    on_behalf_of_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    redirect_reason: Mapped[str] = mapped_column(String(30), nullable=True)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=True)
    comment: Mapped[str] = mapped_column(Text, nullable=True)
    supersedes_action_id: Mapped[int] = mapped_column(ForeignKey("request_action.id"), nullable=True)
    is_superseded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    actor = relationship("User", foreign_keys=[actor_user_id])
    on_behalf_of = relationship("User", foreign_keys=[on_behalf_of_user_id])


class RequestFinancials(db.Model):
    __tablename__ = "request_financials"
    __table_args__ = (UniqueConstraint("request_id", "round", "period", name="uq_financials_round_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("request.id"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    period: Mapped[str] = mapped_column(String(10), nullable=False)
    visits: Mapped[int] = mapped_column(Integer, nullable=True)
    procedures: Mapped[int] = mapped_column(Integer, nullable=True)
    revenue: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=True)
    payroll_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=True)
    headcount: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=True)
    oay_specialty_id: Mapped[int] = mapped_column(ForeignKey("oay_specialty.id"), nullable=True)
    oay_data_month: Mapped[date] = mapped_column(Date, nullable=True)
    payroll_to_month: Mapped[date] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")
    source_snapshot_json: Mapped[str] = mapped_column(Text, nullable=True)


class RequestDocument(db.Model):
    __tablename__ = "request_document"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("request.id"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    file_name: Mapped[str] = mapped_column(String(300), nullable=False)
    mime: Mapped[str] = mapped_column(String(100), nullable=True)
    size: Mapped[int] = mapped_column(Integer, nullable=True)
    storage_ref: Mapped[str] = mapped_column(String(300), nullable=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=True)
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class Task(db.Model):
    __tablename__ = "task"
    __table_args__ = (
        Index("ix_task_assignee_status", "assignee_user_id", "status"),
        Index("ix_task_request_id", "request_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("request.id"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    step: Mapped[int] = mapped_column(Integer, nullable=False)
    phase: Mapped[str] = mapped_column(String(10), nullable=True)  # 'inputs' | 'decision' (step 3 only)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    assignee_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    on_behalf_of_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    redirect_reason: Mapped[str] = mapped_column(String(30), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")
    may_replace: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    clock_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    reminded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    escalated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    assignee = relationship("User", foreign_keys=[assignee_user_id])


class NumberSequence(db.Model):
    __tablename__ = "number_sequence"

    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
