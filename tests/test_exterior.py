"""Validate retained-velocity against the reference Lowry data points."""

import pytest

from shotgun_ballistics.exterior import state_at_range
from shotgun_ballistics.pellets import make_pellet


def _vel(material, size, mv, rng):
    return state_at_range(make_pellet(material, size), mv, rng).velocity_fps


@pytest.mark.parametrize(
    "material,size,mv,rng,expected,tol",
    [
        # #6 lead @ 1375 fps -> ~780 @ 30 yd, ~591 @ 50 yd (Lowry, Am. Rifleman)
        ("lead", "6", 1375, 30, 780, 60),
        ("lead", "6", 1375, 50, 591, 70),
        # #2 steel @ 1400 -> ~691 @ 40 yd
        ("steel", "2", 1400, 40, 691, 70),
        # #4 lead @ 1400 -> ~766 @ 40 yd
        ("lead", "4", 1400, 40, 766, 70),
    ],
)
def test_retained_velocity(material, size, mv, rng, expected, tol):
    got = _vel(material, size, mv, rng)
    assert abs(got - expected) <= tol, (
        f"{material} #{size} @ {mv} fps, {rng} yd: got {got:.0f}, exp {expected}"
    )


def test_velocity_monotonic_decreasing():
    p = make_pellet("steel", "3")
    v10 = state_at_range(p, 1400, 10).velocity_fps
    v30 = state_at_range(p, 1400, 30).velocity_fps
    v50 = state_at_range(p, 1400, 50).velocity_fps
    assert 1400 > v10 > v30 > v50


def test_denser_pellet_retains_more_velocity():
    # same diameter, lead vs steel: lead (denser) should be faster downrange.
    v_lead = state_at_range(make_pellet("lead", "4"), 1300, 40).velocity_fps
    v_steel = state_at_range(make_pellet("steel", "4"), 1300, 40).velocity_fps
    assert v_lead > v_steel


def test_reference_energy_at_40yd():
    # #2 steel @ 1400 -> ~691 fps ~= 3.7 ft.lbf at 40 yd
    st = state_at_range(make_pellet("steel", "2"), 1400, 40)
    assert abs(st.energy_ftlb - 3.7) < 0.6
