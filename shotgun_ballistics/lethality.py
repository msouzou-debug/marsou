"""Kill-probability model: the Poisson two-gate lethality calculation.

A pellet contributes to a clean kill only if it BOTH (a) lands in the vital
area and (b) retains enough energy to penetrate to vitals. Because every pellet
in a given shell is identical, the energy gate is a single pass/fail for the
whole pattern at a given range.

Given the expected number of vital-area strikes lambda (from the pattern
module), the number of strikes is modelled as Poisson. The clean-kill
probability is

    P(>= k) = 1 - sum_{i=0}^{k-1} e^{-lambda} lambda^i / i!

with k the species' required vital hits. If the energy gate fails, the shot is
downgraded to "wounding-likely" regardless of pattern density.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


def poisson_at_least(k: int, lam: float) -> float:
    """P(X >= k) for X ~ Poisson(lam)."""
    if k <= 0:
        return 1.0
    if lam <= 0:
        return 0.0
    # cumulative P(X <= k-1)
    cdf = 0.0
    term = math.exp(-lam)  # i = 0 term
    cdf += term
    for i in range(1, k):
        term *= lam / i
        cdf += term
    return max(0.0, min(1.0, 1.0 - cdf))


@dataclass
class LethalityVerdict:
    clean_kill_probability: float
    expected_vital_hits: float  # lambda
    required_vital_hits: int
    energy_gate_pass: bool
    verdict: str  # "clean-kill-likely" | "marginal" | "wounding-likely"
    reasons: list[str]


def classify(
    expected_vital_hits: float,
    required_vital_hits: int,
    energy_gate_pass: bool,
    circle_count: float,
    roster_min_circle: tuple[int, int],
    clean_kill_threshold: float = 0.90,
) -> LethalityVerdict:
    """Combine the pattern and energy gates into a verdict.

    Downgrade rules (from the reference recommendations):
      * energy below threshold  -> wounding-likely (penetration gate fails)
      * pattern below the Roster minimum count -> wounding-likely
      * otherwise use the Poisson clean-kill probability vs the threshold.
    """
    reasons: list[str] = []
    lam_effective = expected_vital_hits if energy_gate_pass else 0.0
    p_kill = poisson_at_least(required_vital_hits, lam_effective)

    roster_low = roster_min_circle[0]
    pattern_ok = circle_count >= roster_low

    if not energy_gate_pass:
        reasons.append(
            "Retained per-pellet energy is below the species minimum -- pellets "
            "may not penetrate to vitals."
        )
    if not pattern_ok:
        reasons.append(
            f"Pattern density ({circle_count:.0f} in the 30\" circle) is below "
            f"Roster's minimum of {roster_low}."
        )

    if not energy_gate_pass or not pattern_ok:
        verdict = "wounding-likely"
    elif p_kill >= clean_kill_threshold:
        verdict = "clean-kill-likely"
        reasons.append(
            f"Both gates pass and P(clean kill)={p_kill:.0%} >= "
            f"{clean_kill_threshold:.0%}."
        )
    else:
        verdict = "marginal"
        reasons.append(
            f"Gates pass but P(clean kill)={p_kill:.0%} is below the "
            f"{clean_kill_threshold:.0%} target."
        )

    return LethalityVerdict(
        clean_kill_probability=p_kill,
        expected_vital_hits=expected_vital_hits,
        required_vital_hits=required_vital_hits,
        energy_gate_pass=energy_gate_pass,
        verdict=verdict,
        reasons=reasons,
    )
