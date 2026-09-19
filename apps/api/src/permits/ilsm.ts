/**
 * ILSM — Προσωρινά μέτρα ασφάλειας ζωής (R21, CAPEX-01 §6.3).
 *
 * «If the work affects fire detection, suppression, compartmentation, exits
 * or evacuation routes, ILSM is mandatory: interim measures list, fire watch,
 * extra drills, notification to the fire officer.»
 *
 * That sentence is the whole rule. One trigger is enough, and the four
 * measures it names are always in — they are what «mandatory» means here, not
 * a menu. The other three measures on `IlsmMeasure` are ones a fire officer
 * adds to a particular job; nothing in the brief makes them automatic, so
 * nothing here adds them.
 */
import type { IlsmCheck, IlsmMeasure, IlsmTrigger, PermitSystem } from "@ecapital/shared";

/** §6.3, in order. The list a permit prints when ILSM is required. */
export const MANDATORY_MEASURES: IlsmMeasure[] = [
  "INTERIM_MEASURES_LIST",
  "FIRE_WATCH",
  "EXTRA_DRILLS",
  "NOTIFY_FIRE_OFFICER",
];

/**
 * RULE (§6.3): required when any trigger is ticked. The triggers are the
 * engineer's answer on S11, not something derived from the systems list — a
 * lift shaft closure can break a compartment without the FIRE system being
 * touched at all, and an electrical isolation can take the detection loop
 * down with it.
 *
 * The FIRE system is the one exception, and it is the strict reading: taking
 * fire out and ticking nothing is not an ILSM-free job. It counts as fire
 * detection and suppression whatever the form says.
 */
export function ilsmFor(triggers: IlsmTrigger[], systems: PermitSystem[]): IlsmCheck {
  const all = new Set<IlsmTrigger>(triggers);
  if (systems.includes("FIRE")) {
    all.add("FIRE_DETECTION");
    all.add("FIRE_SUPPRESSION");
  }
  const ordered = ORDER.filter((trigger) => all.has(trigger));
  const required = ordered.length > 0;
  return {
    triggers: ordered,
    required,
    measures: required ? [...MANDATORY_MEASURES] : [],
    fireOfficerNotifiedAt: null,
  };
}

const ORDER: IlsmTrigger[] = [
  "FIRE_DETECTION",
  "FIRE_SUPPRESSION",
  "COMPARTMENTATION",
  "EXITS",
  "EVACUATION_ROUTES",
];
