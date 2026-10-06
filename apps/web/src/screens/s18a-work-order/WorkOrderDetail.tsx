"use client";

// S18a «Εντολή εργασίας» — R33, R34, R35 (ADR-0031)
//
/**
 * WorkOrderDetail — the pure S18a record page: header, facts, the three
 * contract timers, the actions the order allows, the edit panel, «Στις
 * εκκρεμότητες», notes, photos and the history. The Screen owns the data
 * and the writes; each write callback returns a promise that rejects with
 * the API's `ApiError`, whose `.message` this page shows as it is.
 *
 * | Prop             | Type                          | Notes                                                        |
 * |------------------|-------------------------------|--------------------------------------------------------------|
 * | order            | WorkOrderDetail?              | Ignored in `noPermission` \| `loading` \| `error`.           |
 * | state            | WorkOrderDetailState          | No `empty`: a record page names one order or none.           |
 * | canWork          | boolean                       | `canWorkWorkOrder` — actions, edit, notes, photos.           |
 * | canManageBacklog | boolean                       | `canManageBacklog` — «Στις εκκρεμότητες».                    |
 * | onTransition     | (body) => Promise<void>       | POST /work-orders/:id/transition                             |
 * | onPatch          | (patch) => Promise<void>      | PATCH /work-orders/:id                                       |
 * | onNote           | (noteEl) => Promise<void>     | POST /work-orders/:id/notes                                  |
 * | onUpload         | (file, title) => Promise<void>| POST /work-orders/:id/documents (multipart)                  |
 * | onToBacklog      | (body) => Promise<void>       | POST /work-orders/:id/backlog                                |
 *
 * RULE (contract `WORK_ORDER_TRANSITIONS`): the action buttons are exactly
 * `availableActions(status, kind)` — never a button the API would refuse.
 * RULE (R36, `BACKLOG_REPEAT_COUNT`): three or more corrective orders on
 * the same asset in twelve months show a warning above the facts.
 * RULE (contract note 2, `EXTENSION_DAYS_*`): an extension needs a reason
 * and moves only the restore deadline; the hint says the contract's 5/15.
 *
 * Photos: the API files each photo with eArchive (ADR-0031 §11) and keeps
 * no URL of its own, so the strip shows the photos taken in this session
 * (from the file itself) and the list under it names every filed one.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Smartphone, TriangleAlert } from "lucide-react";
import {
  BACKLOG_REPEAT_COUNT,
  EXTENSION_DAYS_CHILLER_COMPRESSOR,
  EXTENSION_DAYS_SPARE,
  type BacklogCreate,
  type BacklogKind,
  type CauseCode,
  type FailureCode,
  type RemedyCode,
  type RiskBand,
  type WorkOrderAction,
  type WorkOrderDetail as WorkOrderDetailType,
  type WorkOrderPatch,
  type WorkOrderTransition,
} from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { PhotoStrip, type Photo } from "@/components/photo-strip";
import { Timeline } from "@/components/timeline";
import { formatDateTime, formatEURorDash } from "@/lib/format";
import { BandChip } from "@/screens/s18-work-orders/BandChip";
import { EscalatedMark, PmDueChip, WorkOrderTimer } from "@/screens/s18-work-orders/WorkOrderTimer";
import { availableActions, CAUSE_CODES, FAILURE_CODES, isClosed, REMEDY_CODES } from "./actions";
import { TransitionDialog } from "./TransitionDialog";

export type WorkOrderDetailState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface WorkOrderDetailProps {
  order?: WorkOrderDetailType;
  state: WorkOrderDetailState;
  onRetry?: () => void;
  noPermission: ReactNode;
  canWork: boolean;
  canManageBacklog: boolean;
  onTransition: (body: WorkOrderTransition) => Promise<void>;
  onPatch: (patch: WorkOrderPatch) => Promise<void>;
  onNote: (noteEl: string) => Promise<void>;
  onUpload: (file: File, titleEl: string) => Promise<void>;
  onToBacklog: (body: BacklogCreate) => Promise<void>;
}

const BACKLOG_KINDS: BacklogKind[] = ["REPAIR", "REPLACEMENT", "UPGRADE", "STATUTORY"];
const RISK_BANDS: RiskBand[] = ["HIGH", "SIGNIFICANT", "MODERATE", "LOW"];
const inputClass = "min-h-[44px] w-full rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** "" → null, "12,5" → 12.5, garbage → NaN (the caller refuses it). */
function parseAmount(value: string): number | null {
  if (value.trim() === "") return null;
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <h2 className="text-fs-20 text-k-blue-deep">{title}</h2>
      <div className="mt-s-3">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-fs-12 text-k-text">{label}</dt>
      <dd className="text-fs-16 text-k-ink">{value}</dd>
    </div>
  );
}

function TimerBlock({ label, chip, deadline, met }: { label: string; chip: ReactNode; deadline: string | null; met: string | null }) {
  const t = useTranslations("screens.s18detail.timers");
  return (
    <div className="rounded-k border border-k-grey p-s-4">
      <p className="eyebrow">{label}</p>
      <div className="mt-s-2 text-fs-20 [&>span]:px-s-3 [&>span]:py-s-2 [&>span]:text-fs-16">{chip}</div>
      <p className="num mt-s-2 text-left text-fs-14 text-k-text">{deadline ? t("deadline", { date: formatDateTime(deadline) }) : "—"}</p>
      {met && <p className="num text-left text-fs-14 text-k-text">{t("met", { date: formatDateTime(met) })}</p>}
    </div>
  );
}

export function WorkOrderDetail(props: WorkOrderDetailProps) {
  const { order, state, onRetry, noPermission, canWork, canManageBacklog, onTransition, onPatch, onNote, onUpload, onToBacklog } = props;
  const t = useTranslations();

  const [dialogAction, setDialogAction] = useState<WorkOrderAction | null>(null);
  const [transitionSaving, setTransitionSaving] = useState(false);
  const [transitionError, setTransitionError] = useState<string | undefined>();

  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | undefined>();

  const fileRef = useRef<HTMLInputElement>(null);
  const [localPhotos, setLocalPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();

  // Object URLs for this session's photos are released when the page goes.
  const photosRef = useRef<Photo[]>([]);
  useEffect(() => {
    photosRef.current = localPhotos;
  }, [localPhotos]);
  useEffect(() => () => photosRef.current.forEach((p) => p.url && URL.revokeObjectURL?.(p.url)), []);

  if (state === "noPermission") return <>{noPermission}</>;
  if (state === "loading" || !order) {
    return <div aria-busy="true" className="h-s-12 animate-pulse rounded-k bg-k-grey" />;
  }
  if (state === "error") {
    return (
      <div className="p-s-8 text-center">
        <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-s-4 min-h-[44px] rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep">
            {t("common.retry")}
          </button>
        )}
      </div>
    );
  }

  const offline = state === "offline";
  const writable = canWork && !offline;
  const closed = isClosed(order.status);
  const actions = offline ? [] : availableActions(order.status, order.kind, canWork);
  const stopped = order.status === "CANCELLED";

  async function confirmTransition(body: WorkOrderTransition) {
    setTransitionSaving(true);
    setTransitionError(undefined);
    try {
      await onTransition(body);
      setDialogAction(null);
    } catch (e) {
      setTransitionError(errorText(e));
    } finally {
      setTransitionSaving(false);
    }
  }

  async function submitNote() {
    if (!noteText.trim()) return;
    setNoteSaving(true);
    setNoteError(undefined);
    try {
      await onNote(noteText.trim());
      setNoteText("");
    } catch (e) {
      setNoteError(errorText(e));
    } finally {
      setNoteSaving(false);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    setUploadError(undefined);
    try {
      await onUpload(file, file.name);
      const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
      setLocalPhotos((prev) => [...prev, { id: `${Date.now()}-${file.name}`, url, caption: file.name, timestamp: new Date() }]);
    } catch (e) {
      setUploadError(errorText(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const filed = order.events.filter((e) => e.kind === "PHOTO" && e.documentTitle);

  return (
    <>
      <PageTitle
        eyebrow={<span className="font-k-mono">{order.ref}</span>}
        title={order.titleEl}
        action={
          writable && !closed ? (
            <Link
              href={`/maintenance/${encodeURIComponent(order.id)}/run`}
              className="flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey px-s-4 text-fs-14 text-k-blue-deep"
            >
              <Smartphone size={20} strokeWidth={1.5} aria-hidden="true" />
              {t("screens.s18detail.runLink")}
            </Link>
          ) : undefined
        }
      />

      <div className="mb-s-5 flex flex-wrap items-center gap-s-3">
        <span className="rounded-k-chip bg-k-grey px-s-2 py-s-1 text-fs-14 text-k-ink">{t(`workOrderStatus.${order.status}`)}</span>
        <span className="text-fs-14 text-k-text">{t(`workOrderKind.${order.kind}`)}</span>
        <BandChip band={order.band} />
        {order.escalatedAt && <EscalatedMark />}
      </div>

      {offline && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {order.escalatedAt && (
        <p className="mb-s-4 text-fs-14 text-k-ink">{t("screens.s18detail.escalatedAt", { date: formatDateTime(order.escalatedAt) })}</p>
      )}

      {/* RULE (R36): a third corrective order on the same asset in twelve
          months is the replacement trigger; say so where the order is read. */}
      {order.repeatCount >= BACKLOG_REPEAT_COUNT && (
        <div role="status" className="mb-s-5 flex items-start gap-s-3 rounded-k bg-k-amber-bg p-s-4 text-fs-16 text-k-ink">
          <TriangleAlert size={20} strokeWidth={1.5} aria-hidden="true" className="mt-[2px] shrink-0 text-k-amber" />
          <span>
            {order.repeatCount === BACKLOG_REPEAT_COUNT
              ? t("screens.s18detail.repeatThird")
              : t("screens.s18detail.repeatMany", { count: order.repeatCount })}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-s-6 desktop:grid-cols-2">
        <div className="grid gap-s-5 self-start">
          <Card title={t("screens.s18detail.timers.title")}>
            {order.kind === "PM" ? (
              <div className="grid grid-cols-1 gap-s-3">
                <TimerBlock
                  label={t("screens.s18detail.timers.pmDue")}
                  chip={<PmDueChip dueDate={order.dueDate} state={order.sla.restore} done={closed} />}
                  deadline={null}
                  met={order.completedAt}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-s-3 tablet:grid-cols-3">
                <TimerBlock
                  label={t("screens.s18detail.timers.response")}
                  chip={<WorkOrderTimer dueAt={order.dueResponseAt} metAt={order.respondedAt} startAt={order.calledAt} state={order.sla.response} stopped={stopped} />}
                  deadline={order.dueResponseAt}
                  met={order.respondedAt}
                />
                <TimerBlock
                  label={t("screens.s18detail.timers.restore")}
                  chip={<WorkOrderTimer dueAt={order.dueRestoreAt} metAt={order.restoredAt} startAt={order.calledAt} state={order.sla.restore} stopped={stopped} />}
                  deadline={order.dueRestoreAt}
                  met={order.restoredAt}
                />
                <TimerBlock
                  label={t("screens.s18detail.timers.report")}
                  chip={<WorkOrderTimer dueAt={order.dueReportAt} metAt={order.reportReceivedAt} startAt={order.calledAt} state={order.sla.report} stopped={stopped} />}
                  deadline={order.dueReportAt}
                  met={order.reportReceivedAt}
                />
              </div>
            )}
            {order.extensionDays > 0 && (
              <p className="mt-s-3 text-fs-14 text-k-text">
                {t("screens.s18detail.timers.extended", { days: order.extensionDays })}
                {order.extensionReasonEl ? ` · ${order.extensionReasonEl}` : ""}
              </p>
            )}
          </Card>

          <Card title={t("screens.s18detail.actionsTitle")}>
            {actions.length === 0 ? (
              <p className="text-fs-14 text-k-text">
                {closed ? t("screens.s18detail.closed") : canWork ? t("screens.s18detail.noActions") : t("screens.s18detail.readOnly")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-s-3">
                {actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => {
                      setTransitionError(undefined);
                      setDialogAction(action);
                    }}
                    className={
                      action === "CANCEL"
                        ? "min-h-[44px] rounded-k border border-k-red px-s-4 text-fs-14 text-k-red"
                        : "min-h-[44px] rounded-k border border-k-blue-deep px-s-4 text-fs-14 font-bold text-k-blue-deep"
                    }
                  >
                    {t(`workOrderAction.${action}`)}
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title={t("screens.s18detail.factsTitle")}>
            <dl className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
              <Fact
                label={t("screens.s18detail.facts.system")}
                value={order.slaSystemName ? `${order.slaSystemCode ?? ""} ${order.slaSystemName}`.trim() : t("common.notAvailable")}
              />
              <Fact
                label={t("screens.s18detail.facts.asset")}
                value={
                  order.assetId ? (
                    <Link href={`/assets/${encodeURIComponent(order.assetId)}`} className="text-k-blue hover:underline">
                      <span className="font-k-mono">{order.assetTag}</span>
                      {order.assetName ? ` ${order.assetName}` : ""}
                    </Link>
                  ) : (
                    t("screens.s18detail.facts.noAsset")
                  )
                }
              />
              <Fact label={t("screens.s18detail.facts.area")} value={order.areaName ?? t("common.notAvailable")} />
              <Fact label={t("screens.s18detail.facts.contractor")} value={order.contractorName ?? t("common.notAvailable")} />
              <Fact label={t("screens.s18detail.facts.calledBy")} value={`${order.raisedByName} · ${t(`workOrderSource.${order.source}`)}`} />
              <Fact label={t("screens.s18detail.facts.calledAt")} value={<span className="num">{formatDateTime(order.calledAt)}</span>} />
              <Fact label={t("screens.s18detail.facts.assignedTo")} value={order.assignedToEl ?? t("common.notAvailable")} />
              <Fact label={t("screens.s18detail.facts.costs")} value={`${formatEURorDash(order.costEstimate)} / ${formatEURorDash(order.costActual)}`} />
              {order.failureCode && (
                <Fact
                  label={t("screens.s18detail.codes.title")}
                  value={[
                    t(`failureCode.${order.failureCode}`),
                    order.causeCode ? t(`causeCode.${order.causeCode}`) : null,
                    order.remedyCode ? t(`remedyCode.${order.remedyCode}`) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              )}
            </dl>
            {order.descriptionEl && (
              <div className="mt-s-4">
                <p className="text-fs-12 text-k-text">{t("screens.s18detail.facts.description")}</p>
                <p className="whitespace-pre-line text-fs-16 text-k-ink">{order.descriptionEl}</p>
              </div>
            )}
            {order.closeoutNoteEl && (
              <div className="mt-s-4">
                <p className="text-fs-12 text-k-text">{t("screens.s18detail.facts.closeout")}</p>
                <p className="whitespace-pre-line text-fs-16 text-k-ink">{order.closeoutNoteEl}</p>
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-s-5 self-start">
          {writable && !closed && <EditPanel order={order} onPatch={onPatch} />}

          {canManageBacklog && !offline && (
            <BacklogPanel order={order} onToBacklog={onToBacklog} />
          )}

          <Card title={t("screens.s18detail.photosTitle")}>
            {writable ? (
              <>
                <PhotoStrip photos={localPhotos} onCapture={() => fileRef.current?.click()} loading={uploading} />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  aria-label={t("screens.s18detail.uploadLabel")}
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
              </>
            ) : null}
            {uploadError && (
              <p role="alert" className="mt-s-2 text-fs-14 text-k-red">
                {uploadError}
              </p>
            )}
            {filed.length === 0 ? (
              <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s18detail.photosEmpty")}</p>
            ) : (
              <ul className="mt-s-3 grid gap-s-2">
                {filed.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-s-2 border-b border-k-grey pb-s-2 text-fs-14">
                    <span className="text-k-ink">{e.documentTitle}</span>
                    <span className="num text-k-text">
                      {e.byName} · {formatDateTime(e.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("screens.s18detail.notesTitle")}>
            {writable ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitNote();
                }}
                className="grid gap-s-3"
              >
                <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                  {t("screens.s18detail.noteLabel")}
                  <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} className="w-full rounded-k border border-k-grey p-s-3 text-fs-16 text-k-ink" />
                </label>
                <p className="text-fs-14 text-k-text">{t("screens.s18detail.noPatientData")}</p>
                {noteError && (
                  <p role="alert" className="text-fs-14 text-k-red">
                    {noteError}
                  </p>
                )}
                <div>
                  <button
                    type="submit"
                    disabled={noteSaving || !noteText.trim()}
                    className="min-h-[44px] rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
                  >
                    {noteSaving ? t("screens.s18detail.saving") : t("buttons.add")}
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-fs-14 text-k-text">{t("screens.s18detail.notesReadOnly")}</p>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-s-6 rounded-k border border-k-grey bg-k-white p-s-4">
        <h2 className="text-fs-20 text-k-blue-deep">{t("screens.s18detail.historyTitle")}</h2>
        <div className="mt-s-3">
          <Timeline
            entries={order.events.map((e) => ({
              id: e.id,
              actor: e.byName,
              action: t(`workOrderEvent.${e.kind}`),
              timestamp: e.at,
              diff: e.noteEl ?? e.documentTitle ?? undefined,
            }))}
          />
        </div>
      </div>

      <TransitionDialog
        open={dialogAction !== null}
        action={dialogAction}
        kind={order.kind}
        workRef={order.ref}
        defaults={order}
        submitting={transitionSaving}
        error={transitionError}
        onCancel={() => setDialogAction(null)}
        onConfirm={(body) => void confirmTransition(body)}
      />
    </>
  );
}

// ------------------------------------------------------------------ edit --

function EditPanel({ order, onPatch }: { order: WorkOrderDetailType; onPatch: (patch: WorkOrderPatch) => Promise<void> }) {
  const t = useTranslations();
  const initial = {
    assignedToEl: order.assignedToEl ?? "",
    failureCode: (order.failureCode ?? "") as FailureCode | "",
    causeCode: (order.causeCode ?? "") as CauseCode | "",
    remedyCode: (order.remedyCode ?? "") as RemedyCode | "",
    costEstimate: order.costEstimate === null ? "" : String(order.costEstimate).replace(".", ","),
    costActual: order.costActual === null ? "" : String(order.costActual).replace(".", ","),
    partsNoteEl: order.partsNoteEl ?? "",
    extensionDays: String(order.extensionDays),
    extensionReasonEl: order.extensionReasonEl ?? "",
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const costEstimate = parseAmount(form.costEstimate);
  const costActual = parseAmount(form.costActual);
  const extensionDays = form.extensionDays.trim() === "" ? 0 : Number(form.extensionDays);
  const costInvalid = (costEstimate !== null && (Number.isNaN(costEstimate) || costEstimate < 0)) || (costActual !== null && (Number.isNaN(costActual) || costActual < 0));
  const daysInvalid = !Number.isInteger(extensionDays) || extensionDays < 0 || extensionDays > 60;
  // RULE (contract note 2): an extension is granted with a reason.
  const reasonMissing = extensionDays > 0 && form.extensionReasonEl.trim() === "";

  async function save() {
    if (costInvalid || daysInvalid || reasonMissing) return;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    const patch: WorkOrderPatch = {
      assignedToEl: form.assignedToEl.trim() || null,
      failureCode: form.failureCode || null,
      causeCode: form.causeCode || null,
      remedyCode: form.remedyCode || null,
      costEstimate,
      costActual,
      partsNoteEl: form.partsNoteEl.trim() || null,
      extensionDays,
      extensionReasonEl: form.extensionReasonEl.trim() || null,
    };
    try {
      await onPatch(patch);
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={t("screens.s18detail.editTitle")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="grid grid-cols-1 gap-s-3 tablet:grid-cols-2"
      >
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text tablet:col-span-2">
          {t("screens.s18detail.facts.assignedTo")}
          <input type="text" value={form.assignedToEl} onChange={(e) => setForm({ ...form, assignedToEl: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("screens.s18detail.codes.failure")}
          <select value={form.failureCode} onChange={(e) => setForm({ ...form, failureCode: e.target.value as FailureCode | "" })} className={inputClass}>
            <option value="">{t("screens.s18detail.codes.pick")}</option>
            {FAILURE_CODES.map((c) => (
              <option key={c} value={c}>
                {t(`failureCode.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("screens.s18detail.codes.cause")}
          <select value={form.causeCode} onChange={(e) => setForm({ ...form, causeCode: e.target.value as CauseCode | "" })} className={inputClass}>
            <option value="">{t("screens.s18detail.codes.pick")}</option>
            {CAUSE_CODES.map((c) => (
              <option key={c} value={c}>
                {t(`causeCode.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("screens.s18detail.codes.remedy")}
          <select value={form.remedyCode} onChange={(e) => setForm({ ...form, remedyCode: e.target.value as RemedyCode | "" })} className={inputClass}>
            <option value="">{t("screens.s18detail.codes.pick")}</option>
            {REMEDY_CODES.map((c) => (
              <option key={c} value={c}>
                {t(`remedyCode.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("screens.s18detail.fields.costEstimate")}
          <input type="text" inputMode="decimal" value={form.costEstimate} onChange={(e) => setForm({ ...form, costEstimate: e.target.value })} className={`num ${inputClass}`} />
        </label>
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("screens.s18detail.fields.costActual")}
          <input type="text" inputMode="decimal" value={form.costActual} onChange={(e) => setForm({ ...form, costActual: e.target.value })} className={`num ${inputClass}`} />
        </label>
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text tablet:col-span-2">
          {t("screens.s18detail.fields.partsNote")}
          <textarea value={form.partsNoteEl} onChange={(e) => setForm({ ...form, partsNoteEl: e.target.value })} rows={2} className="w-full rounded-k border border-k-grey p-s-3 text-fs-16 text-k-ink" />
        </label>
        {order.kind !== "PM" && (
          <>
            <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
              {t("screens.s18detail.fields.extensionDays")}
              <input type="number" min={0} max={60} value={form.extensionDays} onChange={(e) => setForm({ ...form, extensionDays: e.target.value })} className={`num ${inputClass}`} />
            </label>
            <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
              {t("screens.s18detail.fields.extensionReason")}
              <input type="text" value={form.extensionReasonEl} onChange={(e) => setForm({ ...form, extensionReasonEl: e.target.value })} className={inputClass} />
            </label>
            <p className="text-fs-14 text-k-text tablet:col-span-2">
              {t("screens.s18detail.fields.extensionHint", { spare: EXTENSION_DAYS_SPARE, chiller: EXTENSION_DAYS_CHILLER_COMPRESSOR })}
            </p>
          </>
        )}
        {reasonMissing && (
          <p role="alert" className="text-fs-14 text-k-red tablet:col-span-2">
            {t("screens.s18detail.fields.extensionReasonRequired")}
          </p>
        )}
        {(costInvalid || daysInvalid) && (
          <p role="alert" className="text-fs-14 text-k-red tablet:col-span-2">
            {costInvalid ? t("screens.s18detail.fields.costInvalid") : t("screens.s18detail.fields.daysInvalid")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-fs-14 text-k-red tablet:col-span-2">
            {error}
          </p>
        )}
        {saved && <p className="text-fs-14 text-k-ink tablet:col-span-2">{t("screens.s18detail.saved")}</p>}
        <div className="tablet:col-span-2">
          <button
            type="submit"
            disabled={saving || costInvalid || daysInvalid || reasonMissing}
            className="min-h-[44px] rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {saving ? t("screens.s18detail.saving") : t("buttons.save")}
          </button>
        </div>
      </form>
    </Card>
  );
}

// --------------------------------------------------------------- backlog --

function BacklogPanel({ order, onToBacklog }: { order: WorkOrderDetailType; onToBacklog: (body: BacklogCreate) => Promise<void> }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<BacklogKind>(order.repeatCount >= BACKLOG_REPEAT_COUNT ? "REPLACEMENT" : "REPAIR");
  const [title, setTitle] = useState(order.titleEl);
  const [band, setBand] = useState<RiskBand>(order.band === "CRITICAL" ? "HIGH" : "SIGNIFICANT");
  const [cost, setCost] = useState(order.costEstimate === null ? "" : String(order.costEstimate).replace(".", ","));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const costValue = parseAmount(cost);
  const invalid = title.trim().length < 3 || (costValue !== null && (Number.isNaN(costValue) || costValue < 0));

  if (order.backlogItemId || done) {
    return (
      <Card title={t("screens.s18detail.backlog.title")}>
        <p className="text-fs-14 text-k-ink">{done ? t("screens.s18detail.backlog.done") : t("screens.s18detail.backlog.linked")}</p>
        <Link href="/maintenance/backlog" className="mt-s-2 inline-flex min-h-[44px] items-center text-fs-14 text-k-blue hover:underline">
          {t("screens.s18detail.backlog.open")}
        </Link>
      </Card>
    );
  }

  async function save() {
    if (invalid) return;
    setSaving(true);
    setError(undefined);
    try {
      await onToBacklog({ kind, titleEl: title.trim(), riskBand: band, costEstimate: costValue, assetId: order.assetId, slaSystemId: order.slaSystemId, sourceWorkOrderId: order.id });
      setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={t("screens.s18detail.backlog.title")}>
      <p className="text-fs-14 text-k-text">{t("screens.s18detail.backlog.intro")}</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-s-3 min-h-[44px] rounded-k border border-k-grey px-s-4 text-fs-14 text-k-blue-deep">
          {t("screens.s18detail.backlog.button")}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="mt-s-3 grid grid-cols-1 gap-s-3 tablet:grid-cols-2"
        >
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text tablet:col-span-2">
            {t("screens.s18detail.backlog.titleLabel")}
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s18detail.backlog.kind")}
            <select value={kind} onChange={(e) => setKind(e.target.value as BacklogKind)} className={inputClass}>
              {BACKLOG_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`backlogKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s18detail.backlog.band")}
            <select value={band} onChange={(e) => setBand(e.target.value as RiskBand)} className={inputClass}>
              {RISK_BANDS.map((b) => (
                <option key={b} value={b}>
                  {t(`riskBands.${b}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text tablet:col-span-2">
            {t("screens.s18detail.fields.costEstimate")}
            <input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={`num ${inputClass}`} />
          </label>
          {error && (
            <p role="alert" className="text-fs-14 text-k-red tablet:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-s-3 tablet:col-span-2">
            <button type="submit" disabled={saving || invalid} className="min-h-[44px] rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60">
              {saving ? t("screens.s18detail.saving") : t("buttons.save")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-k px-s-4 text-fs-14 text-k-text">
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
