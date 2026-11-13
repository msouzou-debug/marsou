"""People and access (contract 01)."""
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..extensions import db

ROLES = (
    "requester", "dir_accountant", "sci_director", "dir_hr_officer", "dir_exec",
    "fin_mgmt_head", "central_hr_officer", "medical_director", "nursing_director", "ceo",
    "viewer", "admin",
)
DIRECTORATE_ROLES = ("requester", "dir_accountant", "sci_director", "dir_hr_officer", "dir_exec")
CENTRAL_ROLES = ("fin_mgmt_head", "central_hr_officer", "medical_director", "nursing_director", "ceo")
SEE_ALL_ROLES = CENTRAL_ROLES + ("viewer", "admin")
PERMISSIONS = (
    "request.create", "request.view_own", "request.view_directorate", "request.view_all",
    "request.act", "audit.view", "settings.manage",
)


def utcnow():
    return datetime.now(timezone.utc)


class User(db.Model):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(200), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(300), nullable=True)
    auth_source: Mapped[str] = mapped_column(String(10), nullable=False, default="local")
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    language: Mapped[str] = mapped_column(String(2), nullable=False, default="el")
    line_manager_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    out_of_office: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    out_of_office_from: Mapped[date] = mapped_column(Date, nullable=True)
    out_of_office_to: Mapped[date] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    line_manager = relationship("User", remote_side=[id], foreign_keys=[line_manager_user_id])
    directorates = relationship("Directorate", secondary="user_directorate", viewonly=True)

    def active_assignments(self, on=None):
        """Role assignments held directly (not as substitute) that are active on a date."""
        return [a for a in RoleAssignment.query.filter_by(user_id=self.id).all() if a.is_active_on(on)]

    def substitute_assignments(self, on=None):
        return [a for a in RoleAssignment.query.filter_by(substitute_user_id=self.id).all() if a.is_active_on(on)]

    def roles(self, on=None):
        """Roles held as holder or substitute."""
        return {a.role for a in self.active_assignments(on)} | {a.role for a in self.substitute_assignments(on)}

    def permissions(self):
        roles = self.roles()
        if not roles:
            return set()
        rows = RolePermission.query.filter(RolePermission.role.in_(roles)).all()
        return {r.permission_key for r in rows}

    def has_permission(self, key):
        return key in self.permissions()


class RolePermission(db.Model):
    __tablename__ = "role_permission"

    role: Mapped[str] = mapped_column(String(40), primary_key=True)
    permission_key: Mapped[str] = mapped_column(String(60), primary_key=True)


class RoleAssignment(db.Model):
    """Holder of a role, with a substitute. directorate_id is null for central roles, viewer and admin.

    Only one active holder per (role, directorate) is expected for every role except `requester`,
    which many people hold in the same Directorate. The rule is enforced by `holder_conflict`, not
    by a database constraint, because a null directorate defeats a unique index on some engines.
    """

    __tablename__ = "role_assignment"
    __table_args__ = (UniqueConstraint("user_id", "role", "directorate_id", name="uq_role_assignment_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    directorate_id: Mapped[int] = mapped_column(ForeignKey("directorate.id"), nullable=True)
    substitute_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    active_from: Mapped[date] = mapped_column(Date, nullable=True)
    active_to: Mapped[date] = mapped_column(Date, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    substitute = relationship("User", foreign_keys=[substitute_user_id])
    directorate = relationship("Directorate")

    def is_active_on(self, on=None):
        on = on or date.today()
        return (self.active_from is None or self.active_from <= on) and (self.active_to is None or self.active_to >= on)


class UserDirectorate(db.Model):
    __tablename__ = "user_directorate"

    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), primary_key=True)
    directorate_id: Mapped[int] = mapped_column(ForeignKey("directorate.id"), primary_key=True)
