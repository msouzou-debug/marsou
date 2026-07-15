"""Έλεγχοι: αθροίσματα στηλών έναντι επιστολής και έλεγχοι συνέπειας ανά γραμμή."""

from __future__ import annotations

from dataclasses import dataclass

from .models import AMOUNT_FIELDS, AMOUNT_LABELS, LetterTotals, TableRow, cents

TOLERANCE_CENTS = 5          # ±0,05 € στα σύνολα στηλών
ROW_TOLERANCE_CENTS = 3      # ±0,03 € στους ελέγχους συνέπειας ανά γραμμή
AUXISI_RATE = 0.015          # Αύξηση μισθού 1,5%
DEFAULT_TIM_RATE = 0.1267    # Τιμαριθμικό 12,67% (2026)


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


def derived_checks(rows: list[TableRow], totals: LetterTotals) -> list[ColumnCheck]:
    """Παράγωγα σύνολα όπως τα υπολογίζει το φύλλο (R–V) έναντι της επιστολής:

    Εισφορά = Σύνολο×24,25% · Διοικητικά = (Σύνολο+Εισφορά)×10% · Γενικό = άθροισμα.
    """
    total = sum(cents(getattr(r, f)) for r in rows for f in AMOUNT_FIELDS) / 100
    eisfora = round(total * 0.2425, 2)
    dioikitika = round((total + eisfora) * 0.10, 2)
    geniko = round(total + eisfora + dioikitika, 2)
    return [
        ColumnCheck("eisfora", "Εισφορά Εργοδότη 24,25% (υπολογ.)", eisfora, totals.eisfora),
        ColumnCheck("dioikitika", "Διοικητικά Έξοδα 10% (υπολογ.)", dioikitika, totals.dioikitika),
        ColumnCheck("geniko", "Γενικό Σύνολο (υπολογ.)", geniko, totals.geniko),
    ]


def all_ok(checks: list[ColumnCheck]) -> bool:
    return all(c.ok for c in checks)


KNOWN_TIM_RATES = (0.1267, 0.1256)  # γνωστά ποσοστά τιμαρίθμου ανά έτος


def infer_tim_rate(totals: LetterTotals) -> float:
    """Συντελεστής τιμαρίθμου από τα σύνολα της επιστολής (π.χ. 12,67% ή 12,56%).

    Ο λόγος των συνόλων αποκλίνει ελαφρά λόγω αναλογικών γραμμών, γι' αυτό
    «κουμπώνει» στο πλησιέστερο γνωστό ποσοστό αν είναι αρκετά κοντά.
    """
    base = totals.basic + totals.auxisi
    if base > 0 and totals.tim > 0:
        rate = totals.tim / base
        if 0.10 < rate < 0.15:
            nearest = min(KNOWN_TIM_RATES, key=lambda k: abs(k - rate))
            return nearest if abs(nearest - rate) < 0.001 else round(rate, 4)
    return DEFAULT_TIM_RATE


def consistency_checks(rows: list[TableRow], tim_rate: float = DEFAULT_TIM_RATE) -> None:
    """Προαιρετική διασταύρωση για πλήρεις μήνες (όχι αναλογικές/διορθωτικές):

    - Αύξηση ≈ Βασικός × 1,5%
    - Τιμάριθμος ≈ (Βασικός + Αύξηση) × tim_rate (π.χ. 12,67%)

    Οι αποκλίνουσες γραμμές σημειώνονται για χειροκίνητο έλεγχο (δεν απορρίπτονται).
    """
    for row in rows:
        if row.is_analogia or cents(row.basic) <= 0:
            continue
        expected_auxisi = cents(round(row.basic * AUXISI_RATE, 2))
        if abs(cents(row.auxisi) - expected_auxisi) > ROW_TOLERANCE_CENTS:
            row.flag(
                f"Αύξηση {row.auxisi:.2f} ≠ Βασικός×1,5% ({expected_auxisi / 100:.2f})"
            )
        expected_tim = cents(round((row.basic + row.auxisi) * tim_rate, 2))
        if abs(cents(row.tim) - expected_tim) > ROW_TOLERANCE_CENTS:
            row.flag(
                f"Τιμάριθμος {row.tim:.2f} ≠ (Βασικός+Αύξηση)×{tim_rate * 100:.2f}% "
                f"({expected_tim / 100:.2f})"
            )


def basic_row_checks(rows: list[TableRow]) -> None:
    """Στοιχειώδεις έλεγχοι εγκυρότητας γραμμών."""
    for row in rows:
        if not row.aka_norm:
            row.flag("Λείπει ή δεν διαβάστηκε το Α.Κ.Α.")
