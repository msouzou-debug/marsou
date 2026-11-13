from tests.conftest import login
from tests.requests.helpers import ids


def _did(code):
    return ids(code)["directorate_id"]


def test_preview_medical_with_sci_director(seeded, client):
    login(client, "nic.requester")
    html = client.get("/requests/route-preview?directorate_id=%d&category=medical" % _did("NIC")).get_data(as_text=True)
    assert "ehr-tracker" in html and html.count("ehr-tracker__stop ") == 6
    assert "role.sci_director" not in html
    assert html.index("ehr-tracker__people--inputs") < html.index("ehr-tracker__people--decision")
    assert "ehr-tracker__stop--not_applicable" not in html


def test_preview_admin_without_sci_director_has_no_step_five(seeded, client):
    login(client, "phc.requester")
    html = client.get("/requests/route-preview?directorate_id=%d&category=admin" % _did("PHC")).get_data(as_text=True)
    assert "ehr-tracker__stop--not_applicable" in html
    en = client.get("/requests/route-preview?directorate_id=%d&category=admin&lang=en" % _did("PHC")).get_data(as_text=True)
    assert "Scientific Director" not in en and "Not applicable" in en
    en = client.get("/requests/route-preview?directorate_id=%d&category=medical&lang=en" % _did("PHC")).get_data(as_text=True)
    assert "Scientific Director" not in en  # PHC has no holder, so the route skips it


def test_preview_with_missing_or_foreign_input_is_empty(seeded, client):
    login(client, "nic.requester")
    assert "ehr-tracker" not in client.get("/requests/route-preview").get_data(as_text=True)
    assert "ehr-tracker" not in client.get("/requests/route-preview?directorate_id=%d&category=medical" % _did("LIM")).get_data(as_text=True)


def test_options_filter_facility_and_position(seeded, client):
    login(client, "nic.requester")
    nic = client.get("/requests/options?list=facility&directorate_id=%d&lang=en" % _did("NIC")).get_json()["options"]
    assert nic and all("Nicosia" in o["label"] or "Strovolos" in o["label"] or o["label"] for o in nic)
    lim = client.get("/requests/options?list=facility&directorate_id=%d" % _did("LIM")).get_json()["options"]
    assert lim == []  # not this user's Directorate
    from ehr.models import Facility
    ours = {f.id for f in Facility.query.filter_by(directorate_id=_did("NIC"))}
    assert {o["id"] for o in nic} == ours
    medical = client.get("/requests/options?list=position&category=medical").get_json()["options"]
    nursing = client.get("/requests/options?list=position&category=nursing").get_json()["options"]
    assert medical and nursing and not ({o["id"] for o in medical} & {o["id"] for o in nursing})
    assert client.get("/requests/options?list=position&category=bogus").get_json()["options"] == []
    assert client.get("/requests/options?list=other").status_code == 404


def test_preview_and_options_need_the_create_permission(seeded, client):
    login(client, "demo.viewer")
    assert client.get("/requests/route-preview?category=admin").status_code == 404
    assert client.get("/requests/options?list=position").status_code == 404
