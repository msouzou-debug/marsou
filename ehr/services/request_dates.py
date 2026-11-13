"""Dates typed and shown as dd/mm/yyyy (contract 03, section 3)."""
import re
from datetime import date

_PATTERN = re.compile(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$")


def parse_date(text):
    """Return a date for 'dd/mm/yyyy' (also d/m/yyyy, with / . or - between parts). Raise ValueError otherwise."""
    match = _PATTERN.match((text or "").strip())
    if not match:
        raise ValueError("not a dd/mm/yyyy date")
    day, month, year = (int(g) for g in match.groups())
    if year < 1900:
        raise ValueError("year out of range")
    return date(year, month, day)  # ValueError for 31/02/2026 and similar


def format_date(value):
    """dd/mm/yyyy, or an empty string for None."""
    if value is None:
        return ""
    return "{:02d}/{:02d}/{:04d}".format(value.day, value.month, value.year)


def format_datetime(value):
    """dd/mm/yyyy hh:mm, or an empty string for None."""
    if value is None:
        return ""
    return "{} {:02d}:{:02d}".format(format_date(value), value.hour, value.minute)
