from ehr.workflow.route import compute_route
from ehr.workflow.tracker import preview, tracker_view
from wfhelpers import Sim


def test_preview_all_pending_not_applicable_marked():
    stops = preview(compute_route("admin", False))
    assert [s["state"] for s in stops] == ["pending"] * 4 + ["not_applicable", "pending"]
    s3 = stops[2]
    assert [(p["role"], p["phase"]) for p in s3["people"]] == [
        ("dir_hr_officer", "inputs"), ("dir_exec", "decision")]
    assert all(p["state"] == "waiting" and p["actor_user_id"] is None for s in stops for p in s["people"])
    full = preview(compute_route("medical", True))
    assert [p["role"] for p in full[2]["people"]] == ["sci_director", "dir_hr_officer", "dir_exec"]
    assert set(full[0]["people"][0]) == {"role", "state", "actor_user_id", "on_behalf_of_user_id",
                                          "redirect_reason", "replaced", "phase"}


def test_tracker_in_progress_states():
    sim = Sim()
    sim.through_step2()
    sim.sci("negative", "doubts")
    v = tracker_view(sim.state)
    assert [s["state"] for s in v] == ["done", "done", "current", "pending", "pending", "pending"]
    assert v[2]["phase"] == "inputs"
    people = {p["role"]: p for p in v[2]["people"]}
    assert people["sci_director"]["state"] == "negative" and people["sci_director"]["actor_user_id"] == "sci1"
    assert people["dir_hr_officer"]["state"] == "waiting" and people["dir_hr_officer"]["actor_user_id"] == "hro1"


def test_tracker_returned_shows_paused():
    sim = Sim()
    sim.through_step2()
    sim.act("sci1", "return", "sci_director", comment="x")
    v = tracker_view(sim.state)
    assert v[2]["state"] == "paused"
    assert all(p["state"] == "paused" for p in v[2]["people"] if p["role"] != "dir_exec")


def test_tracker_draft_and_redirect_shown():
    sim = Sim(requester="sci1")
    assert [s["state"] for s in tracker_view(sim.state)] == []  # no route yet
    sim.submit(); sim.acc()
    v = tracker_view(sim.state)
    sci = next(p for p in v[2]["people"] if p["role"] == "sci_director")
    assert (sci["actor_user_id"], sci["on_behalf_of_user_id"], sci["redirect_reason"]) == (
        "sci_sub", "sci1", "conflict_of_interest")


def test_tracker_material_change_marks_replaced():
    sim = Sim()
    sim.through_step2()
    sim.sci()
    sim.act("hro1", "return", "dir_hr_officer", comment="x")
    sim.act("req1", "resubmit", "requester", changed={"position_id": "P2"})
    v = tracker_view(sim.state)
    assert v[1]["state"] == "current" and v[2]["state"] == "pending"
    sci = next(p for p in v[2]["people"] if p["role"] == "sci_director")
    assert sci["state"] == "replaced"
