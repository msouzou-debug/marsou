"""
Runs the acceptance scenarios under pytest.

The scenarios themselves live in acceptance.py, so the Word document generated for
sign-off is produced from the same code these tests run.
"""
import pytest

import acceptance
import taep_harness


@pytest.mark.parametrize("scenario", acceptance.SCENARIOS,
                         ids=[s.code for s in acceptance.SCENARIOS])
def test_acceptance_scenario(scenario, tmp_path):
    with taep_harness.Harness(str(tmp_path)) as harness:
        checks = scenario.run(harness)
    assert checks, f"{scenario.code} recorded no checks"


def test_every_scenario_has_a_unique_code_and_a_clause():
    codes = [s.code for s in acceptance.SCENARIOS]
    assert len(codes) == len(set(codes))
    assert all(s.clause and s.title and s.given and s.when and s.then
               for s in acceptance.SCENARIOS)


def test_the_scenarios_cover_the_clauses_the_brief_names():
    """§13 names the behaviours that must be demonstrated. Each must appear."""
    clauses = " ".join(s.clause for s in acceptance.SCENARIOS)
    for clause in ("§4.1", "§4.4", "§5", "§6", "§7", "§8", "§10", "§11", "§12", "§13"):
        assert clause in clauses, f"no scenario cites {clause}"
