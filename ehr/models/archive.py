"""eArchive deposits (contract 06). One row per request and kind, written in the same transaction as the action."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db
from .access import utcnow

ARCHIVE_KINDS = ("submitted", "approved")
ARCHIVE_STATES = ("queued", "stored", "failed")
ARCHIVE_OUTCOMES = ("rejected", "withdrawn")
ARCHIVE_MAX_ATTEMPTS = 10


class ArchiveDeposit(db.Model):
    __tablename__ = "archive_deposit"
    __table_args__ = (UniqueConstraint("request_id", "kind", name="uq_archive_request_kind"),
                      Index("ix_archive_deposit_state", "state"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("request.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    state: Mapped[str] = mapped_column(String(10), nullable=False, default="queued")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str] = mapped_column(Text, nullable=True)
    pdf_storage_ref: Mapped[str] = mapped_column(String(300), nullable=True)
    pdf_sha256: Mapped[str] = mapped_column(String(64), nullable=True)
    manifest_json: Mapped[str] = mapped_column(Text, nullable=True)
    archive_ref: Mapped[str] = mapped_column(String(300), nullable=True)
    request_outcome: Mapped[str] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
