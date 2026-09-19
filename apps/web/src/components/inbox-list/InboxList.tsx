"use client";

import { Construction, FileEdit, Inbox as InboxIcon, Receipt } from "lucide-react";
import { useTranslations } from "next-intl";
import type { InboxItem, InboxItemType } from "@ecapital/shared";

// RULE (UI instructions §5 S14): grouped by type, in this fixed order —
// Διακοπές · Τροποποιήσεις · Πιστοποιήσεις · Άλλα — newest first inside each
// group.
const GROUP_ORDER: InboxItemType[] = ["SHUTDOWN", "VARIATION", "PAYMENT_CERT", "OTHER"];

const GROUP_ICON: Record<InboxItemType, typeof Construction> = {
  SHUTDOWN: Construction,
  VARIATION: FileEdit,
  PAYMENT_CERT: Receipt,
  OTHER: InboxIcon,
};

const SLA_STYLE: Record<NonNullable<InboxItem["slaState"]>, string> = {
  GREEN: "bg-k-green-bg text-k-ink",
  AMBER: "bg-k-amber-bg text-k-ink",
  RED: "bg-k-red-bg text-k-ink",
  BREACHED: "bg-k-red text-k-white",
};

/**
 * InboxList — S14's grouped approvals list (UI instructions §5 S14).
 *
 * | Prop        | Type       | Notes                                                              |
 * |-------------|------------|------------------------------------------------------------------------|
 * | items       | InboxItem[]| Any order in — this component groups and orders them itself.            |
 * | focusedId   | string?    | The keyboard-focused row (`useInboxKeyboard`, `screens/s14-approvals`). |
 * | onFocus     | (id) => void | Fired on mouse hover/focus, so keyboard and mouse never disagree.     |
 * | onOpen      | (id) => void | Click or `Enter` on the focused row.                                  |
 *
 * RULE: an unread row (`item.unread`) renders bold, per group and overall.
 *
 * State: default, empty («Δεν υπάρχουν εκκρεμείς εγκρίσεις.»). Loading, error,
 * noPermission and offline belong to the screen around this list.
 */
export interface InboxListProps {
  items: InboxItem[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
}

export function InboxList({ items, focusedId, onFocus, onOpen }: InboxListProps) {
  const t = useTranslations();

  if (items.length === 0) {
    return <p className="p-s-8 text-center text-fs-16 text-k-text">{t("components.inbox-list.empty")}</p>;
  }

  const groups = GROUP_ORDER.map((type) => ({
    type,
    items: items
      .filter((item) => item.type === type)
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="grid gap-s-6">
      {groups.map((group) => {
        const Icon = GROUP_ICON[group.type];
        return (
          <section key={group.type} aria-label={t(`components.inbox-list.groups.${group.type}`)}>
            <h3 className="eyebrow mb-s-2 text-fs-12 text-k-text-muted">
              {t(`components.inbox-list.groups.${group.type}`)}
            </h3>
            <ul className="flex flex-col gap-s-2">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onFocus={() => onFocus(item.id)}
                    onMouseEnter={() => onFocus(item.id)}
                    onClick={() => onOpen(item.id)}
                    aria-current={focusedId === item.id ? "true" : undefined}
                    className={`flex w-full min-h-[44px] flex-wrap items-center gap-s-3 rounded-k border p-s-3 text-left text-fs-14 ${
                      focusedId === item.id ? "border-k-blue" : "border-k-grey"
                    }`}
                  >
                    <Icon size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-k-blue-deep" />
                    <span className={`flex-1 min-w-[160px] ${item.unread ? "font-bold text-k-ink" : "text-k-ink"}`}>
                      {item.whatEl}
                    </span>
                    <span className="text-k-text">{item.whereEl}</span>
                    <span className="text-k-text">{item.requestedByName}</span>
                    {item.slaState && (
                      <span className={`rounded-k-chip px-s-2 py-s-1 text-fs-12 ${SLA_STYLE[item.slaState]}`}>
                        {t(`components.inbox-list.sla.${item.slaState}`)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
