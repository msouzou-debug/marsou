"""Output workbook (openpyxl) + gate-5 verification.

Formatting rules from the brief (non-negotiable):
- Blue font = hardcoded input off a source report.  Black = formula.
  Green = cross-sheet link.  Yellow fill = zero-check cells.
- Every subtotal, total, diff and check is a LIVE formula.
- SUMIFS criteria reference header/label cells, not quoted strings.
- Brand colours for headers: navy #062E5C, blue #0072BC, sky #00AEEF,
  green #8DC63F, gray #595959.

verify_workbook() reopens the built file and recomputes every yellow
zero-check cell with a small formula evaluator (openpyxl stores formulas,
it doesn't compute them) — gate 5.
"""
from __future__ import annotations

import io
import re
from typing import Optional

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter, range_boundaries

from .checks import CENT, ReconResult
from .models import (Bucket, BUCKET_ORDER, HOSPITALS, MONTH_NAMES_EL,
                     PHARMACIST_FEE_UNIT_PRICE)

NAVY, BLUE, SKY, GREEN_BRAND, GRAY = "062E5C", "0072BC", "00AEEF", "8DC63F", "595959"
GREEN_LINK = "1F7A1F"

F_INPUT = Font(color=BLUE)                       # blue font = hardcoded input
F_FORMULA = Font(color="000000")                 # black = formula
F_LINK = Font(color=GREEN_LINK)                  # green = cross-sheet link
F_HEADER = Font(color="FFFFFF", bold=True)
F_RED = Font(color="C00000", bold=True)
F_AMBER = Font(color="B45F06", bold=True)
FILL_HEADER = PatternFill("solid", fgColor=NAVY)
FILL_SECTION = PatternFill("solid", fgColor=SKY)
FILL_CHECK = PatternFill("solid", fgColor="FFFF00")   # yellow = zero-check
FILL_AMBER = PatternFill("solid", fgColor="FFE599")
THIN = Border(bottom=Side(style="thin", color=GRAY))
EUR_FMT = "#,##0.00"


def _header(ws, row: int, labels: list[str]) -> None:
    for j, label in enumerate(labels, start=1):
        c = ws.cell(row=row, column=j, value=label)
        c.font = F_HEADER
        c.fill = FILL_HEADER
        c.alignment = Alignment(vertical="center")


def _amount(ws, row: int, col: int, value, font: Font) -> None:
    c = ws.cell(row=row, column=col, value=value)
    c.font = font
    c.number_format = EUR_FMT


def build_workbook(result: ReconResult) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    bundle = result.bundle

    sra_tab = None
    stated_cell = None
    if not result.crosscheck_mode and bundle.sra:
        sra_tab, total_row, stated_row, n_lines = _tab_sra(wb, result)
        stated_cell = f"'{sra_tab}'!F{stated_row}"
        _tab_reconciliation(wb, result, sra_tab, n_lines, stated_cell)
    else:
        _tab_matrix(wb, result)
    _tab_crosscheck(wb, result, sra_tab)
    _tab_split(wb, result, stated_cell)
    _tab_legend(wb, result)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ------------------------------------------------------------- tab 1: SRA

def _tab_sra(wb: Workbook, result: ReconResult):
    sra = result.bundle.sra
    name = f"SRA_{sra.cheque_no}"[:31]
    ws = wb.create_sheet(name)
    _header(ws, 1, ["Κωδικός (Code)", "Περιγραφή (Description)", "Κανάλι (Channel)",
                    "Κατηγορία (Bucket)", "Πηγή ΟΑΥ (Source report)", "Ποσό (Amount €)"])
    r = 2
    for line in sra.lines:
        ws.cell(row=r, column=1, value=line.code).font = F_INPUT
        ws.cell(row=r, column=2, value=line.description).font = F_INPUT
        ws.cell(row=r, column=3, value=line.channel).font = F_INPUT
        ws.cell(row=r, column=4, value=line.bucket.value).font = F_INPUT
        ws.cell(row=r, column=5, value=line.source_report).font = F_INPUT
        _amount(ws, r, 6, line.amount, F_INPUT)
        r += 1
    last_line = r - 1
    total_row = r
    ws.cell(row=total_row, column=1, value="TOTAL (ΣΥΝΟΛΟ)").font = Font(bold=True)
    _amount(ws, total_row, 6, f"=SUM(F2:F{last_line})", F_FORMULA)
    ws.cell(row=total_row, column=6).font = Font(bold=True)
    stated_row = r + 1
    ws.cell(row=stated_row, column=1,
            value=f"Δηλωμένο σύνολο επιταγής (stated cheque total) #{sra.cheque_no}").font = F_INPUT
    _amount(ws, stated_row, 6, sra.stated_total, F_INPUT)
    check_row = r + 2
    ws.cell(row=check_row, column=1, value="Check = TOTAL − stated (must be 0)")
    _amount(ws, check_row, 6, f"=F{total_row}-F{stated_row}", F_FORMULA)
    ws.cell(row=check_row, column=6).fill = FILL_CHECK
    _autosize(ws)
    return name, total_row, stated_row, last_line


# ----------------------------------------------------- tab 2: Reconciliation

def _tab_reconciliation(wb: Workbook, result: ReconResult, sra_tab: str,
                        n_lines: int, stated_cell: str) -> None:
    ws = wb.create_sheet("Reconciliation")
    b = result.bundle
    hosp = HOSPITALS[b.hospital_code]
    ws.cell(row=1, column=1, value=f"{hosp[0]} ({hosp[1]}) — {MONTH_NAMES_EL[b.month]} "
                                   f"{b.year} — Επιταγή #{b.sra.cheque_no}").font = Font(bold=True, color=NAVY)
    _header(ws, 3, ["Κατηγορία (Bucket)", "Bucket key", "Ποσό (Amount €)"])
    labels = {
        Bucket.INPATIENT: "Ενδονοσοκομειακή περίθαλψη (Inpatient)",
        Bucket.AE: "ΤΑΕΠ (A&E)",
        Bucket.OUTPATIENT: "Εξωνοσοκομειακή περίθαλψη (Outpatient)",
        Bucket.PHARMA: "Φάρμακα (Pharma)",
    }
    r = 4
    for bucket in BUCKET_ORDER:
        ws.cell(row=r, column=1, value=labels[bucket]).font = F_INPUT
        ws.cell(row=r, column=2, value=bucket.value).font = F_INPUT
        # live SUMIFS on the SRA tab's Bucket column, criteria = the label cell
        _amount(ws, r, 3,
                f"=SUMIFS('{sra_tab}'!$F$2:$F${n_lines},'{sra_tab}'!$D$2:$D${n_lines},$B{r})",
                F_FORMULA)
        r += 1
    total_row = r
    ws.cell(row=total_row, column=1, value="TOTAL (ΣΥΝΟΛΟ)").font = Font(bold=True)
    _amount(ws, total_row, 3, f"=SUM(C4:C{r - 1})", F_FORMULA)
    ws.cell(row=total_row, column=3).font = Font(bold=True)
    cheque_row = total_row + 1
    ws.cell(row=cheque_row, column=1, value="Επιταγή ΟΑΥ (HIO cheque)")
    _amount(ws, cheque_row, 3, f"={stated_cell}", F_LINK)
    check_row = cheque_row + 1
    ws.cell(row=check_row, column=1, value="Zero-check = TOTAL − cheque (must be 0)")
    _amount(ws, check_row, 3, f"=C{total_row}-C{cheque_row}", F_FORMULA)
    ws.cell(row=check_row, column=3).fill = FILL_CHECK
    _autosize(ws)


# ------------------------------------------- tab 2 (cross-check mode): matrix

def _tab_matrix(wb: Workbook, result: ReconResult) -> None:
    ws = wb.create_sheet("Crosscheck_Matrix")
    b = result.bundle
    hosp = HOSPITALS[b.hospital_code]
    ws.cell(row=1, column=1,
            value=f"{hosp[0]} ({hosp[1]}) — {MONTH_NAMES_EL[b.month]} {b.year} — "
                  "Cross-check mode (χωρίς SRA / no SRA)").font = Font(bold=True, color=NAVY)
    cols = result.matrix_columns
    _header(ws, 3, ["Ροή (Stream)"] + cols + ["Range (max−min)"])
    r = 4
    for row in result.matrix:
        ws.cell(row=r, column=1, value=row["stream"]).font = F_INPUT
        populated = []
        for j, col in enumerate(cols, start=2):
            v = row["values"].get(col)
            if v is not None:
                _amount(ws, r, j, v, F_INPUT)
                populated.append(get_column_letter(j) + str(r))
        rng_col = len(cols) + 2
        if len(populated) > 1:
            first, last = get_column_letter(2), get_column_letter(len(cols) + 1)
            _amount(ws, r, rng_col,
                    f"=MAX({first}{r}:{last}{r})-MIN({first}{r}:{last}{r})", F_FORMULA)
            if row["range"] is not None and abs(row["range"]) > 0.5:
                ws.cell(row=r, column=rng_col).font = F_AMBER
        r += 1
    _autosize(ws)


# ------------------------------------------------ tab 3: Source_crosscheck

def _sra_refs(sra_tab: str, sra, codes: list[str]) -> list[str]:
    refs = []
    for i, line in enumerate(sra.lines):
        if line.code in codes:
            refs.append(f"'{sra_tab}'!F{i + 2}")
    return refs


def _tab_crosscheck(wb: Workbook, result: ReconResult, sra_tab: Optional[str]) -> None:
    ws = wb.create_sheet("Source_crosscheck")
    _header(ws, 1, ["Έλεγχος (Check)", "Σύνολο πηγής (Source total €)",
                    "Πλευρά SRA (SRA side €)", "Διαφορά (Diff €)", "Σημείωση (Note)",
                    "Συσκευασίες (Packages)", "Τιμή μονάδας (Unit €)"])
    r = 2
    b = result.bundle
    for chk in result.crosschecks:
        ws.cell(row=r, column=1, value=chk.name).font = F_INPUT
        is_phfee = "1,60" in chk.name or "Φαρμακοποιού (packages" in chk.name
        if is_phfee and b.phfee:
            # packages × 1.60 as a LIVE formula off two blue inputs
            ws.cell(row=r, column=6, value=b.phfee.packages).font = F_INPUT
            _amount(ws, r, 7, PHARMACIST_FEE_UNIT_PRICE, F_INPUT)
            _amount(ws, r, 2, f"=F{r}*G{r}", F_FORMULA)
        else:
            _amount(ws, r, 2, chk.source_total, F_INPUT)
        if sra_tab and chk.sra_codes and b.sra:
            refs = _sra_refs(sra_tab, b.sra, chk.sra_codes)
            _amount(ws, r, 3, "=" + ("+".join(refs) if refs else "0"), F_LINK)
        elif chk.sra_side is not None:
            _amount(ws, r, 3, chk.sra_side, F_INPUT)
        if chk.sra_side is not None:
            _amount(ws, r, 4, f"=B{r}-C{r}", F_FORMULA)
            if chk.flag == "red":
                ws.cell(row=r, column=4).font = F_RED
            elif chk.flag == "amber":
                ws.cell(row=r, column=4).font = F_AMBER
        note = ws.cell(row=r, column=5, value=chk.note)
        if chk.flag == "amber":
            note.fill = FILL_AMBER
        r += 1
    _autosize(ws)


# --------------------------------------------------- tab 4: By_Clinic_Split

def _tab_split(wb: Workbook, result: ReconResult, stated_cell: Optional[str]) -> None:
    ws = wb.create_sheet("By_Clinic_Split")
    b = result.bundle
    hosp = HOSPITALS[b.hospital_code]
    ws.cell(row=1, column=1, value=f"Κατανομή ανά κλινική για SAP (By-clinic split) — "
                                   f"{hosp[0]} — {MONTH_NAMES_EL[b.month]} {b.year}"
            ).font = Font(bold=True, color=NAVY)
    _header(ws, 3, ["Κλινική / Γραμμή (Clinic / Line)", "Fixed Fee €", "DRG €",
                    "Ποσό (Amount €)"])
    r = 4
    subtotal_cells = []
    for section in result.split:
        sec = ws.cell(row=r, column=1, value=section.title)
        sec.font = Font(bold=True, color="FFFFFF")
        sec.fill = FILL_SECTION
        r += 1
        first = r
        for row in section.rows:
            ws.cell(row=r, column=1, value=row.label).font = F_INPUT
            if row.fixed_fee is not None:
                _amount(ws, r, 2, row.fixed_fee, F_INPUT)
            if row.drg is not None:
                _amount(ws, r, 3, row.drg, F_INPUT)
            _amount(ws, r, 4, row.amount, F_INPUT)
            r += 1
        ws.cell(row=r, column=1, value=f"Υποσύνολο (Subtotal) — {section.title}"
                ).font = Font(bold=True)
        if r > first:
            _amount(ws, r, 4, f"=SUM(D{first}:D{r - 1})", F_FORMULA)
        else:
            _amount(ws, r, 4, 0.0, F_FORMULA)
        ws.cell(row=r, column=4).font = Font(bold=True)
        for col in range(1, 5):
            ws.cell(row=r, column=col).border = THIN
        subtotal_cells.append(f"D{r}")
        r += 2
    total_row = r
    ws.cell(row=total_row, column=1, value="ΓΕΝΙΚΟ ΣΥΝΟΛΟ (GRAND TOTAL)").font = Font(bold=True, color=NAVY)
    _amount(ws, total_row, 4, "=" + "+".join(subtotal_cells), F_FORMULA)
    ws.cell(row=total_row, column=4).font = Font(bold=True)
    if stated_cell:
        cheque_row = total_row + 1
        ws.cell(row=cheque_row, column=1, value="Επιταγή ΟΑΥ (HIO cheque)")
        _amount(ws, cheque_row, 4, f"={stated_cell}", F_LINK)
        check_row = cheque_row + 1
        ws.cell(row=check_row, column=1, value="Zero-check = ΓΕΝΙΚΟ ΣΥΝΟΛΟ − επιταγή (must be 0)")
        _amount(ws, check_row, 4, f"=D{total_row}-D{cheque_row}", F_FORMULA)
        ws.cell(row=check_row, column=4).fill = FILL_CHECK
    else:
        ws.cell(row=total_row + 1, column=1,
                value="Cross-check mode: χωρίς επιταγή — no cash tie-out (δεν υπάρχει SRA).")
    _autosize(ws)


# ----------------------------------------------------------- tab 5: Legend

def _tab_legend(wb: Workbook, result: ReconResult) -> None:
    ws = wb.create_sheet("Legend")
    ws.cell(row=1, column=1, value="Υπόμνημα (Legend)").font = Font(bold=True, size=14, color=NAVY)
    rows = [
        ("Μπλε γραμματοσειρά (blue font)", "Hardcoded input από αναφορά ΟΑΥ (off a source report)", F_INPUT, None),
        ("Μαύρη γραμματοσειρά (black font)", "Ζωντανός τύπος (live formula)", F_FORMULA, None),
        ("Πράσινη γραμματοσειρά (green font)", "Σύνδεσμος μεταξύ φύλλων (cross-sheet link)", F_LINK, None),
        ("Κίτρινο γέμισμα (yellow fill)", "Zero-check — πρέπει να είναι 0 (must read 0)", None, FILL_CHECK),
        ("Πορτοκαλί (amber)", "Γνωστή απόκλιση με σημείωση (known variance, noted)", F_AMBER, FILL_AMBER),
        ("Κόκκινο (red)", "Ανεξήγητη διαφορά — εύρημα (unexplained diff, a finding)", F_RED, None),
    ]
    r = 3
    for label, meaning, font, fill in rows:
        c = ws.cell(row=r, column=1, value=label)
        if font:
            c.font = font
        if fill:
            c.fill = fill
        ws.cell(row=r, column=2, value=meaning)
        r += 1
    r += 1
    notes = [
        "Κάθε υποσύνολο/σύνολο/διαφορά είναι ζωντανός τύπος — αλλάζοντας ένα μπλε κελί, "
        "το βιβλίο ξανα-δένει ή δείχνει το σπάσιμο.",
        "Never plug a difference: κάθε ανεξήγητη διαφορά εμφανίζεται με τις δύο πλευρές και το άνοιγμα.",
        "Stateless: τίποτα δεν αποθηκεύεται μετά το κλείσιμο του browser session.",
    ]
    for n in notes:
        ws.cell(row=r, column=1, value=n)
        r += 1
    _autosize(ws)


def _autosize(ws) -> None:
    for col_cells in ws.columns:
        length = max((len(str(c.value)) for c in col_cells if c.value is not None), default=8)
        ws.column_dimensions[get_column_letter(col_cells[0].column)].width = min(length + 2, 70)


# =================================================== gate 5: verification

_TOKEN_RE = re.compile(r"""
    (?P<func>SUMIFS|SUM|MAX|MIN|ROUND)\(
  | (?P<ref>(?:'[^']+'!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)
  | (?P<num>\d+(?:\.\d+)?)
  | (?P<op>[+\-*/(),])
""", re.VERBOSE)


class _Evaluator:
    """Just enough of a formula engine to recompute the formulas THIS app
    writes: SUM/SUMIFS/MAX/MIN over (cross-sheet) ranges, cell refs, + - * /."""

    def __init__(self, wb):
        self.wb = wb

    def cell_value(self, sheet: str, coord: str) -> float:
        v = self.wb[sheet][coord.replace("$", "")].value
        if v is None:
            return 0.0
        if isinstance(v, str) and v.startswith("="):
            # fresh evaluator: evaluate() is stateful, recursing on self would
            # clobber the caller's token position
            return _Evaluator(self.wb).evaluate(v, sheet)
        if isinstance(v, (int, float)):
            return float(v)
        return 0.0

    def cell_raw(self, sheet: str, coord: str):
        return self.wb[sheet][coord.replace("$", "")].value

    def _range_cells(self, sheet: str, ref: str) -> list[tuple[str, str]]:
        if "!" in ref:
            sheet_part, ref = ref.split("!")
            sheet = sheet_part.strip("'")
        ref = ref.replace("$", "")
        if ":" in ref:
            min_c, min_r, max_c, max_r = range_boundaries(ref)
            return [(sheet, f"{get_column_letter(c)}{r}")
                    for r in range(min_r, max_r + 1) for c in range(min_c, max_c + 1)]
        return [(sheet, ref)]

    def evaluate(self, formula: str, sheet: str) -> float:
        self.tokens = list(_TOKEN_RE.finditer(formula.lstrip("=")))
        self.pos = 0
        self.sheet = sheet
        return self._expr()

    def _peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def _next(self):
        t = self._peek()
        self.pos += 1
        return t

    def _expr(self) -> float:
        v = self._term()
        while (t := self._peek()) and t.group("op") in ("+", "-"):
            op = self._next().group("op")
            rhs = self._term()
            v = v + rhs if op == "+" else v - rhs
        return v

    def _term(self) -> float:
        v = self._factor()
        while (t := self._peek()) and t.group("op") in ("*", "/"):
            op = self._next().group("op")
            rhs = self._factor()
            v = v * rhs if op == "*" else v / rhs
        return v

    def _factor(self) -> float:
        t = self._next()
        if t is None:
            return 0.0
        if t.group("num"):
            return float(t.group("num"))
        if t.group("op") == "-":
            return -self._factor()
        if t.group("op") == "(":
            v = self._expr()
            self._next()  # ')'
            return v
        if t.group("ref"):
            cells = self._range_cells(self.sheet, t.group("ref"))
            if len(cells) == 1:
                return self.cell_value(*cells[0])
            return sum(self.cell_value(s, c) for s, c in cells)
        if t.group("func"):
            return self._call(t.group("func"))
        return 0.0

    def _args(self) -> list:
        """Argument list; each arg is either a float or ('RANGE', ref)."""
        args = []
        depth = 1
        current_start = self.pos
        while self.pos < len(self.tokens):
            t = self.tokens[self.pos]
            op = t.group("op")
            if op == "(":
                depth += 1
            elif op == ")":
                depth -= 1
                if depth == 0:
                    if self.pos > current_start:
                        args.append(self._arg_slice(current_start, self.pos))
                    self.pos += 1
                    return args
            elif op == "," and depth == 1:
                args.append(self._arg_slice(current_start, self.pos))
                current_start = self.pos + 1
            self.pos += 1
        return args

    def _arg_slice(self, start: int, end: int):
        toks = self.tokens[start:end]
        if len(toks) == 1 and toks[0].group("ref"):
            return ("RANGE", toks[0].group("ref"))
        sub = _Evaluator(self.wb)
        sub.tokens = toks
        sub.pos = 0
        sub.sheet = self.sheet
        return sub._expr()

    def _call(self, name: str) -> float:
        args = self._args()

        def cells_of(arg):
            assert isinstance(arg, tuple) and arg[0] == "RANGE"
            return self._range_cells(self.sheet, arg[1])

        def vals(arg):
            if isinstance(arg, tuple):
                return [self.cell_value(s, c) for s, c in cells_of(arg)]
            return [arg]

        if name == "SUM":
            return sum(v for a in args for v in vals(a))
        if name in ("MAX", "MIN"):
            pool = []
            for a in args:
                if isinstance(a, tuple):
                    for s, c in cells_of(a):
                        raw = self.cell_raw(s, c)
                        if raw is not None:
                            pool.append(self.cell_value(s, c))
                else:
                    pool.append(a)
            return (max if name == "MAX" else min)(pool) if pool else 0.0
        if name == "ROUND":
            return round(args[0], int(args[1]))
        if name == "SUMIFS":
            sum_cells = cells_of(args[0])
            crit_cells = cells_of(args[1])
            crit = args[2]
            if isinstance(crit, tuple):
                s, c = cells_of(crit)[0]
                crit_val = self.cell_raw(s, c)
            else:
                crit_val = crit
            total = 0.0
            for (ss, sc), (cs, cc) in zip(sum_cells, crit_cells):
                if self.cell_raw(cs, cc) == crit_val:
                    total += self.cell_value(ss, sc)
            return total
        raise ValueError(f"unsupported function {name}")


def verify_workbook(data: bytes) -> list[tuple[str, str, float]]:
    """Reopen the built workbook and recompute every yellow zero-check cell.
    Returns [(sheet, cell, recomputed value)] for cells NOT reading 0."""
    wb = load_workbook(io.BytesIO(data))
    ev = _Evaluator(wb)
    failures = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.fill is not None and cell.fill.fgColor is not None \
                        and str(cell.fill.fgColor.rgb).endswith("FFFF00"):
                    v = cell.value
                    if isinstance(v, str) and v.startswith("="):
                        val = ev.evaluate(v, ws.title)
                    elif isinstance(v, (int, float)):
                        val = float(v)
                    else:
                        continue  # legend colour swatches carry no check value
                    if abs(val) > CENT:
                        failures.append((ws.title, cell.coordinate, round(val, 2)))
    return failures
