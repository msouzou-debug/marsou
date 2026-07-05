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
    assert s.kanonika == 500_000.00
    assert s.kanonika_parap == 61_728.70
    assert s.regular == 561_728.70          # Κανονικά + με παραπεμπτικό
    assert s.specialized == 400_000.00      # Εξειδικευμένα + με παραπεμπτικό
    assert s.z_catalogue == 100_000.00
    assert s.synolo == 1_061_728.70


def test_inpatient_summary_total_assert_fires():
    bad = synth.inpatient_summary_xlsx(synolo=999_999.99)
    with pytest.raises(ExtractionError):
        extract_inpatient_summary(bad)


def test_claims_all_by_segment_and_clinic_detail():
    c = extract_claims_all(synth.claims_all_xlsx())
    assert c.by_segment["Inpatient"] == 1_061_728.70
    assert c.by_segment["A&E"] == 131_284.66
    assert c.by_segment["Outpatient Specialists"] == 40_000.00
    assert c.by_segment["Nurses-Midwives"] == 20_000.00
    assert c.by_segment["Allied Health"] == 5_000.00
    assert c.total == 1_258_013.36
    clinics = {r.clinic: r for r in c.inpatient_by_clinic}
    row = clinics["Παθολογική (Internal Medicine)"]
    assert row.total == 450_000.00
    assert row.fixed_fee == 300_000.00
    assert row.drg == 150_000.00
    assert c.os_by_specialty["Καρδιολογία (Cardiology)"] == 25_000.00


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


def test_sra_parse_lines_cheque_and_total():
    sra = parse_sra_text(synth.sra_text())
    assert sra.cheque_no == "259434"
    assert sra.stated_total == 1_936_528.19
    assert sra.lines_total == 1_936_528.19
    assert sra.hospital_code == "F1049"
    assert (sra.year, sra.month) == (2026, 3)
    by_code = {l.code: l for l in sra.lines}
    assert by_code["IS"].amount == 1_061_728.70
    assert by_code["IS"].bucket == Bucket.INPATIENT
    assert by_code["AE"].bucket == Bucket.AE
    assert by_code["PD-CAP"].amount == 13_729.74   # PD + κατά κεφαλήν → capitation
    assert by_code["PHF"].bucket == Bucket.PHARMA


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
