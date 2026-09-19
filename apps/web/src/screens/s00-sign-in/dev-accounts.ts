// The eight seeded users (apps/api/src/db/seed-data.ts, docs/manual/*/M0-login).
// Rendered only in `dev` mode with NEXT_PUBLIC_DEV_AUTH=1, and useless unless
// the API is in `dev` mode too — it answers 404 to `/auth/dev-token`
// otherwise (ADR-0009, ADR-0018).
//
// The list is here rather than fetched because there is no endpoint that hands
// out accounts, and there should not be one. On the ΟΚΥπΥ server the sign-in
// screen is in `ldap` mode and this block is not rendered at all: eight
// addresses nobody can sign in with would be eight invitations to try.
export interface DevAccount {
  email: string;
  /** A key under `help.roles.*` — the role labels already exist there. */
  roleKey: string;
}

export const DEV_ACCOUNTS: DevAccount[] = [
  { email: "admin@ecapital.test", roleKey: "admin" },
  { email: "estates.nicosia@ecapital.test", roleKey: "estatesHead" },
  { email: "engineer.larnaca@ecapital.test", roleKey: "projectEngineer" },
  { email: "clinical.nicosia@ecapital.test", roleKey: "clinicalApprover" },
  { email: "auditor@ecapital.test", roleKey: "auditorReadonly" },
  { email: "executive@ecapital.test", roleKey: "executiveReadonly" },
  { email: "finance@ecapital.test", roleKey: "finance" },
  { email: "technician.nicosia@ecapital.test", roleKey: "technician" },
];
