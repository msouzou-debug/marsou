"""Pattern-module tests: choke %, sigma back-out, and normal-distribution hits."""

import math

import pytest

from shotgun_ballistics.patterns import (
    expected_hits_on_area,
    pattern_percentage,
    pellets_in_circle,
    sigma_from_circle_count,
)


@pytest.mark.parametrize(
    "choke,expected",
    [("cylinder", 40), ("ic", 55), ("modified", 60), ("im", 65), ("full", 70)],
)
def test_choke_percentage_at_40yd(choke, expected):
    assert math.isclose(pattern_percentage(choke, 40), expected, abs_tol=1.0)


def test_percentage_falls_with_range():
    assert pattern_percentage("full", 30) > pattern_percentage("full", 40) \
        > pattern_percentage("full", 50)


def test_steel_shifts_one_choke_tighter():
    lead_mod = pattern_percentage("modified", 40, steel=False)
    steel_mod = pattern_percentage("modified", 40, steel=True)
    assert steel_mod > lead_mod  # steel patterns tighter -> higher %


def test_sigma_roundtrip():
    total = 300
    circle = 180  # 60% in the 30" circle
    sigma = sigma_from_circle_count(total, circle)
    # fraction within R=15 should reproduce the count
    frac = 1 - math.exp(-(15**2) / (2 * sigma**2))
    assert math.isclose(frac * total, circle, rel_tol=1e-6)


def test_more_pellets_more_vital_hits():
    sigma = sigma_from_circle_count(300, 180)
    low = expected_hits_on_area(150, sigma, 12.0)
    high = expected_hits_on_area(300, sigma, 12.0)
    assert high > low


def test_roster_mallard_threshold_gives_about_four_body_hits():
    """Roster: ~88 pellets in the 30" circle for a large duck should yield
    ~4+ hits on the ~39 in^2 body (classic derivation), enough for a clean kill
    once the energy gate is satisfied."""
    total = 140  # ~1.125 oz steel #2
    circle = 88.0  # Roster large-duck minimum
    sigma = sigma_from_circle_count(total, circle)
    lam = expected_hits_on_area(total, sigma, 39.0)
    assert 4.0 <= lam <= 9.0  # comfortably above the 3-4 hit requirement


def test_pellets_in_circle_scales_with_payload():
    a = pellets_in_circle(100, "modified", 40)
    b = pellets_in_circle(200, "modified", 40)
    assert math.isclose(b, 2 * a)
