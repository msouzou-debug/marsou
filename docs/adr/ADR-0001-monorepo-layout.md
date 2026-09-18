# ADR-0001 — pnpm workspace with apps/ and packages/

**Status:** accepted · 18/09/2026

## Context
CAPEX-01 §3 names Next.js for the frontend and NestJS for the API, with zod schemas shared between them. Both need to live in one repo so a schema change is one commit.

## Decision
pnpm workspaces. `apps/web` (Next.js), `apps/api` (NestJS, later), `packages/shared` (zod schemas and shared types). The root `package.json` only holds workspace scripts and the CI checks.

## Consequences
- `@ecapital/shared` is imported as source (`transpilePackages` in Next); no build step for it yet.
- The repo is called `marsou` on GitHub; the product and package scope stay `ecapital` as the brief requires.
