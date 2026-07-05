"""Acceptance tests against the REAL fixture months from the brief.

These run only when the confidential ΟΑΥ files are present under fixtures/
(they are not committed).  Expected directory layout:

    fixtures/F1049_2026-03/   — the reference month (workbook spec)
    fixtures/F1054_2026-05/   — cross-check mode month (no SRA)
    fixtures/F1054_2026-01/   — inpatient three-way tie month

Drop every ΟΑΥ file for the month into its folder (any filename — files are
identified by content).  A build that reproduces these three months to the
cent is done.
"""
from pathlib import Path

import pytest

from recon.build_xlsx import build_workbook, verify_workbook
from recon.checks import (ReconBundle, gate4_internal_asserts,
                          run_reconciliation, validate_batch)
from recon.extract import extract
from recon.identify import identify
from recon.models import Bucket, ReportType

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def _load_month(dirname: str):
    d = FIXTURES / dirname
    if not d.is_dir() or not any(d.iterdir()):
        pytest.skip(f"real fixtures not present: {d}")
    files = [identify(p.name, p.read_bytes()) for p in sorted(d.iterdir()) if p.is_file()]
    return files


def _bundle(files, crosscheck=False):
    gates, hospital, (year, month) = validate_batch(files, crosscheck_mode=crosscheck)
    assert all(g.passed for g in gates), [g.message for g in gates if not g.passed]
    b = ReconBundle(hospital_code=hospital, year=year, month=month)
    slot = {
        ReportType.SRA: "sra", ReportType.INPATIENT_SUMMARY: "inpatient",
        ReportType.CLAIMS_ALL: "claims", ReportType.PHARMA_CLAIMS: "pharma",
        ReportType.PHARMACIST_FEE: "phfee", ReportType.CAPITATION: "capitation",
        ReportType.QUALITY_CRITERIA: "quality", ReportType.HEMODIALYSIS: "hemo",
        ReportType.GL_EXTRACT: "gl", ReportType.IS_AUDITOR: "isaud",
        ReportType.XML_ACTIVITY: "xml_activity",
    }
    for f in files:
        setattr(b, slot[f.report_type],
                extract(f.report_type, f.data, hospital_code=hospital, raw_text=f.raw_text))
    return b


def test_f1049_mar_2026_reference_month():
    files = _load_month("F1049_2026-03")
    b = _bundle(files)
    assert all(g.passed for g in gate4_internal_asserts(b))
    assert b.sra.cheque_no == "259434"
    assert b.sra.stated_total == 1_936_528.19
    res = run_reconciliation(b)
    assert res.buckets[Bucket.INPATIENT] == 1_061_728.70
    assert res.buckets[Bucket.AE] == 131_284.66
    assert res.buckets[Bucket.OUTPATIENT] == 78_729.74
    assert res.buckets[Bucket.PHARMA] == 664_785.09
    assert b.phfee.packages == 8_076
    assert b.phfee.computed == 12_921.60
    data = build_workbook(res)
    assert verify_workbook(data) == []          # all zero-checks 0


def test_f1054_may_2026_crosscheck_mode():
    files = _load_month("F1054_2026-05")
    b = _bundle(files, crosscheck=True)
    assert b.inpatient.synolo == 9_754_514.71
    assert b.claims.by_segment["Inpatient"] == 9_754_514.71
    assert abs(b.isaud.inpatient_total - 9_754_514.71) <= 0.45
    assert b.isaud.drg_fees == 7_426_636.07
    assert b.isaud.z_catalogue == 2_327_878.64
    assert b.claims.by_segment["A&E"] == 263_988.21
    assert b.gl.ae == 263_988.21
    assert b.phfee.packages == 32_853
    assert b.phfee.computed == 52_564.80
    assert b.gl.pharmacist_fee == 23_655.52
    res = run_reconciliation(b, crosscheck_mode=True)
    fee_chk = next(c for c in res.crosschecks if "25501" in c.name)
    assert fee_chk.flag == "amber"              # flagged, never absorbed
    data = build_workbook(res)
    assert verify_workbook(data) == []


def test_f1054_jan_2026_three_way_tie():
    files = _load_month("F1054_2026-01")
    b = _bundle(files, crosscheck=True)
    assert b.inpatient.synolo == 13_162_508.96
    assert b.claims.by_segment["Inpatient"] == 13_162_508.96
    assert abs(b.isaud.inpatient_total - 13_162_508.96) <= 0.45
    assert b.phfee.packages == 35_319
    assert b.phfee.computed == 56_510.40
    assert b.gl.pharmacist_fee == 24_229.17
    res = run_reconciliation(b, crosscheck_mode=True)
    fee_chk = next(c for c in res.crosschecks if "25501" in c.name)
    assert fee_chk.flag == "amber"
