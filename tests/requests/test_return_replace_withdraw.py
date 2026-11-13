"""Return, resubmit, replace, withdraw and the conflict-of-interest redirect, through the screens."""
from ehr.extensions import db
from ehr.models import AuditLog, Request, RequestAction, RequestFinancials, Task, User
from tests.requests.flowhelpers import (act, actions_of, as_user, create, fin_fields, open_task, reload, step2,
                                        step3, step4, text)
from tests.requests.helpers import full_form


def resubmit(client, rid, note="Added what was missing.", user="nic.requester", directorate_code="NIC",
             category="medical", reason="new_need", follow=False, **changes):
    as_user(client, user)
    data = full_form(directorate_code, category, reason, **changes)
    data["intent"] = "resubmit"
    if note is not None:
        data["resubmit_note"] = note
    return client.post("/requests/%d/edit?lang=en" % rid, data=data, follow_redirects=follow)


def test_scenario_5_return_at_step_2_and_resubmit(seeded, client):
    rid = create(client).id
    assert act(client, "nic.accountant", rid, "return", comment="Attach the job description.").status_code == 302
    r = reload(rid)
    assert r.status == "returned" and r.returned_at is not None and r.returned_from_step == 2
    assert [t.status for t in r.tasks] == ["paused"]

    as_user(client, "nic.requester")
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "Attach the job description." in page and "Correct and resubmit" in page
    edit = text(client.get("/requests/%d/edit?lang=en" % rid))
    assert "Returned by" in edit and "Attach the job description." in edit
    assert "working days left" in edit and 'name="resubmit_note"' in edit
    assert '<select class="form-select" id="f-directorate_id"' not in edit and 'type="hidden" id="f-directorate_id"' in edit
    assert 'value="resubmit"' in edit and 'value="draft"' not in edit
    assert "Posts and funds" in edit  # live route preview

    resp = resubmit(client, rid, note="")  # the note is required
    assert resp.status_code == 200 and reload(rid).round == 1
    resp = resubmit(client, rid, need_text="A corrected need.")
    assert resp.status_code == 302
    r = reload(rid)
    assert (r.status, r.round, r.current_step, r.returned_at) == ("in_progress", 2, 2, None)
    assert r.need_text == "A corrected need."
    assert [t.status for t in r.tasks] == ["open"]  # same task, resumed
    assert [a.action for a in actions_of(rid)] == ["submit", "return", "resubmit"]

    as_user(client, "nic.accountant")
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert "Returned to requester" in html and "Resubmitted" in html and "Round 2" in html
    assert "Added what was missing." in html


def test_scenario_13b_return_at_step_3_pauses_the_other_task_and_resubmit_resumes_it(seeded, client):
    rid = create(client).id
    step2(client, rid)
    assert act(client, "nic.sci", rid, "return", comment="Please clarify the need.").status_code == 302
    r = reload(rid)
    assert r.status == "returned" and sorted((t.role, t.status) for t in r.tasks if t.step == 3) == [
        ("dir_hr_officer", "paused"), ("sci_director", "paused")]

    # a paused task cannot act: the person gets the request as it is, with the reason
    resp = act(client, "nic.hr", rid, "check", role="dir_hr_officer", task_id=0, documentation="complete", follow=True)
    assert resp.status_code == 200 and "The request is with the requester" in text(resp)
    assert len(actions_of(rid)) == 3
    # and sees a short on-hold note instead of a card
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "On hold" in page and 'name="documentation"' not in page
    # the tracker shows the paused step
    assert "ehr-tracker__stop--paused" in page

    assert resubmit(client, rid, need_text="Clearer need text.").status_code == 302
    r = reload(rid)
    assert (r.status, r.current_step, r.step3_phase, r.round) == ("in_progress", 3, "inputs", 2)
    assert sorted(t.status for t in r.tasks if t.step == 3) == ["open", "open"]
    assert all(t.clock_started_at is not None for t in r.tasks)
    assert act(client, "nic.hr", rid, "check", documentation="complete").status_code == 302


def test_scenario_13a_earlier_answer_can_be_replaced_after_a_resubmission(seeded, client):
    rid = create(client).id
    step2(client, rid)
    assert act(client, "nic.hr", rid, "check", documentation="complete").status_code == 302
    assert act(client, "nic.sci", rid, "return", comment="One more paper is needed.").status_code == 302
    assert resubmit(client, rid, need_text="New wording.").status_code == 302

    hr_task = open_task(rid, "nic.hr", "dir_hr_officer")
    assert hr_task is not None and hr_task.may_replace is True and hr_task.status == "closed"
    as_user(client, "nic.hr")
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "New material was added after your answer" in page and "Keep my answer" in page
    assert "Complete" in page  # the earlier answer is shown

    resp = act(client, "nic.hr", rid, "check", documentation="incomplete")  # negative needs a comment
    assert resp.status_code == 200 and "Write a comment to explain." in text(resp)
    resp = act(client, "nic.hr", rid, "check", documentation="incomplete", comment="The new paper is unreadable.")
    assert resp.status_code == 302
    acts = [a for a in actions_of(rid) if a.role == "dir_hr_officer"]
    assert len(acts) == 2 and acts[0].is_superseded and acts[1].supersedes_action_id == acts[0].id
    assert open_task(rid, "nic.hr", "dir_hr_officer") is None  # the replace right is used up

    as_user(client, "central.ceo")
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert "An earlier answer is in the history" in html  # marker in the checks list
    assert "Replaced by a later answer" in html  # and both answers are in the history
    assert html.count("The new paper is unreadable.") >= 2


def test_keep_my_answer_clears_the_flag_and_records_no_action(seeded, client):
    rid = create(client).id
    step2(client, rid)
    act(client, "nic.hr", rid, "check", documentation="complete")
    act(client, "nic.sci", rid, "return", comment="Clarify.")
    resubmit(client, rid, need_text="Other wording.")
    before = len(actions_of(rid))
    task = open_task(rid, "nic.hr", "dir_hr_officer")
    resp = act(client, "nic.hr", rid, "keep", role="dir_hr_officer", task_id=task.id)
    assert resp.status_code == 302
    db.session.expire_all()
    assert db.session.get(Task, task.id).may_replace is False
    assert len(actions_of(rid)) == before
    assert AuditLog.query.filter_by(event="answer_kept", request_id=rid).count() == 1
    # keeping twice does nothing more
    act(client, "nic.hr", rid, "keep", role="dir_hr_officer", task_id=task.id)
    assert AuditLog.query.filter_by(event="answer_kept", request_id=rid).count() == 1


def test_scenario_14_category_change_restarts_at_step_2(seeded, client):
    rid = create(client, category="medical").id
    step2(client, rid)
    assert RequestFinancials.query.filter_by(request_id=rid).count() == 2
    assert act(client, "nic.sci", rid, "return", comment="Is this really medical?").status_code == 302

    resp = resubmit(client, rid, category="admin", position_id=full_form(category="admin")["position_id"],
                    need_text="It is an admin post.")
    assert resp.status_code == 302
    r = reload(rid)
    assert (r.status, r.round, r.current_step, r.category) == ("in_progress", 2, 2, "admin")
    route = __import__("json").loads(r.route_snapshot_json)
    assert route["financials_required"] is False
    assert [s for s in route["steps"] if s["step"] == 5][0]["applies"] is False
    assert [s for s in route["steps"] if s["step"] == 3][0]["inputs"] == ["dir_hr_officer"]
    open_tasks = [t for t in r.tasks if t.status in ("open", "paused")]
    assert [(t.role, t.status, t.round) for t in open_tasks] == [("dir_accountant", "open", 2)]
    assert all(a.is_superseded for a in actions_of(rid) if a.step >= 2)  # kept in the history, marked
    assert RequestFinancials.query.filter_by(request_id=rid, round=1).count() == 2  # earlier rows are kept

    as_user(client, "nic.accountant")
    card = text(client.get("/requests/%d?lang=en&do=review" % rid))
    assert "Financial data" not in card.split('id="sec-details"')[0]  # no table is asked for any more
    assert "Not applicable" in card  # step 5
    step2(client, rid, financials=False)
    assert RequestFinancials.query.filter_by(request_id=rid, round=2).count() == 0
    assert reload(rid).step3_phase == "inputs"
    assert sorted(t.role for t in reload(rid).tasks if t.status == "open") == ["dir_hr_officer"]


def test_scenario_12_requester_who_is_also_sci_director(seeded, client):
    rid = create(client, "lar.sci", directorate_code="LAR", category="medical").id
    step2(client, rid, user="lar.accountant")
    task = Task.query.filter_by(request_id=rid, role="sci_director").one()
    deputy, owner = User.query.filter_by(username="lar.deputy").one(), User.query.filter_by(username="lar.sci").one()
    assert task.assignee_user_id == deputy.id and task.on_behalf_of_user_id == owner.id
    assert task.redirect_reason == "conflict_of_interest"

    # the requester has no card, and posting an action gets own_request
    as_user(client, "lar.sci")
    assert 'id="ehr-card-' not in text(client.get("/requests/%d" % rid))
    resp = act(client, "lar.sci", rid, "opinion", role="sci_director", task_id=task.id, opinion="positive", follow=True)
    assert "You can&#39;t act on your own request." in text(resp)
    resp = act(client, "lar.sci", rid, "check", role="dir_hr_officer", task_id=0, documentation="complete", follow=True)
    assert "You can&#39;t act on your own request." in text(resp)
    assert len(actions_of(rid)) == 2

    as_user(client, "lar.deputy")
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "the holder made this request" in page and 'name="opinion"' in page
    assert act(client, "lar.deputy", rid, "opinion", opinion="positive").status_code == 302


def test_a_person_without_the_task_gets_the_current_state_not_an_error_page(seeded, client):
    rid = create(client).id
    resp = act(client, "nic.hr", rid, "check", role="dir_hr_officer", task_id=0, documentation="complete")
    assert resp.status_code == 302
    page = text(client.get(resp.headers["Location"] + "?lang=en"))
    assert "This task isn&#39;t yours, or someone has already done it." in page
    assert "Directorate Accountant" in page  # the request as it stands
    assert len(actions_of(rid)) == 1
    # someone who may not see the request at all gets a 404
    assert act(client, "lim.accountant", rid, "check", role="dir_accountant", task_id=0, position="yes",
               funds="yes").status_code == 404
    # a requester cannot post an approver action either
    resp = act(client, "nic.requester", rid, "check", role="dir_accountant", task_id=0, position="yes", funds="yes",
               follow=True)
    assert "You can&#39;t act on your own request." in text(resp)


def test_a_double_post_records_one_action(seeded, client):
    rid = create(client).id
    step2(client, rid)
    task = open_task(rid, "nic.hr", "dir_hr_officer")
    first = act(client, "nic.hr", rid, "check", documentation="complete", task_id=task.id)
    second = act(client, "nic.hr", rid, "check", documentation="complete", task_id=task.id)
    assert first.status_code == second.status_code == 302
    assert len([a for a in actions_of(rid) if a.role == "dir_hr_officer"]) == 1


def test_requester_sees_comments_only_on_return_rejection_and_withdrawal(seeded, client):
    rid = create(client).id
    step2(client, rid, comment="Funds look fine.")
    act(client, "nic.sci", rid, "opinion", opinion="negative", comment="Secret concern about the plan.")
    as_user(client, "nic.accountant")
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "Secret concern about the plan." in page and "Funds look fine." in page
    as_user(client, "nic.requester")
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "Secret concern" not in page and "Funds look fine." not in page
    assert "Negative answer" in page  # the outcome is shown
    act(client, "nic.hr", rid, "check", documentation="incomplete", comment="Paper missing, send it again.")
    act(client, "nic.exec", rid, "reject", comment="Not this year.")
    as_user(client, "nic.requester")
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "Not this year." in page and "Secret concern" not in page and "Paper missing" not in page


def test_scenario_15_withdraw_by_the_requester(seeded, client):
    rid = create(client).id
    step2(client, rid)
    as_user(client, "nic.requester")
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "Withdraw this request? This can&#39;t be undone." in page
    url = "/requests/%d/withdraw?lang=en" % rid
    resp = client.post(url, data={"comment": ""})
    assert resp.status_code == 200 and "Write a comment to explain." in text(resp) and reload(rid).status == "in_progress"
    # someone else cannot withdraw it
    as_user(client, "nic.accountant")
    resp = client.post(url, data={"comment": "x"}, follow_redirects=True)
    assert "Only the requester can do this." in text(resp) and reload(rid).status == "in_progress"
    as_user(client, "nic.requester")
    resp = client.post(url, data={"comment": "The need is gone."}, follow_redirects=True)
    assert resp.status_code == 200 and "The request was withdrawn." in text(resp)
    r = reload(rid)
    assert r.status == "withdrawn" and r.closed_at and not [t for t in r.tasks if t.status != "closed"]
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert "Withdrawn by the requester" in html and "The need is gone." in html
    # a closed request takes no more actions
    resp = act(client, "nic.hr", rid, "check", role="dir_hr_officer", task_id=0, documentation="complete", follow=True)
    assert "This request is closed." in text(resp)


def test_flash_with_parameters_is_translated_when_drawn(seeded, client):
    as_user(client, "nic.requester")
    resp = client.post("/requests", data=full_form())
    number = Request.query.one().number
    page = text(client.get(resp.headers["Location"] + "?lang=en"))
    assert "Your request was submitted. Its number is %s." % number in page


def test_return_at_step_4_then_the_credit_answer_is_replaced_with_no(seeded, client):
    rid = create(client).id
    step2(client, rid)
    step3(client, rid)
    assert act(client, "central.finmgmt", rid, "check", credit="yes", commitment_article="A-9").status_code == 302
    assert act(client, "central.hr", rid, "return", comment="Costs need a second look.").status_code == 302
    r = reload(rid)
    assert (r.status, r.returned_from_step) == ("returned", 4)
    assert resubmit(client, rid, need_text="More detail on cost.").status_code == 302
    fin_task = open_task(rid, "central.finmgmt", "fin_mgmt_head")
    assert fin_task is not None and fin_task.may_replace
    resp = act(client, "central.finmgmt", rid, "check", credit="no", comment="Credit has been used elsewhere.")
    assert resp.status_code == 302
    r = reload(rid)
    assert r.status == "rejected" and r.current_step == 4
    assert not [t for t in r.tasks if t.status != "closed"]


def test_executive_decision_card_and_return_from_the_decision_phase(seeded, client):
    rid = create(client).id
    step2(client, rid)
    act(client, "nic.sci", rid, "opinion", opinion="positive")
    act(client, "nic.hr", rid, "check", documentation="complete")
    as_user(client, "nic.exec")
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert 'value="approve"' in page and 'value="reject"' in page and "data-ehr-needs-comment" in page
    resp = act(client, "nic.exec", rid, "reject")  # reject without a comment is refused on the server
    assert resp.status_code == 200 and "Write a comment to explain." in text(resp) and reload(rid).status == "in_progress"
    assert act(client, "nic.exec", rid, "return", comment="Need the staffing table.").status_code == 302
    r = reload(rid)
    assert (r.status, r.current_step, r.step3_phase) == ("returned", 3, "decision")
    assert resubmit(client, rid, need_text="Includes the staffing table.").status_code == 302
    r = reload(rid)
    assert (r.status, r.step3_phase) == ("in_progress", "decision")
    assert act(client, "nic.exec", rid, "approve").status_code == 302
    assert reload(rid).current_step == 4
