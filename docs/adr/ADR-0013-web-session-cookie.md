# ADR-0013 — The web app keeps the API token in an httpOnly cookie

**Status:** accepted · 18/09/2026

## Context
M0's definition of done is "a user can log in and see their own unit's area tree and nothing else" (CAPEX-01 §14). The API is a bearer-token API: every request carries an Entra ID access token in production and a locally signed one in development (ADR-0009), and the row policies read the org units out of that token (ADR-0010). So the web app has to hold a token somewhere between one request and the next.

Where it holds it decides what a cross-site script can steal. The token is not a session identifier that a server can revoke on sight; it is the caller's units, their roles and eight hours of validity in one string.

## Decision
The token lives in `ecapital_session`: `httpOnly`, `sameSite=lax`, `path=/`, `secure` outside development, eight hours. A server action writes it; nothing reads it but the server.

- `getSession()` (`src/auth/session.ts`) reads the cookie, calls `GET /me` with it and returns `{ me, token }` or null. Wrapped in React's `cache`, so a request that renders a layout and a page asks once.
- Server Components fetch through `serverApi()` (`src/data/server.ts`), which attaches the bearer for them. There is no client-side equivalent and no endpoint that hands the token to the browser.
- `src/proxy.ts` — Next 16's name for middleware — is the gate. Everything except `/sign-in`, `/preview` and `/api/*` needs the cookie to be present; whether it is still good is `/me`'s answer, not the proxy's.
- The shell renders from the session: the switcher lists what `GET /org-units` returned for that caller, and the old `FALLBACK_ORG_UNITS` list is gone.

### Why not localStorage
A token in `localStorage` is readable by every script on the origin, including one that arrives through a dependency. Cookies marked `httpOnly` are not. The usual argument for `localStorage` — that cookies invite CSRF — does not apply here the way it usually does: this cookie is never *automatically* attached to an API call. The browser talks to the Next server, the Next server attaches the bearer itself, and `sameSite=lax` keeps the cookie off cross-site requests that are not top-level navigations. Server actions carry Next's own origin check on top.

The cost is real and accepted: data fetching for anything unit-scoped moves to the server, so a client hook cannot simply call the API. That is why `src/data/client.ts` has two fetchers — `apiFetch` for the API with a bearer, `mockFetch` for the portfolio route handlers that ADR-0005 still owns until M1.

### Why not a server-side session store
Because there is nothing to store yet. The token is self-contained and short-lived, the API keeps no session, and a store would be one more thing to deploy on the ΟΚΥπΥ server for no gain in M0. If sign-out has to become revocation — a shared ward terminal is the obvious case — a store is the right answer then, and it goes behind `getSession()` without touching a single screen.

## Consequences
- No screen and no component can read the token, so no screen can leak it. Reviewing for that is a grep of `src/auth` and `src/data/server.ts`, not of the whole app.
- Sign-out is local: the cookie goes, the token stays valid at the API until it expires. Eight hours in development; in production the Entra token's own lifetime.
- A cookie the API rejects is cleared exactly once. The `(app)` layout redirects to `/sign-in?…&stale=1`, the proxy deletes the cookie on that request, and `/sign-in` is outside the gate — one hop, never a loop (UI instructions §6).
- **What changes for OIDC (ADR-0009):** the cookie, the proxy, `getSession()` and every `serverApi()` caller stay as they are. `signIn` — the development stub that calls `POST /auth/dev-token` — is replaced by the Entra ID callback route, which writes the access token into the same cookie. The sign-in screen loses its email field and its six seeded accounts and becomes a redirect to the tenant. Refresh tokens are the open question at that point: they must not go in this cookie, and where they do go is an M1 decision, not this one.
