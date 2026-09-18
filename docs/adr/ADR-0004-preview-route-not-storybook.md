# ADR-0004 — Component gallery as a dev route instead of Storybook

**Status:** accepted · 18/09/2026

## Context
The UI instructions §4 ask for a Greek and English story per component "in Storybook (or the equivalent preview)" showing all five states. Storybook adds its own build, config and version coupling to Next.

## Decision
A route at `/preview` inside the app lists every registered component; `/preview/<id>` renders each of its declared states in a card, with an EL/EN switch. Components register a `PreviewEntry`. Playwright screenshots the gallery at the three breakpoints, which gives the 390px screenshot the definition of done asks for.

## Consequences
- No extra tooling; the gallery uses the real app shell, tokens and i18n.
- The route is excluded from the help-mapping check and must be hidden behind an env flag before the pilot deploy.
- If the team later wants Storybook, the `PreviewEntry` states map one-to-one to stories.
