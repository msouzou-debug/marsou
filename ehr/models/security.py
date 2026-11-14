"""Sign-in protection (Phase 6). One row per failed sign-in; a successful sign-in deletes that username's rows."""
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db
from .access import utcnow


class LoginAttempt(db.Model):
    __tablename__ = "login_attempt"
    __table_args__ = (Index("ix_login_attempt_username_at", "username", "at"), Index("ix_login_attempt_ip_at", "ip", "at"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False)  # lower case, cut to 80 characters
    ip: Mapped[str] = mapped_column(String(64), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
