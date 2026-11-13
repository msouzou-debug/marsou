"""Append-only audit log. The model exposes insert only: no update or delete helper exists.

Where the engine allows it, the database user should also be denied UPDATE and DELETE on this table.
"""
import json
from datetime import datetime

from flask import has_request_context, request
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, event
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db
from .access import utcnow


class AuditLog(db.Model):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_request_id", "request_id"), Index("ix_audit_log_at", "at"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    event: Mapped[str] = mapped_column(String(60), nullable=False)
    request_id: Mapped[int] = mapped_column(Integer, nullable=True)
    object_type: Mapped[str] = mapped_column(String(60), nullable=True)
    object_id: Mapped[str] = mapped_column(String(60), nullable=True)
    detail_json: Mapped[str] = mapped_column(Text, nullable=True)
    ip: Mapped[str] = mapped_column(String(64), nullable=True)


@event.listens_for(AuditLog, "before_update")
def _no_update(mapper, connection, target):
    raise RuntimeError("audit_log is append-only")


@event.listens_for(AuditLog, "before_delete")
def _no_delete(mapper, connection, target):
    raise RuntimeError("audit_log is append-only")


def audit(event, user_id=None, request_id=None, object_type=None, object_id=None, detail=None):
    """Add one audit row to the current session. The caller commits, in the same transaction as the change."""
    ip = request.remote_addr if has_request_context() else None
    row = AuditLog(
        event=event,
        user_id=user_id,
        request_id=request_id,
        object_type=object_type,
        object_id=None if object_id is None else str(object_id),
        detail_json=None if detail is None else json.dumps(detail, ensure_ascii=False, default=str),
        ip=ip,
    )
    db.session.add(row)
    return row
