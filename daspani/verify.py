"""Έλεγχοι: αθροίσματα στηλών έναντι επιστολής και έλεγχοι συνέπειας ανά γραμμή."""

from __future__ import annotations

from dataclasses import dataclass

from .models import AMOUNT_FIELDS, AMOUNT_LABELS, LetterTotals, TableRow, cents

TOLERANCE_CENTS = 5          # ±0,05 € στα σύνολα στηλών
ROW_TOLERANCE_CENTS = 3      # ±0,03 € στους ελέγχους συνέπειας ανά γραμμή


@dataclass
class ColumnCheck:
    field: str
    label: str
    table_sum: float
    letter_total: float

    @property
    def diff(self) -> float:
        return round(self.table_sum - self.letter_total, 2)

    @property
    def ok(self) -> bool:
        return abs(cents(self.table_sum) - cents(self.letter_total)) <= TOLERANCE_CENTS


def column_checks(rows: list[TableRow], totals: LetterTotals) -> list[ColumnCheck]:
    """Άθροισμα ανά στήλη και σύγκριση με τα σύνολα-ελέγχου της επιστολής."""
    checks = []
    for field in AMOUNT_FIELDS:
        total_cents = sum(cents(getattr(r, field)) for r in rows)
        checks.append(ColumnCheck(
            field=field,
            label=AMOUNT_LABELS[field],
            table_sum=total_cents / 100,
            letter_total=getattr(totals, field),
        ))
    return checks


def all_ok(checks: list[ColumnCheck]) -> bool:
    return all(c.ok for c in checks)


def consistency_checks(rows: list[TableRow]) -> None:
    """Προαιρετική διασταύρωση για πλήρεις μήνες (όχι αναλογικές/διορθωτικές):

    - Αύξηση ≈ Βασικός × 1,5%
    - Τιμάριθμος ≈ (Βασικός + Αύξηση) × 12,67%

    Οι αποκλίνουσες γραμμές σημειώνονται για χειροκίνητο έλεγχο (δεν απορρίπτονται).
    """
    for row in rows:
        if row.is_analogia or cents(row.basic) <= 0:
            continue
        expected_auxisi = cents(round(row.basic * 0.015, 2))
        if abs(cents(row.auxisi) - expected_auxisi) > ROW_TOLERANCE_CENTS:
            row.flag(
                f"Αύξηση {row.auxisi:.2f} ≠ Βασικός×1,5% ({expected_auxisi / 100:.2f})"
            )
        expected_tim = cents(round((row.basic + row.auxisi) * 0.1267, 2))
        if abs(cents(row.tim) - expected_tim) > ROW_TOLERANCE_CENTS:
            row.flag(
                f"Τιμάριθμος {row.tim:.2f} ≠ (Βασικός+Αύξηση)×12,67% ({expected_tim / 100:.2f})"
            )


def basic_row_checks(rows: list[TableRow]) -> None:
    """Στοιχειώδεις έλεγχοι εγκυρότητας γραμμών."""
    for row in rows:
        if not row.aka_norm:
            row.flag("Λείπει ή δεν διαβάστηκε το Α.Κ.Α.")
