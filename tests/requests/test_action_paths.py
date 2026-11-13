"""Whole paths through the screens, as the demo users: scenarios 1, 2, 3, 4, 6 and 16."""
from decimal import Decimal

from ehr.models import AuditLog, RequestFinancials, RequestLeaver, Task
from tests.requests.flowhelpers import (act, actions_of, as_user, create, fin_fields, reload, step2, step3, step4,
                                        text)


def test_scenario_1_medical_all_six_steps_to_approved(seeded, client):
    req = create(client, category="medical")
    rid = req.id
    assert reload(rid).current_step == 2
    step2(client, rid)
    r = reload(rid)
    assert (r.current_step, r.step3_phase) == (3, "inputs")
    rows = RequestFinancials.query.filter_by(request_id=rid).order_by(RequestFinancials.period).all()
    assert [x.period for x in rows] == ["prev_year", "ytd"] and rows[0].round == 1
    assert rows[0].revenue == Decimal("1254300.50") and rows[0].visits == 48200
    assert rows[1].headcount == Decimal("14.50") and rows[0].source == "manual"
    assert rows[0].payroll_to_month.isoformat() == "2026-09-01" and rows[0].oay_data_month.isoformat() == "2026-08-01"

    step3(client, rid)
    r = reload(rid)
    assert r.current_step == 4 and r.step3_phase is None
    step4(client, rid)
    assert reload(rid).current_step == 5
    assert act(client, "central.medical", rid, "opinion", opinion="positive", comment="Fine.").status_code == 302
    assert reload(rid).current_step == 6
    resp = act(client, "central.ceo", rid, "approve")
    assert resp.status_code == 302
    r = reload(rid)
    assert r.status == "approved" and r.closed_at is not None
    assert not Task.query.filter(Task.request_id == rid, Task.status != "closed").count()
    # phases are stored on tasks and actions
    assert {t.phase for t in Task.query.filter_by(request_id=rid, step=3)} == {"inputs", "decision"}
    assert {a.phase for a in actions_of(rid) if a.step == 3} == {"inputs", "decision"}

    # the financial table and the ratio show to the people who may see them (1254300,50 / 812400 = 1,54)
    as_user(client, "central.ceo")
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert "1.254.300,50" in html and "1,54" in html and "Revenue per" in html
    assert html.count('class="ehr-history__item') == 9
    # the requester does not see the table
    as_user(client, "nic.requester")
    assert "1.254.300,50" not in text(client.get("/requests/%d" % rid))


def test_scenario_2_admin_skips_step_5(seeded, client):
    req = create(client, category="admin")
    rid = req.id
    step2(client, rid, financials=False)
    assert not RequestFinancials.query.filter_by(request_id=rid).count()
    step3(client, rid, sci=False)
    step4(client, rid)
    r = reload(rid)
    assert r.current_step == 6
    assert [t.role for t in r.tasks if t.status == "open"] == ["ceo"]
    assert act(client, "central.ceo", rid, "approve").status_code == 302
    assert reload(rid).status == "approved"


def test_scenario_3_nursing_goes_to_the_nursing_director(seeded, client):
    req = create(client, category="nursing")
    rid = req.id
    step2(client, rid, financials=False)
    step3(client, rid)
    step4(client, rid)
    r = reload(rid)
    assert r.current_step == 5 and [t.role for t in r.tasks if t.status == "open"] == ["nursing_director"]
    assert act(client, "central.nursing", rid, "opinion", opinion="negative", comment="Concern.").status_code == 302
    assert reload(rid).current_step == 6


def test_scenario_4_step_2_no_rejects_and_opens_nothing(seeded, client):
    req = create(client)
    rid = req.id
    # a "no" needs a comment: the card comes back with the message and nothing is recorded
    resp = act(client, "nic.accountant", rid, "check", position="no", funds="yes")
    assert resp.status_code == 200
    assert "Write a comment to explain." in text(resp)
    assert len(actions_of(rid)) == 1  # only the submission
    resp = act(client, "nic.accountant", rid, "check", position="no", funds="yes", comment="No vacant post.")
    assert resp.status_code == 302
    r = reload(rid)
    assert r.status == "rejected" and r.closed_at is not None and r.current_step == 2
    assert not [t for t in r.tasks if t.status != "closed"]
    assert not RequestFinancials.query.filter_by(request_id=rid).count()
    as_user(client, "nic.requester")
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert "Rejected at step 2" in html and "No vacant post." in html


def test_scenario_6_credit_no_rejects_at_once_and_closes_the_hr_task(seeded, client):
    req = create(client)
    rid = req.id
    step2(client, rid)
    step3(client, rid)
    r = reload(rid)
    assert sorted(t.role for t in r.tasks if t.status == "open") == ["central_hr_officer", "fin_mgmt_head"]
    resp = act(client, "central.finmgmt", rid, "check", credit="no", comment="No credit this year.")
    assert resp.status_code == 302
    r = reload(rid)
    assert r.status == "rejected" and r.current_step == 4
    assert not [t for t in r.tasks if t.status != "closed"]
    assert [t.status for t in r.tasks if t.role == "central_hr_officer"] == ["closed"]


def test_scenario_16_four_posts_with_resignation_ask_a_cost_per_leaver(seeded, client):
    data = {"positions_count": "4"}
    for i in range(4):
        data.update({"leavers[%d].name" % i: "Leaver %d" % i, "leavers[%d].leave_date" % i: "01/04/2027",
                     "leavers[%d].employment" % i: "okypy_contract"})
    req = create(client, category="admin", reason="resignation", **data)
    rid = req.id
    assert RequestLeaver.query.filter_by(request_id=rid).count() == 4
    step2(client, rid, financials=False)
    step3(client, rid, sci=False)
    assert act(client, "central.finmgmt", rid, "check", credit="yes", commitment_article="A-2").status_code == 302

    as_user(client, "central.hr")
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert page.count("Annual employer cost of Leaver") == 4 and "cost of the new hires" in page

    leavers = RequestLeaver.query.filter_by(request_id=rid).order_by(RequestLeaver.id).all()
    fields = {"new_hire_cost": "200.000,00"}
    for leaver in leavers[:3]:
        fields["leaver_cost.%d" % leaver.id] = "41.000,00"
    resp = act(client, "central.hr", rid, "check", **fields)  # one cost is missing
    assert resp.status_code == 200
    assert "Enter a cost for each person" in text(resp)
    assert "41.000,00" in text(resp)  # the typed values stay
    assert reload(rid).current_step == 4 and len(actions_of(rid)) == 5

    fields["leaver_cost.%d" % leavers[3].id] = "41.500,50"
    assert act(client, "central.hr", rid, "check", **fields).status_code == 302
    db_leavers = RequestLeaver.query.filter_by(request_id=rid).order_by(RequestLeaver.id).all()
    assert [l.annual_employer_cost for l in db_leavers] == [Decimal("41000.00")] * 3 + [Decimal("41500.50")]
    assert reload(rid).current_step == 6  # admin: step 5 does not apply
