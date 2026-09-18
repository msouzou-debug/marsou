import { z } from "zod";

// CAPEX-01 §10 — the eight roles. Row access is by org unit; `admin`,
// `executive_readonly` and `auditor_readonly` see every unit, and
// `auditor_readonly` writes nothing, enforced by the database policies
// rather than by the controllers (ADR-0010).
export const AppRole = z.enum([
  "admin",
  "estates_head",
  "project_engineer",
  "technician",
  "finance",
  "clinical_approver",
  "executive_readonly",
  "auditor_readonly",
]);
export type AppRole = z.infer<typeof AppRole>;

// What the bearer token carries, in the token's own spelling. Entra ID in
// production and the development stub issue the same claims (ADR-0009), so
// nothing downstream can tell them apart.
export const TokenClaims = z.object({
  sub: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  roles: z.array(AppRole),
  org_unit_ids: z.array(z.string()),
});
export type TokenClaims = z.infer<typeof TokenClaims>;

// What GET /me answers. Same facts, camelCase like every other response.
export const Me = z.object({
  sub: z.string(),
  name: z.string(),
  email: z.string(),
  roles: z.array(AppRole),
  orgUnitIds: z.array(z.string()),
});
export type Me = z.infer<typeof Me>;
