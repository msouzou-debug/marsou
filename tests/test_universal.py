"""Universality: the same pipeline must run for ALL EIGHT hospitals.

Every rule in the app was validated on real months of one or two hospitals
(F1049 Mar-2026, F1048 Apr/May-2026, F1054 Jan/May-2026).  Nothing in the
extraction, cross-check or workbook layer may be tied to a particular
F-code: these tests drive the full chain — identify → gates → extract →
reconcile → build → gate-5 verify — once per hospital, and additionally for
the shapes that only some hospitals have (no A&E at Makarios, no capitation
at Nicosia/Kyperounta).
"""
import pytest

from recon.build_xlsx import build_workbook, verify_workbook
from recon.checks import (ReconBundle, gate4_internal_asserts,
                          run_reconciliation, validate_batch)
from recon.extract import (extract_claims_all, extract_gl,
                           extract_inpatient_summary, extract_is_auditor,
                           extract_pharma_claims, extract_simple_report,
                           extract_xml_activity, merge_sras,
                           parse_pharmacist_fee_text, parse_sra_text)
from recon.identify import identify
from recon.models import HOSPITALS, IdentifiedFile, ReportType

import synth

CODES = list(HOSPITALS)


def _pdf_file(report_type, hospital, text):
    """PDFs are identified from their text layer; the synth helpers give us
    the text directly, so build the IdentifiedFile the same way _identify_pdf
    would (report type + hospital/period read from the text)."""
    from recon.identify import (find_hospital, find_period, find_service_period,
                                identify_pdf_text)
    assert identify_pdf_text(text) == report_type
    year, month = (find_service_period(text) if report_type == ReportType.SRA
                   else find_period(text))
    f = IdentifiedFile(f"{report_type.name.lower()}.pdf", b"",
                       report_type=report_type,
                       hospital_code=find_hospital(text) or hospital,
                       year=year, month=month)
    f.raw_text = text
    return f


def _batch(hospital, with_optional=True):
    """A complete synthetic month for `hospital`, every file identified by
    content exactly as the app does it."""
    files = [
        identify("endo.xlsx", synth.inpatient_summary_xlsx(
            hospital=hospital, hospital_name=synth.provider_long_name(hospital))),
        identify("claims_OS.xlsx", synth.claims_all_xlsx()),
        identify("pharma.xlsx", synth.pharma_claims_xlsx()),
        _pdf_file(ReportType.SRA, hospital, synth.sra_text(hospital=hospital)),
        _pdf_file(ReportType.PHARMACIST_FEE, hospital,
                  synth.pharmacist_fee_text(hospital=hospital)),
        _pdf_file(ReportType.CAPITATION, hospital,
                  synth.capitation_text(hospital=hospital)),
    ]
    if with_optional:
        files += [
            identify("gl.xlsx", synth.gl_xlsx(hospital=hospital)),
            identify("isaud.xlsx", synth.is_auditor_xlsx(hospital=hospital)),
            identify("activity.xml", synth.xml_activity_bytes(hospital=hospital)),
        ]
    return files


def _bundle(hospital, files):
    gates, detected, (year, month), _notes = validate_batch(files)
    assert all(g.passed for g in gates), [g.message for g in gates if not g.passed]
    assert detected == hospital
    b = ReconBundle(hospital_code=detected, year=year, month=month)
    b.inpatient = extract_inpatient_summary(files[0].data)
    b.claims = extract_claims_all(files[1].data)
    b.pharma = extract_pharma_claims(files[2].data)
    b.sra = parse_sra_text(files[3].raw_text)
    b.phfee = parse_pharmacist_fee_text(files[4].raw_text)
    b.capitation = extract_simple_report(b"", raw_text=files[5].raw_text)
    if len(files) > 6:
        b.gl = extract_gl(files[6].data, detected)
        b.isaud = extract_is_auditor(files[7].data, detected)
        b.xml_activity = extract_xml_activity(files[8].data)
    return b


@pytest.mark.parametrize("hospital", CODES)
def test_full_pipeline_runs_for_every_hospital(hospital):
    files = _batch(hospital)
    b = _bundle(hospital, files)
    assert all(g.passed for g in gate4_internal_asserts(b)), \
        [g.message for g in gate4_internal_asserts(b) if not g.passed]
    res = run_reconciliation(b)
    # the four buckets must still tie to the cheque, whichever hospital it is
    assert round(sum(res.buckets.values()), 2) == b.sra.stated_total
    data = build_workbook(res)
    assert verify_workbook(data) == []          # gate 5: every zero-check reads 0


@pytest.mark.parametrize("hospital", CODES)
def test_gl_cost_centre_map_is_not_hospital_specific(hospital):
    """The GL is org-wide and uses the SAME cost-centre map for all eight
    vendors — filtering on VENDOR_CODE must isolate this hospital's rows and
    populate every bucket."""
    gl = extract_gl(synth.gl_xlsx(hospital=hospital), hospital)
    assert round(gl.regular_drg + gl.specialized, 2) == 961_728.70
    assert round(gl.z_catalogue, 2) == 100_000.00
    assert round(gl.ae, 2) == 131_284.66
    assert round(gl.outpatient, 2) == 65_000.00
    assert round(gl.pharmacist_fee, 2) == 24_000.00
    assert round(gl.pharma_other, 2) == 651_863.49
    assert round(gl.capitation, 2) == 13_729.74


@pytest.mark.parametrize("hospital", CODES)
def test_is_auditor_provider_filter_is_not_hospital_specific(hospital):
    """The IS Auditor report is org-wide: the provider-name filter must pick
    this hospital's rows only — and «ΛΕΥΚΩΣΙΑΣ» must never drag in Makarios."""
    isaud = extract_is_auditor(synth.is_auditor_xlsx(hospital=hospital), hospital)
    assert round(isaud.drg_fees, 2) == 900_000.00
    assert round(isaud.z_catalogue, 2) == 161_728.70


def test_makarios_month_without_ae_reconciles():
    """Makarios has no ΤΑΕΠ: no A&E SRA line, no A&E claims, GL A&E = 0.
    An absent stream must not break the tie-out or the workbook."""
    hospital = "F1050"
    sra = synth.sra_text(hospital=hospital)
    sra = "\n".join(l for l in sra.splitlines() if "AE - HCP SERVICES" not in l)
    sra = sra.replace("1,936,528.19", "1,805,243.53")   # cheque less the A&E lines
    segments = {k: v for k, v in synth.DEFAULT_SEGMENTS.items() if k != "A&E"}
    files = [
        identify("endo.xlsx", synth.inpatient_summary_xlsx(
            hospital=hospital, hospital_name=synth.provider_long_name(hospital))),
        identify("claims_OS.xlsx", synth.claims_all_xlsx(segments=segments)),
        identify("pharma.xlsx", synth.pharma_claims_xlsx()),
        _pdf_file(ReportType.SRA, hospital, sra),
        _pdf_file(ReportType.PHARMACIST_FEE, hospital,
                  synth.pharmacist_fee_text(hospital=hospital)),
        _pdf_file(ReportType.CAPITATION, hospital,
                  synth.capitation_text(hospital=hospital)),
    ]
    b = _bundle(hospital, files)
    res = run_reconciliation(b)
    assert res.buckets["A&E"] == 0.0
    assert round(sum(res.buckets.values()), 2) == b.sra.stated_total
    assert verify_workbook(build_workbook(res)) == []


def test_hospital_without_capitation_reconciles():
    """Nicosia and Kyperounta showed capitation 0.00 in the org GL: a month
    with no PD line and no capitation report must still tie."""
    hospital = "F1054"
    sra = synth.sra_text(hospital=hospital)
    sra = "\n".join(l for l in sra.splitlines() if "PD - CAPITATION" not in l)
    sra = sra.replace("1,936,528.19", "1,922,798.45")   # cheque less capitation
    files = [
        identify("endo.xlsx", synth.inpatient_summary_xlsx(
            hospital=hospital, hospital_name=synth.provider_long_name(hospital))),
        identify("claims_OS.xlsx", synth.claims_all_xlsx()),
        identify("pharma.xlsx", synth.pharma_claims_xlsx()),
        _pdf_file(ReportType.SRA, hospital, sra),
        _pdf_file(ReportType.PHARMACIST_FEE, hospital,
                  synth.pharmacist_fee_text(hospital=hospital)),
    ]
    gates, detected, (year, month), _ = validate_batch(files)   # capitation slot stays empty
    assert all(g.passed for g in gates), [g.message for g in gates if not g.passed]
    b = ReconBundle(hospital_code=detected, year=year, month=month)
    b.inpatient = extract_inpatient_summary(files[0].data)
    b.claims = extract_claims_all(files[1].data)
    b.pharma = extract_pharma_claims(files[2].data)
    b.sra = parse_sra_text(files[3].raw_text)
    b.phfee = parse_pharmacist_fee_text(files[4].raw_text)
    res = run_reconciliation(b)
    assert round(sum(res.buckets.values()), 2) == b.sra.stated_total
    assert verify_workbook(build_workbook(res)) == []


def test_every_hospital_constant_covers_all_eight():
    """Adding a hospital must not half-land: every per-hospital map has to
    carry all eight codes, and the F-code regex is derived from HOSPITALS."""
    from recon.identify import F_CODE_RE
    from recon.models import HOSPITAL_NAME_TOKENS
    assert sorted(HOSPITAL_NAME_TOKENS) == sorted(HOSPITALS)
    for code in CODES:
        assert F_CODE_RE.fullmatch(code), code
    assert not F_CODE_RE.search("F1085")          # a satellite is not a hospital


@pytest.mark.parametrize("hospital", CODES)
def test_provider_name_matches_exactly_one_hospital(hospital):
    """The org-wide reports are filtered by provider NAME — each hospital's
    full name must match its own tokens and nobody else's (the
    ΛΕΥΚΩΣΙΑΣ/ΜΑΚΑΡΕΙΟ trap from the brief)."""
    from recon.models import hospital_name_matches
    name = synth.provider_long_name(hospital)
    matched = [c for c in CODES if hospital_name_matches(c, name)]
    assert matched == [hospital], (name, matched)


def test_makarios_long_name_containing_lefkosias_is_not_nicosia():
    """Makarios is spelled «ΜΑΚΑΡΕΙΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ» in some exports —
    filtering Nicosia on «ΛΕΥΚΩΣΙΑΣ» alone would swallow it (brief warning)."""
    from recon.models import hospital_name_matches
    name = "ΜΑΚΑΡΕΙΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ (ΟΚΥπΥ)"
    assert [c for c in CODES if hospital_name_matches(c, name)] == ["F1050"]


@pytest.mark.parametrize("hospital", ["F1055", "F1026"])
def test_thin_exports_still_reconcile(hospital):
    """The small hospitals get thinner exports: the Ενδ. file with no
    per-claim listing and no «per clinic» pivot, the claims file with no
    ASSOCIATED DOCTOR / DR SPECIALITY columns.  Missing DETAIL must degrade
    the by-clinic / by-doctor tabs, never the cash reconciliation."""
    files = [
        identify("endo.xlsx", synth.inpatient_summary_xlsx(
            hospital=hospital, hospital_name=synth.provider_long_name(hospital),
            with_detail=False, with_per_clinic=False)),
        identify("claims_OS.xlsx", synth.claims_all_xlsx(with_doctor=False)),
        identify("pharma.xlsx", synth.pharma_claims_xlsx()),
        _pdf_file(ReportType.SRA, hospital, synth.sra_text(hospital=hospital)),
        _pdf_file(ReportType.PHARMACIST_FEE, hospital,
                  synth.pharmacist_fee_text(hospital=hospital)),
        _pdf_file(ReportType.CAPITATION, hospital,
                  synth.capitation_text(hospital=hospital)),
    ]
    b = _bundle(hospital, files)
    assert b.inpatient.detail_total is None      # no listing to sum
    assert b.inpatient.best_total == b.inpatient.synolo
    assert b.claims.by_doctor == []              # no doctor columns
    assert all(g.passed for g in gate4_internal_asserts(b))
    res = run_reconciliation(b)
    assert round(sum(res.buckets.values()), 2) == b.sra.stated_total
    assert verify_workbook(build_workbook(res)) == []


@pytest.mark.parametrize("hospital", CODES)
def test_satellite_marking_never_fires_on_a_sister_hospital(hospital):
    """A cheque made out to ANOTHER OKYπY hospital is a mixed batch, not a
    satellite provider — it must keep its real codes (so gate 2 catches it)
    while a genuine satellite F-code still becomes SAT."""
    sister = "F1054" if hospital != "F1054" else "F1050"
    sis = parse_sra_text(synth.sra_text_second(cheque="900002", hospital=sister))
    merged = merge_sras([sis], hospital_code=hospital)
    assert {l.code for l in merged.lines} == {"IS"}

    sat = parse_sra_text(synth.sra_text_second(cheque="900003", hospital="F1085"))
    merged = merge_sras([sat], hospital_code=hospital)
    assert {l.code for l in merged.lines} == {"SAT"}
