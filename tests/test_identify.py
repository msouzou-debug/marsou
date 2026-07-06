from recon.identify import (find_hospital, find_period, find_service_period,
                            identify, identify_pdf_text, sniff_format)
from recon.models import ReportType

import synth


def test_sniff_format():
    assert sniff_format(b"%PDF-1.7 ...") == "pdf"
    assert sniff_format(synth.inpatient_summary_xlsx()) == "xlsx"
    assert sniff_format(synth.xml_activity_bytes()) == "xml"
    assert sniff_format(b"\xef\xbb\xbf<root/>") == "xml"
    assert sniff_format(b"garbage") == "unknown"


def test_find_period():
    assert find_period("Περίοδος: ΜΑΡΤΙΟΣ 2026") == (2026, 3)
    assert find_period("Μάρτιος 2026") == (2026, 3)
    assert find_period("03/2026") == (2026, 3)
    assert find_period("15/03/2026") == (2026, 3)
    assert find_period("2026-05") == (2026, 5)
    assert find_period("no period here") == (None, None)


def test_find_service_period_is_document_date_minus_one_month():
    # the SRA is ALWAYS dated one month after the month it settles
    text = "ΚΑΤΑΣΤΑΣΗ ΠΛΗΡΩΜΗΣ\nΗμερομηνία Πληρωμής: 15/04/2026\nΑρ. Επιταγής: 259434"
    assert find_service_period(text) == (2026, 3)
    # Greek month name on the document works too
    assert find_service_period("ΚΑΤΑΣΤΑΣΗ ΠΛΗΡΩΜΗΣ ΑΠΡΙΛΙΟΣ 2026") == (2026, 3)
    # year rollover: January SRA settles December services
    assert find_service_period("Ημερομηνία: 05/01/2026") == (2025, 12)
    assert find_service_period("no dates here") == (None, None)


def test_synthetic_sra_identifies_service_month_not_payment_month():
    import synth
    assert identify_pdf_text(synth.sra_text()) is not None
    assert find_service_period(synth.sra_text()) == (2026, 3)  # dated April → March


def test_find_hospital_full_name_not_leukosia_substring():
    # «ΛΕΥΚΩΣΙΑΣ» alone must not resolve — only full name or F-code
    assert find_hospital("ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ") == "F1054"
    assert find_hospital("ΜΑΚΑΡΕΙΟ ΝΟΣΟΚΟΜΕΙΟ") == "F1050"
    assert find_hospital("κάτι ΛΕΥΚΩΣΙΑΣ κάτι") is None
    assert find_hospital("Παροχέας F1049") == "F1049"
    assert find_hospital("ΓΝ ΑΜΜΟΧΩΣΤΟΥ") == "F1049"


def test_identify_inpatient_summary():
    f = identify("whatever.xlsx", synth.inpatient_summary_xlsx())
    assert f.report_type == ReportType.INPATIENT_SUMMARY
    assert f.hospital_code == "F1049"
    assert (f.year, f.month) == (2026, 3)
    assert f.error is None


def test_identify_claims_all_despite_os_filename():
    # ΟΑΥ often names the all-segments file "..._OS_..." — content wins
    f = identify("F1049_OS_MAR26.xlsx", synth.claims_all_xlsx())
    assert f.report_type == ReportType.CLAIMS_ALL
    assert f.hospital_code == "F1049"
    assert (f.year, f.month) == (2026, 3)


def test_identify_pharma_claims():
    f = identify("pharma.xlsx", synth.pharma_claims_xlsx())
    assert f.report_type == ReportType.PHARMA_CLAIMS
    assert f.hospital_code == "F1049"


def test_identify_gl_is_org_wide():
    f = identify("gl.xlsx", synth.gl_xlsx())
    assert f.report_type == ReportType.GL_EXTRACT
    assert (f.year, f.month) == (2026, 3)   # from sheet name 'ALL OKYPY 03.26'


def test_identify_is_auditor():
    f = identify("aud.xlsx", synth.is_auditor_xlsx())
    assert f.report_type == ReportType.IS_AUDITOR


def test_identify_xml_activity():
    f = identify("act.xml", synth.xml_activity_bytes())
    assert f.report_type == ReportType.XML_ACTIVITY
    assert f.hospital_code == "F1049"
    assert (f.year, f.month) == (2026, 3)


def test_identify_pdf_text_sra_and_phfee():
    assert identify_pdf_text(synth.sra_text()) == ReportType.SRA
    assert identify_pdf_text(synth.pharmacist_fee_text()) == ReportType.PHARMACIST_FEE
    assert identify_pdf_text(synth.capitation_text()) == ReportType.CAPITATION
    assert identify_pdf_text("τυχαίο κείμενο") is None


def test_identify_unknown_bytes():
    f = identify("x.bin", b"not a known format at all")
    assert f.error is not None


def test_underscored_headers_still_identify_and_extract():
    # real ΟΑΥ exports often use DR_SEGMENT / HIO_REIMB style headers
    import io
    from openpyxl import Workbook
    from recon.extract import extract_claims_all

    wb = Workbook()
    ws = wb.active
    ws.append(["CLAIM_ID", "PROVIDER_ID", "DR_SEGMENT", "HIO_REIMB", "PAYMENT_DATE"])
    ws.append(["C1", "F1049", "Inpatient", 100.0, "15/03/2026"])
    ws.append(["C2", "F1049", "A&E", 50.0, "15/03/2026"])
    buf = io.BytesIO()
    wb.save(buf)
    f = identify("claims.xlsx", buf.getvalue())
    assert f.report_type == ReportType.CLAIMS_ALL
    assert f.hospital_code == "F1049"
    c = extract_claims_all(buf.getvalue())
    assert c.by_segment["Inpatient"] == 100.0
    assert c.by_segment["A&E"] == 50.0


def test_probe_captured_for_diagnostics():
    f = identify("endo.xlsx", synth.inpatient_summary_xlsx())
    assert f.probe and "ΣΥΝΟΠΤΙΚΟΣ" in f.probe
    f2 = identify("act.xml", synth.xml_activity_bytes())
    assert f2.probe and "XML root" in f2.probe
