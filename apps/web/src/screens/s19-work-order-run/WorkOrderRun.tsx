"use client";

// S19 «Εκτέλεση εντολής» — R33, R34 (UI instructions §5 S19, CAPEX-02 «S19 Work order — mobile»)
//
/**
 * WorkOrderRun — one task, one screen, phone-first and one-handed at 390px.
 * A 48px header (back, ref); the asset name at 24px with its location; what
 * to do and the checklist; the PhotoStrip; a pinned bar of 64px buttons for
 * the valid next actions only; a 56px camera button floating above it.
 *
 * | Prop        | Type                      | Notes                                                        |
 * |-------------|---------------------------|--------------------------------------------------------------|
 * | order       | WorkOrderDetail?          | Ignored in `noPermission` \| `loading` \| `error`.           |
 * | state       | WorkOrderRunState         | `offline` = navigator offline: read-only, OfflineChip shown. |
 * | unitName    | string?                   | First crumb of the location line.                            |
 * | canWork     | boolean                   | `canWorkWorkOrder` — the bar and the camera.                 |
 * | onTransition| (body) => Promise<void>   | POST /work-orders/:id/transition                             |
 * | onUpload    | (file, title) => Promise<void> | POST /work-orders/:id/documents                         |
 *
 * RULE (UI instructions §5 S19, task S19): the bar shows only actions the
 * order can take now, out of Έναρξη · Συνέχιση · Παύση · Αποκατάσταση ·
 * Ολοκλήρωση — Αποκατάσταση only on an IN_PROGRESS order that is not PM
 * (`availableActions`). Ανταπόκριση and Ακύρωση stay on S18a, at a desk.
 * RULE: Ολοκλήρωση opens the note and, on a corrective order, the three
 * codes; it cannot submit without them (ADR-0031 §6). Αποκατάσταση asks
 * once, because it stops the restore clock. Έναρξη, Παύση and Συνέχιση go
 * with one tap.
 * RULE (ADR-0031 §12): no write queue in M5 — phones have reception. The
 * OfflineChip shows only while the browser says it is offline, and every
 * write control is disabled then, with the reason in its title.
 * The checklist ticks are this screen's own state: the contract has no
 * per-line record, so they are a memory aid, not a record (said on screen).
 */
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Camera, ChevronLeft } from "lucide-react";
import type { WorkOrderAction, WorkOrderDetail, WorkOrderTransition } from "@ecapital/shared";
import { OfflineChip } from "@/components/offline-chip";
import { PhotoStrip, type Photo } from "@/components/photo-strip";
import { BandChip } from "@/screens/s18-work-orders/BandChip";
import { PmDueChip, WorkOrderTimer } from "@/screens/s18-work-orders/WorkOrderTimer";
import { availableActions, isClosed } from "@/screens/s18a-work-order/actions";
import { TransitionDialog } from "@/screens/s18a-work-order/TransitionDialog";

export type WorkOrderRunState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface WorkOrderRunProps {
  order?: WorkOrderDetail;
  state: WorkOrderRunState;
  unitName?: string;
  canWork: boolean;
  onRetry?: () => void;
  noPermission: ReactNode;
  onTransition: (body: WorkOrderTransition) => Promise<void>;
  onUpload: (file: File, titleEl: string) => Promise<void>;
}

/** The actions S19's bar may show, in the order a technician meets them. */
const RUN_ACTIONS: WorkOrderAction[] = ["START", "RESUME", "PAUSE", "RESTORE", "COMPLETE"];
/** These ask first; the rest go with one tap. */
const ASK_FIRST = new Set<WorkOrderAction>(["RESTORE", "COMPLETE"]);

export function runActions(order: Pick<WorkOrderDetail, "status" | "kind">, canWork: boolean): WorkOrderAction[] {
  const allowed = availableActions(order.status, order.kind, canWork);
  return RUN_ACTIONS.filter((action) => allowed.includes(action));
}

export function WorkOrderRun({ order, state, unitName, canWork, onRetry, noPermission, onTransition, onUpload }: WorkOrderRunProps) {
  const t = useTranslations();
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<WorkOrderAction | null>(null);
  const [busy, setBusy] = useState<WorkOrderAction | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (state === "noPermission") return <>{noPermission}</>;
  if (state === "loading" || !order) return <div aria-busy="true" className="h-s-12 animate-pulse rounded-k bg-k-grey" />;
  if (state === "error") {
    return (
      <div className="p-s-6 text-center">
        <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-s-4 min-h-[44px] rounded-k border border-k-grey px-s-4 text-fs-16 text-k-blue-deep">
            {t("common.retry")}
          </button>
        )}
      </div>
    );
  }

  const offline = state === "offline";
  const actions = runActions(order, canWork);
  const checklist = (order.checklistEl ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const location = [unitName, order.areaName].filter(Boolean).join(" › ");
  const heading = order.assetName ?? order.slaSystemName ?? order.titleEl;
  const disabledReason = offline ? t("screens.s19.needsNetwork") : undefined;

  async function run(body: WorkOrderTransition) {
    setBusy(body.action);
    setError(undefined);
    try {
      await onTransition(body);
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    setError(undefined);
    try {
      await onUpload(file, file.name);
      const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
      setPhotos((prev) => [...prev, { id: `${Date.now()}-${file.name}`, url, caption: file.name, timestamp: new Date() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const camera = () => fileRef.current?.click();
  const showBar = canWork && actions.length > 0;

  return (
    <div className={`mx-auto max-w-[640px] ${showBar ? "pb-[168px] tablet:pb-s-6" : ""}`}>
      {/* 48px header: back and the order's ref. */}
      <div className="-mx-s-4 -mt-s-4 mb-s-4 flex h-12 items-center gap-s-2 border-b border-k-grey bg-k-white px-s-2 tablet:mx-0 tablet:mt-0">
        <Link
          href={`/maintenance/${encodeURIComponent(order.id)}`}
          aria-label={t("screens.s19.back")}
          className="flex h-11 w-11 items-center justify-center rounded-k text-k-blue-deep"
        >
          <ChevronLeft size={24} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <span className="font-k-mono text-fs-16 text-k-ink">{order.ref}</span>
      </div>

      {/* RULE (ADR-0031 §12): the chip only when the browser is offline. */}
      {offline && (
        <div className="mb-s-4">
          <OfflineChip status="offline" queued={0} />
        </div>
      )}

      <h1 className="text-fs-24 text-k-ink">{heading}</h1>
      {order.assetTag && <p className="font-k-mono text-fs-14 text-k-text">{order.assetTag}</p>}
      {location && <p className="mt-s-1 text-fs-14 text-k-text">{location}</p>}

      <div className="mt-s-3 flex flex-wrap items-center gap-s-2">
        <span className="rounded-k-chip bg-k-grey px-s-2 py-s-1 text-fs-14 text-k-ink">{t(`workOrderStatus.${order.status}`)}</span>
        <BandChip band={order.band} />
        {order.kind === "PM" ? (
          <PmDueChip dueDate={order.dueDate} state={order.sla.restore} done={isClosed(order.status)} />
        ) : (
          <WorkOrderTimer dueAt={order.dueRestoreAt} metAt={order.restoredAt} startAt={order.calledAt} state={order.sla.restore} stopped={order.status === "CANCELLED"} />
        )}
      </div>

      <section className="mt-s-5">
        <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s19.taskTitle")}</h2>
        <p className="mt-s-1 text-fs-16 text-k-ink">{order.titleEl}</p>
        {order.descriptionEl && <p className="mt-s-2 whitespace-pre-line text-fs-16 text-k-ink">{order.descriptionEl}</p>}
      </section>

      {checklist.length > 0 && (
        <section className="mt-s-5">
          <h2 className="text-fs-16 font-bold text-k-blue-deep">
            {t("screens.s19.checklistTitle")}{" "}
            <span className="num text-fs-14 font-normal text-k-text">{t("screens.s19.checklistDone", { done: ticked.size, total: checklist.length })}</span>
          </h2>
          <ul className="mt-s-2 grid gap-s-1">
            {checklist.map((line, i) => (
              <li key={`${i}-${line}`}>
                <label className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink">
                  <input
                    type="checkbox"
                    checked={ticked.has(i)}
                    onChange={() =>
                      setTicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                    className="h-6 w-6 shrink-0"
                  />
                  {line}
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-s-1 text-fs-14 text-k-text">{t("screens.s19.checklistNote")}</p>
        </section>
      )}

      <section className="mt-s-5">
        <h2 className="mb-s-2 text-fs-16 font-bold text-k-blue-deep">{t("screens.s19.photosTitle")}</h2>
        <PhotoStrip photos={photos} onCapture={canWork && !offline ? camera : () => undefined} loading={uploading} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label={t("screens.s19.camera")}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </section>

      {error && (
        <p role="alert" className="mt-s-4 text-fs-16 text-k-red">
          {error}
        </p>
      )}

      {isClosed(order.status) && <p className="mt-s-5 text-fs-16 text-k-ink">{t("screens.s19.closed")}</p>}
      {!canWork && <p className="mt-s-5 text-fs-14 text-k-text">{t("screens.s19.readOnly")}</p>}

      {/* RULE (UI instructions §5 S19): photo capture one tap from any scroll
          position — a fixed 56px button above the action bar. */}
      {canWork && !isClosed(order.status) && (
        <button
          type="button"
          onClick={camera}
          disabled={offline}
          title={disabledReason}
          aria-label={t("screens.s19.camera")}
          className={`fixed right-s-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-k-blue-deep text-k-white shadow-k disabled:bg-k-grey ${showBar ? "bottom-[calc(56px+96px)] tablet:bottom-[112px]" : "bottom-[calc(56px+16px)] tablet:bottom-s-6"}`}
        >
          <Camera size={24} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}

      {showBar && (
        <div
          role="group"
          aria-label={t("screens.s19.actionsLabel")}
          className="fixed inset-x-0 bottom-14 z-20 flex gap-s-2 border-t border-k-grey bg-k-white p-s-3 tablet:bottom-0 tablet:left-auto tablet:right-0 tablet:w-[min(640px,100%)]"
        >
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              disabled={offline || busy !== null}
              title={disabledReason}
              onClick={() => {
                if (ASK_FIRST.has(action)) {
                  setError(undefined);
                  setDialog(action);
                } else {
                  void run({ action });
                }
              }}
              className={`min-h-[64px] flex-1 rounded-k px-s-2 text-fs-16 font-bold disabled:bg-k-grey disabled:text-k-text-muted ${
                action === "COMPLETE" ? "bg-k-blue text-k-white shadow-k" : "border border-k-blue-deep bg-k-white text-k-blue-deep"
              }`}
            >
              {busy === action ? t("screens.s18detail.saving") : t(`workOrderAction.${action}`)}
            </button>
          ))}
        </div>
      )}

      <TransitionDialog
        open={dialog !== null}
        action={dialog}
        kind={order.kind}
        workRef={order.ref}
        defaults={order}
        submitting={busy !== null}
        error={error}
        phone
        onCancel={() => setDialog(null)}
        onConfirm={(body) => void run(body)}
      />
    </div>
  );
}
