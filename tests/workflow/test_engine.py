import pytest

from ehr.workflow.model import NewAction
from ehr.workflow.engine import apply
from wfhelpers import ACC_OK, ACC_SIMPLE, Sim, make_directory, T0


def ops(res, kind):
    return [o for o in res.task_ops if o.op == kind]


def test_T1_submit():
    sim = Sim()
    res = sim.submit()
    s = sim.state
    assert (s.status, s.current_step, s.round) == ("in_progress", 2, 1)
    assert s.route["financials_required"] is True
    assert [(o.role, o.assignee_user_id) for o in ops(res, "open")] == [("dir_accountant", "acc1")]
    assert res.action.action == "submit" and res.action.step == 1


def test_T2a_check_opens_step3_inputs():
    sim = Sim()
    sim.submit()
    res = sim.acc()
    assert (sim.state.current_step, sim.state.step3_phase) == (3, "inputs")
    assert {o.role for o in ops(res, "open")} == {"sci_director", "dir_hr_officer"}
    sim2 = Sim()
    sim2.submit()
    sim2.acc({**ACC_OK, "position": "arranged_centrally"})
    assert sim2.state.current_step == 3


@pytest.mark.parametrize("payload", [{"position": "no", "funds": "yes"}, {"position": "yes", "funds": "no"}])
def test_T2b_reject_at_step2(payload):
    sim = Sim()
    sim.submit()
    sim.acc(payload, expect="comment_required")
    res = sim.act("acc1", "check", "dir_accountant", payload, "no budget")
    assert (sim.state.status, sim.state.current_step) == ("rejected", 2)
    assert res.closed_at is not None and ops(res, "close")


def test_T3a_sci_opinion_recorded_then_waits_then_decision():
    sim = Sim()
    sim.through_step2()
    res = sim.sci("positive")
    assert sim.state.step3_phase == "inputs" and not ops(res, "open")
    res = sim.hro()
    assert sim.state.step3_phase == "decision"
    assert [o.role for o in ops(res, "open")] == ["dir_exec"]


def test_T3a_negative_opinion_does_not_stop():
    sim = Sim()
    sim.through_step2()
    sim.sci("negative", "concerns")
    sim.hro()
    assert sim.state.step3_phase == "decision"


def test_T3b_hr_check_either_order_and_incomplete_needs_comment():
    sim = Sim()
    sim.through_step2()
    sim.hro("incomplete", expect="comment_required")
    sim.hro("incomplete", "missing form")
    assert sim.state.step3_phase == "inputs"
    res = sim.sci()
    assert [o.role for o in ops(res, "open")] == ["dir_exec"]


def test_T4a_approve_opens_step4():
    sim = Sim()
    sim.through_step2(); sim.sci(); sim.hro()
    res = sim.exe()
    assert sim.state.current_step == 4
    assert {o.role for o in ops(res, "open")} == {"fin_mgmt_head", "central_hr_officer"}


def test_T4b_reject_at_step3():
    sim = Sim()
    sim.through_step2(); sim.sci(); sim.hro()
    sim.exe("reject", expect="comment_required")
    sim.exe("reject", "not now")
    assert (sim.state.status, sim.state.current_step) == ("rejected", 3)


def step4(sim):
    sim.through_step3()


def test_T5a_credit_no_rejects_and_closes_others():
    sim = Sim()
    step4(sim)
    sim.fin("no", expect="comment_required")
    res = sim.fin("no", "no credit")
    assert (sim.state.status, sim.state.current_step) == ("rejected", 4)
    assert [o.role for o in ops(res, "close")] == ["central_hr_officer", "fin_mgmt_head"] or \
        {o.role for o in ops(res, "close")} == {"central_hr_officer", "fin_mgmt_head"}
    assert not sim.open_tasks()


def test_T5b_credit_yes_waits_for_hr():
    sim = Sim()
    step4(sim)
    sim.fin()
    assert sim.state.current_step == 4 and set(sim.open_tasks()) == {"central_hr_officer"}


def test_T5c_hr_costs_then_both_in():
    sim = Sim()
    step4(sim)
    sim.chr_()
    assert sim.state.current_step == 4
    sim.fin()
    assert sim.state.current_step == 5


def test_T5d_goes_to_step5_or_skips_to_step6():
    sim = Sim("medical")
    step4(sim); sim.fin(); res = sim.chr_()
    assert [o.role for o in ops(res, "open")] == ["medical_director"]
    sim = Sim("admin", sci=False)
    step4(sim); sim.fin(); res = sim.chr_()
    assert sim.state.current_step == 6
    assert [o.role for o in ops(res, "open")] == ["ceo"]


def test_T6_director_opinion_to_ceo():
    sim = Sim("nursing")
    step4(sim); sim.fin(); sim.chr_()
    sim.director("nursing_director", "nur1", "negative", expect="comment_required")
    res = sim.director("nursing_director", "nur1")
    assert sim.state.current_step == 6 and [o.role for o in ops(res, "open")] == ["ceo"]


def test_T7a_ceo_approves():
    sim = Sim()
    step4(sim); sim.fin(); sim.chr_(); sim.director()
    res = sim.ceo()
    assert sim.state.status == "approved" and res.closed_at == sim.now
    assert "request_approved" in sim.kinds(res)


def test_T7b_ceo_rejects():
    sim = Sim()
    step4(sim); sim.fin(); sim.chr_(); sim.director()
    sim.ceo("reject", expect="comment_required")
    sim.ceo("reject", "no")
    assert (sim.state.status, sim.state.current_step) == ("rejected", 6)


def test_T8_return_pauses_all_including_returner():
    sim = Sim()
    sim.through_step2()
    res = sim.act("sci1", "return", "sci_director", comment="need the plan")
    assert (sim.state.status, sim.state.returned_from_step) == ("returned", 3)
    assert {o.role for o in ops(res, "pause")} == {"sci_director", "dir_hr_officer"}
    assert all(t.status == "paused" for t in sim.state.tasks if t.step == 3)
    assert res.returned_at == sim.now
    sim.act("sci1", "return", "sci_director", expect="request_returned")


def test_T8_return_needs_comment():
    sim = Sim()
    sim.through_step2()
    sim.act("sci1", "return", "sci_director", expect="comment_required")


def test_T9a_resubmit_resumes_same_step():
    sim = Sim()
    sim.through_step2()
    sim.act("sci1", "return", "sci_director", comment="more")
    res = sim.act("req1", "resubmit", "requester")
    s = sim.state
    assert (s.status, s.current_step, s.step3_phase, s.round) == ("in_progress", 3, "inputs", 2)
    assert s.returned_from_step is None
    assert {o.role for o in ops(res, "resume")} == {"sci_director", "dir_hr_officer"}
    assert all(t.clock_started_at == sim.now for t in s.tasks if t.status == "open")
    assert "task_resumed" in sim.kinds(res)


def test_T9a_may_replace_given_to_completed_inputs():
    sim = Sim()
    sim.through_step2()
    sim.hro("complete")
    sim.act("sci1", "return", "sci_director", comment="more")
    res = sim.act("req1", "resubmit", "requester")
    assert [o.assignee_user_id for o in ops(res, "allow_replace")] == ["hro1"]
    assert "new_material" in sim.kinds(res)


def test_T9b_material_change_back_to_step2():
    sim = Sim()
    sim.through_step2()
    sim.sci()
    sim.act("hro1", "return", "dir_hr_officer", comment="wrong facility")
    res = sim.act("req1", "resubmit", "requester", changed={"facility_id": "F2"})
    s = sim.state
    assert (s.status, s.current_step, s.round, s.step3_phase) == ("in_progress", 2, 2, None)
    assert {o.role for o in ops(res, "open")} == {"dir_accountant"}
    assert {o.role for o in ops(res, "close")} == {"dir_hr_officer"}
    assert not ops(res, "resume")
    sup = {a.role for a in s.actions if a.is_superseded}
    assert sup == {"dir_accountant", "sci_director", "dir_hr_officer"}  # history kept, flagged
    assert all(a.step == 1 or a.is_superseded for a in s.actions)


def test_T10_replace_supersedes_and_clears_flag():
    sim = Sim()
    sim.through_step2()
    sim.hro("incomplete", "missing")
    sim.act("sci1", "return", "sci_director", comment="x")
    sim.act("req1", "resubmit", "requester")
    first = next(a for a in sim.state.actions if a.role == "dir_hr_officer")
    res = sim.hro("complete")
    assert res.action.supersedes_action_id == first.id
    assert res.superseded_action_ids == (first.id,)
    assert not any(t.may_replace for t in sim.state.tasks)
    sim.hro("complete", expect="not_your_task")


def test_T10_new_credit_no_rejects():
    sim = Sim()
    step4(sim)
    sim.fin()
    sim.act("chr1", "return", "central_hr_officer", comment="costs?")
    sim.act("req1", "resubmit", "requester")
    sim.fin("no", expect="comment_required")
    res = sim.fin("no", "changed my mind")
    assert sim.state.status == "rejected" and res.action.supersedes_action_id is not None


def test_T10_only_in_same_step_and_phase():
    sim = Sim()
    sim.through_step2()
    sim.hro()
    sim.act("sci1", "return", "sci_director", comment="x")
    sim.act("req1", "resubmit", "requester")
    sim.sci(); # decision phase now, hro flag still set but phase differs
    sim.hro("incomplete", "late", expect="wrong_step")


def test_T11_withdraw_closes_everything():
    sim = Sim()
    sim.through_step2()
    sim.act("req1", "withdraw", "requester", expect="comment_required")
    res = sim.act("req1", "withdraw", "requester", comment="no longer needed")
    assert sim.state.status == "withdrawn" and res.closed_at
    assert {o.role for o in ops(res, "close")} == {"sci_director", "dir_hr_officer"}
    assert "request_withdrawn" in sim.kinds(res)


def test_T12_system_withdraw_after_timeout():
    sim = Sim()
    sim.through_step2()
    sim.act("sci1", "return", "sci_director", comment="x")
    res = sim.system_withdraw()
    assert sim.state.status == "withdrawn"
    assert res.action.role == "system" and res.action.comment == "system.auto_withdraw"
    assert all(t.status == "closed" for t in sim.state.tasks)


def test_T12_timeout_checked_when_settings_given():
    sim = Sim()
    sim.through_step2()
    sim.act("sci1", "return", "sci_director", comment="x")
    na = NewAction(None, "withdraw", "system", system=True)
    early = apply(sim.state, na, sim.directory, sim.now, holidays=set(), settings={"returned_timeout_days": 30})
    assert early.errors == ("wrong_step",)
    late = apply(sim.state, na, sim.directory, sim.now.replace(year=2027),
                 holidays=set(), settings={"returned_timeout_days": 30})
    assert late.ok


def test_closing_accepts_nothing_more():
    sim = Sim()
    sim.through_step2()
    sim.act("req1", "withdraw", "requester", comment="x")
    sim.sci(expect="request_closed")
    sim.act("req1", "resubmit", "requester", expect="request_closed")
    sim.act("req1", "withdraw", "requester", comment="again", expect="request_closed")


# ---- section 6 errors

def test_error_not_your_task():
    sim = Sim()
    sim.submit()
    sim.act("acc1", "check", "sci_director", {"opinion": "positive"}, expect="not_your_task")
    sim.act("zzz", "check", "dir_accountant", ACC_OK, expect="not_your_task")


def test_error_request_returned():
    sim = Sim()
    sim.through_step2()
    sim.act("sci1", "return", "sci_director", comment="x")
    sim.hro(expect="request_returned")


def test_error_wrong_step():
    sim = Sim()
    sim.submit()
    sim.act("acc1", "approve", "dir_accountant", expect="wrong_step")
    sim.act("req1", "resubmit", "requester", expect="wrong_step")
    sim.act("req1", "submit", "requester", expect="wrong_step")


def test_error_comment_required_list():
    sim = Sim()
    sim.through_step2()
    sim.sci("negative", expect="comment_required")
    sim.hro("incomplete", "  ", expect="comment_required")


def test_error_financials_required():
    sim = Sim("medical")
    sim.submit()
    sim.acc(ACC_SIMPLE, expect="financials_required")
    partial = {**ACC_OK, "ytd": {"visits": 1}}
    sim.acc(partial, expect="financials_required")
    sim2 = Sim("nursing")
    sim2.submit()
    sim2.acc(ACC_SIMPLE)  # not required for nursing


def test_error_commitment_article_required():
    sim = Sim()
    step4(sim)
    sim.act("fin1", "check", "fin_mgmt_head", {"credit": "yes"}, expect="commitment_article_required")


def test_error_leaver_costs_required():
    sim = Sim(reason="resignation", leavers=["L1", "L2"])
    step4(sim)
    sim.chr_({"new_hire_cost": "10"}, expect="leaver_costs_required")
    sim.chr_({"new_hire_cost": "10", "leaver_costs": {"L1": "5"}}, expect="leaver_costs_required")
    sim.chr_({"leaver_costs": {"L1": "5", "L2": "6"}}, expect="leaver_costs_required")
    sim.chr_({"new_hire_cost": "10", "leaver_costs": {"L1": "5", "L2": "6"}})


def test_leaver_costs_not_needed_for_new_need():
    sim = Sim(reason="new_need", leavers=["L1"])
    step4(sim)
    sim.chr_({"new_hire_cost": "10"})


def test_error_directorate_locked():
    sim = Sim()
    sim.through_step2()
    sim.act("sci1", "return", "sci_director", comment="x")
    sim.act("req1", "resubmit", "requester", changed={"directorate_id": "D2"}, expect="directorate_locked")


def test_error_not_requester():
    sim = Sim()
    sim.act("someone", "submit", "requester", expect="not_requester")
    sim.submit()
    sim.act("someone", "withdraw", "requester", comment="x", expect="not_requester")
    sim.acc()
    sim.act("sci1", "return", "sci_director", comment="x")
    sim.act("someone", "resubmit", "requester", expect="not_requester")


def test_error_own_request():
    sim = Sim(requester="sci1")  # the sci_director files a request
    sim.submit()
    sim.acc()
    sim.act("sci1", "opinion", "sci_director", {"opinion": "positive"}, expect="own_request")


def test_error_invalid_payload():
    sim = Sim()
    sim.submit()
    sim.act("acc1", "check", "dir_accountant", {"position": "maybe", "funds": "yes"}, expect="invalid_payload")


# ---- section 7 events

def test_events_section7():
    sim = Sim()
    res = sim.submit()
    kinds = sim.kinds(res)
    assert "request_submitted" in kinds and "task_opened" in kinds
    ev = next(e for e in res.events if e.kind == "task_opened")
    assert ev.recipient_user_id == "acc1" and ev.request_id == 1
    sim.acc()
    res = sim.act("sci1", "return", "sci_director", comment="x")
    assert [(e.kind, e.recipient_user_id) for e in res.events] == [("request_returned", "req1")]
    res = sim.act("req1", "resubmit", "requester")
    assert "request_resubmitted" in sim.kinds(res)
    assert next(e for e in res.events if e.kind == "request_resubmitted").recipient_user_id == "sci1"


def test_events_redirect_and_rejected():
    sim = Sim(out=["acc1"], directory=make_directory(out=["sci1"]))
    sim.directory = make_directory(out=["acc1"], extra_subs={("dir_accountant", "D1"): "acc_sub"})
    res = sim.submit()
    kinds = sim.kinds(res)
    assert "task_redirected" in kinds
    assert next(e for e in res.events if e.kind == "task_redirected").recipient_user_id == "acc1"
    sim.act("acc_sub", "check", "dir_accountant", {"position": "no", "funds": "yes"}, "nope")
    assert "request_rejected" in sim.kinds()
