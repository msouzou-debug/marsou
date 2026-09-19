"use client";

// S14 — R22
//
/**
 * Approvals — the pure S14 screen body: `InboxList` plus `DecisionPanel`
 * (UI instructions §5 S14, item 6).
 *
 * | Prop            | Type          | Notes                                                              |
 * |-----------------|---------------|------------------------------------------------------------------------|
 * | items           | InboxItem[]?  | Ignored in `noPermission` \| `loading` \| `error`.                       |
 * | state           | ApprovalsScreenState |                                                                   |
 * | openItemId      | string?       | The deep-linked or clicked item; `null` closes the panel.               |
 * | onOpen / onClose| —             | Wired by the Screen (marks read on open, updates the `?item=` query).    |
 * | onDecide        | (item, decision, comment?) => void | Approve/return/reject a decidable item.            |
 * | onRetry         | () => void?   |                                                                        |
 * | noPermission    | ReactNode     |                                                                        |
 *
 * RULE (UI instructions §5 S14): a non-decidable item's panel primary is
 * inert (`DecisionPanel`'s own `disabled`/`disabledReason`) and «Άνοιγμα»
 * appears in `belowFooter` instead, linking to `item.href` — the closest
 * faithful use of `DecisionPanel`'s existing contract (RULE: never render
 * the full record here) rather than growing it a second, bespoke primary
 * button just for this one screen.
 */
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { InboxItem } from "@ecapital/shared";
import { DecisionPanel } from "@/components/decision-panel";
import { InboxList } from "@/components/inbox-list";
import { useInboxKeyboard } from "./useInboxKeyboard";

export type ApprovalsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface ApprovalsProps {
  items?: InboxItem[];
  state: ApprovalsScreenState;
  openItemId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onDecide: (item: InboxItem, decision: "APPROVED" | "RETURNED" | "REJECTED", comment?: string) => void;
  onRetry?: () => void;
  noPermission: ReactNode;
}

export function Approvals({ items, state, openItemId, onOpen, onClose, onDecide, onRetry, noPermission }: ApprovalsProps) {
  const t = useTranslations();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const flattened = useMemo(() => {
    const rows = items ?? [];
    const order = ["SHUTDOWN", "VARIATION", "PAYMENT_CERT", "OTHER"] as const;
    return order.flatMap((type) =>
      rows
        .filter((r) => r.type === type)
        .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()),
    );
  }, [items]);
  const rows = items ?? [];

  useInboxKeyboard(
    {
      onMoveFocus: (direction) => {
        const index = flattened.findIndex((r) => r.id === focusedId);
        const next = flattened[Math.max(0, Math.min(flattened.length - 1, (index === -1 ? 0 : index) + direction))];
        if (next) setFocusedId(next.id);
      },
      onOpenFocused: () => {
        if (focusedId) onOpen(focusedId);
      },
      onToggleHelp: () => setHelpOpen((v) => !v),
    },
    openItemId !== null,
  );

  if (state === "noPermission") return <>{noPermission}</>;

  const openItem = openItemId ? rows.find((r) => r.id === openItemId) : undefined;

  return (
    <>
      {state === "loading" && (
        <div aria-busy="true" className="grid gap-s-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-s-8 animate-pulse rounded-k bg-k-grey" />
          ))}
        </div>
      )}
      {state === "error" && (
        <div className="p-s-8 text-center">
          <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
              {t("common.retry")}
            </button>
          )}
        </div>
      )}
      {(state === "default" || state === "empty" || state === "offline") && (
        <InboxList items={rows} focusedId={focusedId} onFocus={setFocusedId} onOpen={onOpen} />
      )}

      {openItem && (
        <DecisionPanel
          what={openItem.whatEl}
          where={openItem.whereEl}
          facts={openItem.facts}
          onApprove={() => onDecide(openItem, "APPROVED")}
          onReturn={(comment) => onDecide(openItem, "RETURNED", comment)}
          onForward={() => {
            const index = flattened.findIndex((r) => r.id === openItem.id);
            const next = flattened[index + 1];
            if (next) onOpen(next.id);
            else onClose();
          }}
          onClose={onClose}
          disabled={!openItem.decidable}
          disabledReason={!openItem.decidable ? t("screens.s14.notDecidable") : undefined}
          belowFooter={
            !openItem.decidable ? (
              <Link href={openItem.href} className="text-fs-14 font-bold text-k-blue">
                {t("screens.s14.open")}
              </Link>
            ) : undefined
          }
        />
      )}

      {helpOpen && (
        <div role="dialog" aria-label={t("screens.s14.shortcuts.title")} className="fixed inset-0 z-40 flex items-center justify-center bg-k-ink/60 p-s-4">
          <div className="w-full max-w-[360px] rounded-k bg-k-white p-s-5 shadow-k">
            <h2 className="text-fs-20">{t("screens.s14.shortcuts.title")}</h2>
            <ul className="mt-s-3 grid gap-s-2 text-fs-14 text-k-ink">
              <li><kbd className="num">↑/↓</kbd> — {t("screens.s14.shortcuts.move")}</li>
              <li><kbd className="num">Enter</kbd> — {t("screens.s14.shortcuts.open")}</li>
              <li><kbd className="num">a</kbd> — {t("buttons.approve")}</li>
              <li><kbd className="num">r</kbd> — {t("buttons.returnWithComments")}</li>
              <li><kbd className="num">f</kbd> — {t("screens.s14.shortcuts.forward")}</li>
              <li><kbd className="num">x</kbd> — {t("common.close")}</li>
              <li><kbd className="num">?</kbd> — {t("screens.s14.shortcuts.title")}</li>
            </ul>
            <button type="button" onClick={() => setHelpOpen(false)} className="mt-s-4 rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white">
              {t("common.close")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
