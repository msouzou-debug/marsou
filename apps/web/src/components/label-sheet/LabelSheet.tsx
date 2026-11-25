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
 *
 * RULE (UAT 25/11/2026, «the text does not fit when printed»): every label
 * is a fixed box in millimetres and nothing leaves it. The arithmetic, for
 * A4 with the 10 mm margin: 190 × 277 mm printable; 3 columns and 8 rows
 * with 2 mm gaps give 62 × 32 mm a label (8 × 32 + 7 × 2 = 270 mm, which
 * fits). Inside: 2 mm padding, the ΟΚΥπΥ mark (unchanged, 20 px), the QR at
 * 20 mm, and about 28 mm of width for the text. So:
 *   - the tag is the one line a technician types or reads out: it is never
 *     cut. Mono bold, 10 pt up to 12 characters (13 fit), 9 pt beyond, and
 *     a tag longer than one line breaks onto a second rather than spilling;
 *   - the name wraps to at most 3 lines (2 when there is an area line) and
 *     ends in «…»; a long name (over 34 characters) drops to 8 pt so more of
 *     it shows — the one place under 12 px, and only for the name;
 *   - the area is one line with «…»;
 *   - `overflow: hidden` and `break-inside: avoid` on the box are the last
 *     lock: whatever a string does, the next label and the page break stay
 *     where they are.
 * Points and millimetres, not px or the type scale: this is paper.
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
/** The label box and the gap between boxes (see the arithmetic above). */
const LABEL_HEIGHT_MM = 32;
const GAP_MM = 2;
/** 20 mm at the CSS 96 px to the inch print uses. */
const QR_PX = 76;
/** Up to this many characters the tag prints at 10 pt (13 fit on one line); longer ones at 9 pt, wrapping if they must. */
const TAG_SHORT = 12;
const NAME_LONG = 34;

/** `short` | `long`: which of the two sizes a string prints at. */
export function tagSize(tag: string): "short" | "long" {
  return tag.length <= TAG_SHORT ? "short" : "long";
}

export function nameSize(name: string): "short" | "long" {
  return name.length <= NAME_LONG ? "short" : "long";
}

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
  const tag = tagSize(label.tag);
  const name = nameSize(label.nameEl);
  return (
    <div
      className="asset-label flex items-center gap-[2mm] overflow-hidden border border-k-grey bg-k-white p-[2mm]"
      style={{ height: `${LABEL_HEIGHT_MM}mm` }}
      data-testid="asset-label"
    >
      <Image src="/brand/okypy_icon.png" alt="" width={20} height={20} className="shrink-0" />
      <div className="shrink-0">
        <QrCode text={label.url} size={QR_PX} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[0.5mm] overflow-hidden" lang="el">
        <p
          data-size={tag}
          className={`font-k-mono font-bold leading-[1.15] break-all text-k-ink ${
            tag === "short" ? "text-[10pt]" : "text-[9pt]"
          }`}
        >
          {label.tag}
        </p>
        <p
          data-size={name}
          title={label.nameEl}
          className={`leading-[1.15] text-k-ink [overflow-wrap:anywhere] ${
            label.areaNameEl ? "line-clamp-2" : "line-clamp-3"
          } ${name === "short" ? "text-[9pt]" : "text-[8pt]"}`}
        >
          {label.nameEl}
        </p>
        {label.areaNameEl && (
          <p title={label.areaNameEl} className="truncate text-[9pt] leading-[1.15] text-k-text">
            {label.areaNameEl}
          </p>
        )}
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
        .asset-label { box-sizing: border-box; break-inside: avoid; page-break-inside: avoid; }
        @media print {
          .labels-page { print-color-adjust: exact; -webkit-print-color-adjust: exact; break-after: page; }
          .labels-page:last-child { break-after: auto; }
        }
      `}</style>
      {pages.map((page, pageIndex) => (
        <div
          key={pageIndex}
          data-testid="labels-page"
          className="labels-page mb-s-6 grid bg-k-white p-s-4 print:mb-0 print:p-0"
          style={{
            // `minmax(0, 1fr)`, not `1fr`: a column never grows to fit a long
            // word, so the three columns stay 62 mm whatever the text.
            gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
            gridAutoRows: `${LABEL_HEIGHT_MM}mm`,
            gap: `${GAP_MM}mm`,
          }}
        >
          {page.map((label) => (
            <Label key={label.assetId} label={label} />
          ))}
        </div>
      ))}
    </div>
  );
}
