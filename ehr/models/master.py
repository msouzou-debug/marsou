"""Master lists (contract 01). Rows are deactivated, never deleted."""
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..extensions import db
from .access import utcnow

CATEGORIES = ("medical", "nursing", "allied", "admin", "other")


class Directorate(db.Model):
    __tablename__ = "directorate"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name_el: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str] = mapped_column(String(200), nullable=False)
    has_sci_director: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def name(self, lang):
        return self.name_en if lang == "en" else self.name_el


class Facility(db.Model):
    __tablename__ = "facility"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    directorate_id: Mapped[int] = mapped_column(ForeignKey("directorate.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name_el: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    directorate = relationship("Directorate")

    def name(self, lang):
        return self.name_en if lang == "en" else self.name_el


class Position(db.Model):
    __tablename__ = "position"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    title_el: Mapped[str] = mapped_column(String(200), nullable=False)
    title_en: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def name(self, lang):
        return self.title_en if lang == "en" else self.title_el


class CostCentre(db.Model):
    __tablename__ = "cost_centre"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name_el: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def name(self, lang):
        return self.name_en if lang == "en" else self.name_el


class OaySpecialty(db.Model):
    __tablename__ = "oay_specialty"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    aliases_json: Mapped[str] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def name_for(self, lang):
        return self.name


class PublicHoliday(db.Model):
    __tablename__ = "public_holiday"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    name_el: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str] = mapped_column(String(200), nullable=False)


class Setting(db.Model):
    __tablename__ = "setting"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=True)
    updated_by: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True, default=utcnow)


def get_setting(key, default=None):
    row = db.session.get(Setting, key)
    return row.value if row is not None and row.value is not None else default
