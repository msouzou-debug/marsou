# -*- coding: utf-8 -*-
"""
ICD-10: the catalogue, the search, and the rule that it must be there to finalise.

The Μονάδα Ελέγχου Εσόδων made the diagnosis mandatory on 22/10/2026 and supplied the
catalogue on 26/10. It does not touch the price — the ΟΑΥ algorithm takes the weight
from the services chosen — so everything here is about the record, not the arithmetic.
"""
import os
import time
from decimal import Decimal

import pytest

import taep
from test_taep_routes import create, form_fields, pdf_text


# The catalogue is the Μονάδα's Greek translation of 10.560 diagnoses and is the one
# seed file deliberately not in this repository, which is public (23/10/2026 decision).
# A clone without it runs everything else and says plainly why these are skipped,
# rather than failing in a way somebody would have to investigate.
pytestmark = pytest.mark.skipif(
    not os.path.exists(os.path.join(taep.SEED_DIR, "icd10.csv")),
    reason="seed/icd10.csv is not present — see docs/deployment-runbook.md §1c")


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------

def test_the_whole_catalogue_is_seeded(seeded):
    rows = seeded["db_execute"](
        "SELECT COUNT(*) AS n FROM taep_diagnosis", fetch=True)[0]
    assert rows["n"] == 10560

    blank = seeded["db_execute"](
        """SELECT code FROM taep_diagnosis
           WHERE description_el IS NULL OR description_el = ''
              OR search_text IS NULL OR search_text = ''""", fetch=True)
    assert blank == []


def test_the_codes_the_unit_sent_that_are_not_standard_are_kept(seeded):
    """QA02 is not an ICD-10 shape. It is in the Μονάδα's file, so it is in ours: the
    catalogue is theirs to rule on, not ours to prune."""
    assert taep.get_diagnosis(seeded, "QA02") is not None


# ---------------------------------------------------------------------------
# Finding one
# ---------------------------------------------------------------------------

def test_search_by_code(seeded):
    hits = taep.search_diagnoses(seeded, "J18")
    codes = [hit["code"] for hit in hits]
    assert "J18.9" in codes
    # An exact or prefix code match sorts above a description that mentions it.
    assert codes[0].startswith("J18")


def test_search_by_greek_without_accents(seeded):
    """Brief §11, and the reason the folded column exists."""
    with_accents = [h["code"] for h in taep.search_diagnoses(seeded, "Χολέρα")]
    without = [h["code"] for h in taep.search_diagnoses(seeded, "χολερα")]
    assert with_accents == without
    assert "A00.9" in without


def test_search_by_english(seeded):
    """The descriptions arrived in both languages; a clerk who knows one should not
    have to guess the other."""
    assert "A00.9" in [h["code"] for h in taep.search_diagnoses(seeded, "cholera")]
    assert "J18.9" in [h["code"] for h in taep.search_diagnoses(seeded, "pneumonia")]


def test_search_is_fast_enough_to_type_against(seeded):
    """Folding all 10.560 rows per keystroke measured 250 ms, which a clerk would feel.
    The folded column is built once at seed time instead."""
    start = time.time()
    for term in ("πνευ", "chol", "J18", "καταγμα", "fract"):
        taep.search_diagnoses(seeded, term)
    elapsed = (time.time() - start) / 5
    assert elapsed < 0.08, "%.0f ms per search" % (elapsed * 1000)


def test_an_empty_term_returns_nothing_rather_than_everything(seeded):
    assert taep.search_diagnoses(seeded, "") == []
    assert taep.search_diagnoses(seeded, "   ") == []


def test_the_search_endpoint_answers_in_both_languages(client):
    body = client.get("/taep/api/diagnoses?q=pneumonia").get_json()
    assert body["results"]
    first = body["results"][0]
    assert set(first) == {"id", "code", "description_el", "description_en", "text"}
    assert first["text"].startswith(first["code"])


# ---------------------------------------------------------------------------
# Recording one
# ---------------------------------------------------------------------------

def test_the_description_is_taken_from_the_catalogue_not_the_post(client, app):
    """A description arriving with the form could say anything."""
    episode_id = create(client, app, diagnosis_code="J18.9",
                        diagnosis_text="ΟΤΙΔΗΠΟΤΕ ΘΕΛΩ")
    episode = taep.get_episode(app.ctx, episode_id)
    assert episode["diagnosis_code"] == "J18.9"
    assert episode["diagnosis_text"] == taep.get_diagnosis(
        app.ctx, "J18.9")["description_el"]
    assert "ΟΤΙΔΗΠΟΤΕ" not in (episode["diagnosis_text"] or "")


def test_a_code_outside_the_catalogue_is_refused(client, app):
    response = client.post("/taep/nea", data=form_fields(
        app.ctx, diagnosis_code="ZZ99.9"))
    assert response.status_code == 200
    assert "δεν βρέθηκε στον κατάλογο" in response.get_data(as_text=True)
    assert app.ctx["db_execute"]("SELECT id FROM taep_episode", fetch=True) == []


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------

def test_an_episode_without_a_diagnosis_can_be_entered_and_priced(client, app):
    """Deliberately not required on save: a clerk admitting a patient often has no
    diagnosis yet, and refusing the entry would push them into inventing one."""
    episode_id = create(client, app, diagnosis_code="")
    assert taep.get_episode(app.ctx, episode_id)["diagnosis_code"] is None
    assert client.post("/taep/%d/calculate" % episode_id).status_code == 302
    assert taep.get_calculation(app.ctx, episode_id) is not None


def test_but_it_cannot_be_finalised(client, app):
    episode_id = create(client, app, diagnosis_code="")
    client.post("/taep/%d/calculate" % episode_id)
    response = client.post("/taep/%d/finalise" % episode_id, follow_redirects=True)

    assert "Η διάγνωση (ICD-10) είναι υποχρεωτική" in response.get_data(as_text=True)
    episode = taep.get_episode(app.ctx, episode_id)
    assert episode["status"] != "FINALISED"
    assert episode["costing_number"] is None
    # And the screen says so before the clerk reaches for the button.
    assert 'id="no-diagnosis"' in client.get(
        "/taep/%d" % episode_id).get_data(as_text=True)


def test_adding_the_diagnosis_unblocks_it(client, app):
    episode_id = create(client, app, diagnosis_code="")
    client.post("/taep/%d/calculate" % episode_id)
    client.post("/taep/%d/edit" % episode_id,
                data=dict(form_fields(app.ctx), diagnosis_code="S52.5"))
    client.post("/taep/%d/calculate" % episode_id)
    assert client.post("/taep/%d/finalise" % episode_id).status_code == 302
    assert taep.get_episode(app.ctx, episode_id)["costing_number"]


def test_the_diagnosis_does_not_move_the_price(client, app):
    """It is a record-keeping rule, not an arithmetic one."""
    totals = []
    for index, code in enumerate(("J18.9", "S52.5")):
        episode_id = create(client, app, diagnosis_code=code,
                            episode_number="E-DX-%d" % index,
                            id_number="900000%d" % index)
        client.post("/taep/%d/services" % episode_id,
                    data={"service_code": ["AED008", "AET057"]})
        client.post("/taep/%d/calculate" % episode_id)
        totals.append(taep.money_from_db(
            taep.get_calculation(app.ctx, episode_id)["total_cost"]))
    assert totals[0] == totals[1] == Decimal("120.00")


def test_the_export_carries_the_diagnosis(client, app):
    from io import BytesIO
    from openpyxl import load_workbook
    from test_taep_excel import cell

    episode_id = create(client, app, diagnosis_code="J18.9")
    client.post("/taep/%d/calculate" % episode_id)
    client.post("/taep/%d/finalise" % episode_id)

    sheet = load_workbook(BytesIO(
        taep.export_episodes_workbook(app.ctx, "NGH"))).active
    assert cell(sheet, 2, "ICD-10") == "J18.9"
    assert "Πνευμονία" in cell(sheet, 2, "Διάγνωση")


# ---------------------------------------------------------------------------
# When the search box does not load (reported 30/10/2026)
# ---------------------------------------------------------------------------

def test_the_screen_carries_a_plain_code_field_behind_the_search_box(client):
    """The clerk reported the ICD-10 box doing nothing. The server was answering
    correctly, so the box had failed in the browser.

    Every other dropdown on that screen degrades to a plain list. This one cannot:
    10.560 codes do not fit in the page, so with no search there is nothing to pick
    from — and a diagnosis is mandatory to finalise, so a dead box stops every costing
    at the hospital. A plain code field stands behind it, disabled so it is not posted
    while the search works, and the script hands it the name when the search does not.
    """
    page = client.get("/taep/nea").get_data(as_text=True)
    assert 'id="diagnosis_code_typed"' in page
    # Disabled, so the normal path posts one diagnosis_code and not two.
    assert page.count('name="diagnosis_code"') == 1
    assert "data-no-search=" in page


def test_a_typed_code_saves_exactly_as_a_chosen_one_does(client, app):
    """The fallback needs no server change, and this is the assertion that says so.

    resolve_diagnosis() already looked the posted code up in the catalogue and wrote
    the catalogue's own description, because the field has always been a posted string
    — whether a clerk picked it from the search box or typed it makes no difference to
    the request. Pinned here so a future change to that path cannot quietly break the
    one route a clerk has when the search is unavailable.
    """
    episode_id = create(client, app, diagnosis_code="J18.9")
    episode = taep.get_episode(app.ctx, episode_id)
    assert episode["diagnosis_code"] == "J18.9"
    assert "Πνευμονία" in episode["diagnosis_text"]

    # And a typed code the catalogue does not know is still refused, which is what
    # makes the fallback safe to offer rather than a hole in the record.
    response = client.post("/taep/nea", data=form_fields(app.ctx, diagnosis_code="J99.99"))
    assert response.status_code == 200
    assert "δεν βρέθηκε στον κατάλογο" in response.get_data(as_text=True)
