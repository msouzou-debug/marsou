# ADR-0007 — Four named skills are not installed; their work is done by hand

**Status:** accepted · 18/09/2026

## Context
CAPEX-01 §0 asks for `engineering:system-design`, `design:design-system`, `design:design-handoff` and `engineering:deploy-checklist`. None exist in the build environment. The owner agreed to proceed without them.

## Decision
- Architecture decisions are written as ADRs in this folder.
- Design tokens are consumed from `/brand` and the UI instructions §1; nothing invented.
- Where the design brief is silent the build raises a question in the summary rather than guessing, as `design:design-handoff` would have required.
- A deploy checklist will be written as `docs/deploy-checklist.md` before the first release and run by hand.

## Consequences
- If the skills are installed later, this ADR is superseded and the checklist moves into the skill.
