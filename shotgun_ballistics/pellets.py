"""Pellet geometry: shot size -> diameter, mass, and count per payload.

A pellet is treated as a perfect sphere. Given a diameter and a material
density everything else follows deterministically:

    volume  = (pi/6) * d^3
    mass    = density * volume
    count   = payload_mass / pellet_mass

This reproduces the reference "pellets per ounce" lookup table to within
manufacturer variance (buffering, antimony content, out-of-round pellets).
"""

from __future__ import annotations

from dataclasses import dataclass

from .materials import Material, get_material

# Unit conversions
IN_PER_CM = 1.0 / 2.54
CM_PER_IN = 2.54
GRAINS_PER_GRAM = 15.4323584
GRAMS_PER_OZ = 28.349523125
GRAINS_PER_OZ = GRAINS_PER_GRAM * GRAMS_PER_OZ  # 437.5

# US / international standard shot sizes -> nominal diameter in inches.
# Covers the sizes used in the reference tables (birdshot through F).
SHOT_DIAMETERS_IN: dict[str, float] = {
    "12": 0.050,
    "11": 0.060,
    "10": 0.070,
    "9": 0.080,
    "8.5": 0.085,
    "8": 0.090,
    "7.5": 0.095,
    "7": 0.100,
    "6": 0.110,
    "5": 0.120,
    "4": 0.130,
    "3": 0.140,
    "2": 0.150,
    "1": 0.160,
    "B": 0.170,
    "BB": 0.180,
    "BBB": 0.190,
    "T": 0.200,
    "TT": 0.210,
    "F": 0.220,
}


def diameter_in(shot_size: str) -> float:
    """Return nominal pellet diameter (inches) for a named shot size.

    Accepts either a named size ("2", "BB", "7.5") or a raw decimal-inch
    string (e.g. "0.15"), so custom diameters are allowed.
    """
    s = str(shot_size).strip().upper().lstrip("#")
    if s in SHOT_DIAMETERS_IN:
        return SHOT_DIAMETERS_IN[s]
    # allow raw diameter in inches
    try:
        val = float(s)
    except ValueError as exc:
        valid = ", ".join(SHOT_DIAMETERS_IN)
        raise KeyError(
            f"unknown shot size {shot_size!r}; use one of [{valid}] "
            f"or a decimal-inch diameter like 0.13"
        ) from exc
    if not 0.02 < val < 0.5:
        raise ValueError(f"diameter {val} in is out of range for shot")
    return val


@dataclass(frozen=True)
class Pellet:
    """A single pellet's physical properties."""

    material: Material
    diameter_in: float

    @property
    def diameter_cm(self) -> float:
        return self.diameter_in * CM_PER_IN

    @property
    def diameter_m(self) -> float:
        return self.diameter_in * CM_PER_IN / 100.0

    @property
    def volume_cc(self) -> float:
        import math

        return (math.pi / 6.0) * self.diameter_cm**3

    @property
    def mass_g(self) -> float:
        return self.material.density_gcc * self.volume_cc

    @property
    def mass_grains(self) -> float:
        return self.mass_g * GRAINS_PER_GRAM

    @property
    def mass_kg(self) -> float:
        return self.mass_g / 1000.0

    @property
    def frontal_area_m2(self) -> float:
        import math

        r = self.diameter_m / 2.0
        return math.pi * r * r

    @property
    def sectional_density(self) -> float:
        """Sectional density in lb/in^2 = ballistic coefficient (sphere)."""
        mass_lb = self.mass_grains / 7000.0
        return mass_lb / (self.diameter_in**2)


def make_pellet(material: str | Material, shot_size: str) -> Pellet:
    mat = material if isinstance(material, Material) else get_material(material)
    return Pellet(material=mat, diameter_in=diameter_in(shot_size))


def pellets_per_oz(material: str | Material, shot_size: str) -> float:
    """Approximate number of pellets in one ounce of shot."""
    p = make_pellet(material, shot_size)
    return GRAMS_PER_OZ / p.mass_g


def pellet_count(material: str | Material, shot_size: str, payload_oz: float) -> int:
    """Total pellets in a payload of the given weight (ounces)."""
    return round(pellets_per_oz(material, shot_size) * payload_oz)


def pellet_count_grams(
    material: str | Material, shot_size: str, payload_g: float
) -> int:
    """Total pellets in a payload of the given weight (grams)."""
    return round(payload_g / make_pellet(material, shot_size).mass_g)
