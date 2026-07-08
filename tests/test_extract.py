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
    # Feb-style SRA: PH pharmacy stream incl. the fee invoice, CRN-Packages
    # (→ PHF), hemodialysis adjustment (→ HEMO, its own code so the IS check
    # ties), ADJ-MRI/CT line, trailing-minus credit, KPI line, and a
    # wrapped-row fragment («se 12.25») that must be SKIPPED
    sra = parse_sra_text(synth.sra_text_feb())
    assert sra.cheque_no == "256797"
    assert sra.stated_total == 929_012.04
    assert sra.lines_total == 929_012.04          # ties: fragment skipped
    assert not any(l.description.startswith("se") for l in sra.lines)
    sums = {}
    for l in sra.lines:
        sums[l.code] = round(sums.get(l.code, 0) + l.amount, 2)
    assert sums["IS"] == 840_526.10               # hemo NOT counted as IS
    assert sums["HEMO"] == 5_260.00               # «ADJ- IS - ... Hemodialysis»
    assert sums["PH"] == round(42_623.01 + 12_023.64, 2)  # incl. fee invoice
    assert sums["PHF"] == -6_388.29               # CRN-Packages corrections
    assert sums["MRI"] == 501.03
    assert sums["PD-KPI"] == 151.80
    assert sums["AE"] == 24_327.00                # daily AE lines only
    assert sums["AE-ADJ"] == -12.25               # credit note split apart
    assert (sra.year, sra.month) == (2026, 2)
    hemo = next(l for l in sra.lines if l.code == "HEMO")
    assert hemo.bucket == Bucket.INPATIENT        # default; editable per patient


def test_classify_splits_adjustments_from_daily_lines():
    # real Apr-2026 (F1048) SRA lines: credit notes / corrections must leave
    # the daily PH/AE codes so «PH = claims + fee» and «AE = GL 25801» tie
    from recon.extract import classify_sra_line

    cases = {
        "PH - HCP SERVICES": "PH",                              # daily line stays
        "AE - HCP SERVICES": "AE",
        "CRN-Drugs- PH - DEDUCTIONS-Drugs-Phase2-": "PH-ADJ",
        "OTC-CORR-VAT- PH-OTC-CORR-VAT-04-2026": "PH-ADJ",
        "CRN-Drugs- CRN-Drugs-Phase1-COST&VAT": "PH-ADJ",       # PHD token
        "ADJ- Adjustment PharmacyLine - Feb26": "PH-ADJ",
        "ISSUANCES ISSUANCES 11.24-10.25": "PH-ADJ",
        # GL books the referral deduction against inpatient income (26xxx)
        "ADJ-AE Referral IS - Adjustment for referrals": "IS-ADJ",
        "MANUAL ADJ AE - overpayment": "AE-ADJ",
        "CRN-Packages PH - CORRECTION-Packages": "PHF",         # fee corrections
        "ADJ- IS - Adjustment for Hemodialysis": "HEMO",
        "ADJ-New Reimb OS - Adj. based on new reimb. method-": "OS",
        "ADJ-MRI/CT QC- CTs Quality Criteria": "MRI",
        # May-2026 (F1048) new line types
        "ADJ-DRG- IS - Year End Adj. for DRG points - JAN_DEC25": "IS-PRIOR",
        "Innovativeantibio Innovativeantibiotic01-Apr2023to30-Sept2025": "PH-PRIOR",
        "HPV-HBVaxPro- HPV-HBVaxPro-JAN-MAR": "PD-FP",
        "COR.-REV-ADJ- COR.-REV-ADJ-New Reimb Met D5920": "OS",
        "PD-INFLUENZA- PD-INFLUENZA-F1048-MAY": "PD-FP",
        "PD - OOH SERVICES": "PD-FP",
        "Out of hours-APR. PD-Out of hours-": "PD-FP",
        "PD - HCP SERVICES": "PD",                       # daily line stays
        "CRN-Drugs-Z- PH - DED.-Drugs-Z-CAT": "PH-ADJ",
    }
    for desc, want in cases.items():
        code, bucket, channel, _ = classify_sra_line("", desc)
        assert code == want, f"{desc!r} → {code}, want {want}"
    assert classify_sra_line("", "CRN-Drugs- PH - DEDUCTIONS")[1] == Bucket.PHARMA
    assert classify_sra_line("", "ADJ-AE Referral IS - Adj. for referrals")[1] == Bucket.INPATIENT
    assert classify_sra_line("", "MANUAL ADJ AE - overpayment")[1] == Bucket.AE


def test_sra_cents_only_amount_and_settlement_cheques():
    # real May-2026 lines: «.26» amounts print WITHOUT an integer part, and
    # single-line settlement cheques must classify as prior-period codes
    text = """ΚΑΤΑΣΤΑΣΗ ΠΛΗΡΩΜΗΣ
REMITTANCE ADVICE
STATE HEALTH SERVICES ORGANIZATION INCOME-LARN-F1085 Payment Date: 12/06/2026
Payment/Cheque No: 266455
Total paid in this batch: 145.31
31/05/2026 ADJ-New Reimb OS - Adj. based on new reimb. method- 60.92 EUR 60.92
31/05/2026 ADJ-New Reimb OS - Adj. based on new reimb. method- .26 EUR .26
31/05/2026 ADJ-New Reimb OS - Adj. based on new reimb. method- 84.13 EUR 84.13
"""
    sra = parse_sra_text(text)
    assert sra.lines_total == 145.31 == sra.stated_total
    assert all(l.code == "OS" for l in sra.lines)
    from recon.extract import merge_sras
    a = parse_sra_text(synth.sra_text())          # cheque 259434, March
    b = parse_sra_text(synth.sra_text_second())   # cheque 900001
    m = merge_sras([a, b])
    assert m.cheque_no == "259434+900001"
    assert m.stated_total == round(1_936_528.19 + 1_000.00, 2)
    assert m.lines_total == m.stated_total
    assert len(m.parts) == 2
    assert all("[επ." in l.description for l in m.lines)
    # single SRA passes through untouched, with parts filled
    single = merge_sras([parse_sra_text(synth.sra_text())])
    assert single.cheque_no == "259434" and len(single.parts) == 1


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


def test_xml_claims_export_groups_by_payment_number():
    # real Apr-2026 shape: <Claim> wrapper with ClaimPaymentNumber — the
    # PAYMENT NO. gate needs per-cheque sums
    x = extract_xml_activity(synth.xml_claims_export_bytes())
    assert x.total == 758.64
    assert x.n_claims == 4
    assert x.by_payment == {"263000": 120.75, "263367": 137.89, "990001": 500.00}


def test_gl_prefers_all_okypy_sheet_over_detail_sheets():
    # the real Apr-2026 GL workbook puts an A&E-only clinic detail sheet
    # FIRST — reading it instead of «ALL OKYPY MM.YY» zeroes every other
    # bucket (the F1048 all-zero-GL bug)
    gl = extract_gl(synth.gl_xlsx(), "F1049")
    assert gl.regular_drg == 561_728.70              # only on the ALL sheet
    assert gl.inpatient == 1_061_728.70
    assert gl.ae == 131_284.66
