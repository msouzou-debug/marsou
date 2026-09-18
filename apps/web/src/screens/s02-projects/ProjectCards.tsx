"use client";

// S02 — R03
//
// The phone layout for the project list (UI instructions §2, §5): compact
// cards — code, title, unit, RAG — instead of `Table`'s row-per-line grid,
// which does not fit 390px. `Table` has no card variant of its own (only
// dense/comfortable rows, UI §4), so this is a second, phone-only rendering
// of the same rows sitting next to it (`hidden`/`tablet:hidden` switches
// between the two — see `Projects.tsx`), the same way S01's `UnitTable`
// works around gaps in `Table` rather than changing it.

import Link from "next/link";
import type { ProjectSummary } from "@ecapital/shared";
import { RagChip } from "@/components/rag-chip";

export interface ProjectCardsProps {
  items: ProjectSummary[];
  unitNameById: Map<string, string>;
}

export function ProjectCards({ items, unitNameById }: ProjectCardsProps) {
  return (
    <ul className="grid gap-s-3">
      {items.map((project) => (
        <li key={project.id}>
          <Link
            href={`/projects/${encodeURIComponent(project.id)}`}
            className="block rounded-k border border-k-grey bg-k-white p-s-4 shadow-k"
          >
            <p className="num text-fs-12 text-k-text-muted">{project.code}</p>
            <p className="mt-s-1 text-fs-16 text-k-ink">{project.titleEl}</p>
            <div className="mt-s-2 flex items-center justify-between gap-s-2">
              <span className="text-fs-14 text-k-text">{unitNameById.get(project.orgUnitId) ?? project.orgUnitId}</span>
              <RagChip value={project.rag.toLowerCase() as "green" | "amber" | "red"} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
