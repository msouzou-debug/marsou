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


# ---------------------------------------------------------------------------
# A list as well as a search (Παναγιώτα Έλληνα, 02/11/2026)
# ---------------------------------------------------------------------------

def test_the_catalogue_can_be_browsed_by_code(seeded):
    """«Both a search and a drop down list alphabetically» — and, asked again on
    02/11/2026, alphabetical means the code: A00, A01, … B00, … Z99.

    I had first read it as the Greek description and built a folded sort column for it,
    which was the wrong answer to a question I should have asked. Ordering by code is
    how ICD-10 is published, needs no column, and keeps related diagnoses together.
    """
    first, more = taep.list_diagnoses(seeded, page=1)
    assert len(first) == taep.DIAGNOSIS_PAGE
    assert more is True
    assert first[0]["code"].startswith("A")

    second, _ = taep.list_diagnoses(seeded, page=2)
    codes = [r["code"] for r in first + second]
    assert codes == sorted(codes)
    assert len(set(codes)) == len(codes)

    last_page = (10560 // taep.DIAGNOSIS_PAGE) + 1
    tail, more = taep.list_diagnoses(seeded, page=last_page)
    assert more is False and tail
    assert tail[-1]["code"].startswith("Z")


def test_the_whole_catalogue_is_served_in_one_request_for_the_dropdown(client):
    r"""A plain <select> cannot fetch more as it is scrolled, so it is filled once.

    Pairs rather than objects, and the Greek description only: the list shows that, and
    the English only ever matters to the search, which runs on the server. Through
    jsonify this was 3,5 MB, because it escapes every Greek letter to \uXXXX — six
    bytes where two would do.
    """
    import json as _json
    response = client.get("/taep/api/diagnoses?all=1")
    assert response.status_code == 200
    body = response.get_data()
    rows = _json.loads(body)["all"]
    assert len(rows) == 10560
    assert rows[0][0] == "A00.0" and len(rows[0]) == 2
    assert [r[0] for r in rows] == sorted(r[0] for r in rows)
    # Unescaped: the Greek arrives as Greek.
    assert "Χολέρα".encode("utf-8") in body
    assert b"\\u03" not in body
    assert len(body) < 1_600_000, len(body)


def test_the_box_asks_for_a_list_when_nothing_is_typed(client):
    """Empty q is the browse, not an empty result — which is what it used to be."""
    body = client.get("/taep/api/diagnoses").get_json()
    assert len(body["results"]) == taep.DIAGNOSIS_PAGE
    assert body["pagination"]["more"] is True
    page_two = client.get("/taep/api/diagnoses?page=2").get_json()
    assert page_two["results"][0]["code"] != body["results"][0]["code"]


def test_the_search_still_ranks_and_now_pages(client):
    """Ranking happens over every match and the page is cut afterwards, so a clerk does
    not get J18.9 on page four because the first page was chosen before ranking.
    """
    first = client.get("/taep/api/diagnoses?q=J18.9").get_json()
    assert first["results"][0]["code"] == "J18.9"

    page_one = client.get("/taep/api/diagnoses?q=πνευμον&page=1").get_json()
    page_two = client.get("/taep/api/diagnoses?q=πνευμον&page=2").get_json()
    assert len(page_one["results"]) == taep.DIAGNOSIS_PAGE
    assert page_one["pagination"]["more"] is True
    assert {r["code"] for r in page_one["results"]}.isdisjoint(
        {r["code"] for r in page_two["results"]})


# ---------------------------------------------------------------------------
# Greek and Latin letters in the catalogue (02/11/2026)
# ---------------------------------------------------------------------------

def test_the_seeded_catalogue_has_no_character_defects_left(seeded):
    """289 corrections over five classes, all invisible on screen and all breaking the
    search:

      * 34 letters typed on the wrong keyboard, in both directions — «Tριχομονάδωση»
        opening with a Latin T, «Οισοφάγος του Βarrett» with a Greek Β, «Κρίση Αddison»,
        «Εμβόλιο ΒCG». fold_greek() does not map between alphabets, so «Τριχ» typed in
        Greek could not find A59.8 at all.
      * 13 karyotypes written with Greek Χ and Υ. Q96.1 «Καρυότυπος 46,Χ iso (Xq)»
        settles that it is an error: Greek after the comma, Latin in the brackets.
      * 274 runs of two or more spaces. search_text keeps the spacing, so «Εντερίτιδα
        από» typed with one space did not match «Εντερίτιδα  από» stored with two.
      * A23.3 «Βρουκέλωση απόBrucella canis», two words run together.
      * I51.0 «`Ελλείμματα…», a backtick where nothing belongs.

    This test is the guard rather than the fix: it re-runs the whole decision over the
    seeded catalogue and requires nothing left to do, so a future delivery from the
    Μονάδα cannot quietly reintroduce any of them.
    """
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))
    from fix_icd10_text import correct, tidy

    rows = seeded["db_execute"](
        "SELECT code, description_el, description_en FROM taep_diagnosis", fetch=True)
    offenders = [(r["code"], r["description_el"])
                 for r in rows
                 if correct(r["description_el"])[0] != r["description_el"]
                 or tidy(r["description_en"]) != (r["description_en"] or "")]
    assert not offenders, offenders[:5]


def test_the_corrections_left_the_legitimate_punctuation_alone(seeded):
    """The three apostrophes in the catalogue are correct Greek or correct English, and
    a blanket strip would have ruined them. B33.4's brackets are ICD style, not a stray
    pair: the English reads "(cardio-)pulmonary" too.
    """
    def text(code):
        return seeded["db_execute"](
            "SELECT description_el FROM taep_diagnosis WHERE code = %s",
            (code,), fetch=True)[0]["description_el"]

    assert text("A92.1") == "Πυρετός O'nyong-nyong"
    assert "καθ' έξιν" in text("O26.2")
    assert "απ' αυ" in text("Z89.5")
    assert text("B33.4").startswith("(Καρδιο-)πνευμονικό")


def test_a_karyotype_is_now_findable_in_latin_letters(seeded):
    """«47,ΧΧΧ» with Greek letters could not be found by anybody typing 47,XXX — and
    nobody types a karyotype in Greek.
    """
    assert "Q97.0" in [h["code"] for h in taep.search_diagnoses(seeded, "47,XXX")]
    assert "Q98.0" in [h["code"] for h in taep.search_diagnoses(seeded, "47,XXY")]


def test_a_double_space_no_longer_hides_a_diagnosis(seeded):
    """search_text keeps the spacing of the description, so a run of two spaces made a
    phrase unfindable by anyone typing it normally. 274 rows had one.
    """
    hits = [h["code"] for h in taep.search_diagnoses(seeded, "Εντερίτιδα από")]
    assert "A04.0" in hits


def test_a_greek_word_that_was_typed_with_a_latin_letter_is_now_found_in_greek(seeded):
    """A59.8 «Τριχομονάδωση άλλων εντοπίσεων» — the T used to be Latin, so this search
    returned nothing. That is the whole cost of the typo, and the reason it was worth
    correcting the data rather than working around it in the sort.
    """
    hits = [h["code"] for h in taep.search_diagnoses(seeded, "Τριχομονάδωση")]
    assert "A59.8" in hits
    # And the Latin names stayed Latin, which the same pass could have broken.
    assert "K22.7" in [h["code"] for h in taep.search_diagnoses(seeded, "Barrett")]
    assert "Y58.0" in [h["code"] for h in taep.search_diagnoses(seeded, "BCG")]


def test_stale_catalogue_text_on_a_server_is_a_readiness_blocker(seeded):
    """seed() fills a table only when it is empty, so a corrected catalogue never
    reaches an installation that already holds one — and the difference cannot be seen,
    because the letters look the same.

    Readiness reports it, and tools/sync_diagnoses.py carries the correction over,
    rebuilding search_text with it. Without that the search index would still hold the
    old spelling.
    """
    seeded["db_execute"]("UPDATE taep_diagnosis SET description_el = %s "
                         "WHERE code = %s", ("Tριχομονάδωση άλλων εντοπίσεων", "A59.8"))
    drift = taep.diagnosis_text_drift(seeded)
    assert [d[0] for d in drift] == ["A59.8"]

    blockers = [f for f in taep.readiness_report(seeded)
                if f["level"] == "blocker" and "icd10.csv" in f["detail"]]
    assert len(blockers) == 1
    assert "A59.8" in blockers[0]["detail"]
