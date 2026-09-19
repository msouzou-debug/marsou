// Server-side loader for the S26 help centre's guide list (R50; UI
// instructions §5 S26). Reads the `index.json` that scripts/build-guides.mjs
// writes next to the sixteen PDFs it renders — see
// docs/adr/ADR-0027-persona-guides.md for the exact schema.
//
// Both `index.json` and the PDFs are gitignored release artefacts (rebuilt
// by `pnpm guides:build`), so this file is missing on a fresh checkout
// before the first build, and in most local dev and test runs. That is the
// ordinary "not generated yet" case, not an error — see `loadHelpSection`
// in `load-section.ts` for the same shape of loader.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Locale } from "@/i18n/config";

// See the note in load-section.ts: `process.cwd()` is `apps/web` for both
// `next build`/`next dev` and Vitest in this repo.
const GUIDES_ROOT = resolve(process.cwd(), "public/guides");

export interface GuideEntry {
  persona: string;
  lang: Locale;
  file: string;
  personaLabel: string;
  sections: number;
  sizeBytes: number;
  pages: number;
  sha256: string;
}

export interface GuidesIndex {
  schemaVersion: number;
  generatedAt: string;
  version: string;
  guides: GuideEntry[];
}

/** The parsed `index.json`, or null when it has not been generated yet (or
 *  is unreadable) — never throws. */
export function loadGuidesIndex(): GuidesIndex | null {
  try {
    const raw = readFileSync(resolve(GUIDES_ROOT, "index.json"), "utf8");
    const parsed = JSON.parse(raw) as GuidesIndex;
    return Array.isArray(parsed.guides) ? parsed : null;
  } catch {
    return null;
  }
}
