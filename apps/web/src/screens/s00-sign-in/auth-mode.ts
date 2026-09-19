import { AuthMode } from "@ecapital/shared";

// ADR-0018 — which sign-in the screen draws.
//
// The web app does not decide how people are authenticated; the API does, and
// it decides with `AUTH_MODE`. This variable only tells the screen which form
// to put in front of somebody, so that a deployment running against an Active
// Directory does not show a list of seeded test accounts, and a developer
// does not get a password box for a directory that is not there.
//
// Unset, it falls back to what `NEXT_PUBLIC_DEV_AUTH` already said, so every
// `.env.local` written before ADR-0018 keeps behaving exactly as it did.
export function signInMode(
  raw: string | undefined = process.env.NEXT_PUBLIC_AUTH_MODE,
  devAuth: string | undefined = process.env.NEXT_PUBLIC_DEV_AUTH,
): AuthMode {
  const parsed = AuthMode.safeParse(raw?.trim());
  if (parsed.success) return parsed.data;
  return devAuth === "1" ? "dev" : "oidc";
}
