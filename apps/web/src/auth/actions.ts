"use server";

// The server actions that write the two cookies. They are the only places in
// the app allowed to call `cookies().set`, which is why they sit apart from
// `session.ts`: a Client Component may import this file, and a file carrying
// the "use server" directive exports nothing but callable actions.
//
// `signIn` covers both ways in that end in a password or a seeded address
// (ADR-0009, ADR-0018): with a password it calls `POST /auth/login` and the
// API binds against the ΟΚΥπΥ Active Directory; without one it calls the
// development stub. Either way the same cookie is written, and `signOut` and
// `selectUnit` are unchanged. The OIDC callback route, when it is built, will
// set the same cookie from the Entra ID access token and change nothing else.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { UNIT_COOKIE } from "./cookies";
import {
  endSession,
  startSession,
  startSessionWithPassword,
  type SignInError,
} from "./session";

/** Only same-origin paths, so `?next=` cannot bounce anybody off the site. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/**
 * `username` is a work address in `dev` mode and a ΟΚΥπΥ account name (or
 * UPN) in `ldap` mode. `password` is present only in `ldap` mode, comes
 * straight off the form, and is forwarded once and then dropped — see
 * `startSessionWithPassword`.
 */
export async function signIn(
  username: string,
  next?: string,
  password?: string,
): Promise<{ error: SignInError } | undefined> {
  const result = password === undefined
    ? await startSession(username)
    : await startSessionWithPassword(username, password);
  if (!result.ok) return { error: result.error };
  redirect(safeNext(next));
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/sign-in");
}

/** Remembers which unit the switcher is on. Not an access decision: the API
 *  answers 404 for a unit the caller may not see, whatever this cookie says
 *  (ADR-0010). */
export async function selectUnit(unitId: string): Promise<void> {
  (await cookies()).set(UNIT_COOKIE, unitId, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}
