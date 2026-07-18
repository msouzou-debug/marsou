"""Command-line interface for the shotgun ballistics calculator.

Examples:
    python -m shotgun_ballistics --species mallard --material steel \\
        --shot 2 --payload-oz 1.125 --velocity 1450 --choke modified --range 40

    python -m shotgun_ballistics --list-species
    python -m shotgun_ballistics --species pheasant --shot 5 --material lead \\
        --range 35 --max-range
"""

from __future__ import annotations

import argparse
import json
import sys

from .calculator import ShotSetup, evaluate, max_effective_range
from .pellets import pellets_per_oz
from .species import list_species


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="shotgun_ballistics",
        description="Estimate clean-kill probability for a wingshooting load.",
    )
    p.add_argument("--species", help="target species (e.g. mallard, pheasant, dove)")
    p.add_argument("--material", default="steel", help="shot material (default steel)")
    p.add_argument("--shot", default="4", help="shot size (e.g. 2, BB, 7.5) [default 4]")
    p.add_argument("--payload-oz", type=float, help="payload weight in ounces")
    p.add_argument("--payload-g", type=float, help="payload weight in grams")
    p.add_argument("--velocity", type=float, default=1350.0,
                   help="muzzle velocity fps (default 1350)")
    p.add_argument("--choke", help="choke (cylinder, ic, modified, im, full, ...)")
    p.add_argument("--range", type=float, default=40.0, dest="range_yd",
                   help="shot range in yards (default 40)")
    p.add_argument("--circle-count", type=float,
                   help="override: your patterned 30-inch-circle count")
    p.add_argument("--vital-scale", type=float, default=1.0,
                   help="scale vital area (<1 for going-away/quartering shots)")
    p.add_argument("--roster-frontal", action="store_true",
                   help="use Roster's lower frontal/decoyed hit count "
                        "instead of the 3-4 torso standard")
    p.add_argument("--threshold", type=float, default=0.90,
                   help="clean-kill probability threshold (default 0.90)")
    p.add_argument("--max-range", action="store_true",
                   help="also report the max effective range for this load")
    p.add_argument("--json", action="store_true", help="emit JSON")
    p.add_argument("--list-species", action="store_true", help="list species presets")
    return p


def _print_species_table() -> None:
    print(f"{'key':<14}{'name':<28}{'hits':<6}{'min-30in':<10}{'energy ftlb':<12}range")
    print("-" * 82)
    for s in list_species():
        rng = f"{s.effective_range_yd[0]}-{s.effective_range_yd[1]} yd"
        mc = f"{s.roster_min_circle[0]}-{s.roster_min_circle[1]}"
        print(f"{s.key:<14}{s.name:<28}{s.vital_hits_required:<6}{mc:<10}"
              f"{s.energy_threshold_ftlb:<12}{rng}")


def _format_report(rep, show_max: float | None) -> str:
    L = rep.lethality
    pat = rep.pattern
    pen = rep.penetration
    lines = [
        f"=== {rep.species_name} ===",
        f"Load: {rep.setup['material']} #{rep.setup['shot_size']}  "
        f"{rep.total_pellets} pellets  "
        f"({pellets_per_oz(rep.setup['material'], rep.setup['shot_size']):.0f}/oz)  "
        f"@ {rep.setup['muzzle_velocity_fps']:.0f} fps muzzle",
        f"Range: {rep.setup['range_yd']:.0f} yd   Choke: "
        f"{rep.setup['choke'] or 'species default'}",
        "",
        f"Retained velocity : {rep.velocity_fps:6.0f} fps",
        f"Per-pellet energy : {rep.energy_ftlb:6.2f} ft.lbf "
        f"({rep.energy_j:.2f} J)   threshold {pen.energy_threshold_ftlb:.2f} ft.lbf "
        f"-> {'PASS' if pen.energy_gate_pass else 'FAIL'}",
        f"Est. penetration  : {pen.penetration_in:6.2f} in"
        + (f"   target {pen.depth_target_in:.2f} in -> "
           f"{'PASS' if pen.depth_gate_pass else 'FAIL'}"
           if pen.depth_target_in is not None else ""),
        "",
        f"Pattern %         : {pat.pattern_pct:6.1f}%   "
        f"in 30\" circle: {pat.circle_count:.0f} pellets  (sigma {pat.sigma_in:.1f} in)",
        f"Expected vital hits (lambda): {pat.expected_vital_hits:.2f}   "
        f"required: {L.required_vital_hits}",
        f"Clean-kill probability      : {L.clean_kill_probability:.0%}",
        "",
        f">>> VERDICT: {L.verdict.upper()} <<<",
    ]
    for r in L.reasons:
        lines.append(f"    - {r}")
    if show_max is not None:
        lines.append("")
        if show_max:
            lines.append(f"Max effective range (clean-kill-likely): {show_max:.0f} yd")
        else:
            lines.append("Max effective range: none (fails even at close range)")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.list_species:
        _print_species_table()
        return 0

    if not args.species:
        print("error: --species is required (or use --list-species)", file=sys.stderr)
        return 2

    setup = ShotSetup(
        species=args.species,
        material=args.material,
        shot_size=args.shot,
        payload_oz=args.payload_oz,
        payload_g=args.payload_g,
        muzzle_velocity_fps=args.velocity,
        choke=args.choke,
        range_yd=args.range_yd,
        circle_count_override=args.circle_count,
        vital_area_scale=args.vital_scale,
        use_torso_standard=not args.roster_frontal,
        clean_kill_threshold=args.threshold,
    )

    try:
        rep = evaluate(setup)
    except (KeyError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    show_max = None
    if args.max_range:
        show_max = max_effective_range(setup)

    if args.json:
        out = rep.to_dict()
        if args.max_range:
            out["max_effective_range_yd"] = show_max
        print(json.dumps(out, indent=2))
    else:
        print(_format_report(rep, show_max if args.max_range else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
