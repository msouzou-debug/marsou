# ADR-0002 — Locale is a cookie, not a URL segment

**Status:** accepted · 18/09/2026

## Context
CAPEX-01 §6.1 and R47: language is a per-user preference, persisted, applied to exports and emails. The UI instructions §3 say the toggle switches instantly with no reload. `next-intl` supports both URL-prefixed locales (`/el/…`, `/en/…`) and a "without routing" mode.

## Decision
Without routing. The locale lives in the `ecapital_locale` cookie (and in the user profile once S27 exists). URLs are identical in both languages. Switching calls a server action to set the cookie and `router.refresh()`.

## Consequences
- Deep links from notifications work regardless of the recipient's language.
- Search engines do not matter here (internal product), so no SEO cost.
- Every server component reads the locale through `getLocale()`; do not parse it from the path.
