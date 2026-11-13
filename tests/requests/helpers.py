"""Shared helpers for the request tests."""
from ehr.extensions import db
from ehr.models import CostCentre, Directorate, Facility, OaySpecialty, Position, Request, User

from tests.conftest import login


def ids(directorate_code="NIC", category="medical"):
    d = Directorate.query.filter_by(code=directorate_code).one()
    return {
        "directorate_id": d.id,
        "facility_id": Facility.query.filter_by(directorate_id=d.id).first().id,
        "cost_centre_id": CostCentre.query.first().id,
        "position_id": Position.query.filter_by(category=category).first().id,
        "oay_specialty_id": OaySpecialty.query.first().id,
    }


def full_form(directorate_code="NIC", category="medical", reason="new_need", **extra):
    """A form that passes submit validation. Invented text only."""
    data = ids(directorate_code, category)
    data.update({
        "category": category, "positions_count": "2", "reason": reason,
        "need_text": "Sample need text.", "alternatives_text": "Sample alternatives.",
        "absence_flag": "no", "intent": "submit",
    })
    if category in ("medical", "allied"):
        data["external_funding_flag"] = "no"
    if reason == "new_need":
        data.update({"new_need_origin": "Sample origin.", "new_need_cover_so_far": "Sample cover."})
        if category in ("medical", "allied"):
            data["new_need_plan"] = "Sample plan."
    else:
        data.update({"leavers[0].name": "Sample Person", "leavers[0].leave_date": "01/03/2027",
                     "leavers[0].employment": "okypy_contract"})
    data.update(extra)
    return data


def user_id(username):
    return User.query.filter_by(username=username).one().id


def submit(client, username="nic.requester", **kwargs):
    login(client, username)
    resp = client.post("/requests", data=full_form(**kwargs))
    assert resp.status_code == 302, resp.get_data(as_text=True)[:2000]
    return Request.query.order_by(Request.id.desc()).first()
