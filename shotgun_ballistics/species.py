"""Species presets: vital areas, required hits, energy thresholds, and the
Tom Roster field-validated pattern-count / shot-size / choke recommendations.

Two sourced datasets are encoded here:

* Tom Roster's 2016 Nontoxic Shot Lethality Table -- minimum pellet counts in
  the 30-inch circle, required vital hits, recommended steel shot size, choke,
  and effective range, per species class.

* Gough Thomas / Burrard per-pellet minimum striking energies (ft.lbf):
  woodcock/snipe 0.5, partridge/grouse 0.85, pheasant/duck 1.0-1.5,
  goose 1.5.

``vital_area_in2`` is the presented vital ("critical") area used by the Poisson
hit model. It varies with presentation angle; the presets use a representative
broadside/incoming figure and the calculator lets callers scale it.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Species:
    key: str
    name: str
    body_mass_g: tuple[float, float]  # (min, max)
    body_area_in2: float  # whole-body cross section
    vital_area_in2: float  # presented critical/vital area (broadside)
    vital_hits_required: int  # torso standard for a clean kill
    vital_hits_roster: int  # Roster's decoyed/frontal count where lower
    roster_min_circle: tuple[int, int]  # min pellets in 30" circle (low, high)
    energy_threshold_ftlb: float  # per-pellet minimum striking energy
    depth_target_in: float | None  # gel-penetration target, if defined
    steel_sizes: str  # Roster-recommended steel size(s)
    lead_sizes: str
    choke: str  # default recommended choke key (patterns module)
    effective_range_yd: tuple[int, int]
    notes: str = ""
    aliases: tuple[str, ...] = field(default_factory=tuple)


# Energy thresholds follow Gough Thomas ("Shotguns and Cartridges for Game and
# Clays") and Burrard; body/vital areas from the reference species table
# (mallard ~39 in^2 body / ~12 in^2 vital; pheasant ~32 / ~12).
SPECIES: dict[str, Species] = {
    "mallard": Species(
        key="mallard",
        name="Mallard / large duck",
        body_mass_g=(1000, 1300),
        body_area_in2=39.0,
        vital_area_in2=12.0,
        vital_hits_required=4,
        vital_hits_roster=2,
        roster_min_circle=(85, 90),
        energy_threshold_ftlb=2.0,
        depth_target_in=1.5,
        steel_sizes="steel #2-#1 (HEVI #4)",
        lead_sizes="lead #4",
        choke="modified",
        effective_range_yd=(20, 50),
        notes="Roster: 1-2 vitals over decoys (frontal); 3-4 for going-away.",
        aliases=("duck", "large_duck", "pintail", "gadwall"),
    ),
    "teal": Species(
        key="teal",
        name="Teal / small duck",
        body_mass_g=(300, 450),
        body_area_in2=22.0,
        vital_area_in2=7.0,
        vital_hits_required=3,
        vital_hits_roster=2,
        roster_min_circle=(135, 145),
        energy_threshold_ftlb=1.5,
        depth_target_in=1.25,
        steel_sizes="steel #6-#4",
        lead_sizes="lead #6-#5",
        choke="modified",
        effective_range_yd=(20, 45),
        aliases=("small_duck", "bufflehead"),
    ),
    "wigeon": Species(
        key="wigeon",
        name="Wigeon / medium duck",
        body_mass_g=(600, 900),
        body_area_in2=30.0,
        vital_area_in2=9.0,
        vital_hits_required=3,
        vital_hits_roster=2,
        roster_min_circle=(115, 120),
        energy_threshold_ftlb=1.8,
        depth_target_in=1.4,
        steel_sizes="steel #6-#3",
        lead_sizes="lead #5-#4",
        choke="ic",
        effective_range_yd=(20, 45),
        aliases=("medium_duck", "scaup", "shoveler"),
    ),
    "canada_goose": Species(
        key="canada_goose",
        name="Canada / large goose",
        body_mass_g=(3500, 6500),
        body_area_in2=70.0,
        vital_area_in2=20.0,
        vital_hits_required=2,
        vital_hits_roster=2,
        roster_min_circle=(50, 55),
        energy_threshold_ftlb=1.5,
        depth_target_in=2.25,
        steel_sizes="steel BBB-T",
        lead_sizes="(nontoxic) HEVI #2",
        choke="im",
        effective_range_yd=(35, 65),
        aliases=("goose", "large_goose"),
    ),
    "pheasant": Species(
        key="pheasant",
        name="Ring-necked pheasant",
        body_mass_g=(1000, 1400),
        body_area_in2=32.0,
        vital_area_in2=12.0,
        vital_hits_required=4,
        vital_hits_roster=3,
        roster_min_circle=(90, 95),
        energy_threshold_ftlb=1.2,
        depth_target_in=1.75,
        steel_sizes="steel #3-#2 (HEVI #6-#4)",
        lead_sizes="lead #5 (close) / #4 (far)",
        choke="modified",
        effective_range_yd=(20, 50),
        aliases=("ringneck", "cock_pheasant"),
    ),
    "turkey": Species(
        key="turkey",
        name="Wild turkey (head/neck)",
        body_mass_g=(4500, 11000),
        body_area_in2=8.0,  # head/neck kill zone, not body
        vital_area_in2=4.5,
        vital_hits_required=4,
        vital_hits_roster=3,
        roster_min_circle=(210, 230),
        energy_threshold_ftlb=1.5,
        depth_target_in=1.5,
        steel_sizes="steel #4 (HEVI #6)",
        lead_sizes="lead #5-#4",
        choke="extrafull",
        effective_range_yd=(20, 40),
        notes="Aim at head/neck; kill zone is small and requires many hits.",
    ),
    "dove": Species(
        key="dove",
        name="Mourning dove",
        body_mass_g=(100, 170),
        body_area_in2=12.0,
        vital_area_in2=4.0,
        vital_hits_required=2,
        vital_hits_roster=2,
        roster_min_circle=(200, 210),
        energy_threshold_ftlb=0.5,
        depth_target_in=0.9,
        steel_sizes="steel #8-#7",
        lead_sizes="lead #8-#7.5",
        choke="ic",
        effective_range_yd=(20, 45),
        aliases=("mourning_dove",),
    ),
    "quail": Species(
        key="quail",
        name="Bobwhite quail",
        body_mass_g=(150, 200),
        body_area_in2=13.0,
        vital_area_in2=4.5,
        vital_hits_required=2,
        vital_hits_roster=2,
        roster_min_circle=(200, 210),
        energy_threshold_ftlb=0.5,
        depth_target_in=0.9,
        steel_sizes="steel #8-#7",
        lead_sizes="lead #7.5-#8",
        choke="ic",
        effective_range_yd=(20, 30),
        aliases=("bobwhite",),
    ),
    "partridge": Species(
        key="partridge",
        name="Grey / red-legged partridge",
        body_mass_g=(400, 480),
        body_area_in2=22.0,
        vital_area_in2=7.0,
        vital_hits_required=3,
        vital_hits_roster=3,
        roster_min_circle=(120, 130),
        energy_threshold_ftlb=0.85,
        depth_target_in=1.0,
        steel_sizes="steel #5-#4",
        lead_sizes="lead #6-#7",
        choke="ic",
        effective_range_yd=(20, 40),
        aliases=("grey_partridge", "chukar"),
    ),
    "woodpigeon": Species(
        key="woodpigeon",
        name="Wood pigeon",
        body_mass_g=(465, 560),
        body_area_in2=24.0,
        vital_area_in2=8.0,
        vital_hits_required=3,
        vital_hits_roster=3,
        # BASC: >=145 pellets in the 30" circle for consistent kills at <=40 yd.
        roster_min_circle=(145, 150),
        energy_threshold_ftlb=0.8,
        depth_target_in=1.0,
        steel_sizes="steel #5-#4",
        lead_sizes="lead #6-#7 (30-32 g)",
        choke="modified",
        effective_range_yd=(20, 40),
        notes="BASC study: clean kills not expected beyond 40 yd with 32 g #6.",
        aliases=("pigeon", "wood_pigeon"),
    ),
    "woodcock": Species(
        key="woodcock",
        name="Woodcock (European)",
        body_mass_g=(250, 420),
        body_area_in2=16.0,
        vital_area_in2=5.0,
        vital_hits_required=3,
        vital_hits_roster=2,
        roster_min_circle=(200, 210),
        energy_threshold_ftlb=0.7,
        depth_target_in=1.0,
        steel_sizes="steel #6-#5",
        lead_sizes="lead #7-#6 (bismuth #6)",
        choke="ic",
        effective_range_yd=(20, 35),
        notes="Eurasian woodcock ~250-420 g, dove-sized (much larger than snipe).",
        aliases=("eurasian_woodcock",),
    ),
    "snipe": Species(
        key="snipe",
        name="Snipe / American woodcock",
        body_mass_g=(90, 200),
        body_area_in2=11.0,
        vital_area_in2=3.5,
        vital_hits_required=2,
        vital_hits_roster=2,
        roster_min_circle=(200, 210),
        energy_threshold_ftlb=0.5,
        depth_target_in=0.9,
        steel_sizes="steel #7",
        lead_sizes="lead #9-#7.5 (bismuth #8)",
        choke="ic",
        effective_range_yd=(15, 30),
        aliases=("american_woodcock",),
    ),
}

_ALIAS_INDEX: dict[str, str] = {}
for _sp in SPECIES.values():
    for _a in _sp.aliases:
        _ALIAS_INDEX[_a] = _sp.key


def get_species(key: str) -> Species:
    k = key.strip().lower().replace(" ", "_").replace("-", "_")
    if k in SPECIES:
        return SPECIES[k]
    if k in _ALIAS_INDEX:
        return SPECIES[_ALIAS_INDEX[k]]
    valid = ", ".join(sorted(SPECIES))
    raise KeyError(f"unknown species {key!r}; choose one of: {valid}")


def list_species() -> list[Species]:
    return list(SPECIES.values())
