"""Εγγραφή των δεδομένων στο υπάρχον workbook (openpyxl), χωρίς αλλοίωση φορμουλών."""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.formula.translate import Translator
from openpyxl.utils import get_column_letter

from .models import AMOUNT_FIELDS, LetterTotals, TableRow, cents, normalize_label

# Διάταξη φύλλου μήνα (βλ. προδιαγραφή):
#   στήλες A–F: προσυμπληρωμένες ταυτότητες, B = Α.Κ.Α.
#   στήλες G–K: κελιά εισαγωγής (Βασικός, Τιμάριθμος, Αύξηση, Βάρδια, Κυρ/Αργία)
#   στήλες L–P: φόρμουλες — ΔΕΝ τις αγγίζουμε (μόνο αντιγραφή σε νέες γραμμές)
FIRST_DATA_ROW = 3
AKA_COL = 2                     # στήλη B
NAME_COL = 4                    # στήλη D (Ονοματεπώνυμο)
INPUT_COLS = {"basic": 7, "tim": 8, "auxisi": 9, "bardia": 10, "kyriaki": 11}  # G–K
FORMULA_COLS = range(12, 17)    # L–P
TOTAL_LABEL = "ΣΥΝΟΛΟ"

# Μπλοκ «ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ»: οι τιμές της επιστολής γράφονται στη στήλη D του
# μπλοκ, δηλ. 3 στήλες δεξιά από τη στήλη της ετικέτας κάθε γραμμής.
CONTROL_BLOCK_TITLE = "ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ"
CONTROL_VALUE_OFFSET = 3

# Ετικέτες του μπλοκ ελέγχου / του φύλλου ΣΤΟΙΧΕΙΑ_ΕΠΙΣΤΟΛΩΝ -> πεδία LetterTotals.
# Η σειρά έχει σημασία: οι πιο συγκεκριμένες ετικέτες πρώτες.
CONTROL_LABELS = [
    ("ΒΑΣΙΚ", "basic"),
    ("ΤΙΜΑΡΙΘΜ", "tim"),
    ("ΑΥΞΗΣ", "auxisi"),
    ("ΒΑΡΔΙΑ", "bardia"),
    ("ΚΥΡΙΑΚ", "kyriaki"),
    ("ΕΙΣΦΟΡ", "eisfora"),
    ("ΔΙΟΙΚΗΤ", "dioikitika"),
    ("ΓΕΝΙΚΟ", "geniko"),
]

STOIXEIA_SHEET = "ΣΤΟΙΧΕΙΑ_ΕΠΙΣΤΟΛΩΝ"


class ExcelWriteError(RuntimeError):
    pass


@dataclass
class WriteResult:
    matched: int = 0
    inserted: int = 0
    skipped_duplicates: int = 0
    unmatched_akas: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    output_path: str = ""


def _norm_aka(value) -> str:
    return re.sub(r"\D", "", str(value or "")).lstrip("0")


def find_total_row(ws) -> int:
    """Εντοπίζει τη γραμμή ΣΥΝΟΛΟ σαρώνοντας τις στήλες A–D."""
    for row in range(FIRST_DATA_ROW, ws.max_row + 1):
        for col in range(1, 5):
            value = ws.cell(row=row, column=col).value
            if value and normalize_label(value).startswith(TOTAL_LABEL):
                return row
    raise ExcelWriteError(
        f"Δεν βρέθηκε γραμμή «{TOTAL_LABEL}» στο φύλλο «{ws.title}» — ελέγξτε τη δομή του."
    )


def _row_values(ws, row: int) -> dict[str, float]:
    values = {}
    for fld, col in INPUT_COLS.items():
        v = ws.cell(row=row, column=col).value
        values[fld] = float(v) if isinstance(v, (int, float)) else 0.0
    return values


def _same_amounts(ws, row: int, table_row: TableRow) -> bool:
    existing = _row_values(ws, row)
    return all(cents(existing[f]) == cents(getattr(table_row, f)) for f in AMOUNT_FIELDS)


def _extend_range_ends(formula: str, old_end: int, new_end: int) -> str:
    """Επεκτείνει εύρη τύπου G3:G63 όταν το τέλος τους ήταν η παλιά τελευταία γραμμή."""
    pattern = re.compile(r"(\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?)(\d+)")

    def repl(m: re.Match) -> str:
        return m.group(1) + (str(new_end) if int(m.group(2)) == old_end else m.group(2))

    return pattern.sub(repl, formula)


def _insert_data_row(ws, total_row: int) -> int:
    """Εισάγει νέα γραμμή πριν το ΣΥΝΟΛΟ, αντιγράφοντας μορφοποίηση και φόρμουλες L–P.

    Επιστρέφει τον αριθμό της νέας γραμμής. Επεκτείνει και τα εύρη SUM της γραμμής ΣΥΝΟΛΟ.
    """
    template_row = total_row - 1  # τελευταία υπάρχουσα γραμμή δεδομένων
    ws.insert_rows(total_row)
    new_row = total_row
    new_total_row = total_row + 1

    for col in range(1, ws.max_column + 1):
        src = ws.cell(row=template_row, column=col)
        dst = ws.cell(row=new_row, column=col)
        dst._style = copy.copy(src._style)
        if col in FORMULA_COLS and isinstance(src.value, str) and src.value.startswith("="):
            dst.value = Translator(src.value, origin=src.coordinate).translate_formula(
                dst.coordinate
            )
    if template_row in ws.row_dimensions:
        ws.row_dimensions[new_row].height = ws.row_dimensions[template_row].height

    # Επέκταση των ευρών της γραμμής ΣΥΝΟΛΟ ώστε να καλύπτουν τη νέα γραμμή.
    for col in range(1, ws.max_column + 1):
        cell = ws.cell(row=new_total_row, column=col)
        if isinstance(cell.value, str) and cell.value.startswith("="):
            cell.value = _extend_range_ends(cell.value, template_row, new_row)
    return new_row


def _write_amounts(ws, row: int, table_row: TableRow) -> None:
    for fld, col in INPUT_COLS.items():
        ws.cell(row=row, column=col).value = round(getattr(table_row, fld), 2)


def write_month_sheet(ws, rows: list[TableRow]) -> WriteResult:
    """Γράφει τα ποσά G–K στο φύλλο μήνα, ταιριάζοντας μέσω Α.Κ.Α. (στήλη B)."""
    result = WriteResult()
    total_row = find_total_row(ws)

    # Ευρετήριο Α.Κ.Α. -> λίστα γραμμών φύλλου (με τη σειρά).
    index: dict[str, list[int]] = {}
    for r in range(FIRST_DATA_ROW, total_row):
        aka = _norm_aka(ws.cell(row=r, column=AKA_COL).value)
        if aka:
            index.setdefault(aka, []).append(r)
    consumed: dict[str, list[int]] = {}

    for table_row in rows:
        aka = table_row.aka_norm
        if not aka:
            result.unmatched_akas.append(f"(χωρίς ΑΚΑ) {table_row.name}".strip())
            table_row.flag("Δεν γράφτηκε στο φύλλο — λείπει το Α.Κ.Α.")
            continue

        available = index.get(aka, [])
        used = consumed.setdefault(aka, [])
        target = next((r for r in available if r not in used), None)

        if target is not None:
            used.append(target)
            _write_amounts(ws, target, table_row)
            result.matched += 1
            continue

        # Δεν υπάρχει διαθέσιμη γραμμή: είτε νέα πρόσληψη, είτε δεύτερη γραμμή
        # ίδιου ΑΚΑ (αναλογία). Πριν την εισαγωγή, έλεγχος διπλοεγγραφής
        # (idempotency — π.χ. δεύτερο τρέξιμο πάνω στο ίδιο αρχείο εξόδου).
        if any(_same_amounts(ws, r, table_row) for r in used):
            result.skipped_duplicates += 1
            continue

        total_row = find_total_row(ws)
        new_row = _insert_data_row(ws, total_row)
        ws.cell(row=new_row, column=AKA_COL).value = table_row.aka
        label = table_row.name
        extra = table_row.remarks or ("ΑΝΑΛΟΓΙΑ" if aka in index else "ΝΕΑ ΠΡΟΣΛΗΨΗ")
        if extra and extra not in label:
            label = f"{label} ({extra})" if label else extra
        ws.cell(row=new_row, column=NAME_COL).value = label
        _write_amounts(ws, new_row, table_row)
        used.append(new_row)
        result.inserted += 1
        if aka not in index:
            result.unmatched_akas.append(f"{table_row.aka} {table_row.name}".strip())
        result.warnings.append(
            f"Προστέθηκε νέα γραμμή {new_row} για ΑΚΑ {table_row.aka} ({label}). "
            "Ελέγξτε ότι τα εύρη των SUMIFS στο ΣΥΝΟΠΤΙΚΟ καλύπτουν τη νέα γραμμή."
        )

    return result


def update_control_block(ws, totals: LetterTotals) -> list[str]:
    """Ενημερώνει το μπλοκ «ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ» (τιμές επιστολής στη στήλη D του μπλοκ)."""
    warnings = []
    anchor = None
    for row in ws.iter_rows():
        for cell in row:
            if cell.value and CONTROL_BLOCK_TITLE in normalize_label(cell.value):
                anchor = cell
                break
        if anchor:
            break
    if anchor is None:
        warnings.append(
            f"Δεν βρέθηκε μπλοκ «{CONTROL_BLOCK_TITLE}» στο φύλλο «{ws.title}» — "
            "καταχωρίστε τα σύνολα της επιστολής χειροκίνητα."
        )
        return warnings

    written = set()
    for r in range(anchor.row + 1, min(anchor.row + 20, ws.max_row) + 1):
        label_cell = ws.cell(row=r, column=anchor.column)
        if not label_cell.value:
            continue
        label = normalize_label(label_cell.value)
        for key, fld in CONTROL_LABELS:
            if key in label and fld not in written:
                ws.cell(row=r, column=anchor.column + CONTROL_VALUE_OFFSET).value = round(
                    getattr(totals, fld), 2
                )
                written.add(fld)
                break
    missing = [key for key, fld in CONTROL_LABELS if fld not in written]
    if missing:
        warnings.append(
            "Στο μπλοκ ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ δεν βρέθηκαν ετικέτες για: "
            + ", ".join(missing)
            + " — συμπληρώστε τα χειροκίνητα."
        )
    return warnings


def update_stoixeia_sheet(wb, totals: LetterTotals) -> list[str]:
    """Ενημερώνει το φύλλο ΣΤΟΙΧΕΙΑ_ΕΠΙΣΤΟΛΩΝ, μόνο αν ο μήνας δεν έχει ήδη τιμές."""
    warnings = []
    if STOIXEIA_SHEET not in wb.sheetnames:
        warnings.append(f"Δεν βρέθηκε φύλλο «{STOIXEIA_SHEET}» — παραλείφθηκε.")
        return warnings
    ws = wb[STOIXEIA_SHEET]

    # Γραμμή κεφαλίδων: η πρώτη που περιέχει ετικέτα "ΒΑΣΙΚ".
    header_row = None
    header_cols: dict[str, int] = {}
    for r in range(1, min(10, ws.max_row) + 1):
        cols = {}
        for c in range(1, ws.max_column + 1):
            v = ws.cell(row=r, column=c).value
            if not v:
                continue
            label = normalize_label(v)
            for key, fld in CONTROL_LABELS:
                if key in label and fld not in cols:
                    cols[fld] = c
        if "basic" in cols:
            header_row, header_cols = r, cols
            break
    if header_row is None:
        warnings.append(
            f"Δεν αναγνωρίστηκαν κεφαλίδες στο «{STOIXEIA_SHEET}» — παραλείφθηκε."
        )
        return warnings

    # Γραμμή του μήνα: κελί που περιέχει το όνομα του μήνα μισθών.
    month = normalize_label(totals.minas_misthon)
    month_row = None
    for r in range(header_row + 1, ws.max_row + 1):
        for c in range(1, ws.max_column + 1):
            v = ws.cell(row=r, column=c).value
            if v and month and month in normalize_label(v):
                month_row = r
                break
        if month_row:
            break
    if month_row is None:
        warnings.append(
            f"Δεν βρέθηκε γραμμή για τον μήνα {totals.minas_misthon} στο «{STOIXEIA_SHEET}» — "
            "συμπληρώστε τα σύνολα χειροκίνητα."
        )
        return warnings

    existing = [
        ws.cell(row=month_row, column=c).value
        for c in header_cols.values()
        if ws.cell(row=month_row, column=c).value not in (None, "", 0)
    ]
    if existing:
        warnings.append(
            f"Ο μήνας {totals.minas_misthon} έχει ήδη τιμές στο «{STOIXEIA_SHEET}» — δεν αντικαταστάθηκαν."
        )
        return warnings

    for fld, c in header_cols.items():
        ws.cell(row=month_row, column=c).value = round(getattr(totals, fld), 2)
    return warnings


def output_path_for(workbook_path: str, month: str) -> Path:
    p = Path(workbook_path)
    return p.with_name(f"{p.stem}_{month}{p.suffix}")


def write_workbook(
    workbook_path: str,
    month_sheet: str,
    rows: list[TableRow],
    totals: LetterTotals,
) -> WriteResult:
    """Ανοίγει το workbook, γράφει τα δεδομένα και το αποθηκεύει ως νέο αρχείο."""
    wb = load_workbook(workbook_path)  # data_only=False: διατηρούνται οι φόρμουλες
    if month_sheet not in wb.sheetnames:
        raise ExcelWriteError(
            f"Δεν υπάρχει φύλλο «{month_sheet}» στο workbook. "
            f"Διαθέσιμα φύλλα: {', '.join(wb.sheetnames)}"
        )
    ws = wb[month_sheet]

    result = write_month_sheet(ws, rows)
    result.warnings += update_control_block(ws, totals)
    result.warnings += update_stoixeia_sheet(wb, totals)

    out = output_path_for(workbook_path, month_sheet)
    wb.save(out)
    result.output_path = str(out)
    return result
