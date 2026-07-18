"""Exterior ballistics of a decelerating sphere.

We integrate the drag equation numerically over downrange distance using a
Mach-number-dependent sphere drag coefficient. This captures the transonic
drag rise (shot leaves the muzzle around Mach 1.2 and slows through the sound
barrier) that a constant-Cd model misses.

    dv/dx = -k * Cd(Mach) * v ,   k = rho_air * A / (2 * m)

Validated against the reference retained-velocity points:
    #6 lead @ 1375 fps -> ~780 fps @ 30 yd, ~591 fps @ 50 yd
    #2 steel @ 1400 fps -> ~691 fps @ 40 yd
    #4 lead  @ 1400 fps -> ~766 fps @ 40 yd
"""

from __future__ import annotations

from dataclasses import dataclass

from .pellets import Pellet

FPS_PER_MS = 3.280839895
YARD_M = 0.9144

# Standard atmosphere at ~15-20 C, sea level.
DEFAULT_AIR_DENSITY = 1.225  # kg/m^3
DEFAULT_SOUND_SPEED = 343.0  # m/s

# Drag coefficient of a smooth sphere vs Mach number. The subsonic values sit
# near 0.4-0.47; the transonic rise peaks around Mach 1.4-1.6 near Cd ~1.0.
# (Representative sphere-drag curve at the high Reynolds numbers of shot.)
_MACH = [0.0, 0.3, 0.5, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.6, 2.0, 3.0]
_CD = [0.48, 0.46, 0.46, 0.47, 0.52, 0.63, 0.78, 0.88, 0.94, 1.00, 1.01, 0.98, 0.90]


def sphere_cd(mach: float) -> float:
    """Interpolate the sphere drag coefficient for a given Mach number."""
    if mach <= _MACH[0]:
        return _CD[0]
    if mach >= _MACH[-1]:
        return _CD[-1]
    for i in range(1, len(_MACH)):
        if mach <= _MACH[i]:
            m0, m1 = _MACH[i - 1], _MACH[i]
            c0, c1 = _CD[i - 1], _CD[i]
            t = (mach - m0) / (m1 - m0)
            return c0 + t * (c1 - c0)
    return _CD[-1]


@dataclass
class Atmosphere:
    air_density: float = DEFAULT_AIR_DENSITY
    sound_speed: float = DEFAULT_SOUND_SPEED


@dataclass
class ShotState:
    """Retained ballistics at a range."""

    range_yd: float
    velocity_fps: float
    energy_ftlb: float
    energy_j: float
    mach: float


def _energy_ftlb(mass_grains: float, v_fps: float) -> float:
    # E(ft.lbf) = m[grains] * v^2[fps] / 450240
    return mass_grains * v_fps * v_fps / 450240.0


def _energy_j(mass_kg: float, v_ms: float) -> float:
    return 0.5 * mass_kg * v_ms * v_ms


def retained_velocity_fps(
    pellet: Pellet,
    muzzle_velocity_fps: float,
    range_yd: float,
    atmosphere: Atmosphere | None = None,
    step_m: float = 0.05,
) -> float:
    """Return retained velocity (fps) at a range, integrating sphere drag."""
    atm = atmosphere or Atmosphere()
    v = muzzle_velocity_fps / FPS_PER_MS  # m/s
    x_target = range_yd * YARD_M
    k = atm.air_density * pellet.frontal_area_m2 / (2.0 * pellet.mass_kg)

    x = 0.0
    # Fixed-step RK2 (midpoint) integration of dv/dx = -k*Cd(v)*v.
    while x < x_target - 1e-9:
        h = min(step_m, x_target - x)

        def deriv(vel: float) -> float:
            mach = vel / atm.sound_speed
            return -k * sphere_cd(mach) * vel

        k1 = deriv(v)
        k2 = deriv(v + 0.5 * h * k1)
        v = v + h * k2
        if v <= 1.0:  # pellet effectively stopped
            v = 1.0
            break
        x += h
    return v * FPS_PER_MS


def state_at_range(
    pellet: Pellet,
    muzzle_velocity_fps: float,
    range_yd: float,
    atmosphere: Atmosphere | None = None,
) -> ShotState:
    """Full retained state (velocity + energy) at a range for one pellet."""
    atm = atmosphere or Atmosphere()
    v_fps = retained_velocity_fps(pellet, muzzle_velocity_fps, range_yd, atm)
    v_ms = v_fps / FPS_PER_MS
    return ShotState(
        range_yd=range_yd,
        velocity_fps=v_fps,
        energy_ftlb=_energy_ftlb(pellet.mass_grains, v_fps),
        energy_j=_energy_j(pellet.mass_kg, v_ms),
        mach=v_ms / atm.sound_speed,
    )


def velocity_table(
    pellet: Pellet,
    muzzle_velocity_fps: float,
    ranges_yd: list[float],
    atmosphere: Atmosphere | None = None,
) -> list[ShotState]:
    return [
        state_at_range(pellet, muzzle_velocity_fps, r, atmosphere) for r in ranges_yd
    ]
