"""Amounts and months typed the Greek way: 1.234,56 and mm/yyyy (contract 03, section 4).

Dots group thousands, the comma starts the decimals. Parsing is strict so a typo is never read as a different number.
"""
import re
from datetime import date
from decimal import Decimal, InvalidOperation

_AMOUNT = re.compile(r"^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$")
_MONTH = re.compile(r"^(\d{1,2})[/.\-](\d{4})$")


def parse_amount(text):
    """Decimal for '1.234,56', '1234,5', '1.234' or '12'. Raise ValueError for anything else (negative, '12.5', '1,2,3')."""
    value = (text or "").strip()
    if not _AMOUNT.match(value):
        raise ValueError("not an amount")
    try:
        return Decimal(value.replace(".", "").replace(",", "."))
    except InvalidOperation:  # pragma: no cover  the pattern already rules this out
        raise ValueError("not an amount")


def parse_whole(text):
    """Like parse_amount, but the value must be a whole number (visits, procedures)."""
    value = parse_amount(text)
    if value != value.to_integral_value():
        raise ValueError("not a whole number")
    return int(value)


def format_amount(value, places=2):
    """1234.5 -> '1.234,50'. None -> ''."""
    if value is None or value == "":
        return ""
    quantum = Decimal(1).scaleb(-places)
    text = "{:,.{p}f}".format(Decimal(value).quantize(quantum), p=places)
    return text.replace(",", "\0").replace(".", ",").replace("\0", ".")


def format_whole(value):
    return "" if value is None or value == "" else format_amount(Decimal(value), 0)


def parse_month(text):
    """First day of the month for 'mm/yyyy' (also m/yyyy; / . or - between). Raise ValueError otherwise."""
    match = _MONTH.match((text or "").strip())
    if not match:
        raise ValueError("not a month")
    month, year = int(match.group(1)), int(match.group(2))
    if year < 1900:
        raise ValueError("year out of range")
    return date(year, month, 1)  # ValueError for month 13


def format_month(value):
    """date or 'YYYY-MM-DD' -> 'mm/yyyy'. None or '' -> ''."""
    if not value:
        return ""
    if isinstance(value, str):
        value = date.fromisoformat(value[:10])
    return "{:02d}/{:04d}".format(value.month, value.year)


def ratio(revenue, payroll_cost):
    """Revenue per 1 of payroll, for display only. None when payroll is zero or missing."""
    try:
        revenue, payroll_cost = Decimal(revenue), Decimal(payroll_cost)
    except (InvalidOperation, TypeError, ValueError):
        return None
    if payroll_cost == 0:
        return None
    return revenue / payroll_cost
