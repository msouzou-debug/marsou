"use client";

// S07, S07b, S07c, S07d, S08 — R08, R09, R10, R12, R31
//
/**
 * ContractTabs — the tab strip a contract's own screens share, the same
 * pattern `ProjectTabs` (S03) sets: Επισκόπηση (S07), Τροποποιήσεις (S08),
 * Αιτήματα διευκρίνισης (S07b), Οδηγίες εργοταξίου (S07c) and Ελλείψεις
 * (S07d), in that fixed order.
 *
 * | Prop              | Type           | Notes                                                       |
 * |-------------------|----------------|-------------------------------------------------------------|
 * | contractId        | string         | Builds each tab's `href`.                                    |
 * | active            | ContractTabId  | Which tab is the current page.                                |
 * | rfisOpenCount     | number?        | `ContractDetail.rfisOpen` — shown in the Αιτήματα tab when cheap (already on the page). |
 * | defectsOpenCount  | number?        | Computed by the caller from `ContractDetail.defects` (OPEN + IN_PROGRESS). |
 *
 * RULE: a count is only ever shown when the caller already has it for free —
 * this component never fetches on its own account (UI instructions §0.4,
 * the same restraint `ProjectTabs`'s own header comment states for its
 * disabled Κόστος tab).
 */

import Link from "next/link";
import { useTranslations } from "next-intl";

export type ContractTabId = "overview" | "variations" | "rfis" | "instructions" | "defects";

export interface ContractTabsProps {
  contractId: string;
  active: ContractTabId;
  rfisOpenCount?: number;
  defectsOpenCount?: number;
}

function hrefFor(id: ContractTabId, contractId: string): string {
  const base = `/contracts/${encodeURIComponent(contractId)}`;
  switch (id) {
    case "overview":
      return base;
    case "variations":
      return `${base}/variations`;
    case "rfis":
      return `${base}/rfis`;
    case "instructions":
      return `${base}/instructions`;
    case "defects":
      return `${base}/defects`;
  }
}

const TAB_ORDER: ContractTabId[] = ["overview", "variations", "rfis", "instructions", "defects"];

export function ContractTabs({ contractId, active, rfisOpenCount, defectsOpenCount }: ContractTabsProps) {
  const t = useTranslations();

  return (
    <div role="tablist" aria-label={t("screens.s07.tabs.overview")} className="flex flex-wrap gap-s-2 border-b border-k-grey">
      {TAB_ORDER.map((id) => {
        const isActive = id === active;
        const count = id === "rfis" ? rfisOpenCount : id === "defects" ? defectsOpenCount : undefined;
        return (
          <Link
            key={id}
            href={hrefFor(id, contractId)}
            role="tab"
            aria-selected={isActive}
            className={
              isActive
                ? "border-b-2 border-k-blue-deep px-s-3 py-s-2 text-fs-14 font-bold text-k-blue-deep"
                : "px-s-3 py-s-2 text-fs-14 text-k-text"
            }
          >
            {t(`screens.s07.tabs.${id}`)}
            {count !== undefined && <span className="num ml-s-1 text-fs-12 text-k-text-muted">({count})</span>}
          </Link>
        );
      })}
    </div>
  );
}
