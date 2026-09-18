# ADR-0009 — Entra ID in production, a signed local stub in development

**Status:** accepted · 18/09/2026

## Context
R01 and CAPEX-01 §3: authentication is Entra ID over OIDC, and Entra groups map to roles. Nobody can develop or run the test suite against the ΟΚΥπΥ tenant, and a build that needs a tenant is a build that stops working the first week somebody joins the team.

## Decision
One guard, one claims shape, two ways of getting a verified token.

- **Production.** The bearer token is an Entra ID access token, verified against the tenant's JWKS with the issuer and audience from the environment (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, optional `OIDC_JWKS_URI`).
- **Development and tests.** `DEV_AUTH=1` swaps the verifier for one that checks an HS256 signature made with a local secret, and `POST /auth/dev-token` issues such a token for a seeded user. `config.ts` refuses to boot if `DEV_AUTH` is on while `NODE_ENV=production`.

Both paths produce the same claims: `sub`, `name`, `email`, `roles[]`, `org_unit_ids[]`. Nothing downstream — guard, interceptor, policy — knows which one it got.

Groups map to roles through the `ecapital.role_mapping` table (`entra_group_id` → role, with an optional `org_unit_id`; null means every unit), not through code. Adding a hospital's clinical approver group is a row, applied by an administrator, not a release.

## Consequences
- The tests exercise the real guard rather than a mock of it, so the production path is the tested path.
- The dev stub is one file and one route, both dead when `DEV_AUTH` is off; the route answers 404, the same as a route that does not exist.
- Turning a group into a role is an administrative act with an audit row behind it, not a deployment.
- Not yet decided, and out of scope for M0: what happens when Entra sends a group with no mapping. Today the user gets no roles and therefore sees nothing, which is the safe direction.
