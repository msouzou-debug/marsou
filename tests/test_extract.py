import pytest

from recon.extract import (ExtractionError, classify_sra_line,
                           extract_claims_all, extract_gl,
                           extract_inpatient_summary, extract_is_auditor,
                           extract_pharma_claims, extract_xml_activity,
                           parse_pharmacist_fee_text, parse_sra_text)
from recon.models import Bucket

import synth


def test_inpatient_summary_categories_and_total():
    s = extract_inpatient_summary(synth.inpatient_summary_xlsx())
    assert s.kanonika == 475_000.00
    assert s.kanonika_parap == 61_728.70    # «Κανονικά με παραπεμπτικό από ΤΑΕΠ»
    assert s.gennes == 25_000.00            # Γέννες — real months have it
    assert s.regular == 536_728.70          # Κανονικά + με παραπεμπτικό
    assert s.specialized == 400_000.00      # Εξειδικευμένα + με παραπεμπτικό
    assert s.z_catalogue == 100_000.00      # «Κατάλογος Ζ» (Greek zeta)
    assert s.synolo == 1_061_728.70


def test_inpatient_summary_per_clinic_sheet():
    s = extract_inpatient_summary(synth.inpatient_summary_xlsx())
    assert len(s.by_clinic) == 3            # Grand Total row excluded
    assert round(sum(r.total for r in s.by_clinic), 2) == 1_061_728.70
    top = s.by_clinic[0]
    assert top.clinic == "GENERAL SURGERY"
    assert top.fixed_fee == 150_000.00 and top.drg == 250_000.00


def test_inpatient_summary_total_assert_fires():
    bad = synth.inpatient_summary_xlsx(synolo=999_999.99)
    with pytest.raises(ExtractionError):
        extract_inpatient_summary(bad)


def test_claims_all_by_segment():
    # real file: dotted headers (HIO REIMB.), ISO dates from older months,
    # no clinic/specialty columns, no F-code
    c = extract_claims_all(synth.claims_all_xlsx())
    assert c.by_segment["Inpatient"] == 1_061_728.70
    assert c.by_segment["A&E"] == 131_284.66
    assert c.by_segment["Outpatient Specialists"] == 40_000.00
    assert c.by_segment["Nurses-Midwives"] == 20_000.00
    assert c.by_segment["Allied Health"] == 5_000.00
    assert c.total == 1_258_013.36
    assert c.inpatient_by_clinic == []      # detail comes from the Ενδ. workbook


def test_segment_value_variants_all_canonicalise():
    # real files vary the DR SEGMENT labels — codes, long names, Greek
    from recon.extract import _canon_segment
    for raw, want in [
        ("Inpatient", "Inpatient"), ("IS", "Inpatient"), ("IP", "Inpatient"),
        ("INPATIENT SERVICES", "Inpatient"), ("Ενδονοσοκομειακή", "Inpatient"),
        ("OS", "Outpatient Specialists"),
        ("Outpatient Specialist Doctors", "Outpatient Specialists"),
        ("Ειδικοί Ιατροί", "Outpatient Specialists"),
        ("AE", "A&E"), ("A&E", "A&E"), ("Accident and Emergency", "A&E"),
        ("NM", "Nurses-Midwives"), ("Nurses / Midwives", "Nurses-Midwives"),
        ("AP", "Allied Health"), ("AHP", "Allied Health"),
        ("Allied Healthcare Professionals", "Allied Health"),
    ]:
        assert _canon_segment(raw) == want, raw


def test_claims_with_code_segments_extract():
    import io
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["CLAIM ID", "PAYMENT NO.", "HIO REIMB.", "DR SEGMENT"])
    ws.append([1, "256797", 100.0, "IS"])
    ws.append([2, "256797", 50.0, "AE"])
    ws.append([3, "256797", 25.0, "OS"])
    buf = io.BytesIO()
    wb.save(buf)
    c = extract_claims_all(buf.getvalue())
    assert c.by_segment["Inpatient"] == 100.0
    assert c.by_segment["A&E"] == 50.0
    assert c.by_segment["Outpatient Specialists"] == 25.0


def test_pharma_claims_by_type():
    p = extract_pharma_claims(synth.pharma_claims_xlsx())
    assert p.by_type["Drugs"] == 600_000.00
    assert p.by_type["Consumables"] == 51_863.49
    assert p.total == 651_863.49


def test_pharmacist_fee_packages_times_160():
    fee = parse_pharmacist_fee_text(synth.pharmacist_fee_text(packages=8076))
    assert fee.packages == 8076
    assert fee.unit_price == 1.60
    assert fee.amount == 12_921.60
    assert fee.computed == 12_921.60


def test_pharmacist_fee_reads_unit_price_from_document():
    # the Feb-2026 real report: 1.62 € × 7422 = 12,023.64 — the unit price
    # changed and must be read from the file, never assumed
    fee = parse_pharmacist_fee_text(synth.pharmacist_fee_text(packages=7422, unit=1.62))
    assert fee.packages == 7422
    assert fee.unit_price == 1.62
    assert fee.amount == 12_023.64
    assert fee.computed == 12_023.64


def test_sra_feb_format_ph_stream_adjustment_and_credit():
    # Feb-style SRA: PH pharmacy stream, ADJ-MRI/CT line, trailing-minus
    # credit, KPI line, and a wrapped-row fragment («se 12.25») that must
    # be SKIPPED (it double-counts a spilled amount)
    sra = parse_sra_text(synth.sra_text_feb())
    assert sra.cheque_no == "256797"
    assert sra.stated_total == 918_116.69
    assert sra.lines_total == 918_116.69          # ties: fragment skipped
    assert not any(l.description.startswith("se") for l in sra.lines)
    sums = {}
    for l in sra.lines:
        sums[l.code] = round(sums.get(l.code, 0) + l.amount, 2)
    assert sums["PH"] == 42_623.01                # pharmacy via HCP channel
    assert sums["MRI"] == 501.03                  # ADJ-MRI/CT QC → quality/Outpatient
    assert sums["PD-KPI"] == 151.80               # KPIs-02-2026 line
    assert sums["AE"] == round(24_327.00 - 12.25, 2)  # credit note negative
    assert (sra.year, sra.month) == (2026, 2)     # Payment Date 13/03 − 1
    ph_line = next(l for l in sra.lines if l.code == "PH")
    assert ph_line.bucket == Bucket.PHARMA
    credit = next(l for l in sra.lines if l.amount < 0)
    assert credit.amount == -12.25


def test_quality_criteria_xlsx_recognised_and_extracted():
    from recon.extract import extract_simple_report
    from recon.identify import identify
    from recon.models import ReportType

    data = synth.quality_criteria_xlsx(total=652.83)
    f = identify("Ποιοτικά Κριτήρια.xlsx", data)
    assert f.report_type == ReportType.QUALITY_CRITERIA   # SINGULAR «CRITERION»
    rep = extract_simple_report(data)
    assert rep.total == 652.83                            # '€ 652.83' text cell
    # the real upload was an EMPTY report — must still be accepted
    f0 = identify("q.xlsx", synth.quality_criteria_xlsx(total=0.0))
    assert f0.report_type == ReportType.QUALITY_CRITERIA
    assert extract_simple_report(synth.quality_criteria_xlsx(total=0.0)).total == 0.0


def test_capitation_bundled_in_pd_lines_is_amber_not_red():
    from recon.checks import ReconBundle, run_reconciliation
    from recon.extract import extract_simple_report

    b = ReconBundle(hospital_code="F1049", year=2026, month=2)
    b.sra = parse_sra_text(synth.sra_text_feb())   # has PD-KPI but no PD-CAP
    b.capitation = extract_simple_report(b"", raw_text=synth.capitation_text(total=4_752.24))
    res = run_reconciliation(b)
    cap = next(c for c in res.crosschecks if "Capitation" in c.name)
    assert "PD" in cap.name and cap.flag in ("ok", "amber")
    assert cap.flag != "red"


def test_sra_parse_invoice_level_lines():
    # real SRA: invoice-level lines «date inv-no desc total EUR paid»
    sra = parse_sra_text(synth.sra_text())
    assert sra.cheque_no == "259434"
    assert sra.stated_total == 1_936_528.19
    assert len(sra.lines) == 11
    assert sra.lines_total == 1_936_528.19
    assert sra.hospital_code == "F1049"            # from PAR-F1049
    assert (sra.year, sra.month) == (2026, 3)      # Payment Date 20/04 − 1
    sums = {}
    for l in sra.lines:
        sums[l.code] = round(sums.get(l.code, 0) + l.amount, 2)
    assert sums["IS"] == 1_061_728.70              # two IS invoices
    assert sums["AE"] == 131_284.66
    assert sums["PD-CAP"] == 13_729.74             # PD - CAPITATION
    assert sums["PHF"] == 12_921.60
    buckets = {}
    for l in sra.lines:
        buckets[l.bucket] = round(buckets.get(l.bucket, 0) + l.amount, 2)
    assert buckets[Bucket.INPATIENT] == 1_061_728.70
    assert buckets[Bucket.AE] == 131_284.66
    assert buckets[Bucket.OUTPATIENT] == 78_729.74
    assert buckets[Bucket.PHARMA] == 664_785.09
    assert not any(l.channel == "Unmapped" for l in sra.lines)


def test_classify_sra_line_keywords_without_codes():
    assert classify_sra_line("", "Ενδονοσοκομειακή Περίθαλψη")[1] == Bucket.INPATIENT
    assert classify_sra_line("", "Αμοιβή Φαρμακοποιού")[0] == "PHF"
    assert classify_sra_line("", "Ατυχήματα και Επείγοντα")[1] == Bucket.AE
    code, bucket, channel, _ = classify_sra_line("", "κάτι εντελώς άγνωστο")
    assert channel == "Unmapped"


def test_gl_cost_centre_map_filters_vendor():
    gl = extract_gl(synth.gl_xlsx(), "F1049")
    assert gl.regular_drg == 561_728.70
    assert gl.specialized == 400_000.00
    assert gl.z_catalogue == 100_000.00     # 26003 + 26007
    assert gl.inpatient == 1_061_728.70
    assert gl.ae == 131_284.66
    assert gl.outpatient == 65_000.00
    assert gl.pharmacist_fee == 24_000.00   # the known flat booking
    assert gl.pharma_other == 651_863.49
    assert gl.capitation == 13_729.74       # account 51001001
    # F1054's 9,999,999.99 row must not leak in
    assert gl.other == 0.0


def test_is_auditor_drg_flag_and_z():
    a = extract_is_auditor(synth.is_auditor_xlsx(), "F1049")
    assert a.drg_fees == 900_000.00                  # DRG rows only
    assert a.z_catalogue == 161_728.70               # ALL procedures amounts
    assert a.inpatient_total == 1_061_728.70
    assert a.normal == 500_000.00
    assert a.specialised == 400_000.00


def test_xml_activity_total():
    x = extract_xml_activity(synth.xml_activity_bytes())
    assert x.total == 65_000.00
    assert x.n_claims == 3
