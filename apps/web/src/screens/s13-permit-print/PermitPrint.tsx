"use client";

// S13 — R23
//
/**
 * PermitPrint — the A4 print sheet, `/permits/[id]/print` (UI instructions
 * §5 item 5). On-screen preview at 100% plus a hidden-in-print «Εκτύπωση»
 * button; the sheet itself is the thing that gets taped to a corridor
 * barrier, so: big type, high contrast, no light grey (§7 of both briefs).
 *
 * | Prop         | Type            | Notes                                                       |
 * |--------------|-----------------|------------------------------------------------------------------|
 * | permit       | ShutdownPermit? | Ignored in `noPermission` \| `loading` \| `error`.                 |
 * | state        | PermitPrintState|                                                                   |
 * | recordUrl    | string          | The full URL the QR points back to.                              |
 * | onRetry      | () => void?     |                                                                   |
 * | noPermission | ReactNode       |                                                                   |
 *
 * RULE (UI instructions §1, §5 S13): purple appears only inside IcraBadge —
 * nothing else on this page uses `--k-purple`.
 *
 * RULE (both briefs, §7 / print sheet): every text colour here is `--k-ink`
 * or `--k-text` at 14px or larger — never `--k-text-muted`, never a light
 * grey rule.
 */
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import type { ShutdownPermit } from "@ecapital/shared";
import { IcraBadge } from "@/components/icra-badge";
import type { Locale } from "@/i18n/config";
import { formatDateTime, formatDateTimeRange } from "@/lib/format";
import { qrMatrix } from "@/lib/qr";

export type PermitPrintState = "default" | "loading" | "error" | "noPermission";

export interface PermitPrintProps {
  permit?: ShutdownPermit;
  state: PermitPrintState;
  recordUrl: string;
  onRetry?: () => void;
  noPermission: ReactNode;
}

function QrCode({ text, size }: { text: string; size: number }) {
  const matrix = qrMatrix(text);
  const cell = size / matrix.size;
  const cells: ReactNode[] = [];
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.isDark(row, col)) {
        cells.push(<rect key={`${row}-${col}`} x={col * cell} y={row * cell} width={cell} height={cell} />);
      }
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={text} className="fill-k-ink">
      <rect x={0} y={0} width={size} height={size} className="fill-k-white" />
      {cells}
    </svg>
  );
}

export function PermitPrint({ permit, state, recordUrl, onRetry, noPermission }: PermitPrintProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  if (state === "noPermission") return <>{noPermission}</>;
  if (state === "loading" || !permit) {
    return <div aria-busy="true" className="mx-auto h-[297mm] w-[210mm] animate-pulse bg-k-grey" />;
  }
  if (state === "error") {
    return (
      <div className="p-s-8 text-center">
        <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
            {t("common.retry")}
          </button>
        )}
      </div>
    );
  }

  const controls = permit.icra?.controls ?? [];

  return (
    <div className="flex flex-col items-center gap-s-5 bg-k-surface p-s-6 print:bg-k-white print:p-0">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-k bg-k-blue px-s-5 py-s-3 text-fs-14 font-bold text-k-white shadow-k print:hidden"
      >
        {t("buttons.print")}
      </button>

      {/* RULE: A4 portrait, exact print colours, one page (UI instructions §5 S13). */}
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .permit-sheet { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="permit-sheet flex h-[297mm] w-[210mm] flex-col bg-k-white p-[12mm] text-k-ink shadow-k print:shadow-none">
        <header className="flex items-start justify-between">
          <Image src="/brand/okypy_icon.png" alt="OKYpY" width={56} height={56} />
          <h1 className="text-fs-32 font-bold text-k-ink">{t("screens.s13.headerTitle")}</h1>
        </header>

        <div className="mt-[8mm] flex items-center gap-s-6">
          {permit.icra && <IcraBadge icraClass={permit.icra.icraClass} size="print" />}
          <div>
            <p className="text-fs-20 text-k-ink">{permit.titleEl}</p>
            <p className="text-fs-20 text-k-ink">{formatDateTimeRange(permit.plannedStart, permit.plannedEnd)}</p>
            <p className="text-fs-20 text-k-ink">{permit.systems.map((s) => t(`permitSystem.${s}`)).join(" · ")}</p>
          </div>
        </div>

        <section className="mt-[8mm] flex-1">
          <h2 className="text-fs-20 font-bold text-k-ink">{t("screens.s13.controlsTitle")}</h2>
          <ol className="mt-s-3 grid list-decimal gap-s-2 pl-s-6 text-fs-16 text-k-ink">
            {controls.map((control) => (
              <li key={control.id}>{locale === "en" ? control.textEn : control.textEl}</li>
            ))}
          </ol>
        </section>

        <section className="mt-[8mm]">
          <h2 className="text-fs-20 font-bold text-k-ink">{t("screens.s13.approversTitle")}</h2>
          <ul className="mt-s-2 grid gap-s-1 text-fs-16 text-k-ink">
            {permit.approvals
              .filter((a) => a.decision === "APPROVED")
              .map((a) => (
                <li key={a.id}>
                  {t(`approvalRole.${a.role}`)} — {a.approverName} — {a.decidedAt ? formatDateTime(a.decidedAt) : ""}
                </li>
              ))}
          </ul>
        </section>

        <footer className="mt-[8mm] flex items-end justify-between">
          <p className="font-k-mono text-fs-16 text-k-ink">{permit.ref ?? ""}</p>
          <QrCode text={recordUrl} size={160} />
        </footer>
      </div>
    </div>
  );
}
