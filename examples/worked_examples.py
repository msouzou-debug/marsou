"""Worked examples that exercise the full calculator and cross-check the model
against the reference's field-validated anchors.

Run:  python examples/worked_examples.py
"""

from __future__ import annotations

from shotgun_ballistics import (
    ShotSetup,
    evaluate,
    make_pellet,
    max_effective_range,
    state_at_range,
)


def line(title: str) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def exterior_validation() -> None:
    line("1. Exterior ballistics vs Lowry retained-velocity points")
    cases = [
        ("lead", "6", 1375, 30, 780),
        ("lead", "6", 1375, 50, 591),
        ("steel", "2", 1400, 40, 691),
        ("lead", "4", 1400, 40, 766),
    ]
    print(f"{'load':<14}{'mv':>6}{'range':>7}{'model':>8}{'ref':>7}{'delta':>7}")
    for mat, size, mv, rng, ref in cases:
        v = state_at_range(make_pellet(mat, size), mv, rng).velocity_fps
        print(f"{mat+' #'+size:<14}{mv:>6}{rng:>6}y{v:>8.0f}{ref:>7}{v-ref:>+7.0f}")


def roster_consistency() -> None:
    line("2. Roster threshold consistency (clean-kill at listed max ranges)")
    scenarios = [
        # species, material, size, oz, mv, choke, range, frontal?
        ("mallard", "steel", "2", 1.125, 1450, "modified", 40, True),
        ("pheasant", "lead", "5", 1.25, 1300, "modified", 35, False),
        ("dove", "lead", "7.5", 1.0, 1200, "ic", 30, False),
        ("canada_goose", "steel", "BBB", 1.375, 1450, "im", 50, True),
    ]
    for sp, mat, size, oz, mv, choke, rng, frontal in scenarios:
        rep = evaluate(ShotSetup(
            species=sp, material=mat, shot_size=size, payload_oz=oz,
            muzzle_velocity_fps=mv, choke=choke, range_yd=rng,
            use_torso_standard=not frontal,
        ))
        L = rep.lethality
        print(f"{rep.species_name:<26} {mat} #{size} @ {rng}yd: "
              f"P(kill)={L.clean_kill_probability:5.0%}  "
              f"circle={rep.pattern.circle_count:5.0f}  "
              f"E={rep.energy_ftlb:4.2f}ftlb  -> {L.verdict}")


def size_material_tradeoff() -> None:
    line("3. Material/size trade-off: TSS lets you drop shot size")
    for mat, size in [("steel", "2"), ("tss", "7"), ("tss", "9")]:
        rep = evaluate(ShotSetup(
            species="mallard", material=mat, shot_size=size, payload_oz=1.125,
            muzzle_velocity_fps=1350, choke="modified", range_yd=40,
            use_torso_standard=True,
        ))
        print(f"{mat} #{size:<3}: {rep.total_pellets:>3} pellets  "
              f"E@40yd={rep.energy_ftlb:4.2f}ftlb  "
              f"circle={rep.pattern.circle_count:5.0f}  "
              f"P(kill)={rep.lethality.clean_kill_probability:5.0%}")


def range_sweep() -> None:
    line("4. Max effective range by choke (steel #2 duck load)")
    for choke in ["ic", "modified", "im", "full"]:
        setup = ShotSetup(
            species="mallard", material="steel", shot_size="2", payload_oz=1.125,
            muzzle_velocity_fps=1450, choke=choke, use_torso_standard=True,
        )
        mer = max_effective_range(setup)
        print(f"  {choke:<10}: {mer:.0f} yd" if mer else f"  {choke:<10}: n/a")


if __name__ == "__main__":
    exterior_validation()
    roster_consistency()
    size_material_tradeoff()
    range_sweep()
    print()
