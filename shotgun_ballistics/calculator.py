"""Top-level calculator: wire the modules into a single lethality estimate.

Pipeline (from the reference "recommended architecture"):

    inputs -> exterior ballistics -> penetration/energy gate
           -> pattern module -> Poisson kill probability -> verdict
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from .exterior import Atmosphere, state_at_range
from .lethality import LethalityVerdict, classify
from .patterns import PatternResult, pattern_analysis
from .pellets import make_pellet, pellet_count, pellet_count_grams
from .penetration import PenetrationResult, evaluate_gate
from .species import Species, get_species


@dataclass
class ShotSetup:
    """Everything needed to describe a shot."""

    species: str
    material: str = "steel"
    shot_size: str = "4"
    payload_oz: float | None = None
    payload_g: float | None = None
    muzzle_velocity_fps: float = 1350.0
    choke: str | None = None  # default: species-recommended choke
    range_yd: float = 40.0
    # Optional overrides for advanced / self-patterned use.
    circle_count_override: float | None = None
    vital_area_scale: float = 1.0  # <1 for going-away, quartering shots
    use_torso_standard: bool = True  # True: 3-4 hits; False: Roster frontal count
    clean_kill_threshold: float = 0.90
    atmosphere: Atmosphere = field(default_factory=Atmosphere)


@dataclass
class ShotReport:
    setup: dict[str, Any]
    species_name: str
    total_pellets: int
    pellet_mass_grains: float
    sectional_density: float
    velocity_fps: float
    energy_ftlb: float
    energy_j: float
    pattern: PatternResult
    penetration: PenetrationResult
    lethality: LethalityVerdict

    def to_dict(self) -> dict[str, Any]:
        d = {
            "setup": self.setup,
            "species_name": self.species_name,
            "total_pellets": self.total_pellets,
            "pellet_mass_grains": round(self.pellet_mass_grains, 3),
            "sectional_density": round(self.sectional_density, 4),
            "velocity_fps": round(self.velocity_fps, 1),
            "energy_ftlb": round(self.energy_ftlb, 2),
            "energy_j": round(self.energy_j, 2),
            "pattern": {k: round(v, 3) if isinstance(v, float) else v
                        for k, v in asdict(self.pattern).items()},
            "penetration": {k: (round(v, 3) if isinstance(v, float) else v)
                            for k, v in asdict(self.penetration).items()},
            "lethality": asdict(self.lethality),
        }
        return d


def _resolve_payload(setup: ShotSetup) -> int:
    if setup.payload_g is not None:
        return pellet_count_grams(setup.material, setup.shot_size, setup.payload_g)
    oz = setup.payload_oz if setup.payload_oz is not None else 1.125
    return pellet_count(setup.material, setup.shot_size, oz)


def evaluate(setup: ShotSetup) -> ShotReport:
    """Run the full pipeline for a shot setup and return a structured report."""
    species: Species = get_species(setup.species)
    pellet = make_pellet(setup.material, setup.shot_size)
    total = _resolve_payload(setup)
    is_steel = pellet.material.key == "steel"
    choke = setup.choke or species.choke

    # 1. Exterior ballistics
    st = state_at_range(
        pellet, setup.muzzle_velocity_fps, setup.range_yd, setup.atmosphere
    )

    # 2. Penetration / energy gate
    pen = evaluate_gate(
        pellet=pellet,
        velocity_fps=st.velocity_fps,
        energy_ftlb=st.energy_ftlb,
        energy_j=st.energy_j,
        energy_threshold_ftlb=species.energy_threshold_ftlb
        * pellet.material.min_energy_scale,
        is_steel=is_steel,
        depth_target_in=species.depth_target_in,
    )

    # 3. Pattern module.
    # The Poisson model counts pellets landing on the presented BODY cross
    # section (classic derivation: ~88 pellets in the 30" circle -> ~4 hits on a
    # ~32 in^2 body). Whether each torso hit reaches vitals is the job of the
    # separate energy/penetration gate. vital_area_scale shrinks the presented
    # area for going-away / quartering shots.
    target_area = species.body_area_in2 * setup.vital_area_scale
    pat = pattern_analysis(
        total_pellets=total,
        vital_area_in2=target_area,
        choke=choke,
        range_yd=setup.range_yd,
        steel=is_steel,
        circle_count_override=setup.circle_count_override,
    )

    # 4. Kill probability + verdict
    required = (
        species.vital_hits_required
        if setup.use_torso_standard
        else species.vital_hits_roster
    )
    verdict = classify(
        expected_vital_hits=pat.expected_vital_hits,
        required_vital_hits=required,
        energy_gate_pass=pen.energy_gate_pass,
        circle_count=pat.circle_count,
        roster_min_circle=species.roster_min_circle,
        clean_kill_threshold=setup.clean_kill_threshold,
    )

    return ShotReport(
        setup=asdict(setup),
        species_name=species.name,
        total_pellets=total,
        pellet_mass_grains=pellet.mass_grains,
        sectional_density=pellet.sectional_density,
        velocity_fps=st.velocity_fps,
        energy_ftlb=st.energy_ftlb,
        energy_j=st.energy_j,
        pattern=pat,
        penetration=pen,
        lethality=verdict,
    )


def max_effective_range(
    setup: ShotSetup,
    min_range: float = 10.0,
    max_range: float = 80.0,
    step: float = 1.0,
) -> float | None:
    """Longest range (yd) at which the shot still reads 'clean-kill-likely'.

    Returns None if even the closest range fails.
    """
    best: float | None = None
    r = min_range
    while r <= max_range + 1e-9:
        trial = ShotSetup(**{**asdict(setup), "range_yd": r,
                             "atmosphere": setup.atmosphere})
        rep = evaluate(trial)
        if rep.lethality.verdict == "clean-kill-likely":
            best = r
        r += step
    return best
