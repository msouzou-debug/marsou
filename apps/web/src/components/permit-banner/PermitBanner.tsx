"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import { IcraBadge, type IcraClass } from "@/components/icra-badge";

/**
 * PermitBanner — eCapital UI instructions §4. One of only two components
 * allowed to use `--k-purple` (ADR-0006); the other is IcraBadge.
 *
 * | Prop       | Type                                                              | Notes                          |
 * |------------|-------------------------------------------------------------------|----------------------------------|
 * | state      | "inForce" \| "pendingApproval" \| "expired" \| "revoked"           | Permit lifecycle state.          |
 * | validFrom  | string (ISO)                                                       | Formatted via `formatDate`.       |
 * | validTo    | string (ISO)                                                       | Formatted via `formatDate`.       |
 * | icraClass  | "I" \| "II" \| "III" \| "IV" \| "V"                                | Rendered as an on-purple IcraBadge (list size). |
 * | onPrint    | () => void?                                                        | Defaults to `window.print()`.    |
 * | onDismiss  | () => void?                                                        | See RULE below.                  |
 *
 * State: default only, one preview per permit state (UI instructions §4).
 *
 * RULE: no dismiss control while the permit is «Σε ισχύ» (in force) — a live
 * permit is never allowed to be dismissed off screen, so the control only
 * renders for the other three states, and only when `onDismiss` is provided.
 */

export type PermitState = "inForce" | "pendingApproval" | "expired" | "revoked";

export interface PermitBannerProps {
  state: PermitState;
  validFrom: string;
  validTo: string;
  icraClass: IcraClass;
  onPrint?: () => void;
  onDismiss?: () => void;
}

export function PermitBanner({ state, validFrom, validTo, icraClass, onPrint, onDismiss }: PermitBannerProps) {
  const t = useTranslations();
  const canDismiss = state !== "inForce" && Boolean(onDismiss);

  return (
    <div className="w-full flex flex-wrap items-center justify-between gap-s-4 rounded-k bg-k-purple px-s-6 py-s-4 text-k-white">
      <div className="flex flex-wrap items-center gap-s-4">
        <span className="text-fs-16 font-bold">{t(`components.permitBanner.state.${state}`)}</span>
        <span className="text-fs-14">
          {formatDate(validFrom)} – {formatDate(validTo)}
        </span>
        <IcraBadge icraClass={icraClass} size="list" onPurple />
      </div>
      <div className="flex items-center gap-s-4">
        <button
          type="button"
          onClick={onPrint ?? (() => window.print())}
          className="text-fs-14 text-k-white underline underline-offset-2"
        >
          {t("buttons.print")}
        </button>
        {canDismiss && (
          <button type="button" onClick={onDismiss} aria-label={t("common.close")} className="text-k-white">
            <X aria-hidden="true" size={20} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
