"""eArchive deposits (contract 06). One row per request and kind, written in the same transaction as the action."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db
from .access import utcnow

ARCHIVE_KINDS = ("submitted", "decided")  # decided: approved, rejected or withdrawn (eArchive note, section 5)
# queued: waiting to be sent (also while a temporary failure waits for next_attempt_at); failed: a problem on eHire's side,
# tried again up to ARCHIVE_MAX_ATTEMPTS times; blocked: needs an administrator (eArchive refused it, or no site code).
ARCHIVE_STATES = ("queued", "stored", "failed", "blocked")
ARCHIVE_OUTCOMES = ("rejected", "withdrawn")  # kept for old rows; nothing relies on request_outcome any more
ARCHIVE_MAX_ATTEMPTS = 10  # for `failed` rows only; a temporary failure of eArchive is retried without end


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
    request_outcome: Mapped[str] = mapped_column(String(10), nullable=True)  # old rows only
    meta_json: Mapped[str] = mapped_column(Text, nullable=True)  # the meta part as first built, resent unchanged
    protocol_id: Mapped[str] = mapped_column(String(60), nullable=True)
    protocol_number: Mapped[str] = mapped_column(String(60), nullable=True)
    url: Mapped[str] = mapped_column(String(500), nullable=True)
    error_code: Mapped[str] = mapped_column(String(60), nullable=True)  # why a row is blocked
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    legal_hold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    disposed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
