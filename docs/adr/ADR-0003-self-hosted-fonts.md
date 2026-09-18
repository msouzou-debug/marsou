# ADR-0003 — Fonts self-hosted through next/font; brand-tokens.css vendored without its Google import

**Status:** accepted · 18/09/2026

## Context
The brand `brand-tokens.css` pulls Lato from Google Fonts at runtime. The product runs on the hospital LAN, which may have no route to the internet. The UI instructions §1 want Lato 400/700 and IBM Plex Mono for figures.

## Decision
`next/font/google` downloads Lato and IBM Plex Mono at build time and serves them from the app. `apps/web/src/styles/brand-tokens.css` is a copy of `/brand/brand-tokens.css` with only the `@import url(https://fonts.googleapis.com/…)` line removed; `--okypy-font` is pointed at the self-hosted family. `/brand/brand-tokens.css` stays untouched as the reference.

## Consequences
- The build machine needs internet once; the runtime does not.
- Re-vendor the copy whenever `/brand/brand-tokens.css` changes.
