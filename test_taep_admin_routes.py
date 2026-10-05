"""
Administration screens: rates, the tariff Excel round trip, the list export.
"""
import datetime as dt
from decimal import Decimal
from io import BytesIO

import pytest
from openpyxl import load_workbook

import taep


@pytest.fixture
def rates_admin(app):
    """A session holding only the rates permission, as a rates_admin would."""
    app.ctx["granted_permissions"].update({taep.PERMISSIONS["rates"],
                                           taep.PERMISSIONS["create"]})
    client = app.test_client()
    with client.session_transaction() as sess:
        sess["user_id"] = 9
        sess["hospital_code"] = "NGH"
    return client


def category_id(ctx, code):
    return ctx["db_execute"](
        "SELECT id FROM taep_financial_category WHERE code_new=%s", (code,),
        fetch=True)[0]["id"]


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------

def test_the_rate_screens_need_the_rates_permission(app):
    app.ctx["granted_permissions"].add(taep.PERMISSIONS["create"])
    clerk = app.test_client()
    with clerk.session_transaction() as sess:
        sess["user_id"] = 1
    for path in ("/taep/rates", "/taep/tariff", "/taep/tariff/download"):
        assert clerk.get(path).status_code == 403


def test_the_rate_screens_require_a_session(app):
    assert app.test_client().get("/taep/rates").status_code == 401


# ---------------------------------------------------------------------------
# The rate screen
# ---------------------------------------------------------------------------

def test_the_rate_screen_shows_the_scale_and_the_fees(rates_admin):
    page = rates_admin.get("/taep/rates").get_data(as_text=True)
    assert "Κλίμακα βαρύτητας" in page
    assert "60,00" in page and "120,00" in page and "180,00" in page
    assert "Διαλογή" in page and "10,00" in page
    assert "603 — ΔΙΚΑΙΟΥΧΟΣ Α" in page


def test_the_three_fee_states_are_labelled_differently(rates_admin, app):
    app.ctx["db_execute"](
        "DELETE FROM taep_rate WHERE rate_type='REGISTRATION_FEE' "
        "AND financial_category_id=%s", (category_id(app.ctx, "620"),))
    page = rates_admin.get("/taep/rates").get_data(as_text=True)
    assert "Ορισμένο" in page
    assert "Εξαιρείται" in page
    assert "Δεν έχει οριστεί" in page


def test_the_only_unset_filter_narrows_the_list(rates_admin, app):
    app.ctx["db_execute"](
        "DELETE FROM taep_rate WHERE rate_type='REGISTRATION_FEE' "
        "AND financial_category_id=%s", (category_id(app.ctx, "620"),))
    page = rates_admin.get("/taep/rates?only_unset=1").get_data(as_text=True)
    assert "620" in page
    assert "603 — ΔΙΚΑΙΟΥΧΟΣ Α" not in page


def test_changing_a_rate_through_the_screen(rates_admin, app):
    response = rates_admin.post("/taep/rates/change", data={
        "rate_type": "REGISTRATION_FEE",
        "financial_category_id": str(category_id(app.ctx, "603")),
        "amount": "25.00", "effective_from": "2027-01-01",
        "source_document": "Απόφαση ΔΣ 77/2026"}, follow_redirects=True)
    assert "Η προηγούμενη περίοδος έκλεισε" in response.get_data(as_text=True)

    rates = taep.rates_in_force(app.ctx, category_id(app.ctx, "603"),
                                dt.date(2027, 6, 1))
    assert rates.registration_fee == Decimal("25.00")
    # The old period still prices an old episode.
    old = taep.rates_in_force(app.ctx, category_id(app.ctx, "603"), dt.date(2026, 6, 1))
    assert old.registration_fee == Decimal("10.00")


def test_a_change_without_a_source_document_is_refused(rates_admin, app):
    response = rates_admin.post("/taep/rates/change", data={
        "rate_type": "TRIAGE_AMOUNT", "amount": "12.00",
        "effective_from": "2027-01-01", "source_document": ""},
        follow_redirects=True)
    assert "έγγραφο απόφασης" in response.get_data(as_text=True)


def test_a_backdated_change_is_refused_through_the_screen(rates_admin):
    rates_admin.post("/taep/rates/change", data={
        "rate_type": "TRIAGE_AMOUNT", "amount": "12.00",
        "effective_from": "2027-01-01", "source_document": "Α"})
    response = rates_admin.post("/taep/rates/change", data={
        "rate_type": "TRIAGE_AMOUNT", "amount": "14.00",
        "effective_from": "2026-06-01", "source_document": "Β"},
        follow_redirects=True)
    assert "κλεισμένη περίοδο" in response.get_data(as_text=True)


def test_the_history_screen_shows_every_period(rates_admin, app):
    rates_admin.post("/taep/rates/change", data={
        "rate_type": "REGISTRATION_FEE",
        "financial_category_id": str(category_id(app.ctx, "603")),
        "amount": "25.00", "effective_from": "2027-01-01",
        "source_document": "Απόφαση ΔΣ 77/2026"})
    page = rates_admin.get(
        f"/taep/rates/history?rate_type=REGISTRATION_FEE"
        f"&financial_category_id={category_id(app.ctx, '603')}").get_data(as_text=True)
    assert "10,00" in page and "25,00" in page
    assert "Απόφαση ΔΣ 77/2026" in page
    assert "σε ισχύ" in page


def test_an_overlap_is_announced_on_the_rate_screen(rates_admin, app):
    app.ctx["db_execute"](
        """INSERT INTO taep_rate (rate_type, weight, amount, valid_from,
           source_document, series_key)
           VALUES ('WEIGHT_AMOUNT', 4, '99.00', '2026-06-01', 'χειρ.', 'manual')""")
    page = rates_admin.get("/taep/rates").get_data(as_text=True)
    assert "Επικαλυπτόμενες περίοδοι" in page


# ---------------------------------------------------------------------------
# The tariff round trip through the screens
# ---------------------------------------------------------------------------

def test_the_tariff_screen_lists_the_tariff(rates_admin):
    page = rates_admin.get("/taep/tariff").get_data(as_text=True)
    assert "Καρδιογράφημα" in page
    assert "Πλύση οφθαλμού, 3 ώρες" in page
    assert "tariff_lookup" in page


def test_the_download_is_a_workbook(rates_admin):
    response = rates_admin.get("/taep/tariff/download")
    assert response.status_code == 200
    assert "spreadsheetml" in response.mimetype
    assert "timokatalogos_taep_" in response.headers["Content-Disposition"]
    sheet = load_workbook(BytesIO(response.data))[taep.TARIFF_SHEET]
    assert sheet.max_row == 53


def edited(ctx, **kwargs):
    import test_taep_excel as excel
    return excel.edit_download(ctx, **kwargs)


def test_uploading_shows_a_diff_and_applies_nothing_yet(rates_admin, app):
    data = edited(app.ctx, changes=[("SHSO-ER11", 6, 25)])
    response = rates_admin.post("/taep/tariff/upload", data={
        "workbook": (BytesIO(data), "tariff.xlsx")},
        content_type="multipart/form-data")
    page = response.get_data(as_text=True)
    assert "Διαφορές προς επιβεβαίωση" in page
    assert "Αλλαγές (1)" in page

    unchanged = app.ctx["db_execute"](
        "SELECT base_amount FROM taep_tariff WHERE code='SHSO-ER11'", fetch=True)
    assert taep.money_from_db(unchanged[0]["base_amount"]) == Decimal("20.00")


def test_confirming_the_diff_applies_it(rates_admin, app):
    data = edited(app.ctx, changes=[("SHSO-ER11", 6, 25)])
    rates_admin.post("/taep/tariff/upload",
                     data={"workbook": (BytesIO(data), "tariff.xlsx")},
                     content_type="multipart/form-data")
    response = rates_admin.post("/taep/tariff/apply", follow_redirects=True)
    assert "1 αλλαγές" in response.get_data(as_text=True)

    changed = app.ctx["db_execute"](
        "SELECT base_amount FROM taep_tariff WHERE code='SHSO-ER11'", fetch=True)
    assert taep.money_from_db(changed[0]["base_amount"]) == Decimal("25.00")


def test_a_file_with_errors_shows_them_and_offers_no_apply(rates_admin, app):
    data = edited(app.ctx, changes=[("SHSO-ER11", 5, "nonsense")])
    response = rates_admin.post("/taep/tariff/upload",
                                data={"workbook": (BytesIO(data), "tariff.xlsx")},
                                content_type="multipart/form-data")
    page = response.get_data(as_text=True)
    assert "Δεν εφαρμόστηκε τίποτα" in page
    assert "Μη έγκυρος τύπος τιμής" in page
    assert "Εφαρμογή όλων" not in page


def test_applying_without_an_upload_is_refused(rates_admin):
    response = rates_admin.post("/taep/tariff/apply", follow_redirects=True)
    assert "Ανεβάστε το ξανά" in response.get_data(as_text=True)


def test_an_upload_cannot_be_applied_twice(rates_admin, app):
    data = edited(app.ctx, changes=[("SHSO-ER11", 6, 25)])
    rates_admin.post("/taep/tariff/upload",
                     data={"workbook": (BytesIO(data), "tariff.xlsx")},
                     content_type="multipart/form-data")
    rates_admin.post("/taep/tariff/apply")
    second = rates_admin.post("/taep/tariff/apply", follow_redirects=True)
    assert "Ανεβάστε το ξανά" in second.get_data(as_text=True)


def test_no_file_is_refused(rates_admin):
    response = rates_admin.post("/taep/tariff/upload", data={},
                                content_type="multipart/form-data",
                                follow_redirects=True)
    assert "Επιλέξτε αρχείο" in response.get_data(as_text=True)


# ---------------------------------------------------------------------------
# The list export
# ---------------------------------------------------------------------------

def test_the_list_offers_an_export_link_carrying_the_filters(client, app):
    page = client.get("/taep/list?status=FINALISED").get_data(as_text=True)
    assert 'id="export"' in page
    assert "status=FINALISED" in page
    assert "None" not in page.split('id="export"')[0].split("<a href=")[-1]


def test_the_export_returns_a_workbook_with_live_formulas(client, app):
    import test_taep_routes as routes
    episode_id = routes.create(client, app)
    client.post(f"/taep/{episode_id}/services",
                data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{episode_id}/calculate")
    client.post(f"/taep/{episode_id}/finalise")

    response = client.get("/taep/list/export")
    assert response.status_code == 200
    assert "spreadsheetml" in response.mimetype
    sheet = load_workbook(BytesIO(response.data)).active
    assert sheet.cell(2, 1).value == "OKY1054/0001"
    formulas = [c.value for row in sheet.iter_rows() for c in row
                if isinstance(c.value, str) and c.value.startswith("=")]
    assert any(f.startswith("=SUM(") for f in formulas)


def test_the_export_respects_a_status_filter(client, app):
    import test_taep_routes as routes
    first = routes.create(client, app, episode_number="E-1")
    client.post(f"/taep/{first}/services", data={"service_code": ["AED008", "AET057"]})
    client.post(f"/taep/{first}/calculate")
    client.post(f"/taep/{first}/finalise")
    routes.create(client, app, episode_number="E-2", id_number="7654321")

    everything = load_workbook(BytesIO(
        client.get("/taep/list/export").data)).active
    finalised = load_workbook(BytesIO(
        client.get("/taep/list/export?status=FINALISED").data)).active
    assert everything.max_row > finalised.max_row
