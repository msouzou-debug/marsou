# ADR-0005 — Mock data served by route handlers until the NestJS API exists

**Status:** accepted · 18/09/2026

## Context
M0 is being built frontend-first. Screens need data with the right shape today, and the brief wants the SAP source swappable (R15) and the API contract shared through zod.

## Decision
Fixtures in `apps/web/src/mocks/` typed by the zod schemas in `packages/shared`. `apps/web/src/app/api/**` route handlers serve them. The frontend talks to `/api/...` through TanStack Query hooks in `src/data/`. When NestJS lands, the base URL moves and the route handlers are deleted; hooks and schemas do not change.

## Consequences
- Fixture figures are obviously fake (round numbers, sample titles) so nobody mistakes a screenshot for real data.
- No patient data can appear in a fixture, by review.
