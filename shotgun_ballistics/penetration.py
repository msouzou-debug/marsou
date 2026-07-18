"""Penetration / energy gate.

A striking pellet only counts toward a kill if it retains enough energy to push
through roughly 2/3-3/4 of the bird into a vital area. We implement the gate two
ways and report both:

1. Energy gate (primary, best-sourced) -- Gough Thomas / Burrard per-pellet
   minimum striking energies. This is the hard pass/fail used for lethality.

2. Penetration-depth estimate (informational) -- a Lowry/momentum-style model
   giving an approximate gel-penetration depth, compared against species depth
   targets (duck 1.5", pheasant 1.75", goose 2.25"). Calibrated so a #3 steel
   pellet reaches its ~1.5" duck target near the "600 fps rule" strike velocity;
   treat the absolute depth as indicative, not exact.
"""

from __future__ import annotations

from dataclasses import dataclass

from .pellets import Pellet

# The "600 fps rule": steel is generally taken to need >=600 fps at the target.
STEEL_MIN_VELOCITY_FPS = 600.0

# Boundary-layer diameter correction (Lowry): pellets carry a fluid layer, so
# effective diameter is d + 0.033".
BOUNDARY_LAYER_IN = 0.033

# Calibration constant for the momentum penetration model (see penetration_in).
# depth_in = _PEN_K * corrected_sectional_density[lb/in^2] * velocity[fps].
# Chosen so #3 steel (0.14") at ~600 fps -> ~1.5" (the duck depth target).
_PEN_K = 0.1834


@dataclass
class PenetrationResult:
    velocity_fps: float
    energy_ftlb: float
    energy_j: float
    energy_gate_pass: bool
    energy_threshold_ftlb: float
    velocity_gate_pass: bool  # steel 600 fps rule (informational for lead too)
    penetration_in: float
    depth_target_in: float | None
    depth_gate_pass: bool | None


def penetration_in(pellet: Pellet, velocity_fps: float) -> float:
    """Approximate soft-tissue/gel penetration depth (inches).

    Momentum form: depth scales with sectional density (using the boundary-layer
    corrected diameter) times strike velocity above a small threshold. This
    respects the reference's equal-penetration relation D2*V2 = D1*V1 for a
    fixed density (a bigger pellet penetrates proportionally deeper at the same
    speed). Absolute magnitude is calibrated, not measured -- use it to compare
    loads, not as a literal wound-channel length.
    """
    if velocity_fps <= 0:
        return 0.0
    d_eff_in = pellet.diameter_in + BOUNDARY_LAYER_IN
    # corrected sectional density in lb/in^2
    mass_lb = pellet.mass_grains / 7000.0
    corrected_sd = mass_lb / (d_eff_in**2)
    # depth ~ corrected_SD * strike_velocity (momentum/Lowry form).
    depth_in = _PEN_K * corrected_sd * velocity_fps
    return max(0.0, depth_in)


def equivalent_velocity(
    reference_diameter_in: float,
    reference_velocity_fps: float,
    target_diameter_in: float,
) -> float:
    """Velocity a pellet of ``target_diameter`` needs to match the penetration
    of the reference pellet at the same density (D1*V1 = D2*V2).

    Example: #3 steel (0.14") at 600 fps == B steel (0.17") at ~494 fps.
    """
    return reference_diameter_in * reference_velocity_fps / target_diameter_in


def evaluate_gate(
    pellet: Pellet,
    velocity_fps: float,
    energy_ftlb: float,
    energy_j: float,
    energy_threshold_ftlb: float,
    is_steel: bool,
    depth_target_in: float | None = None,
) -> PenetrationResult:
    depth = penetration_in(pellet, velocity_fps)
    depth_pass = None if depth_target_in is None else depth >= depth_target_in
    return PenetrationResult(
        velocity_fps=velocity_fps,
        energy_ftlb=energy_ftlb,
        energy_j=energy_j,
        energy_gate_pass=energy_ftlb >= energy_threshold_ftlb,
        energy_threshold_ftlb=energy_threshold_ftlb,
        velocity_gate_pass=(velocity_fps >= STEEL_MIN_VELOCITY_FPS)
        if is_steel
        else True,
        penetration_in=depth,
        depth_target_in=depth_target_in,
        depth_gate_pass=depth_pass,
    )
