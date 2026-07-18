"""Shotgun ballistics & terminal-lethality calculator for wingshooting.

Three coupled modules, per the sourced reference:

  1. exterior  -- retained velocity/energy of a decelerating sphere by range
  2. patterns  -- pattern density + normal-distribution Poisson hit model
  3. penetration -- per-pellet energy/penetration gate

tied together by ``calculator.evaluate`` into a two-gate clean-kill probability
validated against Tom Roster's pattern-count thresholds and Gough Thomas's
per-pellet energy minimums.
"""

from .calculator import (
    ShotReport,
    ShotSetup,
    evaluate,
    max_effective_range,
)
from .exterior import Atmosphere, state_at_range
from .materials import MATERIALS, get_material
from .patterns import pattern_analysis, pattern_percentage
from .pellets import make_pellet, pellet_count, pellets_per_oz
from .penetration import equivalent_velocity, penetration_in
from .species import SPECIES, get_species, list_species

__version__ = "0.1.0"

__all__ = [
    "ShotSetup",
    "ShotReport",
    "evaluate",
    "max_effective_range",
    "Atmosphere",
    "state_at_range",
    "MATERIALS",
    "get_material",
    "SPECIES",
    "get_species",
    "list_species",
    "make_pellet",
    "pellet_count",
    "pellets_per_oz",
    "pattern_analysis",
    "pattern_percentage",
    "penetration_in",
    "equivalent_velocity",
]
