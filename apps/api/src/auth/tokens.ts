import { TokenClaims } from "@ecapital/shared";
import { SignJWT, createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";
import type { AppConfig } from "../config";

/**
 * ADR-0009. Two ways in, one claims shape.
 *
 * In production the token comes from Entra ID and is verified against the
 * tenant's JWKS, issuer and audience. In development and in tests `DEV_AUTH=1`
 * turns on a stub that signs the same claims with a shared secret, so the app
 * runs without a tenant and the tests do not need one. The guard, the claims
 * and everything downstream cannot tell the two apart — which is the point:
 * the path the tests exercise is the path production uses.
 *
 * The stub refuses to exist in production; config.ts fails the boot.
 *
 * ADR-0018 adds a third way in and no third token: `AUTH_MODE=ldap` verifies
 * the user against the ΟΚΥπΥ Active Directory and then issues exactly the
 * token below, signed with `SESSION_SECRET`. The issuer string still reads
 * `ecapital-dev-auth` because it is the name of this signer, not a claim
 * about the environment, and changing it would invalidate every session held
 * by everyone the moment the API restarted after an upgrade.
 */

export const DEV_ISSUER = "ecapital-dev-auth";
export const DEV_AUDIENCE = "ecapital-api";

/** The same two strings under names that do not say "dev" (ADR-0018). */
export const SESSION_ISSUER = DEV_ISSUER;
export const SESSION_AUDIENCE = DEV_AUDIENCE;

export interface Verifier {
  verify(token: string): Promise<TokenClaims>;
}

function toClaims(payload: JWTPayload): TokenClaims {
  // Entra ID spells the display name `name` and the address `preferred_username`
  // or `email` depending on the tenant's configuration; accept either.
  const candidate = {
    sub: payload.sub,
    name: payload.name,
    email: payload.email ?? payload.preferred_username ?? payload.upn,
    roles: payload.roles ?? [],
    org_unit_ids: payload.org_unit_ids ?? [],
  };
  return TokenClaims.parse(candidate);
}

/** Verifies the locally signed session token — `dev` and `ldap` modes. */
export function createSessionVerifier(secret: string): Verifier {
  const key = new TextEncoder().encode(secret);
  return {
    async verify(token: string): Promise<TokenClaims> {
      const { payload } = await jwtVerify(token, key, {
        issuer: DEV_ISSUER,
        audience: DEV_AUDIENCE,
      });
      return toClaims(payload);
    },
  };
}

export function createOidcVerifier(config: AppConfig): Verifier {
  const issuer = config.OIDC_ISSUER as string;
  const audience = config.OIDC_AUDIENCE as string;
  const jwksUri = config.OIDC_JWKS_URI ?? `${issuer.replace(/\/$/, "")}/discovery/v2.0/keys`;
  const jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(jwksUri));
  return {
    async verify(token: string): Promise<TokenClaims> {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience });
      return toClaims(payload);
    },
  };
}

/** Used by tests that want an OIDC verifier without a network round trip. */
export function createLocalJwksVerifier(
  jwks: Parameters<typeof createLocalJWKSet>[0],
  issuer: string,
  audience: string,
): Verifier {
  const keys = createLocalJWKSet(jwks);
  return {
    async verify(token: string): Promise<TokenClaims> {
      const { payload } = await jwtVerify(token, keys, { issuer, audience });
      return toClaims(payload);
    },
  };
}

/**
 * Issue a session token. In `dev` mode the caller is the dev-token route or
 * the tests; in `ldap` mode it is `/auth/login`, after Active Directory has
 * said the password is right (ADR-0018). Eight hours either way.
 */
export async function signSessionToken(
  claims: TokenClaims,
  secret: string,
  expiresIn = "8h",
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({
    name: claims.name,
    email: claims.email,
    roles: claims.roles,
    org_unit_ids: claims.org_unit_ids,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(DEV_ISSUER)
    .setAudience(DEV_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

/** @deprecated The name from ADR-0009. `signSessionToken` is the same thing. */
export const signDevToken = signSessionToken;

/** @deprecated The name from ADR-0009. `createSessionVerifier` is the same. */
export const createDevVerifier = createSessionVerifier;
