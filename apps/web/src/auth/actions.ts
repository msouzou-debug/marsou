"use server";

// The server actions that write the two cookies. They are the only places in
// the app allowed to call `cookies().set`, which is why they sit apart from
// `session.ts`: a Client Component may import this file, and a file carrying
// the "use server" directive exports nothing but callable actions.
//
// `signIn` is the development stub (ADR-0009). In production it is replaced
// by the OIDC callback route, which sets the same cookie from the Entra ID
// access token; `signOut` and `selectUnit` are unchanged by that swap.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { UNIT_COOKIE } from "./cookies";
import { endSession, startSession, type SignInError } from "./session";

/** Only same-origin paths, so `?next=` cannot bounce anybody off the site. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function signIn(email: string, next?: string): Promise<{ error: SignInError } | undefined> {
  const result = await startSession(email);
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
