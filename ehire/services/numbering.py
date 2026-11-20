"""Request numbers: EHIRE-<directorate>-<position>-<YYYYMMDD>-<NN>, one counter per stem, gap-free per committed
transaction. The format rules live in ehire.workflow.numbering."""
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from .. import localtime
from ..models import Directorate, NumberCounter, Position, Setting
from ..workflow.numbering import format_request_number, number_stem

DEFAULT_PREFIX = "EHIRE"


def _ensure_row(session, stem):
    """Create the stem's row if missing, without disturbing the caller's transaction."""
    name = session.get_bind().dialect.name
    if name in ("sqlite", "postgresql"):
        if name == "sqlite":
            from sqlalchemy.dialects.sqlite import insert as dialect_insert
        else:
            from sqlalchemy.dialects.postgresql import insert as dialect_insert
        session.execute(dialect_insert(NumberCounter).values(stem=stem, last_value=0).on_conflict_do_nothing())
        return
    if session.get(NumberCounter, stem) is None:
        try:
            with session.begin_nested():
                session.execute(insert(NumberCounter).values(stem=stem, last_value=0))
        except IntegrityError:
            pass  # another transaction created it first


def next_value(session, stem):
    """Take the next integer for the stem. Call inside the transaction that stores the number."""
    _ensure_row(session, stem)
    # The UPDATE takes the write lock on SQLite and the row lock elsewhere, so two callers never get the same value.
    session.execute(update(NumberCounter).where(NumberCounter.stem == stem).values(last_value=NumberCounter.last_value + 1))
    return session.execute(
        select(NumberCounter.last_value).where(NumberCounter.stem == stem).with_for_update()
    ).scalar_one()


def stem_for(session, req, when):
    """The stem for a request submitted at `when` (an aware datetime): the day is the Cyprus day."""
    directorate = session.get(Directorate, req.directorate_id) if req.directorate_id else None
    position = session.get(Position, req.position_id) if req.position_id else None
    category = (position.category if position is not None else None) or req.category
    return number_stem(_prefix(session), directorate.code if directorate else "",
                       position.code if position is not None else None, category, localtime.local_date(when))


def next_number(session, req, when):
    """Return the next number for `req`, for example EHIRE-NGH-NUR-20261120-01."""
    stem = stem_for(session, req, when)
    return format_request_number(stem, next_value(session, stem))


def _prefix(session):
    """The `number_prefix` setting; when none is recorded, the prefix in the seed file; DEFAULT_PREFIX only if that
    file has none."""
    row = session.get(Setting, "number_prefix")
    if row is not None and row.value:
        return row.value
    from ..seed import load_data

    return (load_data().get("settings") or {}).get("number_prefix") or DEFAULT_PREFIX
