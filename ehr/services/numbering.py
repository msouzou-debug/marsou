"""Request numbers: one sequence per year, gap-free per committed transaction."""
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from ..models import NumberSequence, Setting

DEFAULT_PREFIX = "EHR"


def _format(prefix, year, value):
    try:
        from ehr.workflow.numbering import format_number
    except ImportError:
        return "%s-%s-%05d" % (prefix, year, value)
    return format_number(prefix, year, value)


def _ensure_row(session, year):
    """Create the year's row if missing, without disturbing the caller's transaction."""
    name = session.get_bind().dialect.name
    if name in ("sqlite", "postgresql"):
        if name == "sqlite":
            from sqlalchemy.dialects.sqlite import insert as dialect_insert
        else:
            from sqlalchemy.dialects.postgresql import insert as dialect_insert
        session.execute(dialect_insert(NumberSequence).values(year=year, last_value=0).on_conflict_do_nothing())
        return
    if session.get(NumberSequence, year) is None:
        try:
            with session.begin_nested():
                session.execute(insert(NumberSequence).values(year=year, last_value=0))
        except IntegrityError:
            pass  # another transaction created it first


def next_value(session, year):
    """Take the next integer for the year. Call inside the transaction that stores the number."""
    _ensure_row(session, year)
    # The UPDATE takes the write lock on SQLite and the row lock elsewhere, so two callers never get the same value.
    session.execute(update(NumberSequence).where(NumberSequence.year == year).values(last_value=NumberSequence.last_value + 1))
    row = session.execute(
        select(NumberSequence.last_value).where(NumberSequence.year == year).with_for_update()
    ).scalar_one()
    return row


def next_number(session, year):
    """Return the next formatted number, for example PREFIX-2026-00001 (format owned by ehr.workflow.numbering)."""
    value = next_value(session, year)
    prefix = _prefix(session)
    return _format(prefix, year, value)


def _prefix(session):
    row = session.get(Setting, "number_prefix")
    return row.value if row is not None and row.value else DEFAULT_PREFIX
