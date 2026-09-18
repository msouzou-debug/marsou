# ADR-0005 — Mock data served by route handlers until the NestJS API exists

**Status:** accepted · 18/09/2026

## Context
M0 is being built frontend-first. Screens need data with the right shape today, and the brief wants the SAP source swappable (R15) and the API contract shared through zod.

## Decision
Fixtures in `apps/web/src/mocks/` typed by the zod schemas in `packages/shared`. `apps/web/src/app/api/**` route handlers serve them. The frontend talks to `/api/...` through TanStack Query hooks in `src/data/`. When NestJS lands, the base URL moves and the route handlers are deleted; hooks and schemas do not change.

## Consequences
- Fixture figures are obviously fake (round numbers, sample titles) so nobody mistakes a screenshot for real data.
- No patient data can appear in a fixture, by review.

## Status (M1)
S01, S02 and S03 now read the real API: `GET /portfolio`, `GET /projects` and
`GET /projects/:id` in `apps/api`. `apps/web/src/app/api/{portfolio,projects}`
are deleted along with the fixtures they served over HTTP. `src/mocks/*`
itself stays — it now feeds only the preview gallery (ADR-0004) and unit
tests that want fixture-shaped data without a network, never a route a
screen fetches from.

The base-URL swap this ADR promised did not, in the end, cover S01–S03: the
bearer token lives in an httpOnly cookie the browser cannot read (ADR-0013),
so a TanStack Query hook cannot call `apps/api` directly the way `serverApi()`
does. `mockFetch` becomes `proxyFetch` (`src/data/client.ts`), which calls a
new same-origin route, `src/app/api/proxy/[...path]/route.ts` — it reads the
session cookie on the server and forwards the request to the real API with
the bearer attached. Every hook, screen and schema is otherwise unchanged, so
the swap the brief asked for still happened one layer down: at `proxyFetch`
instead of at `API_BASE`.
