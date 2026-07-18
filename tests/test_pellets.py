"""Validate pellet mass / count against the reference per-ounce table."""

import math

import pytest

from shotgun_ballistics.pellets import make_pellet, pellets_per_oz


# (material, size, expected per-ounce count from the reference table). Tolerance
# is generous (~12%) because published counts vary with antimony/buffering.
REFERENCE_PER_OZ = [
    ("steel", "2", 125),
    ("steel", "4", 191),
    ("steel", "6", 316),
    ("steel", "BB", 72),
    ("lead", "6", 232),
    ("lead", "4", 136),
    ("lead", "2", 90),
    ("bismuth", "6", 259),
    ("tss", "9", 362),
    # NOTE: the reference "Tungsten 15" column is internally inconsistent
    # (back-solving its counts gives ~12 g/cc, i.e. mislabeled HEVI data), so it
    # is deliberately excluded here; physically-correct 15 g/cc gives ~220/oz.
]


@pytest.mark.parametrize("material,size,expected", REFERENCE_PER_OZ)
def test_pellets_per_oz_matches_reference(material, size, expected):
    got = pellets_per_oz(material, size)
    assert math.isclose(got, expected, rel_tol=0.12), (
        f"{material} #{size}: got {got:.0f}/oz, reference {expected}/oz"
    )


def test_sectional_density_denser_material_higher():
    steel = make_pellet("steel", "4")
    lead = make_pellet("lead", "4")
    tss = make_pellet("tss", "4")
    assert steel.sectional_density < lead.sectional_density < tss.sectional_density


def test_reference_sectional_densities():
    # Lowry table: #2 steel SD .0223, #2 lead .0315 (buffered pure lead).
    assert math.isclose(make_pellet("steel", "2").sectional_density, 0.0223,
                        abs_tol=0.002)
    assert math.isclose(make_pellet("lead_pure", "2").sectional_density, 0.0315,
                        abs_tol=0.003)
