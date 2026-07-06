"""Amount parsing and Greek-locale formatting.

ΟΑΥ files mix formats: '1.234.567,89', '1,234,567.89', '1234567.89', pandas
floats, and cells with stray '€'/spaces.  parse_amount handles all of them;
format_eur renders the on-screen Greek format 1.234.567,89 €.
"""
from __future__ import annotations

import re
from typing import Any

_CLEAN_RE = re.compile(r"[€\s ]")


def parse_amount(value: Any) -> float:
    """Coerce any source-cell representation of an amount to float. NaN/None/'' -> 0.0."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        # NaN check without importing pandas
        return float(value) if value == value else 0.0
    s = _CLEAN_RE.sub("", str(value)).strip()
    if not s or s.lower() in ("nan", "none", "-"):
        return 0.0
    negative = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if s.startswith("-"):
        negative = True
        s = s[1:]
    if s.endswith("-"):        # credit notes print trailing minus: '12.25-'
        negative = True
        s = s[:-1]
    has_dot, has_comma = "." in s, "," in s
    if has_dot and has_comma:
        # the LAST separator is the decimal one
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif has_comma:
        # comma is decimal if it leaves <=2 digits at the end, else thousands
        head, _, tail = s.rpartition(",")
        if len(tail) <= 2 and "," not in head:
            s = head.replace(",", "") + "." + tail
        else:
            s = s.replace(",", "")
    elif has_dot:
        head, _, tail = s.rpartition(".")
        # '1.234' with exactly 3 digits after a single dot is ambiguous; ΟΑΥ
        # thousands-groups are always 3 digits and decimals are 1-2, so treat
        # 3-digit tails (with grouping-sized head) as thousands separators.
        if len(tail) == 3 and head and "." not in head and len(head) <= 3:
            s = head + tail
        elif len(tail) == 3 and "." in head:
            s = s.replace(".", "")
        elif len(tail) > 2:
            s = s.replace(".", "")
        # else: normal decimal point, leave as-is
    try:
        v = float(s)
    except ValueError:
        return 0.0
    return -v if negative else v


def format_eur(value: float) -> str:
    """1234567.89 -> '1.234.567,89 €' (Greek on-screen format)."""
    neg = value < 0
    s = f"{abs(value):,.2f}"                    # 1,234,567.89
    s = s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return ("-" if neg else "") + s + " €"


AMOUNT_RE = re.compile(
    r"""(?<![\d.,])            # not preceded by digits/separators
        (?: -?\d{1,3}(?:\.\d{3})*,\d{2}   # 1.234.567,89 (Greek)
          | -?\d{1,3}(?:,\d{3})*\.\d{2}   # 1,234,567.89 (Anglo)
          | -?\d+[.,]\d{2}                # 1234,89 / 1234.89
        )-?                    # trailing-minus credits: '12.25-'
        (?!\d)                 # amounts end after 2 decimals — don't split 8.076
    """,
    re.VERBOSE,
)


def find_amounts(text: str) -> list[float]:
    """All monetary amounts in a text line, parsed."""
    return [parse_amount(m.group(0)) for m in AMOUNT_RE.finditer(text)]
