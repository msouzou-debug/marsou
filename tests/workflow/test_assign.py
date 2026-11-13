from ehr.workflow.assign import reassign_for_out_of_office, resolve_assignee
from ehr.workflow.model import Directory
from wfhelpers import Sim, make_directory


def test_C1_default_holder():
    d = make_directory()
    assert resolve_assignee("sci_director", "D1", "req1", d) == ("sci1", None, None)
    assert resolve_assignee("ceo", "D1", "req1", d) == ("ceo1", None, None)  # central role


def test_C2_holder_out_substitute():
    d = make_directory(out=["sci1"])
    assert resolve_assignee("sci_director", "D1", "req1", d) == ("sci_sub", "sci1", "out_of_office")


def test_C3_requester_is_holder_goes_to_substitute():
    d = make_directory()
    assert resolve_assignee("sci_director", "D1", "sci1", d) == ("sci_sub", "sci1", "conflict_of_interest")


def test_C3_chain_to_line_manager_and_beyond():
    d = make_directory()
    # holder hro1 and substitute hro_sub: requester is hro1, substitute is out
    d2 = make_directory(out=["hro_sub"])
    assert resolve_assignee("dir_hr_officer", "D1", "hro1", d2) == ("exe1", "hro1", "conflict_of_interest")
    # no substitute: holder acc1 is requester, manager exe1 is out, next is ceo1
    d3 = make_directory(out=["exe1"])
    assert resolve_assignee("dir_accountant", "D1", "acc1", d3) == ("ceo1", "acc1", "conflict_of_interest")
    assert d.manager_of("acc1") == "exe1"


def test_C4_out_of_office_candidate_skipped():
    d = make_directory(out=["sci1", "sci_sub"])
    assert resolve_assignee("sci_director", "D1", "req1", d) == ("med1", "sci1", "out_of_office")


def test_C5_nobody_left_unassigned_event():
    d = Directory(holders={("dir_accountant", "D1"): "acc1"}, out_of_office=frozenset(["acc1"]))
    assert resolve_assignee("dir_accountant", "D1", "req1", d) == (None, "acc1", "out_of_office")
    sim = Sim(directory=d)
    res = sim.submit()
    assert res.task_ops[0].assignee_user_id is None
    assert "task_unassigned" in sim.kinds(res)
    assert sim.open_tasks()["dir_accountant"].assignee_user_id is None


def test_C6_out_of_office_moves_open_tasks():
    sim = Sim()
    sim.through_step2()
    assert sim.open_tasks()["sci_director"].assignee_user_id == "sci1"
    d = make_directory(out=["sci1"])
    ops, events = reassign_for_out_of_office("sci1", [sim.state], d)
    assert len(ops) == 1 and ops[0].op == "reassign" and ops[0].assignee_user_id == "sci_sub"
    assert ops[0].redirect_reason == "out_of_office"
    assert events[0].kind == "task_redirected" and events[0].recipient_user_id == "sci_sub"
    sim.directory = d
    sim.store(type("R", (), {"superseded_action_ids": (), "action": None, "task_ops": ops,
                              "status": "in_progress", "current_step": 3, "step3_phase": "inputs",
                              "round": 1, "returned_from_step": None, "category": "medical",
                              "route": sim.state.route, "returned_at": None})())
    # switching off does not move it back: nothing to do, task stays with the substitute
    back = make_directory()
    ops2, _ = reassign_for_out_of_office("sci1", [sim.state], back)
    assert ops2 == []
    assert sim.open_tasks()["sci_director"].assignee_user_id == "sci_sub"


def test_C6_paused_and_other_users_untouched():
    sim = Sim()
    sim.through_step2()
    d = make_directory(out=["hro1"])
    ops, _ = reassign_for_out_of_office("sci1", [sim.state], d)
    assert ops == []


def test_C7_only_assignee_acts_on_open_task():
    sim = Sim()
    sim.through_step2()
    sim.sci(user="hro1", expect="not_your_task")  # not the assignee
    sim.act("sci1", "return", "sci_director", comment="more info")
    sim.sci(expect="request_returned")
