import json

from ehr.extensions import db
from ehr.models import AuditLog, Request, Task, RequestLeaver
from tests.conftest import login
from tests.requests.helpers import full_form, ids, submit, user_id


def test_new_form_renders_and_hides_inapplicable_fields(seeded, client):
    login(client, "nic.requester")
    html = client.get("/requests/new").get_data(as_text=True)
    assert 'name="category"' in html and 'name="need_text"' in html
    for name in ("oay_specialty_id", "new_need_origin", "external_funding_flag", "leavers[0].name", "absence_text"):
        assert 'name="%s"' % name not in html
    assert "csrf_token" in html


def test_dependent_fields_appear_for_category_and_reason(seeded, client):
    login(client, "nic.requester")
    data = {"category": "medical", "reason": "new_need", "intent": "refresh"}
    html = client.post("/requests", data=data).get_data(as_text=True)
    for name in ("oay_specialty_id", "new_need_origin", "new_need_plan", "external_funding_flag"):
        assert 'name="%s"' % name in html
    html = client.post("/requests", data={"category": "admin", "reason": "retirement", "intent": "refresh"}).get_data(as_text=True)
    assert 'name="leavers[0].name"' in html
    assert 'name="oay_specialty_id"' not in html and 'name="new_need_origin"' not in html
    assert Request.query.count() == 0


def test_draft_saves_with_partial_data(seeded, client):
    login(client, "nic.requester")
    resp = client.post("/requests", data={"intent": "draft", "need_text": "Only this so far", "category": "nursing"})
    assert resp.status_code == 302
    req = Request.query.one()
    assert req.status == "draft" and req.number is None
    assert req.need_text == "Only this so far" and req.category == "nursing"
    assert resp.headers["Location"].endswith("/requests/%d/edit" % req.id)
    page = client.get(resp.headers["Location"]).get_data(as_text=True)
    assert "Only this so far" in page
    assert AuditLog.query.filter_by(event="request_draft_saved", request_id=req.id).count() == 1


def test_draft_update_keeps_one_row_and_changes_values(seeded, client):
    login(client, "nic.requester")
    client.post("/requests", data={"intent": "draft", "need_text": "first"})
    req = Request.query.one()
    client.post("/requests/%d/edit" % req.id, data={"intent": "draft", "need_text": "second"})
    assert Request.query.count() == 1
    assert db.session.get(Request, req.id).need_text == "second"


def test_draft_with_bad_date_is_rejected_with_typed_values_kept(seeded, client):
    login(client, "nic.requester")
    resp = client.post("/requests", data={"intent": "draft", "reason": "retirement", "need_text": "kept text",
                                          "leavers[0].name": "Sample One", "leavers[0].leave_date": "32/13/2027"})
    html = resp.get_data(as_text=True)
    assert resp.status_code == 200 and Request.query.count() == 0
    assert "kept text" in html and "32/13/2027" in html and "Sample One" in html


def test_submit_validation_errors_keep_typed_values(seeded, client):
    login(client, "nic.requester")
    data = full_form(category="medical", reason="new_need", need_text="", positions_count="0")
    data["alternatives_text"] = "typed alternatives stay"
    resp = client.post("/requests", data=data, headers={"Accept-Language": "en"})
    html = resp.get_data(as_text=True)
    assert resp.status_code == 200 and Request.query.count() == 0
    assert "typed alternatives stay" in html
    assert 'id="ehr-error-summary"' in html and 'id="e-need_text"' in html and 'id="e-positions_count"' in html


def test_submit_creates_numbered_request_task_route_and_audit(seeded, client):
    req = submit(client)
    assert req.number and req.status == "in_progress" and req.current_step == 2
    assert req.number_search
    route = json.loads(req.route_snapshot_json)
    assert [s["step"] for s in route["steps"]] == [1, 2, 3, 4, 5, 6]
    assert "sci_director" in route["steps"][2]["inputs"]
    tasks = Task.query.filter_by(request_id=req.id).all()
    assert len(tasks) == 1 and tasks[0].role == "dir_accountant" and tasks[0].status == "open"
    assert tasks[0].assignee_user_id == user_id("nic.accountant") and tasks[0].step == 2
    actions = req.actions
    assert len(actions) == 1 and actions[0].action == "submit" and actions[0].actor_user_id == user_id("nic.requester")
    assert req.submitted_at is not None
    assert AuditLog.query.filter_by(event="request_submitted", request_id=req.id).count() == 1


def test_submit_redirects_to_request_page_with_flash_and_number(seeded, client):
    login(client, "nic.requester")
    resp = client.post("/requests", data=full_form(), follow_redirects=True)
    req = Request.query.one()
    html = resp.get_data(as_text=True)
    assert req.number in html and "{number}" not in html and "form.submitted" not in html


def test_two_submits_get_different_numbers(seeded, client):
    first = submit(client)
    second = submit(client)
    assert first.number != second.number


def test_submit_from_an_existing_draft_keeps_the_row(seeded, client):
    login(client, "nic.requester")
    client.post("/requests", data={"intent": "draft", "need_text": "x"})
    draft = Request.query.one()
    resp = client.post("/requests/%d/edit" % draft.id, data=full_form())
    assert resp.status_code == 302
    assert Request.query.count() == 1
    assert db.session.get(Request, draft.id).status == "in_progress"
    # a submitted request is no longer editable
    assert client.get("/requests/%d/edit" % draft.id).status_code == 404


def test_inapplicable_fields_are_ignored(seeded, client):
    login(client, "nic.requester")
    data = full_form(category="admin", reason="retirement")
    data.update({"oay_specialty_id": ids()["oay_specialty_id"], "external_funding_flag": "yes",
                 "external_funding_text": "ignored", "new_need_origin": "ignored", "new_need_plan": "ignored"})
    assert client.post("/requests", data=data).status_code == 302
    req = Request.query.one()
    assert req.oay_specialty_id is None and req.external_funding_flag is None and req.external_funding_text is None
    assert req.new_need_origin is None and req.new_need_plan is None


def test_admin_category_has_no_step_five_and_no_specialty_required(seeded, client):
    login(client, "phc.requester")
    resp = client.post("/requests", data=full_form("PHC", "admin", "new_need"))
    assert resp.status_code == 302
    route = json.loads(Request.query.one().route_snapshot_json)
    assert route["steps"][4]["applies"] is False
    assert "sci_director" not in route["steps"][2]["inputs"]


def test_leavers_need_one_and_at_most_positions_count(seeded, client):
    login(client, "nic.requester")
    none = full_form(reason="retirement", positions_count="1")
    for key in [k for k in none if k.startswith("leavers[")]:
        del none[key]
    html = client.post("/requests", data=none).get_data(as_text=True)
    assert 'id="e-leavers"' in html and Request.query.count() == 0

    too_many = full_form(reason="retirement", positions_count="1")
    too_many.update({"leavers[1].name": "Sample Two", "leavers[1].leave_date": "02/03/2027", "leavers[1].employment": "civil_servant"})
    html = client.post("/requests", data=too_many).get_data(as_text=True)
    assert 'id="e-leavers"' in html and Request.query.count() == 0

    two_ok = full_form(reason="retirement", positions_count="2")
    two_ok.update({"leavers[1].name": "Sample Two", "leavers[1].leave_date": "02/03/2027", "leavers[1].employment": "civil_servant"})
    assert client.post("/requests", data=two_ok).status_code == 302
    leavers = RequestLeaver.query.order_by(RequestLeaver.id).all()
    assert [l.name for l in leavers] == ["Sample Person", "Sample Two"]
    assert str(leavers[0].leave_date) == "2027-03-01"


def test_add_and_remove_leaver_redraw_without_saving(seeded, client):
    login(client, "nic.requester")
    base = {"category": "admin", "reason": "retirement", "leavers[0].name": "Sample One"}
    html = client.post("/requests", data=dict(base, intent="add_leaver")).get_data(as_text=True)
    assert 'name="leavers[1].name"' in html and "Sample One" in html
    html = client.post("/requests", data=dict(base, **{"leavers[1].name": "Sample Two", "intent": "remove_leaver:0"})).get_data(as_text=True)
    assert 'name="leavers[0].name"' in html and "Sample Two" in html and "Sample One" not in html
    assert Request.query.count() == 0


def test_directorate_must_be_one_of_the_users_own(seeded, client):
    login(client, "nic.requester")
    data = full_form("LIM")
    html = client.post("/requests", data=data).get_data(as_text=True)
    assert Request.query.count() == 0 and 'id="e-directorate_id"' in html


def test_only_the_creator_edits_a_draft(seeded, client):
    login(client, "nic.requester")
    client.post("/requests", data={"intent": "draft", "need_text": "mine"})
    rid = Request.query.one().id
    client.post("/logout")
    login(client, "nic.accountant")
    assert client.get("/requests/%d/edit" % rid).status_code == 404
    assert client.post("/requests/%d/edit" % rid, data={"intent": "draft"}).status_code == 404


def test_returned_request_edit_is_only_for_its_requester(seeded, client):
    req = submit(client)
    req.status = "returned"
    db.session.commit()
    assert client.get("/requests/%d/edit" % req.id).status_code == 200
    client.post("/logout")
    login(client, "nic.accountant")
    assert client.get("/requests/%d/edit" % req.id).status_code == 404


def test_viewer_cannot_open_the_form(seeded, client):
    login(client, "demo.viewer")
    assert client.get("/requests/new").status_code == 404
    assert client.post("/requests", data=full_form()).status_code == 404


def test_csrf_is_required_on_post(seeded, client):
    seeded.config["CSRF_ENABLED"] = True
    login(client, "nic.requester")
    assert client.post("/requests", data={"intent": "draft"}).status_code == 400
