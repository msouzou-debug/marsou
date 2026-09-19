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

// ADR-0018. How this deployment authenticates people.
//
//   dev   the seeded-account stub, development and tests only (ADR-0009)
//   ldap  a simple bind against the ΟΚΥπΥ Active Directory — what the ΟΚΥπΥ
//         server estate actually runs, alongside eMAP and eFinance
//   oidc  Entra ID, as ADR-0009 built it; kept, not used today
//
// All three end in the same signed session token and the same claims.
export const AuthMode = z.enum(["dev", "ldap", "oidc"]);
export type AuthMode = z.infer<typeof AuthMode>;

// POST /auth/login — what the sign-in screen sends in `ldap` mode. The
// username is either a bare sAMAccountName or a full UPN; the API works out
// which. RULE (ADR-0018): the password is never logged, never stored and
// never echoed back.
export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

// What the bearer token carries, in the token's own spelling. Entra ID, the
// AD bind and the development stub issue the same claims (ADR-0009,
// ADR-0018), so nothing downstream can tell them apart.
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
  // The app_user row id. Records that name a person (variation.raisedById,
  // sponsorId, …) carry this, not the token subject, so the client compares
  // against it — the API's own check is still what enforces anything.
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  roles: z.array(AppRole),
  orgUnitIds: z.array(z.string()),
});
export type Me = z.infer<typeof Me>;

// What POST /auth/login and POST /auth/dev-token both answer: the token the
// web app puts in its httpOnly cookie, and the claims that go with it.
export const SessionResponse = z.object({ token: z.string().min(1), claims: Me });
export type SessionResponse = z.infer<typeof SessionResponse>;
