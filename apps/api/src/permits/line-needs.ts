import type { AccessLevel, ApprovalRole, MatrixArea } from "@ecapital/shared";

/**
 * Which row of the role matrix a person needs, besides being the person a
 * line is assigned to, to decide one approval line (ADR-0033).
 *
 * OWNER UAT 25/11/2026 («Έγκριση και Επιστροφή με σχόλια δεν λειτουργούν»):
 * every line used to ask `permitClinical` APPROVE, which only the clinical
 * approver holds. The TECHNICAL and SAFETY lines, though, are the head of
 * estates' (ADR-0026, the seeded unit approvers), so the routing handed those
 * lines to somebody the decide route then refused with «περιμένει άλλο
 * πρόσωπο», and the inbox offered both buttons on a line nobody could move.
 *
 * ADR-0039 (owner decision 26/11/2026): the estate-side lines have their
 * own row, `permitTechnical`, held by default by the technical and safety
 * approver, the estates head and the administrator. It replaces the request
 * row these lines borrowed on 25/11/2026, so rejecting a request and deciding
 * a technical line can now be given out separately. The TECHNICAL and SAFETY
 * lines still accept the clinical row as well: clinical approvers appointed
 * to them before the new role existed keep deciding them until the
 * administrator moves them. The clinical lines keep the clinical row alone.
 * The assignment itself is still checked separately: holding a row never
 * lets anybody decide a line that is waiting on someone else.
 */
export const LINE_NEEDS: Record<ApprovalRole, ReadonlyArray<readonly [MatrixArea, AccessLevel]>> = {
  INFECTION_CONTROL: [["permitClinical", "APPROVE"]],
  WARD_MANAGER: [["permitClinical", "APPROVE"]],
  NURSING: [["permitClinical", "APPROVE"]],
  HOSPITAL_DIRECTOR: [["permitClinical", "APPROVE"]],
  TECHNICAL: [
    ["permitTechnical", "APPROVE"],
    ["permitClinical", "APPROVE"],
  ],
  SAFETY: [
    ["permitTechnical", "APPROVE"],
    ["permitClinical", "APPROVE"],
  ],
};

/** True when any of the rows a line of this role accepts is one the caller holds. */
export function mayDecideLine(
  role: ApprovalRole,
  allowed: (area: MatrixArea, level: AccessLevel) => boolean,
): boolean {
  return LINE_NEEDS[role].some(([area, level]) => allowed(area, level));
}
