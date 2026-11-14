"""Local time. Timestamps are stored in UTC. Every time shown to a person, and every calendar day the rules count,
is in the zone set by EHR_TIMEZONE (default Europe/Nicosia, summer time included).

Values read back from SQLite have no zone; they are UTC, so a naive datetime is taken as UTC here.
"""
import os
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from flask import current_app, has_app_context

DEFAULT_ZONE = "Europe/Nicosia"


def load_zone(name):
    """The ZoneInfo for `name`. Raises RuntimeError with a plain message when the machine has no such zone, so the
    app stops at start-up instead of showing UTC to people who expect Cyprus time."""
    try:
        return ZoneInfo(name)
    except Exception as exc:  # ZoneInfoNotFoundError, ValueError (bad key), OSError (unreadable database)
        raise RuntimeError(
            "Time zone %r cannot be loaded (%s). Install the system time zone database (the tzdata package) or set "
            "EHR_TIMEZONE to a zone the machine knows. Times are stored in UTC and shown in this zone." % (name, exc))


def zone_name():
    if has_app_context():
        return current_app.config.get("EHR_TIMEZONE") or DEFAULT_ZONE
    return os.environ.get("EHR_TIMEZONE") or DEFAULT_ZONE


def zone():
    return load_zone(zone_name())


def check(app):
    """Start-up check: fail now if the zone cannot be loaded."""
    load_zone(app.config.get("EHR_TIMEZONE") or DEFAULT_ZONE)


def to_local(value):
    """An aware datetime in the local zone. Naive input is UTC. None stays None."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(zone())


def local_date(value):
    """The calendar date in the local zone. A plain date is returned as it is (a date has no time to shift)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return to_local(value).date()
    return value


def now():
    return datetime.now(timezone.utc)


def today():
    """Today's date in the local zone."""
    return to_local(now()).date()


def day_start_utc(day):
    """The UTC moment the local calendar day `day` begins. For turning a typed date range into a query."""
    return datetime.combine(day, time.min, tzinfo=zone()).astimezone(timezone.utc)
