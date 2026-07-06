from recon.checks import (ReconBundle, conditional_requirements,
                          gate4_internal_asserts, run_reconciliation,
                          validate_batch)
from recon.extract import (extract_claims_all, extract_gl,
                           extract_inpatient_summary, extract_is_auditor,
                           extract_pharma_claims, extract_simple_report,
                           extract_xml_activity, parse_pharmacist_fee_text,
                           parse_sra_text)
from recon.identify import identify
from recon.models import Bucket, IdentifiedFile, ReportType

import synth


def _identified_batch():
    files = [
        identify("endo.xlsx", synth.inpatient_summary_xlsx()),
        identify("claims_OS.xlsx", synth.claims_all_xlsx()),
        identify("pharma.xlsx", synth.pharma_claims_xlsx()),
    ]
    sra = IdentifiedFile("sra.pdf", b"", report_type=ReportType.SRA,
                         hospital_code="F1049", year=2026, month=3)
    fee = IdentifiedFile("fee.pdf", b"", report_type=ReportType.PHARMACIST_FEE,
                         hospital_code="F1049", year=2026, month=3)
    return files + [sra, fee]


def full_bundle(with_optional=False):
    b = ReconBundle(hospital_code="F1049", year=2026, month=3)
    b.sra = parse_sra_text(synth.sra_text())
    b.inpatient = extract_inpatient_summary(synth.inpatient_summary_xlsx())
    b.claims = extract_claims_all(synth.claims_all_xlsx())
    b.pharma = extract_pharma_claims(synth.pharma_claims_xlsx())
    b.phfee = parse_pharmacist_fee_text(synth.pharmacist_fee_text())
    b.capitation = extract_simple_report(b"", raw_text=synth.capitation_text())
    if with_optional:
        b.gl = extract_gl(synth.gl_xlsx(), "F1049")
        b.isaud = extract_is_auditor(synth.is_auditor_xlsx(), "F1049")
        b.xml_activity = extract_xml_activity(synth.xml_activity_bytes())
    return b


def test_gates_pass_on_complete_batch():
    gates, hospital, period, notes = validate_batch(_identified_batch())
    assert all(g.passed for g in gates)
    assert hospital == "F1049"
    assert period == (2026, 3)


def test_gate2_rejects_mixed_hospitals():
    files = _identified_batch()
    files[3].hospital_code = "F1054"
    gates, _, _, _ = validate_batch(files)
    assert any(not g.passed and g.number == 2 for g in gates)
    assert "δύο νοσοκομεία" in [g for g in gates if not g.passed][0].message


def test_gate2_rejects_mixed_months():
    files = _identified_batch()
    files[0].month = 4          # a CLAIM report from another month — mixed batch
    gates, _, _, _ = validate_batch(files)
    assert any(not g.passed and g.number == 2 for g in gates)


def test_gate2_sra_month_match_gets_arrears_note():
    # the SRA's stored month is already the derived service month (document
    # date − 1); when it matches the claim reports an informational note
    # explains the arrears dating
    files = _identified_batch()   # SRA month = 3, same as the claim reports
    gates, hospital, period, notes = validate_batch(files)
    assert all(g.passed for g in gates)
    assert period == (2026, 3)
    assert notes and "καθυστέρηση" in notes[0] and "04/2026" in notes[0]


def test_gate2_wrong_month_sra_warns_but_never_blocks():
    # a wrong month's SRA won't tie out — the reconciliation shows the break,
    # so the date mismatch is a warning, not a hard stop
    files = _identified_batch()
    files[3].month = 5          # SRA seems to settle May, reports are March
    gates, _, period, notes = validate_batch(files)
    assert all(g.passed for g in gates)
    assert period == (2026, 3)  # the claim reports' month wins
    warning = next(n for n in notes if n.startswith("Προσοχή"))
    assert "05/2026" in warning and "03/2026" in warning


def test_gate2_sra_only_period_used_when_reports_have_none():
    files = _identified_batch()
    for f in files:
        if f.report_type != ReportType.SRA:
            f.year, f.month = None, None
    gates, _, period, notes = validate_batch(files)
    assert all(g.passed for g in gates)
    assert period == (2026, 3)
    assert notes


def test_gate3_missing_reports():
    files = _identified_batch()[:3]   # no SRA, no pharmacist fee
    gates, _, _, _ = validate_batch(files)
    failed = [g for g in gates if not g.passed]
    assert failed and failed[0].number == 3
    assert "SRA" in failed[0].message


def test_gate3_crosscheck_mode_waives_sra_only():
    files = [f for f in _identified_batch() if f.report_type != ReportType.SRA]
    gates, _, _, _ = validate_batch(files, crosscheck_mode=True)
    assert all(g.passed for g in gates)


def test_gate1_duplicate_type_rejected():
    files = _identified_batch()
    files.append(identify("endo2.xlsx", synth.inpatient_summary_xlsx()))
    gates, _, _, _ = validate_batch(files)
    assert not gates[-1].passed and gates[-1].number == 1


def test_conditional_requirements_from_sra_lines():
    sra = parse_sra_text(synth.sra_text())
    assert conditional_requirements(sra) == [ReportType.CAPITATION]


def test_gate4_ties():
    assert all(g.passed for g in gate4_internal_asserts(full_bundle()))


def test_gate4_catches_claims_vs_endo_break():
    b = full_bundle()
    b.inpatient.synolo = 1_000_000.00
    g = gate4_internal_asserts(b)[0]
    assert not g.passed and "Ενδ" in g.message


def test_buckets_match_brief_f1049():
    res = run_reconciliation(full_bundle())
    assert res.buckets[Bucket.INPATIENT] == 1_061_728.70
    assert res.buckets[Bucket.AE] == 131_284.66
    assert res.buckets[Bucket.OUTPATIENT] == 78_729.74
    assert res.buckets[Bucket.PHARMA] == 664_785.09
    assert res.cheque_total == 1_936_528.19
    assert round(sum(res.buckets.values()), 2) == res.cheque_total


def test_crosschecks_tie_and_annotate_known_variances():
    res = run_reconciliation(full_bundle(with_optional=True))
    by_name = {c.name: c for c in res.crosschecks}
    endo = by_name["Ενδ. Πληρωμένες Απαιτήσεις (inpatient claims file) = SRA IS"]
    assert endo.diff == 0.0 and endo.flag == "ok"
    fee_gl = next(c for c in res.crosschecks if "25501" in c.name)
    assert fee_gl.flag == "amber"                    # known booking issue
    assert "booking" in fee_gl.note
    assert abs(fee_gl.diff - (24_000.00 - 12_921.60)) < 0.01
    isaud = next(c for c in res.crosschecks if "IS Auditor" in c.name)
    assert isaud.diff == 0.0


def test_split_grand_total_equals_cheque():
    res = run_reconciliation(full_bundle())
    grand = round(sum(s.subtotal for s in res.split), 2)
    assert grand == 1_936_528.19


def test_crosscheck_mode_report_vs_report_flags():
    # without an SRA, checks compare report-vs-report so known variances
    # (pharmacist fee flat GL booking) still get flagged — per the F1054 months
    b = full_bundle(with_optional=True)
    b.sra = None
    res = run_reconciliation(b, crosscheck_mode=True)
    fee_gl = next(c for c in res.crosschecks if "25501" in c.name)
    assert fee_gl.sra_side == 12_921.60      # vs the fee report, not the SRA
    assert fee_gl.flag == "amber"
    endo = next(c for c in res.crosschecks if c.name.startswith("Ενδ."))
    assert endo.sra_side == 1_061_728.70     # vs claims-all Inpatient
    assert endo.flag == "ok"
    isaud = next(c for c in res.crosschecks if "IS Auditor" in c.name)
    assert isaud.diff == 0.0


def test_crosscheck_mode_matrix():
    b = full_bundle(with_optional=True)
    b.sra = None
    res = run_reconciliation(b, crosscheck_mode=True)
    assert res.matrix, "matrix should have rows"
    ip = next(r for r in res.matrix if "Inpatient" in r["stream"])
    values = [v for v in ip["values"].values() if v is not None]
    assert len(values) >= 3            # Ενδ, claims, GL, IS auditor
    assert ip["range"] == 0.0          # three-way tie
    fee = next(r for r in res.matrix if "Φαρμακοποιού" in r["stream"])
    assert fee["range"] == round(24_000.00 - 12_921.60, 2)
