"""End-to-end lethality tests, including Roster-threshold sanity checks."""

import math

import pytest

from shotgun_ballistics.calculator import ShotSetup, evaluate, max_effective_range
from shotgun_ballistics.lethality import poisson_at_least
from shotgun_ballistics.penetration import equivalent_velocity


def test_poisson_basic():
    assert math.isclose(poisson_at_least(1, 0.0), 0.0)
    assert poisson_at_least(0, 5) == 1.0
    # P(>=1) for lambda=1 is 1 - e^-1 = 0.632
    assert math.isclose(poisson_at_least(1, 1.0), 1 - math.exp(-1), abs_tol=1e-9)


def test_equivalent_velocity_reference():
    # #3 steel (0.14") at 600 fps == B steel (0.17") at ~494 fps
    v = equivalent_velocity(0.14, 600, 0.17)
    assert math.isclose(v, 494, abs_tol=5)


def test_reasonable_duck_load_is_lethal_at_moderate_range():
    setup = ShotSetup(
        species="mallard", material="steel", shot_size="2",
        payload_oz=1.125, muzzle_velocity_fps=1450, choke="modified",
        range_yd=35, use_torso_standard=False,  # decoyed frontal
    )
    rep = evaluate(setup)
    assert rep.penetration.energy_gate_pass
    assert rep.lethality.verdict in ("clean-kill-likely", "marginal")


def test_energy_gate_fails_when_too_far_or_too_small():
    # tiny steel shot far away should fail the energy gate for a duck
    setup = ShotSetup(
        species="mallard", material="steel", shot_size="7",
        payload_oz=1.0, muzzle_velocity_fps=1300, range_yd=55,
    )
    rep = evaluate(setup)
    assert not rep.penetration.energy_gate_pass
    assert rep.lethality.verdict == "wounding-likely"


def test_verdict_downgrades_with_range():
    base = dict(species="pheasant", material="lead", shot_size="5",
                payload_oz=1.25, muzzle_velocity_fps=1300, choke="modified")
    close = evaluate(ShotSetup(range_yd=25, **base))
    far = evaluate(ShotSetup(range_yd=60, **base))
    order = {"clean-kill-likely": 2, "marginal": 1, "wounding-likely": 0}
    assert order[close.lethality.verdict] >= order[far.lethality.verdict]
    assert close.lethality.clean_kill_probability >= far.lethality.clean_kill_probability


def test_max_effective_range_is_sane():
    setup = ShotSetup(
        species="mallard", material="steel", shot_size="2",
        payload_oz=1.125, muzzle_velocity_fps=1450, choke="modified",
        use_torso_standard=False,
    )
    mer = max_effective_range(setup)
    assert mer is not None
    assert 20 <= mer <= 70


def test_denser_material_retains_more_energy_per_pellet():
    # At equal shot size and range, a denser pellet retains more energy -- this
    # is why TSS lets you drop several shot sizes while keeping penetration.
    common = dict(species="mallard", shot_size="4", payload_oz=1.125,
                  muzzle_velocity_fps=1350, choke="modified", range_yd=45)
    steel = evaluate(ShotSetup(material="steel", **common))
    tss = evaluate(ShotSetup(material="tss", **common))
    assert tss.energy_ftlb > steel.energy_ftlb
    assert tss.velocity_fps > steel.velocity_fps


def test_report_serializes_to_dict():
    rep = evaluate(ShotSetup(species="dove", material="lead", shot_size="7.5",
                             payload_oz=1.0, range_yd=25))
    d = rep.to_dict()
    assert "lethality" in d and "pattern" in d and "penetration" in d
    assert isinstance(d["total_pellets"], int)
