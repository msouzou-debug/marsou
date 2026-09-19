"use client";

// S10 — R14
//
/**
 * UnmatchedQueue — the pure S10 batch page: the 20px mono «Απομένουν {n} από
 * {total}» counter, a left dense selectable table of unmatched transactions
 * and a right `SuggestionPanel` for the focused row, `KeyboardHintBar` in
 * the footer and `BulkAssignPicker` for `Shift+A` (build brief §5 S10).
 *
 * Responsive (UI instructions §2 breakpoints): ≥1440 (`desktop:`) is the
 * true 55/45 split pane; 1024–1439 (`tablet:` only) stacks the table full
 * width with the suggestion panel as a bottom sheet for the focused row;
 * below 1024 is a plain read-only list — no selection, no suggestions, no
 * keyboard — with a one-line explanation to use a bigger screen.
 *
 * | Prop           | Type                | Notes                                                    |
 * |----------------|---------------------|---------------------------------------------------------------|
 * | batch          | ImportBatch?        | Header facts (period, report, imported by).                    |
 * | queue          | UnmatchedQueue?     | `remaining`/`total`/`items`.                                    |
 * | state          | UnmatchedQueueState |                                                                  |
 * | focusedIndex   | number              | Index into `queue.items`, owned by the screen.                  |
 * | selectedIds    | Set<string>         | Selected transaction ids (`Space`/checkbox).                    |
 * | onMoveFocus / onAccept / onSkip / onToggleSelect / onBulkAssign / onCommit | — | see `useUnmatchedQueueKeyboard`'s own prop names. |
 * | picker…        | —                   | Forwarded to `BulkAssignPicker`.                                |
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AppRole, ImportBatch, UnmatchedQueue as UnmatchedQueueData } from "@ecapital/shared";
import { KeyboardHintBar } from "@/components/keyboard-hint-bar";
import { PageTitle } from "@/components/app-shell";
import { SuggestionPanel } from "@/components/suggestion-panel";
import { formatDate, formatEUR } from "@/lib/format";
import { BulkAssignPicker, type BulkAssignContractOption, type BulkAssignProjectOption } from "./BulkAssignPicker";
import { useUnmatchedQueueKeyboard } from "./useUnmatchedQueueKeyboard";

export type UnmatchedQueueScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface UnmatchedQueueProps {
  batch?: ImportBatch;
  queue?: UnmatchedQueueData;
  state: UnmatchedQueueScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  focusedIndex: number;
  selectedIds: Set<string>;
  onMoveFocus: (direction: 1 | -1) => void;
  onAccept: (txnId: string, suggestionIndex: number) => void;
  onSkip: (txnIds: string[]) => void;
  onToggleSelect: (txnId: string) => void;
  onCommit: () => void;
  committing?: boolean;
  pickerOpen: boolean;
  onBulkAssignOpen: () => void;
  onBulkAssignClose: () => void;
  onBulkAssign: (projectId: string, contractId: string | null) => void;
  bulkAssigning?: boolean;
  bulkAssignApiError?: string;
  bulkAssignSearch: string;
  onBulkAssignSearchChange: (value: string) => void;
  bulkAssignProjectResults: BulkAssignProjectOption[];
  bulkAssignProjectId: string | null;
  onBulkAssignSelectProject: (id: string | null) => void;
  bulkAssignContractOptions: BulkAssignContractOption[];
  bulkAssignContractId: string | null;
  onBulkAssignSelectContract: (id: string | null) => void;
}

export function UnmatchedQueue({
  batch,
  queue,
  state,
  onRetry,
  noPermission,
  focusedIndex,
  selectedIds,
  onMoveFocus,
  onAccept,
  onSkip,
  onToggleSelect,
  onCommit,
  committing = false,
  pickerOpen,
  onBulkAssignOpen,
  onBulkAssignClose,
  onBulkAssign,
  bulkAssigning,
  bulkAssignApiError,
  bulkAssignSearch,
  onBulkAssignSearchChange,
  bulkAssignProjectResults,
  bulkAssignProjectId,
  onBulkAssignSelectProject,
  bulkAssignContractOptions,
  bulkAssignContractId,
  onBulkAssignSelectContract,
}: UnmatchedQueueProps) {
  const t = useTranslations();

  const items = queue?.items ?? [];
  const focused = items[focusedIndex];

  // RULE (rules-of-hooks): called on every render, before any early return
  // below — `disabled` (not a conditional call) is what turns the listener
  // off for `noPermission`/`loading`/`error`/`offline` or while the picker
  // is open.
  useUnmatchedQueueKeyboard(
    {
      onMoveFocus,
      onAcceptTop: () => focused && onAccept(focused.txn.id, 0),
      onPickSuggestion: (index) => focused && focused.suggestions[index] && onAccept(focused.txn.id, index),
      onSkip: () => focused && onSkip([focused.txn.id]),
      onToggleSelect: () => focused && onToggleSelect(focused.txn.id),
      onBulkAssign: onBulkAssignOpen,
    },
    pickerOpen || state !== "default",
  );

  if (state === "noPermission") return <>{noPermission}</>;

  if (state === "loading" || state === "error") {
    return (
      <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
        {state === "loading" ? (
          <p aria-busy="true" className="text-fs-16 text-k-text">
            {t("common.loading")}
          </p>
        ) : (
          <>
            <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
                {t("common.retry")}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <PageTitle
        eyebrow={batch ? `${batch.period} · ${batch.report ?? ""}` : ""}
        title={t("screens.s10.title")}
        action={
          <button
            type="button"
            onClick={onCommit}
            disabled={committing}
            className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {t("screens.s10.queue.commit")}
          </button>
        }
      />

      {queue && (
        <p className="mb-s-4 font-k-mono text-fs-20 tabular-nums text-k-ink">
          {t("screens.s10.queue.remaining", { remaining: queue.remaining, total: queue.total })}
        </p>
      )}

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {/* Phone (<1024): plain read-only list, no interaction. */}
      <div className="tablet:hidden">
        <p className="mb-s-3 text-fs-14 text-k-text">{t("screens.s10.queue.readOnlyPhone")}</p>
        {items.length === 0 ? (
          <p className="text-fs-16 text-k-text">{t("screens.s10.queue.empty")}</p>
        ) : (
          <ul className="grid gap-s-2">
            {items.map((row) => (
              <li key={row.txn.id} className="rounded-k border border-k-grey p-s-3 text-fs-14">
                <p className="font-bold text-k-ink">{row.txn.vendorName ?? row.txn.description}</p>
                <p className="text-k-text">{formatDate(row.txn.postingDate)}</p>
                <p className="num text-k-ink">{formatEUR(row.txn.amount)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Tablet and desktop: interactive split pane. */}
      <div className="hidden tablet:block">
        {items.length === 0 ? (
          <p className="rounded-k border border-k-grey bg-k-white p-s-8 text-center text-fs-16 text-k-text">
            {t("screens.s10.queue.done")}
          </p>
        ) : (
          <div className="desktop:flex desktop:gap-s-4">
            <div className="desktop:w-[55%]">
              <div className="overflow-auto rounded-k border border-k-grey bg-k-white">
                <table className="w-full border-collapse text-fs-14">
                  <caption className="sr-only">{t("screens.s10.caption")}</caption>
                  <thead className="sticky top-0 bg-k-white">
                    <tr style={{ height: 36 }}>
                      {(["postingDate", "vendor", "description", "amount", "wbs", "po", "costCentre"] as const).map((col) => (
                        <th
                          key={col}
                          scope="col"
                          className={`border-b border-k-grey px-s-2 font-bold text-k-blue-deep ${col === "amount" ? "num" : "text-left"}`}
                        >
                          {t(`screens.s10.queue.columns.${col}`)}
                        </th>
                      ))}
                      <th scope="col" className="border-b border-k-grey px-s-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, index) => {
                      const isFocused = index === focusedIndex;
                      const isSelected = selectedIds.has(row.txn.id);
                      return (
                        <tr
                          key={row.txn.id}
                          tabIndex={isFocused ? 0 : -1}
                          aria-selected={isSelected}
                          onFocus={() => index !== focusedIndex && onMoveFocus(index > focusedIndex ? 1 : -1)}
                          onClick={() => index !== focusedIndex && onMoveFocus(index > focusedIndex ? 1 : -1)}
                          style={{
                            height: 36,
                            backgroundColor: isFocused
                              ? "var(--k-blue-bg)"
                              : index % 2 === 1
                                ? "color-mix(in srgb, var(--k-grey) 40%, transparent)"
                                : undefined,
                          }}
                        >
                          <td className="border-b border-k-grey px-s-2 num whitespace-nowrap">{formatDate(row.txn.postingDate)}</td>
                          <td className="border-b border-k-grey px-s-2">{row.txn.vendorName ?? t("common.notAvailable")}</td>
                          <td className="border-b border-k-grey px-s-2">{row.txn.description}</td>
                          <td className="num border-b border-k-grey px-s-2 whitespace-nowrap">{formatEUR(row.txn.amount)}</td>
                          <td className="border-b border-k-grey px-s-2">{row.txn.sapWbs ?? "—"}</td>
                          <td className="border-b border-k-grey px-s-2">{row.txn.sapPo ?? "—"}</td>
                          <td className="border-b border-k-grey px-s-2">{row.txn.costCentre ?? "—"}</td>
                          <td className="border-b border-k-grey px-s-2">
                            <input
                              type="checkbox"
                              aria-label={t("components.table.select.row")}
                              checked={isSelected}
                              onChange={() => onToggleSelect(row.txn.id)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              className="mt-s-4 rounded-k border border-k-grey bg-k-white p-s-4 shadow-k tablet:fixed tablet:inset-x-0 tablet:bottom-0 tablet:z-20 tablet:mt-0 tablet:max-h-[45vh] tablet:overflow-auto tablet:rounded-b-none desktop:static desktop:max-h-none desktop:w-[45%] desktop:overflow-visible desktop:rounded-k"
            >
              {focused ? <SuggestionPanel suggestions={focused.suggestions} onPick={(index) => onAccept(focused.txn.id, index)} /> : (
                <p className="text-fs-14 text-k-text">{t("components.suggestion-panel.empty")}</p>
              )}
            </div>
          </div>
        )}

        <div className="mt-s-4">
          <KeyboardHintBar selectedCount={selectedIds.size} />
        </div>
      </div>

      <BulkAssignPicker
        open={pickerOpen}
        selectedCount={selectedIds.size}
        assigning={bulkAssigning}
        apiError={bulkAssignApiError}
        onAssign={onBulkAssign}
        onClose={onBulkAssignClose}
        search={bulkAssignSearch}
        onSearchChange={onBulkAssignSearchChange}
        projectResults={bulkAssignProjectResults}
        projectId={bulkAssignProjectId}
        onSelectProject={onBulkAssignSelectProject}
        contractOptions={bulkAssignContractOptions}
        contractId={bulkAssignContractId}
        onSelectContract={onBulkAssignSelectContract}
      />
    </>
  );
}
