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


def _amount(ws, row: int, col: int, value, font: Font):
    c = ws.cell(row=row, column=col, value=value)
    c.font = font
    c.number_format = EUR_FMT
    return c


def build_workbook(result: ReconResult) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    bundle = result.bundle

    sra_tab = None
    stated_cell = None
    n_lines = 0
    if not result.crosscheck_mode and bundle.sra:
        sra_tab, total_row, stated_row, n_lines = _tab_sra(wb, result)
        stated_cell = f"'{sra_tab}'!F{stated_row}"
        _tab_reconciliation(wb, result, sra_tab, n_lines, stated_cell)
    else:
        _tab_matrix(wb, result)
    _tab_crosscheck(wb, result, sra_tab, n_lines)
    split_total_row = _tab_split(wb, result, stated_cell)
    _tab_by_doctor(wb, result, sra_tab, n_lines, split_total_row)
    _tab_truth_map(wb)
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
    r += 1
    # one stated row per cheque; several cheques get a live stated TOTAL
    parts = sra.parts if len(sra.parts) > 1 else \
        [(sra.cheque_no, sra.lines_total, sra.stated_total)]
    first_part_row = r
    for cheque, _lines_total, stated in parts:
        ws.cell(row=r, column=1,
                value=f"Δηλωμένο σύνολο επιταγής (stated cheque total) #{cheque}"
                ).font = F_INPUT
        _amount(ws, r, 6, stated, F_INPUT)
        r += 1
    if len(parts) > 1:
        stated_row = r
        ws.cell(row=stated_row, column=1,
                value="Δηλωμένο σύνολο όλων των επιταγών (all cheques)").font = Font(bold=True)
        _amount(ws, stated_row, 6, f"=SUM(F{first_part_row}:F{r - 1})", F_FORMULA)
        r += 1
    else:
        stated_row = first_part_row
    check_row = r
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

def _tab_crosscheck(wb: Workbook, result: ReconResult, sra_tab: Optional[str],
                    n_lines: int) -> None:
    ws = wb.create_sheet("Source_crosscheck")
    _header(ws, 1, ["Έλεγχος (Check)", "Σύνολο πηγής (Source total €)",
                    "Πλευρά SRA (SRA side €)", "Διαφορά (Diff €)", "Σημείωση (Note)",
                    "Συσκευασίες (Packages)", "Τιμή μονάδας (Unit €)",
                    "Κωδικοί SRA (codes)"])
    r = 2
    b = result.bundle
    # row numbers of the netted pharma/fee pair (they reference each other)
    fee_net_row = next((2 + i for i, c in enumerate(result.crosschecks)
                        if c.side_kind == "fee_net"), None)
    pharma_row = next((2 + i for i, c in enumerate(result.crosschecks)
                       if c.side_kind == "ph_minus_fee"), None)
    for chk in result.crosschecks:
        ws.cell(row=r, column=1, value=chk.name).font = F_INPUT
        is_phfee = "Φαρμακοποιού (packages" in chk.name or chk.side_kind == "fee_net"
        if is_phfee and b.phfee:
            # packages × unit price (READ from the report — 1.60/1.62 €)
            # as a LIVE formula off two blue inputs
            ws.cell(row=r, column=6, value=b.phfee.packages).font = F_INPUT
            _amount(ws, r, 7, b.phfee.unit_price, F_INPUT)
        def _sumifs(code_cols):
            terms = []
            for k, code in enumerate(code_cols):
                col = get_column_letter(8 + k)
                ws.cell(row=r, column=8 + k, value=code).font = F_INPUT
                terms.append(f"SUMIFS('{sra_tab}'!$F$2:$F${n_lines},"
                             f"'{sra_tab}'!$A$2:$A${n_lines},{col}{r})")
            return "+".join(terms)
        if chk.side_kind == "fee_net" and sra_tab and b.sra:
            # source = packages × unit (live); side = SRA PH − claims gross
            _amount(ws, r, 2, f"=F{r}*G{r}", F_FORMULA)
            side = "=" + _sumifs(["PH"])
            if pharma_row is not None:
                side += f"-B{pharma_row}"
            _amount(ws, r, 3, side, F_LINK)
        elif chk.side_kind == "ph_minus_fee" and sra_tab and b.sra:
            if is_phfee and b.phfee:
                _amount(ws, r, 2, f"=F{r}*G{r}", F_FORMULA)
            else:
                _amount(ws, r, 2, chk.source_total, F_INPUT)
            side = "=" + _sumifs(["PH"])
            if fee_net_row is not None:
                side += f"-F{fee_net_row}*G{fee_net_row}"
            _amount(ws, r, 3, side, F_LINK)
        else:
            if is_phfee and b.phfee:
                _amount(ws, r, 2, f"=F{r}*G{r}", F_FORMULA)
            else:
                _amount(ws, r, 2, chk.source_total, F_INPUT)
            if sra_tab and chk.sra_codes and b.sra:
                # SUMIFS over the SRA Code column, criteria referencing the
                # code helper cells (never quoted strings)
                _amount(ws, r, 3, "=" + _sumifs(chk.sra_codes), F_LINK)
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

def _tab_split(wb: Workbook, result: ReconResult, stated_cell: Optional[str]) -> int:
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
    return total_row


# ------------------------------------------- tab 5: by doctor & speciality

def _tab_by_doctor(wb: Workbook, result: ReconResult,
                   sra_tab: Optional[str] = None, n_lines: int = 0,
                   split_total_row: Optional[int] = None) -> None:
    """The SRA payment split by clinic/speciality AND doctor, summed from the
    ROW-LEVEL claims detail (never from ΟΑΥ-printed totals), plus the
    capitation per-doctor breakdown.  Live SUM subtotals per stream; bottom
    block re-ties the tab against the source-report column sums."""
    b = result.bundle
    docs = b.claims.by_doctor if b.claims else []
    cap_docs = b.capitation.by_doctor if b.capitation else []
    if not docs and not cap_docs:
        return
    ws = wb.create_sheet("Ανά_ιατρό")
    ws.cell(row=1, column=1,
            value="Ανάλυση πληρωμής ΟΑΥ ανά ειδικότητα/κλινική και ιατρό "
                  "(SRA payment by speciality & doctor) — αθροισμένη από τις "
                  "αναλυτικές γραμμές των αρχείων ΟΑΥ").font = \
        Font(bold=True, size=14, color=NAVY)
    _header(ws, 3, ["Ροή (Stream)", "Ειδικότητα (Speciality)",
                    "Ιατρός (Doctor)", "Ποσό (Amount €)"])
    r = 4
    subtotal_cells: list[str] = []
    segments: list[str] = []
    for seg, _sp, _d, _v in docs:
        if seg not in segments:
            segments.append(seg)
    for seg in segments:
        head = ws.cell(row=r, column=1, value=f"{seg} — Claims «all»")
        head.font = Font(bold=True)
        head.fill = FILL_SECTION
        r += 1
        # BY CLINIC FIRST, THEN BY DOCTOR: specialities ordered by size,
        # each with a live subtotal over its doctor rows beneath
        seg_rows = [(sp, d, v) for s, sp, d, v in docs if s == seg]
        spec_totals: dict[str, float] = {}
        for sp, _d, v in seg_rows:
            spec_totals[sp] = round(spec_totals.get(sp, 0.0) + v, 2)
        spec_cells: list[str] = []
        for sp in sorted(spec_totals, key=lambda k: -spec_totals[k]):
            drs = [(d, v) for s2, d, v in seg_rows if s2 == sp]
            ws.cell(row=r, column=2, value=sp).font = Font(bold=True)
            _amount(ws, r, 4, f"=SUM(D{r + 1}:D{r + len(drs)})", F_FORMULA)
            spec_cells.append(f"D{r}")
            r += 1
            for d, v in drs:
                ws.cell(row=r, column=3, value=d).font = F_INPUT
                _amount(ws, r, 4, v, F_INPUT)
                r += 1
        ws.cell(row=r, column=1, value=f"Υποσύνολο {seg}").font = Font(bold=True)
        _amount(ws, r, 4, "=" + "+".join(spec_cells), F_FORMULA)
        subtotal_cells.append(f"D{r}")
        r += 1
    if cap_docs:
        head = ws.cell(row=r, column=1,
                       value="Personal Doctors — Capitation report (κατά κεφαλήν)")
        head.font = Font(bold=True)
        head.fill = FILL_SECTION
        r += 1
        first = r
        for label, v in cap_docs:
            ws.cell(row=r, column=2, value="Capitation").font = F_INPUT
            ws.cell(row=r, column=3, value=label).font = F_INPUT
            _amount(ws, r, 4, v, F_INPUT)
            r += 1
        ws.cell(row=r, column=1, value="Υποσύνολο Capitation").font = Font(bold=True)
        _amount(ws, r, 4, f"=SUM(D{first}:D{r - 1})", F_FORMULA)
        subtotal_cells.append(f"D{r}")
        r += 1
    total_row = r
    ws.cell(row=total_row, column=1, value="ΣΥΝΟΛΟ καρτέλας (tab total)").font = \
        Font(bold=True)
    _amount(ws, total_row, 4, "=" + "+".join(subtotal_cells), F_FORMULA)
    r += 2
    # verification block: the tab re-ties against the source-report column
    # sums — a gap here means incomplete row-level detail, shown, never hidden
    src_rows = []
    if b.claims:
        ws.cell(row=r, column=1,
                value="Claims «all» — άθροιση στήλης HIO REIMB. (column sum)"
                ).font = F_INPUT
        _amount(ws, r, 4, b.claims.total, F_INPUT)
        src_rows.append(r)
        r += 1
    if b.capitation:
        ws.cell(row=r, column=1,
                value="Capitation report — άθροιση τιμολογίων EBS (invoice sum)"
                ).font = F_INPUT
        _amount(ws, r, 4, b.capitation.total, F_INPUT)
        src_rows.append(r)
        r += 1
    diff_row = r
    ws.cell(row=diff_row, column=1,
            value="Διαφορά καρτέλας − πηγών (πληρότητα αναλυτικών γραμμών / "
                  "detail completeness)")
    diff_cell = _amount(ws, diff_row, 4,
                        f"=D{total_row}-" + "-".join(f"D{x}" for x in src_rows),
                        F_FORMULA)
    tab_total = round(sum(v for *_x, v in docs)
                      + sum(v for _l, v in cap_docs), 2)
    src_total = round((b.claims.total if b.claims else 0.0)
                      + (b.capitation.total if b.capitation else 0.0), 2)
    if abs(tab_total - src_total) > 0.005:
        diff_cell.font = F_AMBER
        ws.cell(row=diff_row + 1, column=1,
                value="Μερική ανάλυση ανά ιατρό στην πηγή (η αναφορά ΟΑΥ δεν "
                      "αναλύει όλο το ποσό ανά ιατρό) — η διαφορά φαίνεται, "
                      "δεν κρύβεται.").font = F_AMBER
        r += 1
    r = diff_row + 2

    # ------- bridge: from the by-doctor universe to By_Clinic_Split / cheque
    # (only when an SRA exists — cross-check mode has no cash side)
    if sra_tab and src_rows:
        head = ws.cell(row=r, column=1,
                       value="ΓΕΦΥΡΑ ΠΡΟΣ ΤΟ BY_CLINIC_SPLIT / ΤΗΝ ΕΠΙΤΑΓΗ "
                             "(bridge: doctors → cheque)")
        head.font = Font(bold=True, color="FFFFFF")
        head.fill = FILL_SECTION
        r += 1
        bridge_rows: list[int] = []
        first_src = src_rows[0]
        ws.cell(row=r, column=1,
                value="Αποδιδόμενα σε ιατρούς: Claims «all» + Capitation "
                      "(οι πηγές της καρτέλας)").font = F_FORMULA
        _amount(ws, r, 4, "=" + "+".join(f"D{x}" for x in src_rows), F_FORMULA)
        bridge_rows.append(r)
        r += 1

        def sumifs_codes(row: int, codes: list[str], col_letter_ref: str = "A") -> str:
            terms = []
            for k, code in enumerate(codes):
                col = get_column_letter(6 + k)
                ws.cell(row=row, column=6 + k, value=code).font = F_INPUT
                terms.append(
                    f"SUMIFS('{sra_tab}'!$F$2:$F${n_lines},"
                    f"'{sra_tab}'!${col_letter_ref}$2:${col_letter_ref}${n_lines},"
                    f"{col}{row})")
            return "=" + "+".join(terms)

        for label, codes, by_bucket in [
            ("+ Φάρμακα — μη αποδιδόμενα σε ιατρούς (SRA bucket Pharma)",
             ["Pharma"], True),
            ("+ Αιμοκάθαρση (HEMO)", ["HEMO"], False),
            ("+ Προσαρμογές & τακτοποιήσεις (IS-ADJ, AE-ADJ, IS-PRIOR)",
             ["IS-ADJ", "AE-ADJ", "IS-PRIOR"], False),
            ("+ Σταθερές χρεώσεις ΠΙ & Ποιοτικά (PD-FP, KPI, MRI/CT)",
             ["PD-FP", "PD-KPI", "KPI", "MRI", "CT", "MRI/CT"], False),
        ]:
            ws.cell(row=r, column=1, value=label).font = F_LINK
            _amount(ws, r, 4,
                    sumifs_codes(r, codes, "D" if by_bucket else "A"), F_LINK)
            bridge_rows.append(r)
            r += 1
        bridge_total_row = r
        ws.cell(row=r, column=1, value="Σύνολο γέφυρας (bridge total)"
                ).font = Font(bold=True)
        _amount(ws, r, 4, "=" + "+".join(f"D{x}" for x in bridge_rows), F_FORMULA)
        r += 1
        split_row = r
        ws.cell(row=r, column=1,
                value="ΓΕΝΙΚΟ ΣΥΝΟΛΟ By_Clinic_Split (= επιταγή ΟΑΥ)")
        _amount(ws, r, 4, f"='By_Clinic_Split'!D{split_total_row}", F_LINK)
        r += 1
        ws.cell(row=r, column=1,
                value="Διαφορά γέφυρας — γραμμές SRA χωρίς αναλυτικό ανά ιατρό "
                      "(προσαρμογές OS/NM/AP/PD, επιταγές δορυφορικών παροχέων, "
                      "υπόλοιπο ανάλυσης)")
        d = _amount(ws, r, 4, f"=D{bridge_total_row}-D{split_row}", F_FORMULA)
        d.font = F_AMBER
    _autosize(ws)


# ------------------------------------------------- tab 6: how reports tie

# One universe, many projections: every document in the batch is issued by
# the ΟΑΥ (HIO) about the SAME paid population.  The rows below are the
# identities verified to the cent on real months (Feb/Apr/May 2026); the
# join keys are PAYMENT NO. (the cheque) and the EBS invoice IDs.
TRUTH_MAP_ROWS = [
    ("Ροή (stream)", "Ταυτότητα (identity)", "Κλειδί / σημείωση (key / note)"),
    ("Επιταγή (cheque)",
     "Άθροισμα γραμμών SRA = δηλωμένο σύνολο επιταγής",
     "Το SRA είναι η σπονδυλική στήλη του χρήματος — κάθε γραμμή του είναι "
     "τιμολόγιο EBS της ΟΑΥ."),
    ("Ενδονοσοκομειακή (IS)",
     "SRA IS (ημερήσιες) = Claims «all»·Inpatient = Ενδ. Σύνολο = "
     "IS Auditor DRG+Z (± στρογγυλοποίηση)",
     "Τετραπλό δέσιμο σε έναν αριθμό. Απαιτήσεις παλαιών περιόδων που "
     "πληρώνονται τώρα λείπουν από την Ενδ. — κατονομάζονται."),
    ("ΤΑΕΠ (AE)",
     "SRA AE (ημερήσιες) = Claims «all»·A&E = GL ΟΑΥ 25801 "
     "(51101099 − 43010001 co-pays)",
     "Οι προσαρμογές παραπομπών (AE-ADJ/IS-ADJ) μένουν εκτός των ημερησίων."),
    ("Εξωνοσοκομειακή (OS/NM/AP)",
     "SRA ημερήσιες = Claims «all» segments = XML activities",
     "Το XML δένει σε επίπεδο πράξης μέσω ClaimPaymentNumber (PAYMENT NO.)."),
    ("Προσωπικοί Ιατροί (PD)",
     "SRA PD (ημερήσιες) = Capitation report + Claims «Personal Doctors»",
     "Επαληθευμένο στο σεντ Απρ+Μάι 2026. Σταθερές χρεώσεις (OOH, "
     "εμβολιασμοί) χωριστά ως PD-FP."),
    ("Ποιοτικά κριτήρια (KPI/MRI)",
     "SRA γραμμές KPI/MRI-CT = εξαγωγή Ποιοτικών Κριτηρίων",
     "Κενή εξαγωγή = εύρημα, όχι μηδενισμός."),
    ("Φάρμακα (PH)",
     "SRA PH (ημερήσιες) = Πληρωμένες ΦΑΡΜΑΚΑ (Drugs+Consumables) + "
     "Αμοιβή Φαρμακοποιού (packages × τιμή μονάδας)",
     "Επαληθευμένο στο σεντ Φεβ+Απρ+Μάι 2026. CRN/OTC/ISSUANCES χωριστά "
     "ως PH-ADJ· CRN-Packages ως PHF."),
    ("Αιμοκάθαρση (HEMO)",
     "SRA HEMO = μηνιαία αναφορά αιμοκάθαρσης",
     "Ενδονοσοκομειακή ή εξωνοσοκομειακή ανά ασθενή — μπλε κελί Bucket."),
    ("GL ΟΑΥ (καθολικό)",
     "26xxx = SRA IS + HEMO + IS-ADJ · 25801 = AE · 51001001 = capitation "
     "· 255xx ≈ φάρμακα · λοιπά 25xxx + capitation = εξωνοσοκομειακά",
     "Η λογιστική όψη της ΟΑΥ για τα ίδια ποσά. Γνωστές ταξινομήσεις: "
     "Z-tail σε κλινικούς λογαριασμούς, αμοιβή φαρμακοποιού flat."),
    ("Προσαρμογές (ADJ/CRN)",
     "PH-ADJ / AE-ADJ / IS-ADJ — το στρώμα διορθώσεων",
     "Δένουν με contra λογαριασμούς GL (π.χ. ISSUANCES ↔ 11202192 "
     "Unearned Revenue EOAF)."),
    ("Τακτοποιήσεις (PRIOR)",
     "Μονογραμμικές επιταγές παλαιών περιόδων (year-end DRG, "
     "innovative antibiotics)",
     "Pass-through: εκτός όλων των μηνιαίων ελέγχων, δικές τους γραμμές "
     "στο By_Clinic_Split."),
    ("Δορυφορικοί παροχείς",
     "Δικός τους κωδικός F στην κεφαλίδα SRA (π.χ. F1085) και δικός τους "
     "GL vendor",
     "Οι επιταγές τους μετρούν στο ταμείο του μήνα αλλά όχι στα αρχεία "
     "claims/GL του νοσοκομείου."),
]


def _tab_truth_map(wb: Workbook) -> None:
    ws = wb.create_sheet("Πώς_δένουν")
    ws.cell(row=1, column=1,
            value="Πώς δένουν οι αναφορές ΟΑΥ μεταξύ τους "
                  "(how the HIO reports tie together)").font = \
        Font(bold=True, size=14, color=NAVY)
    ws.cell(row=2, column=1,
            value="Όλα τα έγγραφα είναι εκδόσεις της ΟΑΥ για τον ίδιο πληρωμένο "
                  "πληθυσμό — κάθε αναφορά είναι διαφορετική προβολή του. "
                  "Κλειδιά σύνδεσης: PAYMENT NO. (αρ. επιταγής) και EBS invoice "
                  "IDs. Οι ταυτότητες επαληθεύτηκαν στο σεντ σε πραγματικούς "
                  "μήνες (Φεβ/Απρ/Μάι 2026).").font = Font(italic=True, color=GRAY)
    r = 4
    for i, (stream, identity, note) in enumerate(TRUTH_MAP_ROWS):
        if i == 0:
            _header(ws, r, list(TRUTH_MAP_ROWS[0]))
        else:
            ws.cell(row=r, column=1, value=stream).font = Font(bold=True, color=BLUE)
            ws.cell(row=r, column=2, value=identity)
            ws.cell(row=r, column=3, value=note).font = Font(color=GRAY)
        r += 1
    _autosize(ws)


# ----------------------------------------------------------- tab 6: Legend

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


def verify_workbook(data: bytes,
                    documented_residual: float = 0.0) -> list[tuple[str, str, float]]:
    """Reopen the built workbook and recompute every yellow zero-check cell.
    Returns [(sheet, cell, recomputed value)] for cells NOT reading 0.

    documented_residual: a known SRA parsing difference (lines − stated) that
    is documented as a red row in Source_crosscheck — zero-checks reading
    exactly that value are accepted, per the brief's documented-variances
    clause.  Never silently absorbed: it stays visible."""
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
                    if abs(val) > CENT and abs(val - documented_residual) > CENT:
                        failures.append((ws.title, cell.coordinate, round(val, 2)))
    return failures
