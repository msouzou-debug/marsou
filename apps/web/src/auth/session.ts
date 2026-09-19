// The web app's half of R01 — who is signed in, and with what token.
//
// The API bearer token lives in `ecapital_session`: httpOnly, sameSite=lax,
// path=/ (ADR-0013). It is set by a server action and read only on the
// server; no client component, hook or browser script can reach it, so a
// script injected into a page cannot walk off with a token that carries the
// caller's org units.
//
// IN PRODUCTION nothing here changes shape. The Entra ID redirect comes back
// to an OIDC callback, the callback puts the access token in this same cookie
// (ADR-0009), and `signIn` — the development stub — is deleted along with the
// `/auth/dev-token` route it calls. `getSession`, `endSession`, the proxy and
// every `serverApi()` caller carry on reading the same cookie.
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { Me } from "@ecapital/shared";
import { apiFetch, ApiError } from "@/data/client";
import { SESSION_COOKIE, sessionCookieIsSecure } from "./cookies";

export { SESSION_COOKIE, UNIT_COOKIE } from "./cookies";

export interface Session {
  me: Me;
  token: string;
}

/** Eight hours, the life of a development token (apps/api ADR-0009). */
const SESSION_MAX_AGE = 60 * 60 * 8;

/** What `POST /auth/dev-token` and `POST /auth/login` both answer. */
const SessionTokenResponse = z.object({ token: z.string().min(1), claims: Me });

/**
 * The signed-in user, or null. Null covers all three of "no cookie", "a
 * cookie the API rejected" and "the API did not answer" on purpose: the
 * caller's only correct response to any of them is to ask for a sign-in.
 *
 * `cache` makes this once per request, however many layouts and pages ask.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const me = await apiFetch("/me", Me, { token });
    return { me, token };
  } catch {
    // 401 (expired, or signed with another key), 5xx, or no API at all.
    return null;
  }
});

export type SignInError =
  | "devAuthOff"
  | "unknownAccount"
  | "emailNeeded"
  | "credentialsNeeded"
  | "badCredentials"
  | "ldapOff"
  | "unreachable";

export type SignInResult = { ok: true } | { ok: false; error: SignInError };

/**
 * Development only (ADR-0009): swap an email for a signed token and keep it.
 * `POST /auth/dev-token` answers 404 both when the API is not in `dev` mode —
 * the route does not exist as far as that deployment is concerned — and when
 * no seeded user has that address. The error body's key tells the two apart,
 * so the screen can say which one happened instead of guessing.
 */
export async function startSession(email: string): Promise<SignInResult> {
  const address = email.trim();
  if (!address) return { ok: false, error: "emailNeeded" };

  try {
    const { token } = await apiFetch("/auth/dev-token", SessionTokenResponse, {
      method: "POST",
      body: { email: address },
    });
    await keepToken(token);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { ok: false, error: error.key === "errors.userNotFound" ? "unknownAccount" : "devAuthOff" };
    }
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, error: "emailNeeded" };
    }
    return { ok: false, error: "unreachable" };
  }
}

/**
 * ADR-0018 — the ΟΚΥπΥ Active Directory account, which is how people sign in
 * on the server estate.
 *
 * The password is read from the form, passed to the API over the server-side
 * fetch and dropped. It is never put in a cookie, never returned to the
 * browser and never held anywhere this function can be asked for it again.
 *
 * A wrong password and an account the directory has never heard of are the
 * same 401 and the same sentence, deliberately: telling the two apart tells
 * somebody guessing which half of the guess was right.
 */
export async function startSessionWithPassword(
  username: string,
  password: string,
): Promise<SignInResult> {
  const name = username.trim();
  if (!name || !password) return { ok: false, error: "credentialsNeeded" };

  try {
    const { token } = await apiFetch("/auth/login", SessionTokenResponse, {
      method: "POST",
      body: { username: name, password },
    });
    await keepToken(token);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { ok: false, error: "badCredentials" };
    }
    if (error instanceof ApiError && error.status === 404) {
      // The API is not in ldap mode, so this route does not exist there.
      return { ok: false, error: "ldapOff" };
    }
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, error: "credentialsNeeded" };
    }
    return { ok: false, error: "unreachable" };
  }
}

/** The one place the token is written, whichever way in produced it. */
async function keepToken(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    // ADR-0018 §5: the origin decides, not NODE_ENV — behind cloudflared the
    // server speaks HTTP while the browser is on HTTPS.
    secure: sessionCookieIsSecure() || (await forwardedProtoIsHttps()),
  });
}

/**
 * The fallback for a deployment that was never told its own origin: what the
 * proxy in front says the browser used. cloudflared sets `x-forwarded-proto`
 * on every request it forwards, so this is right where `NEXT_PUBLIC_APP_ORIGIN`
 * is simply missing — but it is only the fallback, because a header can be
 * set by anybody who can reach the port and the variable cannot.
 */
async function forwardedProtoIsHttps(): Promise<boolean> {
  try {
    const proto = (await headers()).get("x-forwarded-proto");
    return (proto ?? "").split(",")[0].trim().toLowerCase() === "https";
  } catch {
    // No request to read (a unit test, a build-time call): not https.
    return false;
  }
}

/** Forgets the token. The API keeps no session, so this is the whole job. */
export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
