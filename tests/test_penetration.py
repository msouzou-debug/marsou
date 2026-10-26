"""Penetration/energy-gate tests."""

import pytest

from shotgun_ballistics.pellets import make_pellet
from shotgun_ballistics.penetration import (
    STEEL_MIN_VELOCITY_FPS,
    penetration_in,
    evaluate_gate,
)


def test_calibration_point_no3_steel_600fps():
    # Calibration anchor: #3 steel at 600 fps ~= 1.5" (duck target).
    d = penetration_in(make_pellet("steel", "3"), 600)
    assert 1.3 <= d <= 1.7


def test_bigger_pellet_penetrates_deeper_at_same_velocity():
    v = 700
    small = penetration_in(make_pellet("steel", "6"), v)
    big = penetration_in(make_pellet("steel", "BB"), v)
    assert big > small


def test_denser_pellet_penetrates_deeper_same_size():
    v = 700
    steel = penetration_in(make_pellet("steel", "4"), v)
    tss = penetration_in(make_pellet("tss", "4"), v)
    assert tss > steel


def test_energy_gate_pass_fail():
    p = make_pellet("steel", "2")
    ok = evaluate_gate(p, 800, 5.0, 6.8, energy_threshold_ftlb=2.0,
                       is_steel=True, depth_target_in=1.5)
    assert ok.energy_gate_pass and ok.velocity_gate_pass
    weak = evaluate_gate(p, 500, 1.5, 2.0, energy_threshold_ftlb=2.0,
                         is_steel=True, depth_target_in=1.5)
    assert not weak.energy_gate_pass
    assert not weak.velocity_gate_pass  # below the 600 fps steel rule


def test_steel_velocity_rule_constant():
    assert STEEL_MIN_VELOCITY_FPS == 600.0
