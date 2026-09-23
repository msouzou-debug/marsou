"""OKYπY's own SAP master data driving the journal: company code per hospital,
the HIO revenue account per stream, and the clinic's cost centre picked by
flavour — ward for DRG, ημερήσια φροντίδα for daily treatments, εξωτερικά
ιατρεία for the outpatient specialists."""
import io

from openpyxl import Workbook, load_workbook

import synth
from recon.build_xlsx import build_workbook, verify_workbook
from recon.checks import run_reconciliation
from recon.extract import extract_inpatient_summary
from recon.identify import identify
from recon.models import ReportType
from recon.sapmaster import (SapMaster, company_for, extract_sap_master,
                             looks_like_sap_master)
from test_workbook import _build


def master_xlsx() -> bytes:
    """The shape SAP exports: company codes, the cost-centre master and the
    chart of accounts, one sheet each."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Company Codes"
    ws.append(["Comp. Code", "Περιγραφή"])
    for code, name in (("1003", "ΔΥΨΥ"), ("1040", "ΓΝ Λάρνακας"),
                       ("1041", "ΓΝ Αμμοχώστου")):
        ws.append([code, name])
    cc = wb.create_sheet("Cost centers")
    cc.append(["Company Code", "Cost Center", "Name"])
    for company, code, name in (
            ("1041", "1064102205", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΘΑΛ Α"),
            ("1041", "1064102203", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΗΦ"),
            ("1041", "1064102202", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΕΙ"),
            ("1041", "1064102200", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΓΕΝΙΚΑ"),
            ("1041", "1064105001", "ΤΑΕΠ"),
            ("1041", "1064105002", "ΚΩΔΙΚΟΠΟΙΗΣΗ ΤΑΕΠ"),
            ("1041", "1064105600", "ΦΑΡΜΑΚΕΙΟ"),
            # another hospital's centres must never be picked for F1049
            ("1040", "1064002205", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΘΑΛ Α")):
        cc.append([company, code, name])
    coa = wb.create_sheet("Chart of accounts")
    coa.append(["G/L Account", "G/L Acct Long Text"])
    for code, text in (("412000", "HIO - Capitation Fees"),
                       ("412001", "HIO In-Patient Fees"),
                       ("412002", "HIO Out-Patient Fees"),
                       ("412003", "HIO TAEP Fees"),
                       ("412005", "HIO Day Care Fees"),
                       ("412006", "HIO Drugs Phase B"),
                       ("412007", "HIO Catalogue Z Items")):
        coa.append([code, text])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_master_is_identified_by_content_not_by_name():
    f = identify("anything.xlsx", master_xlsx())
    assert f.report_type == ReportType.SAP_MASTER
    assert looks_like_sap_master(["Cost centers", "Chart of accounts"])
    m = extract_sap_master(master_xlsx())
    assert m.companies["1041"] == "ΓΝ Αμμοχώστου"
    assert len(m.cost_centres) == 8 and len(m.accounts) == 7


def test_a_stream_picks_its_own_account_and_flavour_of_cost_centre():
    m = extract_sap_master(master_xlsx())
    assert company_for("F1049") == "1041"
    assert company_for("F1070") == "1003"          # mental health
    assert m.account("inpatient_drg") == ("412001", "HIO In-Patient Fees")
    assert m.account("inpatient_z") == ("412007", "HIO Catalogue Z Items")
    ward = m.find_centre("1041", "CARDIOLOGY", "ward")
    day = m.find_centre("1041", "CARDIOLOGY", "daycare")
    clinic = m.find_centre("1041", "CARDIOLOGY", "clinic")
    assert (ward.code, day.code, clinic.code) == \
        ("1064102205", "1064102203", "1064102202")
    # «ΤΑΕΠ» is that stream's own centre, not «ΚΩΔΙΚΟΠΟΙΗΣΗ ΤΑΕΠ»
    assert m.find_centre("1041", "A&E").code == "1064105001"
    # a speciality the dictionary does not cover is NOT guessed
    assert m.find_centre("1041", "SOMETHING ELSE") is None
    # and one hospital's centre never answers for another
    assert m.find_centre("1040", "A&E") is None


def test_an_account_the_chart_does_not_carry_is_not_written():
    thin = SapMaster(accounts={"412001": "HIO In-Patient Fees"})
    assert thin.account("inpatient_drg") == ("412001", "HIO In-Patient Fees")
    assert thin.account("inpatient_z") == ("", "")


def test_the_journal_posts_each_stream_to_its_own_account_and_centre():
    _data, res = _build(with_optional=True)
    res.bundle.inpatient = extract_inpatient_summary(
        synth.inpatient_summary_xlsx(with_procedure_detail=True))
    res.bundle.sap = extract_sap_master(master_xlsx())
    res = run_reconciliation(res.bundle)
    data = build_workbook(res)
    assert verify_workbook(data) == []
    ws = load_workbook(io.BytesIO(data))["JOURNAL ENTRIES"]
    credits = [r for r in range(4, ws.max_row + 1)
               if ws.cell(row=r, column=9).value == "50"
               and isinstance(ws.cell(row=r, column=12).value, (int, float))]
    # the hospital's own company code, not the mental-health default
    assert ws.cell(row=4, column=4).value == "1041"
    # one inpatient clinic row became three lines, one per revenue account
    by_account: dict[str, float] = {}
    for r in credits:
        acct = str(ws.cell(row=r, column=10).value)
        by_account[acct] = round(by_account.get(acct, 0.0)
                                 + ws.cell(row=r, column=12).value, 2)
    assert by_account["412001"] == 700_000.00       # DRG
    assert by_account["412005"] == 336_000.00       # daily treatments
    assert by_account["412007"] == 25_728.70        # catalogue Z
    assert by_account["412003"] == 131_284.66       # ΤΑΕΠ
    # and the whole document still ties to the cheque
    assert round(sum(ws.cell(row=r, column=12).value for r in credits), 2) == \
        1_936_528.19
    cardio = [r for r in credits
              if ws.cell(row=r, column=14).value == "1064102205"]
    assert cardio and ws.cell(row=cardio[0], column=10).value == "412001"


def test_without_the_master_the_journal_falls_back_and_invents_nothing():
    _data, res = _build(with_optional=True)
    ws = load_workbook(io.BytesIO(build_workbook(res)))["JOURNAL ENTRIES"]
    credits = [r for r in range(4, ws.max_row + 1)
               if ws.cell(row=r, column=9).value == "50"
               and isinstance(ws.cell(row=r, column=12).value, (int, float))]
    assert credits
    assert all(ws.cell(row=r, column=10).value == "412002" for r in credits)
    assert all(not ws.cell(row=r, column=14).value for r in credits)


def test_a_hospital_posts_no_internal_order():
    """The internal order (11-16) is the mental-health professional category.
    A hospital has none, so that column stays empty even when a lookup offers
    one."""
    from recon.mapping import extract_cost_centres
    _data, res = _build(with_optional=True)
    res.bundle.sap = extract_sap_master(master_xlsx())
    res.bundle.cost_centres = extract_cost_centres(synth.cost_centre_map_xlsx(
        rows=[("Inpatient", "26001", "77", "INPATIENT", "", "F1049")],
        with_hospital=True))
    ws = load_workbook(io.BytesIO(build_workbook(res)))["JOURNAL ENTRIES"]
    credits = [r for r in range(4, ws.max_row + 1)
               if ws.cell(row=r, column=9).value == "50"
               and isinstance(ws.cell(row=r, column=12).value, (int, float))]
    assert credits
    assert all(not ws.cell(row=r, column=15).value for r in credits)


def test_nurses_and_allied_health_post_to_the_outpatient_clinics():
    """ΟΑΥ pays both segments as one number with no speciality of their own,
    so both post to «ΕΞ.ΙΑΤΡΕΙΑ-ΓΕΝΙΚΑ» — and a hospital whose master has no
    such centre still gets a blank rather than a guess."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Cost centers"
    ws.append(["Company Code", "Cost Center", "Name"])
    ws.append(["1041", "1064110701", "ΕΞ.ΙΑΤΡΕΙΑ-ΓΕΝΙΚΑ"])
    ws.append(["1033", "1053305600", "ΦΑΡΜΑΚΕΙΟ"])          # Polis has none
    coa = wb.create_sheet("Chart of accounts")
    coa.append(["G/L Account", "G/L Acct Long Text"])
    coa.append(["412002", "HIO Out-Patient Fees"])
    buf = io.BytesIO()
    wb.save(buf)
    m = extract_sap_master(buf.getvalue())
    for label in ("Νοσηλευτές/Μαίες (Nurses-Midwives)",
                  "Άλλοι Επαγγελματίες Υγείας (Allied Health)"):
        assert m.find_centre("1041", label).code == "1064110701"
        assert m.find_centre("1033", label) is None


def _centres(*rows) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Cost centers"
    ws.append(["Company Code", "Cost Center", "Name"])
    for r in rows:
        ws.append(list(r))
    coa = wb.create_sheet("Chart of accounts")
    coa.append(["G/L Account", "G/L Acct Long Text"])
    coa.append(["412002", "HIO Out-Patient Fees"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_the_flavour_is_read_after_the_speciality_not_inside_it():
    """«ΟΦΘΑΛ» contains «ΘΑΛ» and «ΧΕΙΡΟΥΡΓΙΚΗ» contains «ΕΙ». Testing the whole
    name made every ophthalmology centre look like a ward and every surgery
    centre like an outpatient clinic, so the match was thrown out as ambiguous
    and the line came out uncoded — the real F1048 symptom."""
    m = extract_sap_master(_centres(
        ("1040", "1064003900", "ΟΦΘΑΛΜΟΛΟΓΙΚΗ-ΓΕΝΙΚΑ"),
        ("1040", "1064003901", "ΟΦΘΑΛΜΟΛΟΓΙΚΗ-ΕΙ"),
        ("1040", "1064003902", "ΟΦΘΑΛΜΟΛΟΓΙΚΗ-ΘΑΛ"),
        ("1040", "1064003903", "ΟΦΘΑΛΜΟΛΟΓΙΚΗ Η.Φ."),
        ("1040", "1064000601", "ΧΕΙΡΟΥΡΓΙΚΗ-ΕΙ"),
        ("1040", "1064000602", "ΧΕΙΡΟΥΡΓΙΚΗ-ΘΑΛ Α"),
        ("1040", "1064000603", "ΧΕΙΡΟΥΡΓΙΚΗ Η.Φ.")))
    got = {v: m.find_centre("1040", "OPHTHALMOLOGY", v)
           for v in ("ward", "daycare", "clinic", "general")}
    assert {v: c.code for v, c in got.items()} == {
        "ward": "1064003902", "daycare": "1064003903",
        "clinic": "1064003901", "general": "1064003900"}
    assert m.find_centre("1040", "GENERAL SURGERY", "clinic").code == "1064000601"
    assert m.find_centre("1040", "GENERAL SURGERY", "ward").code == "1064000602"


def test_a_hyphenated_speciality_still_finds_its_stem():
    """norm_label turns «DERMATO-VENEREOLOGY» into «DERMATO VENEREOLOGY», so a
    hyphenated dictionary key never matched the speciality it was written for."""
    m = extract_sap_master(_centres(
        ("1040", "1064001001", "ΔΕΡΜΑΤΟΛΟΓΙΚΗ-ΕΙ"),
        ("1040", "1064001002", "ΔΕΡΜΑΤΟΛΟΓΙΚΗ-ΘΑΛ")))
    assert m.find_centre("1040", "DERMATO-VENEREOLOGY", "clinic").code == "1064001001"
    # and the label as By_Clinic_Split writes it
    assert m.find_centre("1040", "Ειδικοί Ιατροί — DERMATO-VENEREOLOGY (OS)",
                         "clinic").code == "1064001001"


def test_nicosia_books_the_alpha_ward_when_a_clinic_has_two():
    m = extract_sap_master(_centres(
        ("1020", "1042002200", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΓΕΝΙΚΑ"),
        ("1020", "1042002205", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΘΑΛ Α"),
        ("1020", "1042002206", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΘΑΛ Β"),
        ("1020", "1042000602", "ΧΕΙΡΟΥΡΓΙΚΗ-ΘΑΛ Α"),
        ("1020", "1042000603", "ΧΕΙΡΟΥΡΓΙΚΗ-ΘΑΛ Β"),
        # not general surgery, and must not be picked as one
        ("1020", "1042006102", "ΝΕΥΡΟΧΕΙΡΟΥΡΓΙΚΗ-ΘΑΛ")))
    assert m.find_centre("1020", "CARDIOLOGY", "ward").code == "1042002205"
    assert m.find_centre("1020", "GENERAL SURGERY", "ward").code == "1042000602"
    assert m.find_centre("1020", "NEUROLOGICAL SURGERY", "ward").code == "1042006102"


def test_the_alert_names_only_lines_that_carry_money():
    """«Alert and ignore if they don't have amounts allocated to them»: a line
    with no cost centre AND no amount is not a finding."""
    from recon.build_xlsx import _missing_note
    info = {"missing": {"RENAL DISEASES": 12_345.67, "PLASTIC SURGERY": 0.0,
                        "UROLOGY": -250.00}, "master_seen": True}
    note = _missing_note(info, True)
    assert "RENAL DISEASES" in note and "UROLOGY" in note
    assert "PLASTIC SURGERY" not in note
    assert note.index("RENAL") < note.index("UROLOGY")     # biggest first
    assert _missing_note({"missing": {"X": 0.0}}, True) is None
    # and when the master was never uploaded, say so first
    assert "Chart_of_Accounts" in _missing_note(info, False)


def test_the_alert_says_why_each_line_could_not_be_coded():
    """A list of names is something to stare at; a reason is something to act
    on — so each uncoded line carries why the app could not code it."""
    from recon.build_xlsx import _missing_note
    m = extract_sap_master(_centres(
        ("1040", "1064003900", "ΟΦΘΑΛΜΟΛΟΓΙΚΗ-ΓΕΝΙΚΑ"),
        ("1040", "1064003902", "ΟΦΘΑΛΜΟΛΟΓΙΚΗ-ΘΑΛ"),
        ("1040", "1064003912", "ΟΦΘΑΛΜΟΛΟΓΙΚΗ-ΘΑΛ Γ")))
    assert "not in the dictionary" in m.why_no_centre("1040", "SOMETHING ELSE")
    assert "no such centre" in m.why_no_centre("1040", "UROLOGY")
    # two wards, neither of them Α — a human picks
    assert "ambiguous" in m.why_no_centre("1040", "OPHTHALMOLOGY", "ward")
    assert "no company" in m.why_no_centre("", "OPHTHALMOLOGY")
    note = _missing_note({"missing": {"UROLOGY": 900.0},
                          "why": {"UROLOGY": "no such centre in SAP"}}, True)
    assert "UROLOGY" in note and "no such centre in SAP" in note


def test_the_whole_label_is_searched_not_a_slice_of_it():
    """Cutting the speciality out of the label first mangled the hyphenated
    ones — «DERMATO-VENEREOLOGY» became «VENEREOLOGY» and «Προσωπικοί Ιατροί —
    FFS (…)» became «FFS», and neither is in any dictionary."""
    m = extract_sap_master(_centres(
        ("1040", "1064001002", "ΔΕΡΜΑΤΟΛΟΓΙΚΗ-ΘΑΛ"),
        ("1040", "1064004600", "ΠΙ ΕΝΗΛΙΚΩΝ"),
        ("1040", "1064013100", "ΤΜΗΜΑ ΛΟΙΜΩΞΕΩΝ"),
        ("1040", "1064010701", "ΕΞ.ΙΑΤΡΕΙΑ-ΓΕΝΙΚΑ"),
        ("1040", "1064000902", "ΓΥΝΑΙΚΟΛΟΓΙΚΗ-ΘΑΛ"),
        ("1040", "1064003901", "ΟΦΘΑΛΜΟΛΟΓΙΚΗ-ΕΙ")))
    cases = [
        ("DERMATO-VENEREOLOGY", "ward", "1064001002"),
        ("Προσωπικοί Ιατροί — FFS (PD fee-for-service)", "general", "1064004600"),
        ("SPECIALISED IN INFECTIOUS DISEASES", "ward", "1064013100"),
        ("Ειδικοί Ιατροί — OPHTHALMOLOGY (OS)", "clinic", "1064003901"),
        # longest name wins, so this is not read as «GYNAECOLOGY» alone
        ("OBSTETRICS - GYNAECOLOGY", "ward", "1064000902"),
    ]
    for label, variant, want in cases:
        got = m.find_centre("1040", label, variant)
        assert got is not None and got.code == want, f"{label} -> {got}"


def test_the_outpatient_bucket_catches_its_own_leftovers():
    """Quality criteria, reimbursement adjustments and satellite-supplier
    cheques are not clinical specialities, but they are outpatient."""
    m = extract_sap_master(_centres(("1040", "1064010701", "ΕΞ.ΙΑΤΡΕΙΑ-ΓΕΝΙΚΑ")))
    assert m.find_centre("1040", "Outpatient").code == "1064010701"
    for label in ("Ποιοτικά Κριτήρια / MRI-CT (Quality criteria)",
                  "Επιταγές δορυφορικών παροχέων (satellite suppliers)",
                  "Ειδικοί Ιατροί — διαφορά προς SRA (OS diff)"):
        assert m.find_centre("1040", label) is None      # not a speciality…
    assert m.find_centre("1040", "Outpatient") is not None   # …the bucket is


def test_day_treatments_fall_back_to_the_outpatient_clinic():
    """Several hospitals run their day cases out of the ΕΙ clinic and keep no
    ΗΦ centre at all — Famagusta nephrology, where €145.420 of renal day
    treatments belong to 1064103401 — so day care looks ΗΦ → ΕΙ → ΓΕΝΙΚΑ
    rather than giving up after ΗΦ."""
    m = extract_sap_master(_centres(
        ("1041", "1064103402", "ΝΕΦΡΟΛΟΓΙΚΗ-ΘΑΛΑΜΟΣ"),
        ("1041", "1064103401", "ΝΕΦΡΟΛΟΓΙΚΗ-ΕΙ"),
        ("1041", "1064102205", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΘΑΛ Α"),
        ("1041", "1064102203", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΗΦ"),
        ("1041", "1064102202", "ΚΑΡΔΙΟΛΟΓΙΚΗ-ΕΙ")))
    assert m.find_centre("1041", "RENAL DISEASES", "daycare").code == "1064103401"
    assert m.find_centre("1041", "RENAL DISEASES", "ward").code == "1064103402"
    # where an ΗΦ centre does exist it still wins
    assert m.find_centre("1041", "CARDIOLOGY", "daycare").code == "1064102203"


def test_the_pd_line_parts_each_reach_their_own_account():
    """Only the capitation half of «PD - HCP Services» is capitation revenue;
    the fixed-price and quality lines keep their own accounts, and whatever is
    left of the PD line is outpatient."""
    from recon.build_xlsx import _line_kind
    assert _line_kind("Προσωπικοί Ιατροί — εξωνοσοκομειακές χρεώσεις",
                      "Outpatient")[0] == "outpatient"
    assert _line_kind("Προσωπικοί Ιατροί — κατά κεφαλήν (capitation)",
                      "Outpatient")[0] == "capitation"
    assert _line_kind("Προσωπικοί Ιατροί — σταθερές χρεώσεις (OOH, εμβολιασμοί)",
                      "Outpatient")[0] == "oncall"
    assert _line_kind("Ποιοτικά Κριτήρια / MRI-CT (Quality criteria)",
                      "Outpatient")[0] == "quality"


def test_the_tool_carries_its_own_chart_of_accounts():
    """Finance should not have to attach the SAP master every month: the
    export it last handed over is baked into the tool."""
    from recon.sapmaster import COMPANY_CODES, REVENUE_ACCOUNTS, embedded_master
    m = embedded_master()
    assert m.embedded and m.stamp and m.source
    # every hospital's company code is a company the master actually knows
    for f_code, company in COMPANY_CODES.items():
        assert company in m.companies, f_code
        assert m.centres_for(company), company
    # and every account the journal can write is in the chart
    assert [k for k, v in REVENUE_ACCOUNTS.items() if v not in m.accounts] == []
    # a real clinic resolves to its real centre, flavour by flavour
    assert m.find_centre("1040", "OPHTHALMOLOGY", "clinic").code == "1064003901"
    assert m.find_centre("1040", "OPHTHALMOLOGY", "ward").code == "1064003902"
    assert m.find_centre("1040", "A&E").code == "1064005001"


def test_an_uploaded_chart_of_accounts_replaces_the_built_in_one():
    from recon.sapmaster import master_or_embedded
    uploaded = extract_sap_master(master_xlsx())
    assert master_or_embedded(uploaded) is uploaded
    assert master_or_embedded(None).embedded


def test_the_gl_commitment_item_sheet_is_not_read_as_the_company_list():
    """The export grew a «SAP GL AC - COM ITEM» sheet that carries BOTH a
    company code and a G/L account.  Read as either of the sheets it resembles,
    it would put budget wording on the hospitals — so it is skipped."""
    wb = load_workbook(io.BytesIO(master_xlsx()))
    ws = wb.create_sheet("SAP GL AC - COM ITEM")
    ws.append(["Company Code", "G/L Account", "Short Text", "FM Area",
               "Commitment Item", "Name"])
    ws.append(["1041", "412001", "HIO In-Patient Fees", "SHSO", "9500",
               "No Budget Releated E"])
    buf = io.BytesIO()
    wb.save(buf)
    m = extract_sap_master(buf.getvalue())
    assert m.companies["1041"] == "ΓΝ Αμμοχώστου"
    assert m.accounts["412001"] == "HIO In-Patient Fees"


def test_the_journal_carries_its_own_upload_instructions():
    from recon.build_xlsx import build_sap_workbook
    _data, res = _build(with_optional=True)
    wb = load_workbook(io.BytesIO(build_sap_workbook(
        [("F1049", "ΓΝ ΑΜΜΟΧΩΣΤΟΥ", res)])))
    assert "Οδηγίες_SAP" in wb.sheetnames
    text = "\n".join(str(c.value) for row in wb["Οδηγίες_SAP"].iter_rows()
                     for c in row if c.value is not None)
    assert "ZSHSO_FI_POST_UPL_V1" in text
    assert "JOURNAL ENTRIES" in text and "Έλεγχος_SAP" in text


def test_the_short_and_long_spellings_of_a_clinic_both_match():
    """Paphos writes «ΟΡΘ.ΕΙ», everyone else «ΟΡΘΟΠΑΙΔΙΚΗ-ΕΙ» — and Nicosia
    types the Α of «ΘΑΛ Α» in the Latin alphabet, which used to make its two
    orthopaedic wards ambiguous and leave the line blank."""
    m = extract_sap_master(_centres(
        ("1031", "1053103700", "ΟΡΘ.ΓΕΝΙΚΑ"),
        ("1031", "1053103701", "ΟΡΘ.ΕΙ"),
        ("1031", "1053103702", "ΟΡΘ.ΘΑΛΑΜΟΣ Α"),
        ("1020", "1042003701", "ΟΡΘΟΠΑΙΔΙΚΗ-ΕΙ"),
        ("1020", "1042003702", "ΟΡΘΟΠΑΙΔΙΚΗ-ΘΑΛ A"),      # Latin A
        ("1020", "1042003703", "ΟΡΘΟΠΑΙΔΙΚΗ-ΘΑΛ B"),      # Latin B
        ("1020", "1042003704", "ΟΡΘ-ΠΡΟΣΘΕΤΙΚΑ ΜΕΛΗ")))
    assert m.find_centre("1031", "ORTHOPAEDICS", "ward").code == "1053103702"
    assert m.find_centre("1031", "ORTHOPAEDICS", "clinic").code == "1053103701"
    assert m.find_centre("1020", "ORTHOPAEDICS", "ward").code == "1042003702"
    assert m.find_centre("1020", "ORTHOPAEDICS", "clinic").code == "1042003701"


def test_the_specialities_paphos_added_to_the_dictionary():
    """Anaesthesiology and oncology used to fall back to ΕΞ.ΙΑΤΡΕΙΑ or stay
    blank; ΟΑΥ bills the hyperbaric chamber under the bare word «DOCTOR»."""
    m = extract_sap_master(_centres(
        ("1031", "1053110001", "ΑΝΑΙΣΘΗΣΙΟΛΟΓΙΚΟ-ΕΙ"),
        ("1031", "1053103601", "ΟΓΚΟΛΟΓΙΚΗ-ΕΙ"),
        ("1031", "1053103602", "ΟΓΚΟΛΟΓΙΚΗ-ΗΦ"),
        ("1031", "1053105300", "ΥΠΕΡΒΑΡΙΚΟΣ ΘΑΛΑΜΟΣ"),
        ("1031", "1053104101", "ΠΑΙΔΙΑΤΡΙΚΗ-ΓΕΝΙΚΑ"),
        ("1031", "1053104102", "ΠΑΙΔΙΑΤΡΙΚΗ-ΕΙ"),
        ("1031", "1053104104", "ΠΑΙΔΙΑΤΡΙΚΗ-ΘΑΛ Α"),
        ("1031", "1053104600", "ΠΙ ΕΝΗΛΙΚΩΝ")))
    assert m.find_centre("1031", "ANESTHESIOLOGY", "clinic").code == "1053110001"
    assert m.find_centre("1031", "MEDICAL ONCOLOGY", "daycare").code == "1053103602"
    assert m.find_centre("1031", "DOCTOR", "daycare").code == "1053105300"
    # all three streams of the children's Personal Doctors book to the
    # paediatric OUTPATIENT clinic, whatever the revenue account; the adults'
    # keep their own centre
    for what in ("κατά κεφαλήν", "ποιοτικά κριτήρια", "εξωνοσοκομειακές χρεώσεις"):
        assert m.find_centre(
            "1031", f"Προσωπικοί Ιατροί Παιδιών — {what}").code == "1053104102"
    assert m.find_centre(
        "1031", "Προσωπικοί Ιατροί — κατά κεφαλήν").code == "1053104600"
    # the INPATIENT paediatric row is a ward row and keeps the ward centre
    assert m.find_centre("1031", "PD - Child Pediatrics", "ward").code == "1053104104"


def test_the_lines_that_change_account_or_take_none_at_all():
    """Two rules the journal cannot get from a cost centre: ΟΑΥ's «ADJ-IS»
    hemodialysis is day care, not a DRG stay; and the adults' Personal Doctors
    are not our revenue at all, so no account of ours may be written."""
    from recon.build_xlsx import _line_kind
    from recon.sapmaster import SapMaster
    assert _line_kind("Αιμοκάθαρση (Hemodialysis)", "Inpatient") == \
        ("inpatient_daily", "general")
    assert _line_kind("Προσωπικοί Ιατροί Ενηλίκων — κατά κεφαλήν — ΔΠΦΥ "
                      "(intercompany)", "Outpatient")[0] == "intercompany"
    assert _line_kind("Προσωπικοί Ιατροί Παιδιών — κατά κεφαλήν (capitation)",
                      "Outpatient")[0] == "capitation"
    # and «intercompany» is not one of our revenue accounts, so nothing is
    # written even when the whole chart of accounts is loaded
    full = SapMaster(accounts={code: "x" for code in
                               ("412000", "412002", "412005", "412008")})
    assert full.account("intercompany") == ("", "")
    assert full.account("inpatient_daily") == ("412005", "x")


def test_renal_day_care_is_dialysis_and_books_to_its_own_unit():
    """The ΗΦ→ΕΙ fallback would send renal day treatments to the nephrology
    outpatient clinic; they are dialysis and belong to the ΑΙΜΟΚΑΘΑΡΣΗ unit.
    The ward and the clinic are untouched."""
    m = extract_sap_master(_centres(
        ("1031", "1053103400", "ΝΕΦ-ΑΙΜΟΚΑΘΑΡΣΗ"),
        ("1031", "1053103401", "ΝΕΦΡΟΛΟΓΙΚΗ-ΕΙ"),
        ("1031", "1053103402", "ΝΕΦΡΟΛΟΓΙΚΗ-ΘΑΛΑΜΟΣ")))
    assert m.find_centre("1031", "RENAL DISEASES", "daycare").code == "1053103400"
    assert m.find_centre("1031", "RENAL DISEASES", "clinic").code == "1053103401"
    assert m.find_centre("1031", "RENAL DISEASES", "ward").code == "1053103402"
    # a hospital without a dialysis unit still falls back rather than break
    thin = extract_sap_master(_centres(("1033", "1053303401", "ΝΕΦΡΟΛΟΓΙΚΗ-ΕΙ")))
    assert thin.find_centre("1033", "RENAL DISEASES", "daycare").code == "1053303401"


def test_the_adults_personal_doctors_carry_the_intercompany_account():
    from recon.sapmaster import SapMaster
    full = SapMaster(accounts={"412000": "HIO - Capitation Fees",
                               "122112": "Health Centers"})
    assert full.account("intercompany") == ("122112", "Health Centers")
    assert full.account("capitation") == ("412000", "HIO - Capitation Fees")


def test_where_a_line_books_when_it_is_not_the_clinic_that_earned_it():
    """Z-catalogue items are the pharmacy's wherever they were dispensed, and
    the ΔΠΦΥ half of the Personal Doctors posts to a balance-sheet account,
    which takes no cost centre — and is therefore NOT reported as a line
    missing one."""
    from recon.build_xlsx import _KIND_CENTRE, _KIND_NO_CENTRE, build_sap_workbook
    assert _KIND_CENTRE["inpatient_z"] == "ΦΑΡΜΑΚΑ"
    assert "intercompany" in _KIND_NO_CENTRE
    m = extract_sap_master(master_xlsx())
    assert m.find_centre("1041", _KIND_CENTRE["inpatient_z"]).name == "ΦΑΡΜΑΚΕΙΟ"

    _data, res = _build(with_optional=True)
    res.bundle.inpatient = extract_inpatient_summary(
        synth.inpatient_summary_xlsx(with_procedure_detail=True))
    res.bundle.sap = m
    res = run_reconciliation(res.bundle)
    wb = load_workbook(io.BytesIO(build_sap_workbook([("F1049", "ΓΝ ΑΜΜΟΧΩΣΤΟΥ", res)])))
    ws = wb["JOURNAL ENTRIES"]
    z_centres = {ws.cell(row=r, column=14).value
                 for r in range(4, ws.max_row + 1)
                 if str(ws.cell(row=r, column=10).value) == "412007"}
    assert z_centres == {"1064105600"}          # every Z line, one centre


def test_the_nurses_and_allied_professionals_reach_their_own_units():
    """ΟΑΥ pays them as two lump streams; each speciality has a unit of its
    own, and Paphos spells its midwifery «ΚΟΙΝ ΜΑΙΕΥΤΙΚΗ» where the others
    write «ΚΟΙΝΟΤΙΚΗ ΜΑΙΕΥΤΙΚΗ» — so a speciality may name more than one
    candidate centre."""
    m = extract_sap_master(_centres(
        ("1031", "1053102300", "ΚΑΤ'ΟΙΚΟΝ ΝΟΣΗΛΕΙΑ"),
        ("1031", "1053102302", "ΚΟΙΝ ΜΑΙΕΥΤΙΚΗ"),
        ("1031", "1053105900", "ΚΟΙΝΟΤΙΚΗ ΜΑΙΕΥΤΙΚΗ"),
        ("1031", "1053105700", "ΦΥΣΙΟΘΕΡΑΠΕΥΤΗΡΙΟ"),
        ("1031", "1053101201", "ΔΙΑΙΤΟΛΟΓΙΚΟ-ΕΙ"),
        ("1031", "1053100300", "ΑΚΤ-ΓΕΝΙΚΑ"),
        ("1040", "1064002300", "ΚΑΤ'ΟΙΚΟΝ ΝΟΣΗΛΕΙΑ"),
        ("1040", "1064006000", "ΚΟΙΝΟΤΙΚΗ ΜΑΙΕΥΤΙΚΗ")))
    assert m.find_centre("1031", "GENERAL NURSE (NM)").code == "1053102300"
    assert m.find_centre("1031", "MIDWIFE (NM)").code == "1053102302"
    assert m.find_centre("1031", "PHYSIOTHERAPIST (AP)").code == "1053105700"
    assert m.find_centre("1031", "CLINICAL DIETITIAN (AP)").code == "1053101201"
    # the other spelling answers where the first one does not exist
    assert m.find_centre("1040", "MIDWIFE (NM)").code == "1064006000"
    # the scan quality criteria are radiology's, not the outpatient clinics'
    assert m.find_centre(
        "1031", "Ποιοτικά Κριτήρια / MRI-CT (Quality criteria)").code == "1053100300"


def test_radiology_is_spelled_in_both_alphabets():
    """Limassol types its radiology centres «AKT» in Latin letters, everyone
    else «ΑΚΤ» in Greek, and Kyperounta mixes the two inside one hospital."""
    m = extract_sap_master(_centres(
        ("1030", "1053000300", "AKT-ΓΕΝΙΚΑ"),            # Latin AKT
        ("1030", "1053000301", "AKT-ΑΚΤΙΝΟΓΡΑΦΙΕΣ"),
        ("1032", "1053200300", "ΑΚΤ-ΓΕΝΙΚΑ"),            # Greek ΑΚΤ
        ("1032", "1053200309", "AKT-ΥΠΕΡΗΧΟΓΡΑΦΗΜΑΤΑ")))
    for co, want in (("1030", "1053000300"), ("1032", "1053200300")):
        assert m.find_centre(co, "DIAGNOSTIC RADIOLOGY", "clinic").code == want
        assert m.find_centre(
            co, "Ποιοτικά Κριτήρια / MRI-CT (Quality criteria)").code == want
