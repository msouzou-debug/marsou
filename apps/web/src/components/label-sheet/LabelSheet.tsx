"use client";

/**
 * LabelSheet — the A4 sheet of asset QR labels (M4 build brief item 4, S17b
 * `/assets/labels`), and the single 160px preview on S17 (`variant="single"`).
 * Same print posture as `s13-permit-print/PermitPrint`: big, high-contrast,
 * `print-color-adjust: exact`, nothing below 12px `--k-text`/`--k-ink`.
 *
 * | Prop      | Type              | Default | Notes                                                          |
 * |-----------|-------------------|---------|---------------------------------------------------------------------|
 * | labels    | QrLabel[]?        | —       | Ignored in `loading` \| `empty` \| `error`.                          |
 * | state     | LabelSheetState   | `"default"` | `default` \| `loading` \| `empty` \| `error` (UI §6). No `noPermission`/`offline`: the caller (`S17b`'s screen) gates access before this ever mounts, and there is nothing to write here to be offline about. |
 * | onRetry   | () => void        | —       | Retry button in `error`; hidden without it.                          |
 * | perPage   | number            | `24`    | RULE (brief item 4): 3 × 8 per A4 page — the grid is 3 columns and this many labels fill one sheet; more labels start a new `.labels-page` with a forced page break. |
 * | variant   | "sheet" \| "single" | `"sheet"` | `"single"` renders just the first label's QR at 160px with no page chrome — S17's own preview, sharing the same QR renderer instead of a second copy of it. |
 *
 * RULE (CONVENTIONS.md): purple appears only in IcraBadge/PermitBanner —
 * nothing here uses `--k-purple`. RULE (UI §1/§7): every label text is
 * `--k-ink` or `--k-text`, never `--k-text-muted` (it fails contrast below
 * 14px, and a label printed at 12px must still read from arm's length).
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import type { QrLabel } from "@ecapital/shared";
import { qrMatrix } from "@/lib/qr";

export type LabelSheetState = "default" | "loading" | "empty" | "error";

export interface LabelSheetProps {
  labels?: QrLabel[];
  state?: LabelSheetState;
  onRetry?: () => void;
  perPage?: number;
  variant?: "sheet" | "single";
}

const COLUMNS = 3;

export function QrCode({ text, size }: { text: string; size: number }) {
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

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

function Label({ label }: { label: QrLabel }) {
  return (
    <div className="flex items-center gap-s-2 border border-k-grey p-s-2" data-testid="asset-label">
      <Image src="/brand/okypy_icon.png" alt="" width={20} height={20} />
      <QrCode text={label.url} size={64} />
      <div className="min-w-0">
        <p className="font-k-mono text-fs-16 font-bold text-k-ink">{label.tag}</p>
        <p className="truncate text-fs-12 text-k-ink">{label.nameEl}</p>
        {label.areaNameEl && <p className="truncate text-fs-12 text-k-text">{label.areaNameEl}</p>}
      </div>
    </div>
  );
}

export function LabelSheet({ labels, state = "default", onRetry, perPage = 24, variant = "sheet" }: LabelSheetProps) {
  const t = useTranslations("components.label-sheet");
  const tRoot = useTranslations();

  if (state === "loading") {
    return (
      <div aria-busy="true" aria-label={t("loading")} className="grid grid-cols-3 gap-s-2">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} aria-hidden="true" className="block h-[28mm] rounded-k-chip bg-k-grey" />
        ))}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="p-s-8 text-center">
        <p className="text-fs-16 text-k-ink">{tRoot("states.error.loadFailed")}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
            {tRoot("common.retry")}
          </button>
        )}
      </div>
    );
  }

  if (state === "empty" || !labels || labels.length === 0) {
    return <p className="max-w-[400px] text-fs-16 text-k-text">{t("empty")}</p>;
  }

  if (variant === "single") {
    return <QrCode text={labels[0].url} size={160} />;
  }

  const pages = chunk(labels, Math.max(1, perPage));

  return (
    <div>
      {/* RULE (brief item 4): A4, 10mm margin, exact print colours, one page per `perPage` labels. */}
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          .labels-page { print-color-adjust: exact; -webkit-print-color-adjust: exact; break-after: page; }
          .labels-page:last-child { break-after: auto; }
        }
      `}</style>
      {pages.map((page, pageIndex) => (
        <div
          key={pageIndex}
          data-testid="labels-page"
          className="labels-page mb-s-6 grid gap-s-2 bg-k-white p-s-4 print:mb-0 print:p-0"
          style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}
        >
          {page.map((label) => (
            <Label key={label.assetId} label={label} />
          ))}
        </div>
      ))}
    </div>
  );
}
