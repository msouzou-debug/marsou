// S10 — R14
//
/**
 * KeyboardHintBar — the footer strip on S10's unmatched-transaction queue
 * naming every key the queue answers to (build brief §5 S10). Purely
 * informational; the keys themselves are wired by
 * `screens/s10-sap-import/useUnmatchedQueueKeyboard.ts`, kept in that one
 * small hook so the key map lives (and is tested) in exactly one place.
 *
 * | Prop            | Type      | Notes                                                          |
 * |-----------------|-----------|-------------------------------------------------------------------|
 * | selectedCount   | number?   | Shown next to Shift+A so the bulk-assign hint reads "για 3" rather than a bare shortcut. |
 *
 * State: default only — a static legend, never loads or fails on its own.
 */
import { useTranslations } from "next-intl";

export interface KeyboardHintBarProps {
  selectedCount?: number;
}

const KEYS = ["moveFocus", "acceptTop", "pickNumbered", "skip", "select", "bulkAssign"] as const;

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="num rounded-k border border-k-grey bg-k-surface px-s-1 py-0.5 text-fs-12 text-k-ink">
      {children}
    </kbd>
  );
}

export function KeyboardHintBar({ selectedCount = 0 }: KeyboardHintBarProps) {
  const t = useTranslations("components.keyboard-hint-bar");

  return (
    <div
      role="note"
      aria-label={t("label")}
      className="flex flex-wrap items-center gap-s-4 border-t border-k-grey bg-k-white px-s-4 py-s-2 text-fs-12 text-k-text"
    >
      <span className="flex items-center gap-s-1">
        <Kbd>↓</Kbd>/<Kbd>↑</Kbd> {t("moveFocus")}
      </span>
      <span className="flex items-center gap-s-1">
        <Kbd>Enter</Kbd> {t("acceptTop")}
      </span>
      <span className="flex items-center gap-s-1">
        <Kbd>1–9</Kbd> {t("pickNumbered")}
      </span>
      <span className="flex items-center gap-s-1">
        <Kbd>s</Kbd> {t("skip")}
      </span>
      <span className="flex items-center gap-s-1">
        <Kbd>Space</Kbd> {t("select")}
      </span>
      <span className="flex items-center gap-s-1">
        <Kbd>Shift+A</Kbd> {selectedCount > 0 ? t("bulkAssignCount", { count: selectedCount }) : t("bulkAssign")}
      </span>
      {/* not part of the visible legend, but keeps the key list in one place for a snapshot/reference. */}
      <span className="sr-only">{KEYS.join(",")}</span>
    </div>
  );
}
