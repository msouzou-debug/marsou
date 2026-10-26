"""Shot materials and their physical properties.

Densities are the anchor for the whole model: for a spherical pellet the
ballistic coefficient equals sectional density (Lowry framework), so a denser
material of the same diameter retains velocity and energy better downrange.

Densities (g/cc) are from the reference table:
    lead 11.34 (pure) / ~11.1 with 3% antimony, bismuth 9.6-9.8,
    steel 7.85-7.86, tungsten-composite ("HEVI") 12.0, tungsten 15, TSS ~18.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Material:
    """A shot material.

    Attributes:
        key: short identifier used on the CLI / API.
        name: human-readable name.
        density_gcc: density in grams per cubic centimetre.
        min_energy_scale: multiplier applied to the per-pellet energy threshold.
            Fackler/Lowry note that at equal deposited energy a *smaller,
            denser* pellet penetrates better, so the pure kinetic-energy gate
            slightly under-credits dense materials. Kept at 1.0 by default so
            the gate stays the well-sourced Gough Thomas value; exposed here so
            advanced users can tune it.
    """

    key: str
    name: str
    density_gcc: float
    min_energy_scale: float = 1.0


# Antimonial lead (~3% antimony) is the usual sporting lead and is a touch
# lighter than the 11.34 g/cc chemical density; using it makes the pellet-count
# table line up with published figures (e.g. 1 oz steel #2 ~= 125 pellets).
MATERIALS: dict[str, Material] = {
    "lead": Material("lead", "Lead (3% antimony)", 11.1),
    "lead_pure": Material("lead_pure", "Lead (pure/soft)", 11.34),
    "bismuth": Material("bismuth", "Bismuth", 9.7),
    "steel": Material("steel", "Steel (soft iron)", 7.86),
    "hevi": Material("hevi", "Tungsten-composite (HEVI-Shot)", 12.0),
    "tungsten": Material("tungsten", "Tungsten (sintered)", 15.0),
    "tss": Material("tss", "Tungsten Super Shot (TSS)", 18.0),
}

# Alias table so callers can pass common spellings.
_ALIASES = {
    "hevi-shot": "hevi",
    "hevishot": "hevi",
    "tungsten-composite": "hevi",
    "iron": "steel",
    "pb": "lead",
    "bi": "bismuth",
    "fe": "steel",
    "w": "tungsten",
}


def get_material(key: str) -> Material:
    """Look up a material by key or common alias (case-insensitive)."""
    k = key.strip().lower()
    k = _ALIASES.get(k, k)
    if k not in MATERIALS:
        valid = ", ".join(sorted(MATERIALS))
        raise KeyError(f"unknown material {key!r}; choose one of: {valid}")
    return MATERIALS[k]
