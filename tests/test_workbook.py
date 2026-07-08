"""End-to-end: bundle -> workbook -> reopen -> recompute (gate 5)."""
import io

from openpyxl import load_workbook

from recon.build_xlsx import _Evaluator, build_workbook, verify_workbook
from recon.checks import run_reconciliation

from test_checks import full_bundle


def _build(with_optional=False, crosscheck=False):
    b = full_bundle(with_optional=with_optional)
    if crosscheck:
        b.sra = None
    res = run_reconciliation(b, crosscheck_mode=crosscheck)
    return build_workbook(res), res


def test_workbook_has_five_tabs_and_zero_checks_pass():
    data, _ = _build(with_optional=True)
    wb = load_workbook(io.BytesIO(data))
    assert wb.sheetnames == ["SRA_259434", "Reconciliation", "Source_crosscheck",
                             "By_Clinic_Split", "Πώς_δένουν", "Legend"]
    assert verify_workbook(data) == []      # gate 5: every zero-check reads 0


def test_sra_tab_total_is_live_formula_and_ties():
    data, res = _build()
    wb = load_workbook(io.BytesIO(data))
    ws = wb["SRA_259434"]
    n = len(res.bundle.sra.lines)
    total_cell = ws.cell(row=n + 2, column=6).value
    assert isinstance(total_cell, str) and total_cell.startswith("=SUM(")
    ev = _Evaluator(wb)
    assert round(ev.evaluate(total_cell, "SRA_259434"), 2) == 1_936_528.19


def test_reconciliation_buckets_are_sumifs_referencing_label_cells():
    data, _ = _build()
    wb = load_workbook(io.BytesIO(data))
    ws = wb["Reconciliation"]
    for r in range(4, 8):
        f = ws.cell(row=r, column=3).value
        assert f.startswith("=SUMIFS(")
        assert f'$B{r}' in f            # criteria reference a label cell
        assert '"' not in f             # never a quoted string
    ev = _Evaluator(wb)
    assert round(ev.evaluate(ws["C4"].value, "Reconciliation"), 2) == 1_061_728.70
    assert round(ev.evaluate(ws["C5"].value, "Reconciliation"), 2) == 131_284.66
    assert round(ev.evaluate(ws["C6"].value, "Reconciliation"), 2) == 78_729.74
    assert round(ev.evaluate(ws["C7"].value, "Reconciliation"), 2) == 664_785.09


def test_live_retie_changing_a_blue_cell_breaks_the_check():
    data, res = _build()
    wb = load_workbook(io.BytesIO(data))
    ws = wb["SRA_259434"]
    ws["F2"] = 999_999.99               # reviewer edits a blue input
    buf = io.BytesIO()
    wb.save(buf)
    failures = verify_workbook(buf.getvalue())
    assert failures, "editing an input must surface a broken zero-check"


def test_pharmacist_fee_row_is_live_packages_times_price():
    data, _ = _build()
    wb = load_workbook(io.BytesIO(data))
    ws = wb["Source_crosscheck"]
    row = next(r for r in range(2, ws.max_row + 1)
               if "Φαρμακοποιού (packages" in str(ws.cell(row=r, column=1).value))
    assert ws.cell(row=row, column=6).value == 8076
    assert ws.cell(row=row, column=7).value == 1.60
    f = ws.cell(row=row, column=2).value
    assert f == f"=F{row}*G{row}"
    ev = _Evaluator(wb)
    assert round(ev.evaluate(f, "Source_crosscheck"), 2) == 12_921.60


def test_crosscheck_mode_workbook():
    data, _ = _build(with_optional=True, crosscheck=True)
    wb = load_workbook(io.BytesIO(data))
    assert wb.sheetnames == ["Crosscheck_Matrix", "Source_crosscheck",
                             "By_Clinic_Split", "Πώς_δένουν", "Legend"]
    assert verify_workbook(data) == []
    ws = wb["Crosscheck_Matrix"]
    # Range column is a live MAX-MIN formula
    found = any(isinstance(c.value, str) and c.value.startswith("=MAX(")
                for row in ws.iter_rows() for c in row)
    assert found
