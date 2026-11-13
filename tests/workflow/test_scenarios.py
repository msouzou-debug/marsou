"""Acceptance scenarios 1 to 6 and 12 to 16, end to end through the engine."""
from wfhelpers import ACC_OK, ACC_SIMPLE, Sim, make_directory
from ehr.workflow.tracker import tracker_view


def roles_asked(sim):
    return {a.role for a in sim.state.actions}


def test_scenario_1_medical_with_sci_director_all_six_steps():
    sim = Sim("medical", sci=True)
    sim.submit()
    sim.acc()
    assert set(sim.open_tasks()) == {"sci_director", "dir_hr_officer"}
    sim.sci(); sim.hro(); sim.exe()
    sim.fin(); sim.chr_()
    assert set(sim.open_tasks()) == {"medical_director"}
    sim.director()
    sim.ceo()
    assert sim.state.status == "approved"
    assert not sim.open_tasks()
    assert [s["state"] for s in tracker_view(sim.state)] == ["done"] * 6


def test_scenario_2_admin_no_sci_director_no_financials_step5_skipped():
    sim = Sim("admin", sci=False)
    sim.submit()
    assert sim.state.route["financials_required"] is False
    sim.acc(ACC_SIMPLE)  # no financial data needed
    assert set(sim.open_tasks()) == {"dir_hr_officer"}
    sim.hro(); sim.exe(); sim.fin(); sim.chr_()
    assert sim.state.current_step == 6
    sim.ceo()
    assert sim.state.status == "approved"
    assert "medical_director" not in roles_asked(sim) and "nursing_director" not in roles_asked(sim)
    states = [s["state"] for s in tracker_view(sim.state)]
    assert states[4] == "not_applicable"


def test_scenario_3_nursing_with_sci_director():
    sim = Sim("nursing", sci=True)
    sim.submit()
    sim.acc(ACC_SIMPLE)
    assert set(sim.open_tasks()) == {"sci_director", "dir_hr_officer"}
    sim.sci(); sim.hro(); sim.exe(); sim.fin()
    res = sim.chr_()
    assert set(sim.open_tasks()) == {"nursing_director"}
    sim.director("nursing_director", "nur1")
    sim.ceo()
    assert sim.state.status == "approved"


def test_scenario_4_position_no_rejects_no_later_task():
    sim = Sim()
    sim.submit()
    sim.act("acc1", "check", "dir_accountant", {"position": "no", "funds": "yes"}, "post not needed")
    assert (sim.state.status, sim.state.current_step) == ("rejected", 2)
    assert not sim.open_tasks()
    assert all(t.step == 2 for t in sim.state.tasks)


def test_scenario_5_return_at_step2_resubmit_no_material_change():
    sim = Sim()
    sim.submit()
    sim.act("acc1", "return", "dir_accountant", comment="clarify the need")
    assert sim.state.status == "returned"
    sim.act("req1", "resubmit", "requester", changed={"need_text": "clearer text"})
    s = sim.state
    assert (s.status, s.current_step, s.round) == ("in_progress", 2, 2)
    assert set(sim.open_tasks()) == {"dir_accountant"}
    assert len([t for t in s.tasks if t.role == "dir_accountant"]) == 1  # resumed, not reopened
    sim.acc()
    assert sim.state.current_step == 3


def test_scenario_6_credit_no_with_hr_input_pending_rejects_at_once():
    sim = Sim()
    sim.through_step3()
    assert set(sim.open_tasks()) == {"fin_mgmt_head", "central_hr_officer"}
    sim.fin("no", "no credit line")
    assert sim.state.status == "rejected"
    assert all(t.status == "closed" for t in sim.state.tasks)
    assert [s["state"] for s in tracker_view(sim.state)][3] == "stopped"


def test_scenario_12_requester_is_sci_director_nursing_goes_to_substitute():
    sim = Sim("nursing", sci=True, requester="sci1")
    sim.submit()
    res = sim.acc(ACC_SIMPLE)
    opened = {o.role: o for o in res.task_ops if o.op == "open"}
    o = opened["sci_director"]
    assert (o.assignee_user_id, o.on_behalf_of_user_id, o.redirect_reason) == (
        "sci_sub", "sci1", "conflict_of_interest")
    sim.sci(user="sci_sub")
    assert sim.state.actions[-1].redirect_reason == "conflict_of_interest"
    sim.act("sci1", "opinion", "sci_director", {"opinion": "positive"}, expect="own_request")


def test_scenario_13_return_at_step3_replace_via_T10_both_in_history():
    sim = Sim("medical", sci=True)
    sim.through_step2()
    sim.hro("incomplete", "annex missing")
    sim.act("sci1", "return", "sci_director", comment="please explain the absence")
    assert sim.open_tasks() == {}
    assert [t.status for t in sim.state.tasks if t.role == "sci_director"] == ["paused"]
    sim.act("req1", "resubmit", "requester")
    assert sim.open_tasks()["sci_director"].status == "open"  # resumed
    assert sim.state.step3_phase == "inputs"
    sim.hro("complete")  # T10
    hro_actions = [a for a in sim.state.actions if a.role == "dir_hr_officer"]
    assert len(hro_actions) == 2
    assert hro_actions[0].is_superseded and hro_actions[1].supersedes_action_id == hro_actions[0].id
    assert hro_actions[0].payload["documentation"] == "incomplete"
    view = tracker_view(sim.state)[2]
    hro = next(p for p in view["people"] if p["role"] == "dir_hr_officer")
    assert hro["state"] == "done" and hro["replaced"] is True
    sim.sci()
    assert sim.state.step3_phase == "decision"


def test_scenario_14_category_change_medical_to_admin_recomputes_route():
    sim = Sim("medical", sci=True)
    sim.through_step2()
    sim.hro()
    sim.act("sci1", "return", "sci_director", comment="wrong category?")
    sim.act("req1", "resubmit", "requester", changed={"category": "admin"})
    s = sim.state
    assert (s.status, s.current_step, s.round, s.category) == ("in_progress", 2, 2, "admin")
    assert s.route["financials_required"] is False
    assert [x for x in s.route["steps"] if x["step"] == 5][0]["applies"] is False
    assert [x for x in s.route["steps"] if x["step"] == 3][0]["inputs"] == ["dir_hr_officer"]
    sim.acc(ACC_SIMPLE)  # no financials any more
    assert set(sim.open_tasks()) == {"dir_hr_officer"}
    sim.hro(); sim.exe(); sim.fin(); sim.chr_()
    assert sim.state.current_step == 6


def test_scenario_15a_requester_withdraws_a_returned_request():
    sim = Sim()
    sim.through_step2()
    sim.act("sci1", "return", "sci_director", comment="x")
    res = sim.act("req1", "withdraw", "requester", comment="plan dropped")
    assert sim.state.status == "withdrawn" and res.closed_at
    assert all(t.status == "closed" for t in sim.state.tasks)
    assert tracker_view(sim.state)[2]["state"] == "withdrawn"


def test_scenario_15b_system_withdrawal_after_timeout():
    sim = Sim()
    sim.through_step2()
    sim.act("sci1", "return", "sci_director", comment="x")
    res = sim.system_withdraw("auto")
    assert sim.state.status == "withdrawn"
    assert res.action.actor_user_id is None and res.action.comment == "auto"
    assert all(t.status == "closed" for t in sim.state.tasks)


def test_scenario_16_four_posts_resignation_needs_cost_per_leaver():
    sim = Sim(reason="resignation", leavers=["L1", "L2", "L3", "L4"])
    sim.through_step3()
    costs = {"L1": "100", "L2": "100", "L3": "100"}
    sim.chr_({"new_hire_cost": "400", "leaver_costs": costs}, expect="leaver_costs_required")
    costs["L4"] = "100"
    sim.chr_({"new_hire_cost": "400", "leaver_costs": costs})
    sim.fin()
    assert sim.state.current_step == 5
