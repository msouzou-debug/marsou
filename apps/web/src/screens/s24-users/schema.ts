// S24 «Χρήστες» — R01, R02 (ADR-0020)

// What the user sheet holds while it is open, and the one thing the client
// checks before the API gets a chance to: a role that works unit by unit
// needs a unit. Everything else — the auditor, self-lockout, the last
// administrator — is the API's to refuse, and its sentence is what the sheet
// shows (`apiError`), because those three depend on rows this browser cannot
// see.
import type { AppRole, RoleCatalogueEntry } from "@ecapital/shared";

export interface UserFormValues {
  name: string;
  username: string;
  email: string;
  roles: AppRole[];
  orgUnitIds: string[];
  active: boolean;
}

/**
 * RULE (ADR-0020): `admin`, `finance`, `executive_readonly` and
 * `auditor_readonly` reach every unit, so the unit list is ignored for them
 * and the multi-select is switched off rather than left to collect a choice
 * that will not be kept. The catalogue says which is which — the screen does
 * not hardcode the four.
 */
export function coversAllUnits(catalogue: RoleCatalogueEntry[], roles: AppRole[]): boolean {
  return roles.some((role) => catalogue.find((entry) => entry.role === role)?.scope === "all");
}

/** RULE (ADR-0020): a unit role with no unit grants nothing, so it is refused. */
export function needsAUnit(catalogue: RoleCatalogueEntry[], roles: AppRole[]): boolean {
  if (coversAllUnits(catalogue, roles)) return false;
  return roles.some((role) => catalogue.find((entry) => entry.role === role)?.scope === "unit");
}
