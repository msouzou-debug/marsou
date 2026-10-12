// S18a, S19 — the filed photos and papers on a work order, split for the
// screen: what a browser can draw goes in the PhotoStrip, the rest (a PDF,
// a zip, an office file) is a line with «Άνοιγμα».
import type { WorkOrderEvent } from "@ecapital/shared";
import type { Photo } from "@/components/photo-strip";
import { documentContentHref } from "@/data/queries";

/** A photo taken in this session, remembered with what it was filed as. */
export interface LocalPhoto extends Photo {
  documentId?: string | null;
}

export interface FiledPhotos {
  /** Filed images, as thumbnails through `GET /documents/:id/content`. */
  images: Photo[];
  /** Filed files that are not images, for the list. */
  others: WorkOrderEvent[];
}

export function isImageMime(mime: string | null | undefined): boolean {
  return Boolean(mime?.toLowerCase().startsWith("image/"));
}

/**
 * RULE: a photo taken in this session is already in the strip from the file
 * itself, so its filed twin (the order is read back after the upload) is
 * left out rather than shown twice.
 */
export function filedPhotos(events: readonly WorkOrderEvent[], local: readonly LocalPhoto[] = []): FiledPhotos {
  const shown = new Set(local.map((p) => p.documentId).filter(Boolean));
  const images: Photo[] = [];
  const others: WorkOrderEvent[] = [];
  for (const e of events) {
    if (e.kind !== "PHOTO" || !e.documentId || !e.documentTitle) continue;
    if (isImageMime(e.documentMime)) {
      if (shown.has(e.documentId)) continue;
      images.push({ id: e.id, url: documentContentHref(e.documentId), caption: e.documentTitle, timestamp: e.at });
    } else {
      others.push(e);
    }
  }
  return { images, others };
}
