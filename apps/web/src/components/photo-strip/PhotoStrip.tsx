"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, X } from "lucide-react";
import { formatDateTime } from "@/lib/format";

export interface Photo {
  id: string;
  url: string;
  caption?: string;
  timestamp: string | number | Date;
  gps?: string;
}

/**
 * PhotoStrip — 88px thumbnails in a horizontal scroll row, capture button
 * always first (UI instructions §4 PhotoStrip, used by S19/S20).
 *
 * | Prop      | Type       | Notes                                             |
 * |-----------|------------|-----------------------------------------------------|
 * | photos    | Photo[]    | Newest-last is fine; capture button is always shown |
 * | onCapture | () => void | Fired when the capture button is pressed            |
 * | loading   | boolean    | Shows skeleton thumbnails after the capture button  |
 *
 * Tap on a thumbnail opens a lightbox (native `<dialog>`) with previous/next,
 * caption, timestamp (via `formatDateTime`) and GPS when present. No
 * external dependency — the lightbox is built on the platform dialog only.
 *
 * States: default, empty (RULE: only the capture button renders — no filler
 * text or illustration), loading.
 */
export interface PhotoStripProps {
  photos: Photo[];
  onCapture: () => void;
  loading?: boolean;
}

export function PhotoStrip({ photos, onCapture, loading = false }: PhotoStripProps) {
  const t = useTranslations();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openAt(index: number) {
    setOpenIndex(index);
    const dialog = dialogRef.current;
    if (!dialog) return;
    // jsdom (unit tests) has no <dialog> implementation at all — fall back
    // to the `open` attribute there. Real browsers always have showModal.
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function close() {
    const dialog = dialogRef.current;
    if (dialog) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    setOpenIndex(null);
  }

  function step(delta: 1 | -1) {
    if (openIndex === null) return;
    const next = (openIndex + delta + photos.length) % photos.length;
    setOpenIndex(next);
  }

  const active = openIndex !== null ? photos[openIndex] : null;

  return (
    <div>
      <div className="flex gap-s-3 overflow-x-auto pb-s-2">
        <button
          type="button"
          onClick={onCapture}
          aria-label={t("components.photo-strip.capture")}
          className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-k border border-k-grey bg-k-surface text-k-blue-deep"
        >
          <Camera size={24} strokeWidth={1.5} aria-hidden="true" />
        </button>

        {/* RULE: when there are no photos, only the capture button renders
            visibly (UI instructions §6 empty state) — no message, no
            illustration. The sentence below is sr-only, for screen readers. */}
        {!loading && photos.length === 0 && (
          <p className="sr-only">{t("components.photo-strip.empty")}</p>
        )}

        {loading &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-[88px] w-[88px] shrink-0 animate-pulse rounded-k bg-k-grey"
            />
          ))}

        {!loading &&
          photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => openAt(i)}
              className="h-[88px] w-[88px] shrink-0 overflow-hidden rounded-k border border-k-grey"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails come from mock/API URLs, not the Next asset pipeline */}
              <img
                src={photo.url}
                alt={photo.caption || t("components.photo-strip.photoAlt", { index: i + 1, total: photos.length })}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
      </div>

      <dialog
        ref={dialogRef}
        onClose={() => setOpenIndex(null)}
        className="max-w-[90vw] rounded-k border-none p-0 shadow-k backdrop:bg-k-ink/60"
      >
        {active && (
          <div className="relative w-[min(90vw,640px)] p-s-5">
            <button
              type="button"
              onClick={close}
              aria-label={t("common.close")}
              className="absolute right-s-3 top-s-3 rounded-k p-s-2 text-k-text hover:bg-k-surface"
            >
              <X size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url} alt={active.caption ?? ""} className="max-h-[60vh] w-full object-contain" />

            <div className="mt-s-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t("components.photo-strip.previous")}
                disabled={photos.length < 2}
                className="rounded-k p-s-2 text-k-blue-deep disabled:text-k-text-muted"
              >
                <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
              </button>
              <div className="text-center">
                {active.caption && <p className="text-fs-14 text-k-ink">{active.caption}</p>}
                <p className="num text-fs-12 text-k-text-muted">{formatDateTime(active.timestamp)}</p>
                {active.gps && (
                  <p className="text-fs-12 text-k-text-muted">
                    {t("components.photo-strip.gps")}: {active.gps}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t("components.photo-strip.next")}
                disabled={photos.length < 2}
                className="rounded-k p-s-2 text-k-blue-deep disabled:text-k-text-muted"
              >
                <ChevronRight size={20} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
