"""
The clerk path end to end, through a real Flask app and a real database:
entry → service selection → Υπολογισμός → Οριστικοποίηση → printed PDF.
"""
import datetime as dt
import re
from decimal import Decimal

import pytest

import taep


YESTERDAY = dt.datetime.now() - dt.timedelta(days=1)


def form_fields(ctx, code="624", **overrides):
    category = ctx["db_execute"](
        "SELECT id FROM taep_financial_category WHERE code_new=%s", (code,),
        fetch=True)[0]["id"]
    fields = {
        "id_type": "Ταυτότητα", "id_number": "1234567", "id_country": "Κύπρος",
        "id_expiry": "2030-01-01",
        "last_name": "Παπαδόπουλος", "first_name": "Ανδρέας",
        "date_of_birth": "1985-04-12", "gender": "Άνδρας", "phone": "99123456",
        "address": "Λεωφ. Μακαρίου 10", "next_of_kin_type": "Σύζυγος",
        "next_of_kin_details": "Μαρία 99654321",
        "taep_unit_code": "NGH-ADULT", "episode_number": "E-1001",
        "admission_at": YESTERDAY.strftime("%Y-%m-%dT%H:%M"),
        "examination_at": (YESTERDAY + dt.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M"),
        "discharge_at": (YESTERDAY + dt.timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M"),
        "financial_category_id": str(category), "comments": "",
    }
    fields.update(overrides)
    return fields


def create(client, app, **overrides):
    response = client.post("/taep/nea", data=form_fields(app.ctx, **overrides))
    assert response.status_code == 302, response.data[:400]
    return int(re.search(r"/taep/(\d+)", response.headers["Location"]).group(1))


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------

def test_the_screens_require_a_session(app):
    anonymous = app.test_client()
    for path in ("/taep/nea", "/taep/list", "/taep/1"):
        assert anonymous.get(path).status_code == 401


def test_a_clerk_without_the_permission_is_refused(app):
    app.ctx["granted_permissions"].add("taep.something-else")
    client = app.test_client()
    with client.session_transaction() as sess:
        sess["user_id"] = 1
    assert client.get("/taep/nea").status_code == 403


def test_an_episode_at_another_hospital_is_404_not_403(client, app):
    """Brief §13: a Limassol user gets 404 on a Nicosia episode, so the existence of
    the record is not disclosed."""
    elsewhere = taep.save_episode(
        app.ctx, {**{f: None for f in taep.EPISODE_FIELDS},
                  "id_number": "9999", "examination_at": YESTERDAY,
                  "financial_category_id": app.ctx["db_execute"](
                      "SELECT id FROM taep_financial_category WHERE code_new='624'",
                      fetch=True)[0]["id"]},
        entity_code="LGH", unit_code="LGH", user_id=1)
    assert client.get(f"/taep/{elsewhere}").status_code == 404


# ---------------------------------------------------------------------------
# Screen 1
# ---------------------------------------------------------------------------

def test_the_entry_screen_offers_only_the_twenty_three_categories(client):
    page = client.get("/taep/nea").get_data(as_text=True)
    assert "Νέα Καταχώρηση" in page
    assert "624 — ΑΙΤΗΤΕΣ ΑΣΥΛΟΥ/ΔΟΜΕΣ" in page
    # 633 is dental and cannot arise at ΤΑΕΠ.
    assert "ΟΔΟΝΤ ΥΠ" not in page
    assert "23 κατηγορίες" in page


def test_the_entry_screen_offers_both_nicosia_units(client):
    page = client.get("/taep/nea").get_data(as_text=True)
    assert "NGH-ADULT" in page and "NGH-PAED" in page


def test_saving_redirects_to_the_costing_screen(client, app):
    episode_id = create(client, app)
    episode = taep.get_episode(app.ctx, episode_id)
    assert episode["status"] == "DRAFT"
    assert episode["entity_code"] == "NGH"


def test_a_bad_time_order_is_rejected_in_greek(client, app):
    response = client.post("/taep/nea", data=form_fields(
        app.ctx, examination_at=(YESTERDAY - dt.timedelta(hours=2)).strftime(
            "%Y-%m-%dT%H:%M")))
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "εξέτασης" in page and "εισαγωγής" in page
    assert app.ctx["db_execute"]("SELECT COUNT(*) n FROM taep_episode",
                                 fetch=True)[0]["n"] == 0


def test_a_unit_from_another_hospital_is_rejected(client, app):
    response = client.post("/taep/nea", data=form_fields(app.ctx,
                                                         taep_unit_code="LGH"))
    assert response.status_code == 200
    assert "δεν ανήκει στο ενεργό νοσηλευτήριο" in response.get_data(as_text=True)


def test_the_prior_lookup_returns_nothing_for_a_new_patient(client):
    data = client.get("/taep/api/prior?id_type=Ταυτότητα&id_number=0000000").get_json()
    assert data == {"count": 0, "unpaid": [], "prefill": None}


def test_the_prior_lookup_finds_an_earlier_episode_and_offers_a_prefill(client, app):
    first = create(client, app)
    client.post(f"/taep/{first}/services", data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{first}/calculate")
    client.post(f"/taep/{first}/finalise")

    data = client.get("/taep/api/prior?id_type=Ταυτότητα&id_number=1234567").get_json()
    assert data["count"] == 1
    assert data["prefill"]["last_name"] == "Παπαδόπουλος"


def test_an_unpaid_self_pay_episode_is_reported(client, app):
    first = create(client, app, code="600", episode_number="E-1")
    client.post(f"/taep/{first}/services", data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{first}/calculate")
    client.post(f"/taep/{first}/finalise")

    data = client.get("/taep/api/prior?id_type=Ταυτότητα&id_number=1234567").get_json()
    assert len(data["unpaid"]) == 1
    assert data["unpaid"][0]["costing_number"] == "OKY1054/0001"


# ---------------------------------------------------------------------------
# Service search
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("term,expected", [
    ("AET043", "AET043"),
    ("εγχυση υγρων", "AET043"),
    ("ΕΓΧΥΣΗ ΥΓΡΩΝ", "AET043"),
    ("Έγχυση υγρών", "AET043"),
    ("ακτινογραφια", "AED005"),
])
def test_service_search_is_accent_and_case_insensitive(client, term, expected):
    hits = client.get(f"/taep/api/services?q={term}").get_json()
    assert expected in [h["code"] for h in hits]


def test_a_code_match_sorts_first(client):
    hits = client.get("/taep/api/services?q=AED001").get_json()
    assert hits[0]["code"] == "AED001"


# ---------------------------------------------------------------------------
# Screen 2 — the clerk journey
# ---------------------------------------------------------------------------

def test_an_empty_selection_says_it_will_be_charged_as_triage(client, app):
    episode_id = create(client, app)
    page = client.get(f"/taep/{episode_id}").get_data(as_text=True)
    assert "Διαλογή" in page and "Καμία υπηρεσία επιλεγμένη" in page


def test_services_are_grouped_as_the_printed_document_groups_them(client, app):
    episode_id = create(client, app)
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    page = client.get(f"/taep/{episode_id}").get_data(as_text=True)
    assert "Θεραπείες" in page and "Διαγνωστικές Παρεμβάσεις" in page
    assert "AED008" in page and "AET057" in page


def test_the_golden_case_through_the_screens(client, app):
    """The §4.1 golden case driven through the HTTP routes, not the library.

    Max treatment category 3 comes from AET057 Συμπληρωματικό Οξυγόνο; AET008 is
    Καταγραφή ζωτικών σημείων at category 1. The catalogue agrees with the brief."""
    episode_id = create(client, app)
    codes = ["AET008", "AET057", "AET005", "AET043",
             "AED001", "AED008", "AED002", "AED006",
             "AED009", "AED012", "AED016", "AED005"]
    client.post(f"/taep/{episode_id}/services", data={"service_code": codes})
    client.post(f"/taep/{episode_id}/calculate")

    page = client.get(f"/taep/{episode_id}").get_data(as_text=True)
    assert "Συνδυασμός διάγνωσης και θεραπείας μέσου κόστους" in page
    assert "120,00" in page
    assert taep.get_episode(app.ctx, episode_id)["status"] == "CALCULATED"


def test_changing_services_after_calculating_clears_the_result(client, app):
    episode_id = create(client, app)
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{episode_id}/calculate")
    assert "Τελικό Κόστος" in client.get(f"/taep/{episode_id}").get_data(as_text=True)

    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057", "AET074"]})
    page = client.get(f"/taep/{episode_id}").get_data(as_text=True)
    assert "Δεν έχει γίνει υπολογισμός" in page
    assert taep.get_episode(app.ctx, episode_id)["status"] == "DRAFT"


def test_one_sided_selection_is_refused_in_greek(client, app):
    episode_id = create(client, app)
    client.post(f"/taep/{episode_id}/services", data={"service_code": ["AED008"]})
    response = client.post(f"/taep/{episode_id}/calculate", follow_redirects=True)
    page = response.get_data(as_text=True)
    assert "θεραπεία" in page
    assert taep.get_calculation(app.ctx, episode_id) is None


def test_finalising_without_calculating_is_refused(client, app):
    episode_id = create(client, app)
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    response = client.post(f"/taep/{episode_id}/finalise", follow_redirects=True)
    assert "Απαιτείται υπολογισμός" in response.get_data(as_text=True)
    assert taep.get_episode(app.ctx, episode_id)["status"] == "DRAFT"


def test_finalising_allocates_a_number_and_offers_the_print(client, app):
    episode_id = create(client, app)
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{episode_id}/calculate")
    response = client.post(f"/taep/{episode_id}/finalise")
    assert response.status_code == 302
    assert response.headers["Location"].endswith("/print")

    episode = taep.get_episode(app.ctx, episode_id)
    assert episode["status"] == "FINALISED"
    assert episode["costing_number"] == "OKY1054/0001"


def test_a_finalised_episode_cannot_have_its_services_changed(client, app):
    episode_id = create(client, app)
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{episode_id}/calculate")
    client.post(f"/taep/{episode_id}/finalise")

    response = client.post(f"/taep/{episode_id}/services",
                           data={"service_code": ["AED008"]}, follow_redirects=True)
    assert "δεν μπορεί να τροποποιηθεί" in response.get_data(as_text=True)
    assert taep.get_episode_service_codes(app.ctx, episode_id) == ["AED008", "AET057"]


# ---------------------------------------------------------------------------
# Tariff lines
# ---------------------------------------------------------------------------

def test_a_tariff_line_is_refused_for_a_non_self_paying_category(client, app):
    episode_id = create(client, app, code="624")
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    response = client.post(f"/taep/{episode_id}/calculate",
                           data={"tariff_code": "SHSO-ER11", "tariff_quantity": "1"},
                           follow_redirects=True)
    assert "δεν ισχύουν για την οικονομική κατηγορία" in response.get_data(as_text=True)


def test_a_tariff_line_is_charged_for_a_self_paying_patient(client, app):
    episode_id = create(client, app, code="600")
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{episode_id}/calculate",
                data={"tariff_code": "SHSO-ER11", "tariff_quantity": "2"})

    stored = taep.get_calculation(app.ctx, episode_id)
    assert taep.money_from_db(stored["tariff_total"]) == Decimal("40.00")
    assert taep.money_from_db(stored["total_cost"]) == Decimal("160.00")

    lines = app.ctx["db_execute"](
        "SELECT * FROM taep_episode_tariff_line WHERE episode_id=%s",
        (episode_id,), fetch=True)
    assert len(lines) == 1
    assert lines[0]["description_snapshot"] == "Καρδιογράφημα"


def test_consumables_without_a_note_is_refused(client, app):
    episode_id = create(client, app, code="600")
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    response = client.post(f"/taep/{episode_id}/calculate", data={
        "tariff_code": "SHSO-ER13", "tariff_quantity": "1",
        "tariff_consumables": "40.00", "tariff_note": "  "}, follow_redirects=True)
    assert "αιτιολογία" in response.get_data(as_text=True)


def test_an_imaging_line_prices_from_the_selected_cpt(client, app):
    episode_id = create(client, app, code="600")
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{episode_id}/calculate", data={
        "tariff_code": "SHSO-ER3", "tariff_quantity": "1", "tariff_cpt": "10006"})
    stored = taep.get_calculation(app.ctx, episode_id)
    assert taep.money_from_db(stored["tariff_total"]) == Decimal("29.50")


def test_an_unknown_tariff_code_is_refused(client, app):
    episode_id = create(client, app, code="600")
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    response = client.post(f"/taep/{episode_id}/calculate",
                           data={"tariff_code": "SHSO-NOPE", "tariff_quantity": "1"},
                           follow_redirects=True)
    assert "δεν βρέθηκε" in response.get_data(as_text=True)


# ---------------------------------------------------------------------------
# The printed document
# ---------------------------------------------------------------------------

def finalised(client, app, **overrides):
    episode_id = create(client, app, **overrides)
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{episode_id}/calculate")
    client.post(f"/taep/{episode_id}/finalise")
    return episode_id


def test_a_draft_cannot_be_printed(client, app):
    episode_id = create(client, app)
    response = client.get(f"/taep/{episode_id}/print", follow_redirects=True)
    assert "Μόνο οριστικοποιημένες" in response.get_data(as_text=True)


def test_the_print_route_returns_a_pdf(client, app):
    episode_id = finalised(client, app)
    response = client.get(f"/taep/{episode_id}/print")
    assert response.status_code == 200
    assert response.mimetype == "application/pdf"
    assert response.data.startswith(b"%PDF")
    assert "OKY1054-0001.pdf" in response.headers["Content-Disposition"]


def test_the_pdf_carries_the_required_blocks_and_totals(client, app):
    episode_id = finalised(client, app)
    text = pdf_text(taep.render_costing_pdf(app.ctx, episode_id))

    assert "ΚΟΣΤΟΛΟΓΗΣΗ ΠΕΡΙΣΤΑΤΙΚΟΥ" in text
    assert "ΠΡΟΣΩΠΙΚΑ ΔΕΔΟΜΕΝΑ" in text
    assert "Παπαδόπουλος" in text
    assert "Θεραπείες" in text and "Διαγνωστικές Παρεμβάσεις" in text
    assert "AED008" in text and "AET057" in text
    # The totals block, in the order the brief fixes — including Τέλος Εγγραφής,
    # which the supplied sample omits.
    assert "Κατηγοριοποίηση βάσει βαρύτητας" in text
    assert "Κοστολόγηση βάσει βαρύτητας" in text
    assert "Τέλος Εγγραφής" in text
    assert "Τελικό Κόστος" in text
    assert "OKY1054/0001" in text


def test_the_pdf_shows_the_greek_band_label(client, app):
    episode_id = finalised(client, app)
    text = pdf_text(taep.render_costing_pdf(app.ctx, episode_id))
    assert "Συνδυασμός διάγνωσης και θεραπείας" in text


def test_the_pdf_itemises_tariff_lines(client, app):
    episode_id = create(client, app, code="600")
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{episode_id}/calculate",
                data={"tariff_code": "SHSO-ER48", "tariff_quantity": "1"})
    client.post(f"/taep/{episode_id}/finalise")

    text = pdf_text(taep.render_costing_pdf(app.ctx, episode_id))
    assert "Οσφυονωτιαία παρακέντηση" in text
    assert "800,00" in text


def test_the_pdf_is_byte_identical_on_a_second_render(client, app):
    """Brief §12: the same episode must produce the same bytes. Every value comes
    from stored data, including the timestamp."""
    episode_id = finalised(client, app)
    first = taep.render_costing_pdf(app.ctx, episode_id)
    second = taep.render_costing_pdf(app.ctx, episode_id)
    assert first == second


def pdf_words(data):
    """Every word with its position, so layout faults are visible to a test."""
    from io import BytesIO

    import pdfplumber
    with pdfplumber.open(BytesIO(data)) as doc:
        return [(page_number, page.width, word)
                for page_number, page in enumerate(doc.pages, 1)
                for word in page.extract_words()]


def test_a_long_value_stays_inside_the_frame(client, app):
    """A long value used to be drawn at a fixed x and bleed into the margin.

    The specimen that went out for review had the relative's identification number
    hanging 42pt past the frame. Positions are checked rather than text because reading
    the text back cannot see it: the characters extract perfectly while sitting off the
    page.
    """
    episode_id = finalised(
        client, app,
        address="Λεωφόρος Αρχιεπισκόπου Μακαρίου Γ΄ 142, 2311 Λακατάμια, Λευκωσία",
        next_of_kin_type="Σύζυγος",
        next_of_kin_details="Μαρία Παπαδοπούλου-Κωνσταντινίδου 99654321",
        comments="Προσήλθε με πόνο στο στήθος. Παραπέμφθηκε στο Καρδιολογικό για "
                 "περαιτέρω έλεγχο και πιθανή εισαγωγή.")
    words = pdf_words(taep.render_costing_pdf(app.ctx, episode_id))
    # 18mm margin = 51pt; allow a point of rounding
    overflowing = [w["text"] for _, width, w in words if w["x1"] > width - 50]
    assert not overflowing, overflowing


def test_an_identification_number_is_never_truncated(client, app):
    """Shrinking to fit is acceptable; losing digits off a number is not."""
    episode_id = finalised(client, app,
                           next_of_kin_type="Σύζυγος",
                           next_of_kin_details="Μαρία Παπαδοπούλου 99654321")
    text = pdf_text(taep.render_costing_pdf(app.ctx, episode_id))
    assert "99654321" in text
    assert "\u2026" not in text


def pdf_text(data):
    """Extract text from PDF bytes.

    pdfplumber reads by x/y position, so overlapping strings come back interleaved.
    That is what exposed the totals-block collision; pypdf's line grouping hid it.
    Both are tried so the assertions hold with either installed.
    """
    from io import BytesIO
    try:
        import pdfplumber
        with pdfplumber.open(BytesIO(data)) as doc:
            return "\n".join(page.extract_text() or "" for page in doc.pages)
    except ImportError:
        pass
    try:
        from pypdf import PdfReader
        return "\n".join(page.extract_text() or ""
                         for page in PdfReader(BytesIO(data)).pages)
    except ImportError:          # pragma: no cover
        pytest.skip("no PDF text extractor available")


def test_the_totals_block_does_not_overprint_itself(client, app):
    """Regression: the band label was drawn beside its own caption and the two strings
    overlapped on the page. Reading the PDF back by position is what catches this."""
    episode_id = finalised(client, app)
    text = pdf_text(taep.render_costing_pdf(app.ctx, episode_id))
    assert "Κατηγοριοποίηση βάσει βαρύτητας" in text
    assert "Συνδυασμός διάγνωσης και θεραπείας μέσου κόστους" in text
    # Interleaving produced this fragment when the two collided.
    assert "βΣάυσνεδι" not in text


# ---------------------------------------------------------------------------
# Screen 3
# ---------------------------------------------------------------------------

def test_the_list_shows_the_episode(client, app):
    finalised(client, app)
    page = client.get("/taep/list").get_data(as_text=True)
    assert "OKY1054/0001" in page
    assert "Παπαδόπουλος" in page
    assert "120,00" in page


def test_the_list_is_scoped_to_the_active_hospital(client, app):
    finalised(client, app)
    taep.save_episode(app.ctx, {**{f: None for f in taep.EPISODE_FIELDS},
                                "id_number": "777", "last_name": "Λεμεσιανός",
                                "examination_at": YESTERDAY,
                                "financial_category_id": app.ctx["db_execute"](
                                    "SELECT id FROM taep_financial_category "
                                    "WHERE code_new='624'", fetch=True)[0]["id"]},
                      entity_code="LGH", unit_code="LGH", user_id=1)
    page = client.get("/taep/list").get_data(as_text=True)
    assert "Παπαδόπουλος" in page
    assert "Λεμεσιανός" not in page


def test_the_list_filters_by_status(client, app):
    finalised(client, app, episode_number="E-1")
    create(client, app, episode_number="E-2", id_number="7654321")

    finalised_page = client.get("/taep/list?status=FINALISED").get_data(as_text=True)
    assert "OKY1054/0001" in finalised_page
    draft_page = client.get("/taep/list?status=DRAFT").get_data(as_text=True)
    assert "OKY1054/0001" not in draft_page


def test_the_list_filters_by_identification_number(client, app):
    finalised(client, app, episode_number="E-1")
    create(client, app, episode_number="E-2", id_number="7654321",
           last_name="Γεωργίου")
    page = client.get("/taep/list?id_number=7654321").get_data(as_text=True)
    assert "Γεωργίου" in page and "Παπαδόπουλος" not in page


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------

def test_cancelling_keeps_the_number_and_needs_a_reason(client, app):
    episode_id = finalised(client, app)
    response = client.post(f"/taep/{episode_id}/cancel", data={"reason": " "},
                           follow_redirects=True)
    assert "αιτιολογία" in response.get_data(as_text=True)

    client.post(f"/taep/{episode_id}/cancel",
                data={"reason": "Λάθος οικονομική κατηγορία"})
    episode = taep.get_episode(app.ctx, episode_id)
    assert episode["status"] == "CANCELLED"
    assert episode["costing_number"] == "OKY1054/0001"


# ---------------------------------------------------------------------------
# Lookup by costing number, and the code on the document
# ---------------------------------------------------------------------------

def test_the_printed_number_opens_its_own_costing(client, app):
    episode_id = finalised(client, app)
    number = taep.get_episode(app.ctx, episode_id)["costing_number"]
    response = client.get("/taep/find", query_string={"number": number})
    assert response.status_code == 302
    assert response.headers["Location"].endswith("/taep/%d" % episode_id)


def test_a_number_typed_loosely_still_opens_it(client, app):
    """What a person reads off paper, not what a scanner sends."""
    episode_id = finalised(client, app)
    number = taep.get_episode(app.ctx, episode_id)["costing_number"]
    loose = number.replace("OKY", "").replace("/0", "/").lower()
    response = client.get("/taep/find", query_string={"number": loose})
    assert response.headers["Location"].endswith("/taep/%d" % episode_id)


def test_an_unknown_number_says_so_without_a_server_error(client, app):
    response = client.get("/taep/find", query_string={"number": "OKY1054/9999"},
                          follow_redirects=True)
    assert response.status_code == 200
    assert "Δεν βρέθηκε κοστολόγηση" in response.get_data(as_text=True)


def test_an_empty_box_asks_for_a_number(client, app):
    response = client.get("/taep/find", query_string={"number": "  "},
                          follow_redirects=True)
    assert "Δώστε αριθμό κοστολόγησης" in response.get_data(as_text=True)


def test_another_hospitals_number_reads_as_not_found(client, app):
    """Brief §13. The answer must not reveal that the costing exists."""
    episode_id = finalised(client, app)
    number = taep.get_episode(app.ctx, episode_id)["costing_number"]
    # the harness ctx grants NGH only; move the episode to Λεμεσός
    app.ctx["db_execute"]("UPDATE taep_episode SET entity_code='LGH' WHERE id=%s",
                          (episode_id,))

    response = client.get("/taep/find", query_string={"number": number},
                          follow_redirects=True)
    page = response.get_data(as_text=True)
    assert "Δεν βρέθηκε κοστολόγηση" in page
    # identical wording to a number that does not exist at all, and no redirect to it
    assert "/taep/%d" % episode_id not in page


def test_the_document_carries_the_number_as_a_scannable_code(client, app):
    """Decoded from a rendered page, because drawing it is not the same as it scanning."""
    cv2 = pytest.importorskip("cv2")
    pdfium = pytest.importorskip("pypdfium2")
    import numpy as np
    from io import BytesIO

    episode_id = finalised(client, app)
    number = taep.get_episode(app.ctx, episode_id)["costing_number"]
    pdf = taep.render_costing_pdf(app.ctx, episode_id)

    document = pdfium.PdfDocument(BytesIO(pdf))
    # 150 dpi is a poor scan; if it reads there it reads on the desk
    image = np.array(document[0].render(scale=150 / 72).to_pil().convert("L"))
    decoded, *_ = cv2.QRCodeDetector().detectAndDecode(image)
    assert decoded == number


def test_the_code_does_not_sit_on_top_of_any_text(client, app):
    """It is drawn, so the word-position checks cannot see it. Check the square is clear."""
    mm = 72 / 25.4
    episode_id = finalised(client, app)
    words = pdf_words(taep.render_costing_pdf(app.ctx, episode_id))
    for _, width, word in words:
        # the 14mm square sits against the 18mm right margin, 7mm to 21mm from the top
        x0, x1 = width - 32 * mm, width - 18 * mm
        inside_x = word["x1"] > x0 and word["x0"] < x1
        inside_y = word["bottom"] > 7 * mm and word["top"] < 21 * mm
        assert not (inside_x and inside_y), word["text"]


# ---------------------------------------------------------------------------
# The cashier: taep.view reads, and only reads
# ---------------------------------------------------------------------------

def as_cashier(app):
    """Restrict the session to taep.view alone."""
    granted = app.ctx["granted_permissions"]
    granted.clear()
    granted.add(taep.PERMISSIONS["view"])


def test_a_cashier_opens_a_costing_from_the_printed_number(client, app):
    episode_id = finalised(client, app)
    number = taep.get_episode(app.ctx, episode_id)["costing_number"]
    as_cashier(app)

    response = client.get("/taep/find", query_string={"number": number})
    assert response.status_code == 302
    assert response.headers["Location"].endswith("/taep/%d" % episode_id)
    assert client.get("/taep/%d" % episode_id).status_code == 200
    assert client.get("/taep/list").status_code == 200


def test_a_cashier_can_reprint_and_the_reprint_is_logged(client, app):
    episode_id = finalised(client, app)
    as_cashier(app)
    before = len(app.ctx["activity_log"])

    response = client.get("/taep/%d/print" % episode_id)
    assert response.status_code == 200
    assert response.mimetype == "application/pdf"

    entries = app.ctx["activity_log"][before:]
    assert [e[2] for e in entries] == ["PRINTED"]
    assert entries[0][3] == taep.get_episode(app.ctx, episode_id)["costing_number"]


@pytest.mark.parametrize("method,path,data", [
    ("get", "/taep/nea", None),
    ("post", "/taep/nea", {}),
    ("post", "/taep/%d/services", {"service_code": ["AED008"]}),
    ("post", "/taep/%d/calculate", {}),
    ("post", "/taep/%d/finalise", {}),
    ("post", "/taep/%d/cancel", {"reason": "δοκιμή"}),
    ("get", "/taep/rates", None),
    ("get", "/taep/readiness", None),
    ("get", "/taep/list/export", None),
])
def test_a_cashier_cannot_write_anything(client, app, method, path, data):
    episode_id = finalised(client, app)
    as_cashier(app)

    url = path % episode_id if "%d" in path else path
    response = getattr(client, method)(url, data=data)
    assert response.status_code == 403, (url, response.status_code)


def test_the_cashier_key_does_not_widen_the_hospital_scope(client, app):
    """Read-only is still read-only within one hospital — brief §13."""
    episode_id = finalised(client, app)
    number = taep.get_episode(app.ctx, episode_id)["costing_number"]
    app.ctx["db_execute"]("UPDATE taep_episode SET entity_code='LGH' WHERE id=%s",
                          (episode_id,))
    as_cashier(app)

    page = client.get("/taep/find", query_string={"number": number},
                      follow_redirects=True).get_data(as_text=True)
    assert "Δεν βρέθηκε κοστολόγηση" in page
    assert client.get("/taep/%d" % episode_id).status_code == 404


def test_a_clerk_still_reaches_the_read_only_screens(client, app):
    """taep.create keeps everything it had; taep.view only adds a second way in."""
    episode_id = finalised(client, app)
    granted = app.ctx["granted_permissions"]
    granted.clear()
    granted.update({taep.PERMISSIONS["create"], taep.PERMISSIONS["finalise"]})

    assert client.get("/taep/list").status_code == 200
    assert client.get("/taep/%d" % episode_id).status_code == 200
    assert client.get("/taep/%d/print" % episode_id).status_code == 200


def test_a_host_without_has_permission_is_refused_not_waved_through(app):
    """Fail closed: a missing ctx key must not expose patient data."""
    from flask import Flask
    ctx = dict(app.ctx)
    ctx.pop("has_permission", None)
    bare = Flask("no_has_permission",
                 template_folder=app.jinja_loader.searchpath[0])
    bare.secret_key = "test"
    taep.register(bare, ctx)
    client = bare.test_client()
    with client.session_transaction() as sess:
        sess["user_id"] = 1
        sess["hospital_code"] = "NGH"
    assert client.get("/taep/list").status_code == 403


# ---------------------------------------------------------------------------
# The entry form's two dropdowns
# ---------------------------------------------------------------------------

def test_a_unit_less_entity_explains_itself_instead_of_showing_an_empty_box(app):
    """Found in testing: an admin on HQ saw an empty ΤΑΕΠ dropdown and no reason why.

    HQ is the central office and hosts no unit, so the list is correctly empty — but
    silence reads as a broken screen.
    """
    client = app.test_client()
    app.ctx["user_entity"] = lambda: "HQ"
    with client.session_transaction() as sess:
        sess["user_id"] = 1
        sess["hospital_code"] = "HQ"

    page = client.get("/taep/nea").get_data(as_text=True)
    assert "δεν φιλοξενεί μονάδα ΤΑΕΠ" in page
    assert "HQ" in page
    assert '<select id="taep_unit_code"' not in page


def test_a_hospital_still_gets_its_units(client, app):
    page = client.get("/taep/nea").get_data(as_text=True)
    assert '<select id="taep_unit_code"' in page
    assert "NGH-ADULT" in page and "NGH-PAED" in page
    assert "δεν φιλοξενεί" not in page


def test_the_country_field_is_a_list_with_cyprus_first(client, app):
    page = client.get("/taep/nea").get_data(as_text=True)
    assert '<select id="id_country"' in page
    assert "Κύπρος" in page and "Συρία" in page and "Ουκρανία" in page
    countries = taep.list_countries(app.ctx)
    assert countries[0]["name_el"] == "Κύπρος"
    assert len(countries) == 257


def test_a_country_not_in_the_list_is_not_silently_blanked(client, app):
    """A value that predates the dropdown must survive a redisplay of the form.

    The form comes back populated when a save fails validation. Posting with no ΤΑΕΠ
    unit forces that path, which is the one that would otherwise drop the value.
    """
    page = client.post("/taep/nea", data={"id_country": "Γιουγκοσλαβία",
                                          "last_name": "Παπαδόπουλος"}).get_data(
        as_text=True)
    assert '<option value="Γιουγκοσλαβία" selected>' in page


def test_a_chosen_country_is_stored_as_given(client, app):
    episode_id = create(client, app, id_country="Συρία")
    assert taep.get_episode(app.ctx, episode_id)["id_country"] == "Συρία"


# ---------------------------------------------------------------------------
# Correcting an episode before the number is issued (UAT 21/10/2026)
# ---------------------------------------------------------------------------

def test_the_edit_screen_arrives_prefilled(client, app):
    episode_id = create(client, app, phone="99000000",
                        address="Λάθος διεύθυνση 1")
    page = client.get("/taep/%d/edit" % episode_id).get_data(as_text=True)
    assert "Διόρθωση Καταχώρησης" in page
    assert "99000000" in page and "Λάθος διεύθυνση 1" in page


def test_dates_and_times_come_back_in_a_form_the_browser_accepts(client, app):
    """Chrome silently blanks a datetime-local it cannot parse, so the seconds must go."""
    episode_id = create(client, app, date_of_birth="1968-03-11",
                        admission_at="2026-09-14T21:40",
                        examination_at="2026-09-14T22:05",
                        discharge_at="2026-09-15T00:50")
    page = client.get("/taep/%d/edit" % episode_id).get_data(as_text=True)
    assert 'value="1968-03-11"' in page
    assert 'value="2026-09-14T22:05"' in page


def test_a_correction_is_saved_and_logged(client, app):
    episode_id = create(client, app, phone="99000000")
    before = len(app.ctx["activity_log"])

    response = client.post("/taep/%d/edit" % episode_id, data=dict(
        form_fields(app.ctx), phone="99111111", address="Σωστή διεύθυνση 5"),
        follow_redirects=True)
    assert response.status_code == 200

    episode = taep.get_episode(app.ctx, episode_id)
    assert episode["phone"] == "99111111"
    assert episode["address"] == "Σωστή διεύθυνση 5"
    assert "UPDATED" in [e[2] for e in app.ctx["activity_log"][before:]]


def test_correcting_a_calculated_episode_throws_the_price_away(client, app):
    """The financial category decides the amount, so a stale result must not survive.

    Without this the desk would correct the category and keep looking at the old total,
    which is the worst possible failure: a number that looks authoritative and is wrong.
    """
    episode_id = create(client, app)
    client.post("/taep/%d/services" % episode_id,
                data={"service_code": ["AED008", "AET057"]})
    client.post("/taep/%d/calculate" % episode_id)
    assert taep.get_episode(app.ctx, episode_id)["status"] == "CALCULATED"

    client.post("/taep/%d/edit" % episode_id, data=form_fields(app.ctx))

    assert taep.get_episode(app.ctx, episode_id)["status"] == "DRAFT"
    assert app.ctx["db_execute"](
        "SELECT episode_id FROM taep_costing_result WHERE episode_id=%s",
        (episode_id,), fetch=True) == []


def test_a_finalised_episode_cannot_be_edited(client, app):
    """Brief §10: it is cancelled and re-entered, never quietly changed."""
    episode_id = finalised(client, app)
    page = client.get("/taep/%d/edit" % episode_id,
                      follow_redirects=True).get_data(as_text=True)
    assert "δεν τροποποιείται" in page

    client.post("/taep/%d/edit" % episode_id, data=dict(form_fields(app.ctx),
                                                        phone="99999999"))
    assert taep.get_episode(app.ctx, episode_id)["phone"] != "99999999"


def test_another_hospitals_episode_cannot_be_edited(client, app):
    episode_id = create(client, app)
    app.ctx["db_execute"]("UPDATE taep_episode SET entity_code='LGH' WHERE id=%s",
                          (episode_id,))
    assert client.get("/taep/%d/edit" % episode_id).status_code == 404


# ---------------------------------------------------------------------------
# The service pickers (UAT 21/10/2026)
# ---------------------------------------------------------------------------

def test_the_whole_catalogue_is_on_the_screen_not_just_search(client, app):
    """The desk is secretarial: search alone meant knowing the term before looking."""
    episode_id = create(client, app)
    page = client.get("/taep/%d" % episode_id).get_data(as_text=True)

    catalogue = taep.list_services(app.ctx)
    assert len(catalogue[taep.TREATMENT]) == 98
    assert len(catalogue[taep.INVESTIGATION]) == 27
    for service in catalogue[taep.TREATMENT] + catalogue[taep.INVESTIGATION]:
        assert 'value="%s"' % service["code"] in page, service["code"]


def test_the_pickers_are_grouped_by_oay_category(client, app):
    episode_id = create(client, app)
    page = client.get("/taep/%d" % episode_id).get_data(as_text=True)
    assert page.count("<optgroup") == 8      # treatments 1-5, investigations 1-3


def test_an_already_chosen_service_comes_back_selected(client, app):
    episode_id = create(client, app)
    client.post("/taep/%d/services" % episode_id,
                data={"service_code": ["AED008", "AET057"]})
    page = client.get("/taep/%d" % episode_id).get_data(as_text=True)
    for code in ("AED008", "AET057"):
        # the attributes wrap across lines in the template, so match the whole tag
        assert re.search(r'<option value="%s"[^>]*\bselected\b' % code, page), code
    # and one that was not chosen must not carry it
    assert not re.search(r'<option value="AET003"[^>]*\bselected\b', page)


def test_the_search_finds_a_service_by_its_english_description(app):
    """The codes are English and the catalogue came from ΟΑΥ in English.

    Before this, a clerk who knew the English term had no way to reach the row.
    """
    hits = taep.search_services(app.ctx, "supplemental oxygen")
    assert "AET057" in [h["code"] for h in hits]

    greek = taep.search_services(app.ctx, "οξυγονο")
    assert "AET057" in [h["code"] for h in greek]


def test_english_descriptions_actually_reached_the_database(app):
    """The column existed in the CSV and in nothing else until 21/10."""
    rows = app.ctx["db_execute"](
        "SELECT COUNT(*) AS n FROM taep_service WHERE description_en IS NOT NULL "
        "AND description_en <> ''", fetch=True)
    assert rows[0]["n"] == 125
