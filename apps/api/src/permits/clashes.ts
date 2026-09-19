/**
 * Clash detection at submission (R25, CAPEX-01 §6.7), as a pure function of
 * this permit and the other permits in the same unit.
 *
 * «Clash detection: two permits closing redundant halves of the same system,
 * or two theatres in one hospital, raise a warning at submission.»
 *
 * RULE (§6.7, and §7's warn-and-flag discipline): a clash is a **warning**.
 * It goes on the record and into `email_outbox` for the head of estates, and
 * the submission goes through. Nothing in this file is asked before a write
 * is allowed. Two theatres closing together is sometimes exactly what the
 * programme needs; it is never something that should happen without the head
 * of estates finding out before the morning it starts.
 */
import type { AreaType, PermitSystem } from "@ecapital/shared";

export type ClashKind = "REDUNDANT_HALVES" | "TWO_THEATRES" | "SAME_AREA_OVERLAP";

export interface Clash {
  kind: ClashKind;
  otherPermitId: string;
  otherPermitRef: string | null;
  messageKey: string;
}

export interface ClashCandidate {
  id: string;
  ref: string | null;
  orgUnitId: string;
  systems: PermitSystem[];
  areaIds: string[];
  areaTypes: AreaType[];
  start: Date;
  end: Date;
}

/** Half-open on neither side: two permits that share a single minute overlap. */
export function overlaps(a: ClashCandidate, b: ClashCandidate): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * `subject` against everything else already booked. The candidates handed in
 * are the unit's permits that are not CLOSED and not REJECTED — a permit that
 * has been handed back is not blocking a theatre.
 *
 * At most one clash per other permit, worst kind first, so a submission that
 * collides with one other job in three ways does not send the head of estates
 * three emails about it.
 */
export function findClashes(subject: ClashCandidate, others: ClashCandidate[]): Clash[] {
  const found: Clash[] = [];
  for (const other of others) {
    if (other.id === subject.id) continue;
    if (other.orgUnitId !== subject.orgUnitId) continue;
    if (!overlaps(subject, other)) continue;

    const kind = kindOf(subject, other);
    if (kind) {
      found.push({
        kind,
        otherPermitId: other.id,
        otherPermitRef: other.ref,
        // The key both catalogues carry, rendered with `{ ref }`
        // (reconciled with the web agent, 19/09/2026).
        messageKey: `permitClash.${kind}`,
      });
    }
  }
  return found;
}

/**
 * The three kinds, worst first.
 *
 * SAME_AREA_OVERLAP   the same room is closed twice over. Nobody has read
 *                     both permits and the second crew will find the first
 *                     one's barrier already up.
 * TWO_THEATRES        §6.7 by name: two permits touching theatres in one
 *                     hospital at the same time. Two theatres down is a list
 *                     that does not run.
 * REDUNDANT_HALVES    §6.7's other case, as far as it can be answered today.
 *                     Whether two feeds are the A and B halves of one system
 *                     is an asset-register fact (M4), so until `asset` knows,
 *                     the seam is «two permits on the same system in the same
 *                     unit at the same time» — which is the set every real
 *                     redundant-halves clash is inside. It warns more often
 *                     than it eventually will, which is the right way round
 *                     for a warning about medical gas (ADR-0026).
 */
function kindOf(subject: ClashCandidate, other: ClashCandidate): ClashKind | null {
  const sharedArea = subject.areaIds.some((id) => other.areaIds.includes(id));
  if (sharedArea) return "SAME_AREA_OVERLAP";

  const bothTheatre =
    subject.areaTypes.includes("THEATRE") && other.areaTypes.includes("THEATRE");
  if (bothTheatre) return "TWO_THEATRES";

  const sharedSystem = subject.systems.some((system) => other.systems.includes(system));
  if (sharedSystem) return "REDUNDANT_HALVES";

  return null;
}
