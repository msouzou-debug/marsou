# eCapital — conventions for anyone writing code here

Read `docs/briefs/README.md` first, then the brief that covers your task. This file is the short version of what the briefs demand from code. When it and a brief disagree, the brief wins.

## Layout

```
apps/web/            Next.js 16 App Router, TypeScript, Tailwind 4 on the tokens
  src/app/           routes; one page.tsx per screen, screen id in a comment at the top
  src/app/preview/  dev-only component gallery (ADR-0004)
  src/app/api/       route handlers serving mock data until the NestJS API exists (ADR-0005)
  src/components/    the component set, one folder each (see src/components/README.md)
  src/i18n/          el.json (source), en.json, request.ts, actions.ts
  src/lib/           format.ts and other pure helpers, all unit-tested
  src/mocks/         fixtures; obviously fake figures, never patient data
  src/help/map.json  screen route → manual section (checked in CI)
  src/preview/       PreviewEntry type and registry
packages/shared/     zod schemas shared with the API later
docs/briefs/         the specs
docs/adr/            architecture decisions, numbered
docs/manual/{el,en}/ the user manual, one file per screen
scripts/             CI checks
```

## Tokens and styling

- Use Tailwind utilities that map to the tokens: `bg-k-blue`, `text-k-ink`, `p-s-4`, `text-fs-14`, `rounded-k`, `shadow-k`, `font-k-mono`. Or `var(--k-…)` in CSS. Never a bare hex or px in a component.
- Numeric columns get the `num` class (mono, tabular, right-aligned).
- Eyebrows get `eyebrow`. Greek uppercase carries no accents: write «ΔΑΠΑΝΕΣ», not «ΔΑΠΆΝΕΣ».
- Purple (`--k-purple`) only in IcraBadge and PermitBanner. No blue fill except the one primary button per view. No `--k-text-muted` below 14px. No gradients, no dark mode, no pie charts, no emoji, no unicode glyphs as icons.
- Icons: `lucide-react`, `strokeWidth={1.5}`, size 20 inline / 24 in buttons and nav, always with visible text or `aria-label`.
- Money through `formatEUR`, percentages through `formatPct`, dates through `formatDate` from `src/lib/format.ts`. Never format inline.

## Strings

- Every visible string is a key in `src/i18n/el.json` and `src/i18n/en.json`. Write Greek first, then English. `pnpm check:i18n` fails on a missing key.
- Key naming: `common.*`, `buttons.*`, `nav.*`, `states.*`, `components.<kebab-name>.*`, `screens.<s01>.*`.
- Buttons use only the fixed set in `buttons.*`. Do not add new button verbs without asking.
- Glossary in CAPEX-02 §7 is fixed: «Μονάδα» never «Νοσοκομείο» as a label; «Δαπάνες»; «Φυσική κατάσταση» for condition; «Κατάσταση» for status.
- Greek: monotonic, Greek question mark `;`, no exclamation marks, no καθαρεύουσα, verbs over noun chains, second person plural. Run the text through `hellenic-linguist` before handing back.
- English: plain, active, no filler. Run through `write-like-a-human`.

## Components

- Header comment with a props table. `// RULE:` comments next to any markup that encodes a business rule from the briefs.
- Five states where the component holds data (UI instructions §6). Declare which apply in the preview entry and say why any are skipped.
- `Name.preview.tsx` default-exports a `PreviewEntry`; register it in `src/preview/registry.ts`.
- `Name.test.tsx` covers the business rules, not the styling. Use `renderWithIntl` from `src/test/render.tsx`.
- Keyboard: everything reachable by mouse is reachable by keyboard. Focus ring is global; never `outline: none`.
- Touch targets ≥ 44px on phone; 56–64px where the briefs say so.
- Client components only where they need state or browser APIs. Say `"use client"` at the top and keep the client boundary small.

## Screens

- One `page.tsx` per screen. Add the route to `src/help/map.json` and write `docs/manual/{el,en}/<section>.md` (two sentences on purpose, numbered steps, «Τι μπορεί να πάει λάθος»). `pnpm check:help` fails otherwise.
- Every table has an export button top right, always rendered, disabled while loading.
- Cite the R-numbers the screen serves in the page comment.

## Handing back

Before you say you are done: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:i18n`, `pnpm check:help` all pass. Then write a summary of at most fifteen lines: what you built, which R-numbers, which states, which tests, anything you skipped and why, anything you had to guess. If a decision touched the data model, money, clinical safety or access control, stop and hand back instead of guessing.
