"""Cost centres follow the chosen Directorate (contract 03, section 3)."""
from ehire.extensions import db
from ehire.models import CostCentre, Directorate, Request
from ehire.services.request_form import Lookups
from ehire.models import User
from tests.conftest import login
from tests.requests.helpers import full_form, ids


def _dir(code):
    return Directorate.query.filter_by(code=code).one().id


def _cc(code):
    return CostCentre.query.filter_by(code=code).one()


def _options(client, code, lang="en"):
    r = client.get("/requests/options?list=cost_centre&directorate_id=%d&lang=%s" % (_dir(code), lang))
    assert r.status_code == 200
    return r.get_json()["options"]


def test_options_are_the_directorates_own_plus_unassigned_with_codes_as_stored(seeded, client):
    login(client, "nic.requester")
    rows = _options(client, "NIC")
    assert [o["label"] for o in rows] == ["1001 Medical ward", "1002 Surgical ward", "1003 Accident and Emergency",
                                          "1009 Administration", "1010 Support services"]
    assert {o["id"] for o in rows} == {_cc(c).id for c in ("1001", "1002", "1003", "1009", "1010")}
    assert "1004 Maternity ward" not in [o["label"] for o in rows]  # LIM's
    el = _options(client, "NIC", "el")
    assert el[0]["label"] == "1001 Παθολογική κλινική"


def test_inactive_cost_centres_are_not_offered(seeded, client):
    _cc("1002").is_active = False
    _cc("1009").is_active = False
    db.session.commit()
    login(client, "nic.requester")
    labels = [o["label"].split()[0] for o in _options(client, "NIC")]
    assert labels == ["1001", "1003", "1010"]


def test_options_for_a_foreign_directorate_or_without_one_are_empty(seeded, client):
    login(client, "nic.requester")
    assert _options(client, "LIM") == []  # not this user's Directorate
    assert client.get("/requests/options?list=cost_centre").get_json()["options"] == []
    assert client.get("/requests/options?list=cost_centre&directorate_id=abc").get_json()["options"] == []


def test_options_need_the_create_permission(seeded, client):
    assert client.get("/requests/options?list=cost_centre&directorate_id=1").status_code in (302, 401, 403, 404)
    login(client, "demo.viewer")
    assert client.get("/requests/options?list=cost_centre&directorate_id=1").status_code == 404


def test_new_form_offers_only_the_directorates_list(seeded, client):
    login(client, "nic.requester")  # one Directorate: it is preselected
    html = client.get("/requests/new").get_data(as_text=True)
    assert "1001 " in html and "1009 " in html
    assert "1004 " not in html and "1007 " not in html


def test_form_after_an_error_still_offers_only_the_directorates_list(seeded, client):
    login(client, "nic.requester")
    data = full_form(intent="submit", need_text="")
    resp = client.post("/requests", data=data)
    html = resp.get_data(as_text=True)
    assert resp.status_code == 200 and "f-need_text" in html
    assert "1001 " in html and "1004 " not in html
    assert Request.query.count() == 0


def test_a_foreign_cost_centre_posted_by_hand_is_refused(seeded, client):
    login(client, "nic.requester")
    for intent in ("submit", "draft"):
        data = full_form(intent=intent, cost_centre_id=_cc("1004").id)  # belongs to LIM
        resp = client.post("/requests", data=data)
        html = resp.get_data(as_text=True)
        assert resp.status_code == 200 and 'href="#f-cost_centre_id"' in html
        assert Request.query.count() == 0


def test_an_inactive_cost_centre_posted_by_hand_is_refused(seeded, client):
    _cc("1001").is_active = False
    db.session.commit()
    login(client, "nic.requester")
    resp = client.post("/requests", data=full_form(intent="submit", cost_centre_id=_cc("1001").id))
    assert resp.status_code == 200 and 'href="#f-cost_centre_id"' in resp.get_data(as_text=True)
    assert Request.query.count() == 0


def test_own_and_unassigned_cost_centres_are_accepted(seeded, client):
    login(client, "nic.requester")
    assert client.post("/requests", data=full_form(intent="submit", cost_centre_id=_cc("1002").id)).status_code == 302
    assert client.post("/requests", data=full_form(intent="submit", cost_centre_id=_cc("1009").id)).status_code == 302
    assert [r.cost_centre.code for r in Request.query.order_by(Request.id)] == ["1002", "1009"]


def test_a_draft_keeps_an_old_value_that_no_longer_fits(seeded, client):
    login(client, "nic.requester")
    assert client.post("/requests", data=full_form(intent="draft", cost_centre_id=_cc("1002").id)).status_code == 302
    req = Request.query.one()
    _cc("1002").is_active = False  # deactivated after the draft was saved
    db.session.commit()
    html = client.get("/requests/%d/edit?lang=en" % req.id).get_data(as_text=True)
    assert '<option value="%d" selected>1002 Surgical ward</option>' % _cc("1002").id in html
    data = full_form(intent="draft", cost_centre_id=_cc("1002").id)
    assert client.post("/requests/%d/edit" % req.id, data=data).status_code == 302  # saved again unchanged
    assert db.session.get(Request, req.id).cost_centre_id == _cc("1002").id
    # a submission needs a cost centre that is active and fits
    resp = client.post("/requests/%d/edit" % req.id, data=dict(data, intent="submit"))
    assert resp.status_code == 200 and 'href="#f-cost_centre_id"' in resp.get_data(as_text=True)
    assert db.session.get(Request, req.id).status == "draft"


def test_the_kept_value_does_not_follow_a_change_of_directorate(seeded, client):
    login(client, "nic.requester")
    client.post("/requests", data=full_form(intent="draft", cost_centre_id=_cc("1002").id))
    req = Request.query.one()
    user = User.query.filter_by(username="nic.requester").one()
    lookups = Lookups(user, "en", req)
    same = lookups.cost_centre_options(req.directorate_id, _cc("1002").id)
    assert _cc("1002").id in [o[0] for o in same]
    _cc("1002").directorate_id = _dir("LIM")  # moved to another Directorate since
    db.session.commit()
    lookups = Lookups(user, "en", req)
    assert _cc("1002").id in [o[0] for o in lookups.cost_centre_options(req.directorate_id, _cc("1002").id)]
    # the Directorate was changed on the draft (to one the user may choose): the old cost centre is not carried over
    assert _cc("1002").id not in [o[0] for o in lookups.cost_centre_options(None, _cc("1002").id)]
    assert lookups.cost_centre_fits(_cc("1002").id, req.directorate_id) is False


def test_no_directorate_chosen_offers_only_the_unassigned(seeded, client):
    user = User.query.filter_by(username="nic.requester").one()
    rows = Lookups(user, "en").cost_centre_options(None)
    assert [o[1].split()[0] for o in rows] == ["1009", "1010"]


def test_search_box_is_hidden_without_scripts_and_labelled(seeded, client):
    login(client, "nic.requester")
    html = client.get("/requests/new?lang=en").get_data(as_text=True)
    assert 'data-ehire-ccsearch hidden' in html
    assert '<label class="form-label" for="f-cost_centre_search">Search cost centres</label>' in html
    assert 'id="ehire-cc-count"' in html and 'aria-live="polite"' in html
    assert 'name="f-cost_centre_search"' not in html and 'id="f-cost_centre_search" name' not in html  # never posted
    assert 'data-count-many="{n} cost centres found"' in html
    el = client.get("/requests/new?lang=el").get_data(as_text=True)
    assert "Αναζήτηση κέντρου κόστους" in el and "Βρέθηκαν {n} κέντρα κόστους" in el


def test_script_filters_by_code_and_name_ignoring_case_and_accents():
    from pathlib import Path
    js = (Path(__file__).resolve().parents[2] / "ehire/static/js/requests.js").read_text(encoding="utf-8")
    assert 'normalize("NFD")' in js and "toLowerCase" in js and "cost_centre" in js
    assert "<script" not in js
