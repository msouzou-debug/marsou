"""Pattern module: choke percentages and the normal-distribution pattern core.

Two jobs:

1. Estimate how many of the payload's pellets fall inside the 30-inch circle
   at a given range, from a nominal choke percentage table (interpolated per
   range). Real guns vary a full choke gun-to-gun, so callers can override with
   their own patterned count.

2. Convert a 30-inch-circle count into the standard deviation (sigma) of a 2-D
   circular-normal pattern, then integrate that Gaussian over a small vital
   area to get the expected number of pellet strikes there.

Pellet dispersion around the aim point is well modelled as a bivariate normal
(Journee 1902; Oberfell & Thompson 1957; Lowry). The fraction of pellets
within radius R of the centre is  1 - exp(-R^2 / (2 sigma^2)).

Because real patterns are denser at the core than a pure normal predicts, an
empirical Lowry-style correction (~0.84 on the central estimate) is applied by
default.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

STANDARD_CIRCLE_DIAMETER_IN = 30.0
STANDARD_CIRCLE_RADIUS_IN = 15.0

# Lowry empirical correction: real patterns are denser at the core than a pure
# normal predicts. Applied to the central-area hit estimate.
LOWRY_CORE_CORRECTION = 0.84

# Nominal percentage of the payload landing in the 30-inch circle, by choke and
# range (yards), for 12-ga lead. Anchored on the reference's 40-yd figures
# (Cyl 40, IC 55, Mod 60, IM 65, Full 70) and the "~10% per 5 yd" falloff.
# NOTE: these are gun-independent averages; patterning your own gun is far more
# accurate and can be fed in directly via ``sigma_from_circle_count``.
_CHOKE_TABLE: dict[str, dict[int, float]] = {
    # spreader / paradox / rifled chokes open faster than cylinder
    "spreader1": {20: 48, 25: 40, 30: 33, 35: 27, 40: 22, 45: 18, 50: 15, 55: 12, 60: 10},
    "spreader2": {20: 60, 25: 50, 30: 42, 35: 35, 40: 30, 45: 25, 50: 20, 55: 16, 60: 13},
    "cylinder": {20: 75, 25: 65, 30: 55, 35: 47, 40: 40, 45: 33, 50: 27, 55: 22, 60: 18},
    "skeet":    {20: 85, 25: 75, 30: 64, 35: 57, 40: 50, 45: 42, 50: 35, 55: 29, 60: 24},
    "ic":       {20: 90, 25: 82, 30: 74, 35: 64, 40: 55, 45: 46, 50: 38, 55: 31, 60: 25},
    "modified": {20: 95, 25: 88, 30: 80, 35: 70, 40: 60, 45: 51, 50: 43, 55: 36, 60: 29},
    "im":       {20: 98, 25: 91, 30: 83, 35: 74, 40: 65, 45: 56, 50: 47, 55: 39, 60: 32},
    "full":     {20: 100, 25: 95, 30: 87, 35: 78, 40: 70, 45: 60, 50: 50, 55: 42, 60: 35},
    "extrafull": {20: 100, 25: 98, 30: 92, 35: 84, 40: 75, 45: 65, 50: 55, 55: 47, 60: 39},
}

# Order loosest-to-tightest, for the "steel patterns ~1 choke tighter" shift.
_CHOKE_ORDER = [
    "spreader1", "spreader2", "cylinder", "skeet", "ic",
    "modified", "im", "full", "extrafull",
]

_CHOKE_ALIASES = {
    "spreader": "spreader1",
    "paradox": "spreader1",
    "rifled": "spreader1",
    "cyl": "cylinder",
    "improved cylinder": "ic",
    "improved-cylinder": "ic",
    "mod": "modified",
    "improved modified": "im",
    "improved-modified": "im",
    "lm": "skeet",  # light modified ~ between skeet and IC; approximate
    "light modified": "skeet",
    "extra full": "extrafull",
    "extra-full": "extrafull",
    "xfull": "extrafull",
}


def _normalize_choke(choke: str) -> str:
    c = choke.strip().lower()
    c = _CHOKE_ALIASES.get(c, c)
    if c not in _CHOKE_TABLE:
        valid = ", ".join(_CHOKE_ORDER)
        raise KeyError(f"unknown choke {choke!r}; choose one of: {valid}")
    return c


def _tighten_one_step(choke: str) -> str:
    idx = _CHOKE_ORDER.index(choke)
    return _CHOKE_ORDER[min(idx + 1, len(_CHOKE_ORDER) - 1)]


def pattern_percentage(choke: str, range_yd: float, steel: bool = False) -> float:
    """Nominal % of pellets in the 30-inch circle for a choke at a range.

    If ``steel`` is True the effective choke is shifted one step tighter, per
    the reference ("steel patterns ~1 choke tighter than lead").
    """
    c = _normalize_choke(choke)
    if steel:
        c = _tighten_one_step(c)
    table = _CHOKE_TABLE[c]
    ranges = sorted(table)
    if range_yd <= ranges[0]:
        return table[ranges[0]]
    if range_yd >= ranges[-1]:
        # linear extrapolation on the last segment, floored at a few percent
        r0, r1 = ranges[-2], ranges[-1]
        p0, p1 = table[r0], table[r1]
        slope = (p1 - p0) / (r1 - r0)
        return max(3.0, p1 + slope * (range_yd - r1))
    for i in range(1, len(ranges)):
        if range_yd <= ranges[i]:
            r0, r1 = ranges[i - 1], ranges[i]
            p0, p1 = table[r0], table[r1]
            t = (range_yd - r0) / (r1 - r0)
            return p0 + t * (p1 - p0)
    return table[ranges[-1]]


def pellets_in_circle(
    total_pellets: int,
    choke: str,
    range_yd: float,
    steel: bool = False,
) -> float:
    """Expected pellet count in the 30-inch circle from nominal choke %."""
    pct = pattern_percentage(choke, range_yd, steel=steel)
    return total_pellets * pct / 100.0


def sigma_from_circle_count(
    total_pellets: int,
    circle_count: float,
    circle_radius_in: float = STANDARD_CIRCLE_RADIUS_IN,
) -> float:
    """Back out the circular-normal sigma (inches) from a patterned count.

    From  fraction = 1 - exp(-R^2 / (2 sigma^2))  ->
          sigma = R / sqrt(-2 ln(1 - fraction)).
    """
    if total_pellets <= 0:
        raise ValueError("total_pellets must be positive")
    frac = circle_count / total_pellets
    frac = min(max(frac, 1e-6), 0.999999)
    return circle_radius_in / math.sqrt(-2.0 * math.log(1.0 - frac))


@dataclass
class PatternResult:
    pattern_pct: float
    circle_count: float
    sigma_in: float
    density_center: float  # pellets per in^2 at the aim point
    expected_vital_hits: float  # lambda over the vital area, centred


def expected_hits_on_area(
    total_pellets: int,
    sigma_in: float,
    vital_area_in2: float,
    core_correction: float = LOWRY_CORE_CORRECTION,
) -> float:
    """Expected pellet strikes on a vital area centred on the aim point.

    The vital area is treated as an equivalent-area disk of radius
    r_v = sqrt(A/pi); the expected count is the payload times the normal-CDF
    mass inside that disk, with the Lowry core correction applied.
    """
    r_v = math.sqrt(vital_area_in2 / math.pi)
    frac = 1.0 - math.exp(-(r_v**2) / (2.0 * sigma_in**2))
    return total_pellets * frac * core_correction


def pattern_analysis(
    total_pellets: int,
    vital_area_in2: float,
    choke: str,
    range_yd: float,
    steel: bool = False,
    circle_count_override: float | None = None,
    core_correction: float = LOWRY_CORE_CORRECTION,
) -> PatternResult:
    """Full pattern analysis at a range for a vital area.

    Pass ``circle_count_override`` with your own patterned 30-inch-circle count
    to bypass the nominal choke table (strongly recommended for real work).
    """
    if circle_count_override is not None:
        circle_count = float(circle_count_override)
        pct = 100.0 * circle_count / total_pellets
    else:
        pct = pattern_percentage(choke, range_yd, steel=steel)
        circle_count = total_pellets * pct / 100.0

    sigma = sigma_from_circle_count(total_pellets, circle_count)
    density_center = total_pellets / (2.0 * math.pi * sigma**2) * core_correction
    lam = expected_hits_on_area(
        total_pellets, sigma, vital_area_in2, core_correction=core_correction
    )
    return PatternResult(
        pattern_pct=pct,
        circle_count=circle_count,
        sigma_in=sigma,
        density_center=density_center,
        expected_vital_hits=lam,
    )
