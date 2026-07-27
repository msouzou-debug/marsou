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
                             "Ανάλυση_ελέγχων", "By_Clinic_Split", "Ανά_ιατρό",
                             "Πώς_δένουν", "Legend"]
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
                             "Ανάλυση_ελέγχων", "By_Clinic_Split", "Ανά_ιατρό",
                             "Πώς_δένουν", "Legend"]
    assert verify_workbook(data) == []
    ws = wb["Crosscheck_Matrix"]
    # Range column is a live MAX-MIN formula
    found = any(isinstance(c.value, str) and c.value.startswith("=MAX(")
                for row in ws.iter_rows() for c in row)
    assert found


# ------------------------------------------- Ανάλυση_ελέγχων (audit trail)

def _audit_rows(ws):
    return {str(ws.cell(row=r, column=1).value or ""): r
            for r in range(1, ws.max_row + 1)}


def test_audit_tab_reconciles_every_check_with_live_subtotals():
    data, res = _build(with_optional=True)
    wb = load_workbook(io.BytesIO(data))
    ws = wb["Ανάλυση_ελέγχων"]
    labels = _audit_rows(ws)
    # one block per check that has both sides
    blocks = [k for k in labels if k[:1].isdigit() and ". " in k]
    assert len(blocks) == len([c for c in res.crosschecks if c.sra_side is not None])
    # every subtotal / difference / tie-back is a formula, never a typed number
    for key, row in labels.items():
        if key.startswith(("   Σύνολο —", "Διαφορά Α", "Έλεγχος: Σύνολο")):
            assert str(ws.cell(row=row, column=2).value).startswith("=")


def test_audit_tab_ties_back_to_source_crosscheck():
    """The two tie-back cells per block prove the audit sheet and
    Source_crosscheck print the same figures — recomputed, not asserted."""
    data, _ = _build(with_optional=True)
    wb = load_workbook(io.BytesIO(data))
    ws = wb["Ανάλυση_ελέγχων"]
    ev = _Evaluator(wb)
    ties = [r for r in range(1, ws.max_row + 1)
            if str(ws.cell(row=r, column=1).value or "").startswith("Έλεγχος: Σύνολο")]
    assert ties, "no tie-back cells written"
    for r in ties:
        assert round(ev.evaluate(ws.cell(row=r, column=2).value,
                                 "Ανάλυση_ελέγχων"), 2) == 0.0


def test_audit_tab_breaks_out_the_sides_into_components():
    data, _ = _build(with_optional=True)
    wb = load_workbook(io.BytesIO(data))
    ws = wb["Ανάλυση_ελέγχων"]
    labels = _audit_rows(ws)
    # the claims row is broken out per DR SEGMENT
    assert "   DR SEGMENT: Inpatient" in labels
    assert "   DR SEGMENT: Outpatient Specialists" in labels
    # the IS Auditor row separates DRG fees from the Z-catalogue
    assert "   DRG / Fixed-fee αμοιβές" in labels
    # the GL fee row names the ledger centre against packages × unit price
    assert any(k.startswith("   Κέντρο κόστους 25501") for k in labels)
    assert any(k.startswith("   Συσκευασίες 8076 × 1,60 €") for k in labels)
    # SRA components are LIVE SUMIFS whose criteria reference helper cells
    for key, row in labels.items():
        if key.startswith("   SRA γραμμές") or key.startswith("   SRA OS"):
            f = str(ws.cell(row=row, column=2).value)
            assert f.startswith("=SUMIFS(") and '"' not in f
            assert ws.cell(row=row, column=4).value      # the code helper cell


def test_audit_tab_shows_an_unexplained_gap_instead_of_hiding_it():
    """A side whose itemisation doesn't add up gets an explicit
    «not itemised» row — the block still ties, and the gap is visible."""
    from recon.checks import CheckPart
    data, res = _build(with_optional=True)
    chk = next(c for c in res.crosschecks if c.parts_a)
    chk.parts_a = [CheckPart(label="μερική ανάλυση", amount=chk.source_total - 100.0)]
    wb = load_workbook(io.BytesIO(build_workbook(res)))
    ws = wb["Ανάλυση_ελέγχων"]
    row = next(r for r in range(1, ws.max_row + 1)
               if "μη αναλυμένα" in str(ws.cell(row=r, column=1).value or ""))
    assert ws.cell(row=row, column=2).value == 100.0
    assert verify_workbook(build_workbook(res)) == []


def test_audit_tab_breaks_out_the_pharmacy_stream_month():
    """On a PH-stream month the pharma block reads A = drugs + consumables,
    B = the SRA PH lines less the pharmacist-fee invoice."""
    from recon.extract import parse_sra_text
    import synth
    from test_checks import full_bundle
    b = full_bundle()
    b.sra = parse_sra_text(synth.sra_text_feb())
    res = run_reconciliation(b)
    wb = load_workbook(io.BytesIO(build_workbook(res)))
    ws = wb["Ανάλυση_ελέγχων"]
    labels = _audit_rows(ws)
    assert "   Φάρμακα (Drugs)" in labels and "   Αναλώσιμα (Consumables)" in labels
    assert "   SRA γραμμές PH (φαρμακείο)" in labels
    assert "   μείον τιμολόγιο αμοιβής φαρμακοποιού" in labels
    ev = _Evaluator(wb)
    row = labels["   SRA γραμμές PH (φαρμακείο)"]
    f = ws.cell(row=row, column=2).value
    assert f.startswith("=SUMIFS(")
    assert round(ev.evaluate(f, "Ανάλυση_ελέγχων"), 2) == 54_646.65


def test_tolerance_ok_check_is_not_claimed_to_be_zero():
    """A check that passes WITHIN a documented tolerance (IS Auditor per-row
    rounding) has a non-zero difference — it must stay visible, not be
    painted as a zero-check that gate 5 then fails on."""
    from test_checks import full_bundle
    b = full_bundle(with_optional=True)
    b.isaud.drg_fees = round(b.isaud.drg_fees + 2.61, 2)   # rounding drift
    b.isaud.inpatient_total = round(b.isaud.inpatient_total + 2.61, 2)
    res = run_reconciliation(b)
    chk = next(c for c in res.crosschecks if "IS Auditor" in c.name)
    assert chk.flag == "ok" and chk.diff == 2.61            # ok, but NOT zero
    data = build_workbook(res)
    assert verify_workbook(data) == []                      # gate 5 still passes
    wb = load_workbook(io.BytesIO(data))
    ws = wb["Ανάλυση_ελέγχων"]
    block = next(r for r in range(1, ws.max_row + 1)
                 if "IS Auditor" in str(ws.cell(row=r, column=1).value or "")
                 and str(ws.cell(row=r, column=1).value or "")[:1].isdigit())
    diff = next(r for r in range(block, block + 30)
                if str(ws.cell(row=r, column=1).value or "").startswith("Διαφορά"))
    cell = ws.cell(row=diff, column=2)
    assert not str(cell.fill.fgColor.rgb).endswith("FFFF00")
    assert round(_Evaluator(wb).evaluate(cell.value, "Ανάλυση_ελέγχων"), 2) == 2.61
