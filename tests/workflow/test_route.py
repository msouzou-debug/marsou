import pytest

from ehr.workflow.route import (CATEGORIES, DEPARTURE_REASONS, MATERIAL_FIELDS, ROLES,
                                compute_route)


def step(route, n):
    return next(s for s in route["steps"] if s["step"] == n)


def test_vocabulary():
    assert CATEGORIES == ("medical", "nursing", "allied", "admin", "other")
    assert len(ROLES) == 10
    assert MATERIAL_FIELDS == ("category", "facility", "cost_centre", "position", "positions_count")
    assert DEPARTURE_REASONS == ("retirement", "resignation", "secondment_end", "contract_end")


def test_route_shape_full():
    r = compute_route("medical", True)
    assert r == {"financials_required": True, "steps": [
        {"step": 1, "roles": ["requester"]},
        {"step": 2, "roles": ["dir_accountant"]},
        {"step": 3, "inputs": ["sci_director", "dir_hr_officer"], "decision": "dir_exec"},
        {"step": 4, "inputs": ["fin_mgmt_head", "central_hr_officer"]},
        {"step": 5, "roles": ["medical_director"], "applies": True},
        {"step": 6, "roles": ["ceo"]}]}


@pytest.mark.parametrize("cat,has,expected", [
    ("medical", True, True), ("nursing", True, True), ("allied", True, True),
    ("admin", True, False), ("other", True, False),
    ("medical", False, False), ("nursing", False, False), ("allied", False, False)])
def test_R1_sci_director_in_inputs(cat, has, expected):
    inputs = step(compute_route(cat, has), 3)["inputs"]
    assert ("sci_director" in inputs) is expected
    assert "dir_hr_officer" in inputs


@pytest.mark.parametrize("cat,expected", [
    ("medical", True), ("allied", True), ("nursing", False), ("admin", False), ("other", False)])
def test_R2_financials_required(cat, expected):
    assert compute_route(cat, True)["financials_required"] is expected


@pytest.mark.parametrize("cat,roles,applies", [
    ("medical", ["medical_director"], True), ("allied", ["medical_director"], True),
    ("nursing", ["nursing_director"], True), ("admin", [], False), ("other", [], False)])
def test_R3_step5(cat, roles, applies):
    s5 = step(compute_route(cat, True), 5)
    assert s5 == {"step": 5, "roles": roles, "applies": applies}


def test_R4_stored_route_not_rerouted_by_directory_change():
    from wfhelpers import Sim, make_directory
    sim = Sim("medical", sci=True)
    sim.submit()
    stored = sim.state.route
    sim.directory = make_directory(sci=False)  # the role holder disappears afterwards
    sim.acc()
    assert set(sim.open_tasks()) == {"sci_director", "dir_hr_officer"}
    assert sim.state.route == stored


def test_unknown_category():
    with pytest.raises(ValueError):
        compute_route("bogus", True)
