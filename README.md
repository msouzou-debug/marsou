# Shotgun Ballistics & Terminal-Lethality Calculator

A sourced, testable calculator that estimates the **clean-kill probability** of
a wingshooting load against a chosen game bird, following the architecture in
the reference *"Shotgun Ballistics & Terminal Lethality for Wingshooting."*

It couples the three modules a defensible calculator needs:

1. **Exterior ballistics** — retained velocity/energy of a decelerating sphere
   by range, material, and diameter (`exterior.py`).
2. **Pattern density + Poisson hit model** — a normal-distribution pattern core
   with the Lowry empirical correction, integrated over the presented body
   cross-section (`patterns.py`).
3. **Penetration / energy gate** — per-pellet retained energy vs Gough Thomas /
   Burrard minimums, plus an indicative gel-penetration depth (`penetration.py`).

These are tied together into a **two-gate lethality verdict**: a pellet counts
toward a kill only if it *both* lands in the vital zone *and* retains enough
energy to penetrate to vitals (`lethality.py`, `calculator.py`).

The model is anchored on the two best-sourced field datasets from the
reference:

- **Tom Roster's 2016 Nontoxic Shot Lethality Table** — minimum pellet counts
  in the 30-inch circle, required vital hits, shot size, choke, and effective
  range per species (encoded in `species.py`).
- **Gough Thomas's per-pellet minimum striking energies** — the penetration
  gate thresholds.

## Install / run

Pure standard-library Python (3.9+). No runtime dependencies; `pytest` only for
the tests.

```bash
# from the repo root
python -m shotgun_ballistics --list-species

python -m shotgun_ballistics \
    --species mallard --material steel --shot 2 \
    --payload-oz 1.125 --velocity 1450 --choke modified --range 40 \
    --roster-frontal --max-range
```

Example output:

```
=== Mallard / large duck ===
Load: steel #2  140 pellets  (125/oz)  @ 1450 fps muzzle
Range: 40 yd   Choke: modified

Retained velocity :    714 fps
Per-pellet energy :   3.98 ft.lbf (5.39 J)   threshold 2.00 ft.lbf -> PASS
Est. penetration  :   1.96 in   target 1.50 in -> PASS

Pattern %         :   65.0%   in 30" circle: 91 pellets  (sigma 10.4 in)
Expected vital hits (lambda): 6.62   required: 2
Clean-kill probability      : 99%

>>> VERDICT: CLEAN-KILL-LIKELY <<<
    - Both gates pass and P(clean kill)=99% >= 90%.
Max effective range (clean-kill-likely): 42 yd
```

## Library use

```python
from shotgun_ballistics import ShotSetup, evaluate, max_effective_range

setup = ShotSetup(
    species="pheasant",
    material="lead",
    shot_size="5",
    payload_oz=1.25,
    muzzle_velocity_fps=1300,
    choke="modified",
    range_yd=35,
)
report = evaluate(setup)
print(report.lethality.verdict)                 # e.g. "clean-kill-likely"
print(report.lethality.clean_kill_probability)  # e.g. 0.99
print(report.energy_ftlb, report.velocity_fps)  # retained per-pellet values
print(max_effective_range(setup))               # longest clean-kill range (yd)

# Everything is JSON-serialisable for a web/API front end:
report.to_dict()
```

### Pattern your own gun (recommended)

Nominal choke percentages vary a full choke gun-to-gun. If you have patterned
your actual gun/load, feed the measured 30-inch-circle count directly and the
model back-calculates the true pattern spread (sigma):

```python
setup = ShotSetup(species="mallard", material="steel", shot_size="2",
                  payload_oz=1.125, range_yd=40, circle_count_override=95)
```

### Shot presentation

`vital_area_scale` shrinks the presented body area for going-away / quartering
birds (a going-away pheasant shows a far smaller target than an incoming duck).
`use_torso_standard=True` requires the 3–4 torso-hit clean-kill standard;
`False` uses Roster's lower frontal/decoyed hit count.

## How the numbers are derived

| Module | Model | Validation |
|--------|-------|------------|
| Exterior | Numerical RK2 integration of `dv/dx = -k·Cd(Mach)·v` with a Mach-dependent sphere drag curve | Matches Lowry points: #6 lead 1375→~780 fps @30 yd, ~591 @50 yd; #2 steel 1400→~691 @40 yd |
| Pellets | Sphere geometry from diameter + material density | Reproduces reference pellets/oz table (steel #2 ≈125/oz, lead #4 ≈136/oz) |
| Pattern | Circular-normal, `frac(R)=1−exp(−R²/2σ²)`, Lowry 0.84 core correction | Roster ~88-in-circle → ~4+ body hits |
| Penetration | Gough Thomas energy gate + momentum depth model (boundary-layer corrected SD) | #3 steel @600 fps ≈1.5" duck target; D₁V₁=D₂V₂ equivalence |
| Lethality | Poisson `P(≥k)` two-gate | Roster minimum counts ↔ ~95% clean kill at listed ranges |

## Validation against field benchmarks

The calculator's clean-kill predictions coincide with Roster's threshold counts
at the listed maximum ranges, and its wounding-likely verdicts are consistent
with the 20–34% field crippling rates (USFWS / Roster / Norton & Thomas).

## Caveats (from the reference)

- Roster's counts are calibrated to ≤~1,450 fps loads; do not extrapolate to
  1,600–1,750 fps "fast steel."
- The energy-vs-lethality relationship is a **penetration proxy**, not literal
  knockdown; at equal energy a smaller, denser pellet penetrates better.
- Pattern spread is neither perfectly linear nor perfectly normal — patterning
  your own gun and using `circle_count_override` is far more accurate than the
  nominal choke table.
- Vital/body-area figures are estimates and vary strongly with presentation
  angle; use `vital_area_scale`.
- The penetration **depth** value is calibrated and indicative — treat it as a
  load-comparison figure, not a measured wound-channel length. The **energy**
  gate is the hard pass/fail.

## Sources

Tom Roster (2016 Nontoxic Shot Lethality Table, CONSEP); Ed Lowry
(*Shotshell Ballistics*); Gough Thomas (*Shotguns and Cartridges for Game and
Clays*); Gerald Burrard (*The Modern Shotgun*); BASC / GWCT; Norton & Thomas
(1994); USFWS crippling-rate estimates.

## Tests

```bash
python -m pytest -q
```
