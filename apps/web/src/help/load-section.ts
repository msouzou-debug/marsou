// Server-side loader for the embedded manual (R48; UI instructions §5 S25,
// build brief §6.1 "Embedded manuals"). Given a route and a locale, looks up
// the section in `help/map.json` and reads the matching Markdown file out of
// `docs/manual/<locale>/<section>.md`, which is the single source shared by
// the contextual help drawer (S25), the help centre (S26) and the printable
// PDF guides (R50).
//
// `docs/manual` lives at the monorepo root, not under `apps/web`. `next dev`
// and `next build` both run with `apps/web` as `process.cwd()` (confirmed
// against this repo's Next.js config — there is no custom `cwd` override),
// so the manual directory is two levels up: apps/web -> apps -> <root>, then
// down into docs/manual. Vitest is invoked from the same `apps/web`
// directory (see the repo's `pnpm test`), so the same relative path resolves
// correctly in unit tests too.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Locale } from "@/i18n/config";
import helpMap from "./map.json";

const MANUAL_ROOT = resolve(process.cwd(), "../../docs/manual");

export interface HelpMapEntry {
  route: string;
  section: string;
  persona: string[];
}

export interface HelpSectionData {
  /** The section's raw Markdown, or null when the route is unmapped or the
   *  file for this locale has not been written yet. Never throws. */
  markdown: string | null;
  /** Persona ids from the map entry (empty when the route is unmapped),
   *  for the «Οδηγός PDF για [ρόλος]» footer link (R50). */
  personas: string[];
}

const entries = Object.values(helpMap as Record<string, HelpMapEntry>);

function findEntry(route: string): HelpMapEntry | undefined {
  return entries.find((entry) => entry.route === route);
}

export function loadHelpSection(route: string, locale: Locale): HelpSectionData {
  const entry = findEntry(route);
  if (!entry) return { markdown: null, personas: [] };

  const file = resolve(MANUAL_ROOT, locale, `${entry.section}.md`);
  try {
    return { markdown: readFileSync(file, "utf8"), personas: entry.persona };
  } catch {
    // Missing file (e.g. a section not written yet): the empty state, not a
    // crash — `pnpm check:help` is what enforces the file exists at all.
    return { markdown: null, personas: entry.persona };
  }
}
