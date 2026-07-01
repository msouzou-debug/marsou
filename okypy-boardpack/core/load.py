# -*- coding: utf-8 -*-
"""
core/load.py — workbook → tidy per-category frames for 2026 and 2025.

Reads ``DATA 2026`` and ``DATA 2025`` with ``data_only=True`` and returns a
merged list of category records, one per (section, category), carrying every
year's month / YTD / budget figure. EBITDA-basis exclusions (spec §5.1) are
applied here so nothing downstream has to remember them.

No cloud calls; pure openpyxl.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import openpyxl

import config


@dataclass
class Category:
    """One P&L line, merged across years."""
    name: str
    section: str            # config.FLAG_REVENUE or config.FLAG_EXPENSE
    m2026: float = 0.0      # month figure
    ytd2026: float = 0.0    # YTD Ιαν–MM
    budget_period: float = 0.0  # cumulative budget to date (col N)
    m2025: float = 0.0
    ytd2025: float = 0.0


@dataclass
class LoadResult:
    categories: list[Category] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def revenue(self) -> list[Category]:
        return [c for c in self.categories if c.section == config.FLAG_REVENUE]

    def expense(self) -> list[Category]:
        return [c for c in self.categories if c.section == config.FLAG_EXPENSE]


# ── filename month detection ─────────────────────────────────────────────────
_MM_RE = re.compile(r"(\d{1,2})")


def detect_month_from_filename(filename: str) -> int | None:
    """Parse MM from a name like ``01-05_ΓΙΑ_CLAUDE.xlsx`` → 5.

    Takes the *last* 1–2 digit group that is a valid month (01–12); the leading
    ``01-`` is a fixed prefix in the OKYπY naming convention.
    """
    stem = filename.rsplit("/", 1)[-1]
    candidates = [int(x) for x in _MM_RE.findall(stem)]
    months = [c for c in candidates if 1 <= c <= 12]
    # Prefer the second number (after the "01-" prefix) when present.
    if len(months) >= 2:
        return months[1]
    if months:
        return months[0]
    return None


def _num(cell) -> float:
    """Coerce a cell value to float; blanks/text → 0.0."""
    v = cell.value if hasattr(cell, "value") else cell
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    # Occasionally numbers arrive as strings with a comma decimal.
    s = str(v).strip().replace(" ", "").replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _cell_text(row, idx: int) -> str:
    if idx >= len(row):
        return ""
    v = row[idx].value
    return "" if v is None else str(v).strip()


def _iter_rows(ws):
    """Yield data rows (skip the header row 1)."""
    for r in ws.iter_rows(min_row=2):
        yield r


def load_workbook(path: str, mm: int) -> LoadResult:
    """Load a monthly workbook into a merged :class:`LoadResult`.

    ``mm`` is the month number (1–12) — used only for validation/warnings here;
    the divisor logic lives in core/metrics.py.
    """
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    warnings: list[str] = []

    if config.SHEET_2026 not in wb.sheetnames:
        raise ValueError(f"Λείπει το φύλλο «{config.SHEET_2026}».")
    if config.SHEET_2025 not in wb.sheetnames:
        raise ValueError(f"Λείπει το φύλλο «{config.SHEET_2025}».")

    rec: dict[tuple[str, str], Category] = {}

    # ── DATA 2026 ────────────────────────────────────────────────────────────
    ws26 = wb[config.SHEET_2026]
    for row in _iter_rows(ws26):
        section = _cell_text(row, config.COL_SECTION)
        if section not in (config.FLAG_REVENUE, config.FLAG_EXPENSE):
            continue
        name = _cell_text(row, config.COL_CATEGORY)
        if _is_excluded(section, name, row, year=2026):
            continue
        key = (section, name)
        c = rec.get(key) or Category(name=name, section=section)
        c.m2026 += _num(row[config.COL_2026_MONTH])
        c.ytd2026 += _num(row[config.COL_2026_YTD])
        c.budget_period += _num(row[config.COL_2026_BUDGET])
        rec[key] = c

    # ── DATA 2025 ────────────────────────────────────────────────────────────
    # January is column H; month MM = COL_2025_JAN + MM - 1; YTD = sum Jan..MM.
    ws25 = wb[config.SHEET_2025]
    lo = config.COL_2025_JAN
    hi = config.COL_2025_JAN + mm - 1
    month_col = hi
    for row in _iter_rows(ws25):
        section = _cell_text(row, config.COL_SECTION)
        if section not in (config.FLAG_REVENUE, config.FLAG_EXPENSE):
            continue
        name = _cell_text(row, config.COL_CATEGORY)
        if _is_excluded(section, name, row, year=2025):
            continue
        key = (section, name)
        c = rec.get(key) or Category(name=name, section=section)
        c.m2025 += _num(row[month_col]) if month_col < len(row) else 0.0
        c.ytd2025 += sum(_num(row[i]) for i in range(lo, hi + 1) if i < len(row))
        rec[key] = c

    wb.close()

    cats = list(rec.values())
    if not cats:
        warnings.append("Δεν βρέθηκαν κατηγορίες — ελέγξτε τους δείκτες στηλών στο config.py.")
    return LoadResult(categories=cats, warnings=warnings)


def _is_excluded(section: str, name: str, row, year: int) -> bool:
    """Apply the EBITDA-basis exclusions of spec §5.1."""
    if section == config.FLAG_REVENUE:
        if name in config.EXCLUDE_REVENUE:
            return True
        if year == 2025:
            if name in config.EXCLUDE_REVENUE_2025_ONLY:
                return True
            # Blank-category fallback: match on article code (col B).
            if not name:
                art = _cell_text(row, config.ARTICLE_COL)
                if art in config.EXCLUDE_REVENUE_2025_ARTICLES:
                    return True
    elif section == config.FLAG_EXPENSE:
        if name in config.EXCLUDE_EXPENSE:
            return True
    return False
