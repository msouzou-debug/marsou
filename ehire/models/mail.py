"""Email outbox (contract 01). One row per email, stored in the same transaction as the action that caused it."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db
from .access import utcnow

MAIL_STATES = ("queued", "sent", "failed")
MAX_ATTEMPTS = 5


class MailOutbox(db.Model):
    __tablename__ = "mail_outbox"
    __table_args__ = (Index("ix_mail_outbox_state", "state"), Index("ix_mail_outbox_created", "created_at"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    request_id: Mapped[int] = mapped_column(Integer, nullable=True)
    to_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    to_email: Mapped[str] = mapped_column(String(200), nullable=True)
    language: Mapped[str] = mapped_column(String(2), nullable=False, default="el")
    subject: Mapped[str] = mapped_column(String(400), nullable=False)
    html: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(10), nullable=False, default="queued")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
