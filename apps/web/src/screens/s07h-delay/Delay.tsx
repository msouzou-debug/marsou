"use client";

// S07h — ADR-0035
//
/**
 * Delay — the pure «Προθεσμίες και ρήτρες» body of a contract: the delay
 * clocks with a totals row, the sections (τμήματα) and the extensions of
 * time (παρατάσεις), newest first.
 *
 * | Prop                 | Type                          | Notes                                                       |
 * |----------------------|-------------------------------|-------------------------------------------------------------|
 * | data                 | ContractDetail?               | Carries `sections`, `extensions` and `delay`.                |
 * | state                | DelayScreenState              |                                                              |
 * | roles                | AppRole[]                     | WRITE (`canWriteContracts`) edits; APPROVE (`canActivateDelay`) activates. |
 * | onSaveSection / onDeleteSection / onSaveExtension / onDeleteExtension / onActivate | — | Wired by `DelayScreen`. A save resolves to true when it succeeded, so the panel closes. |
 *
 * RULE (ADR-0035 §1): the penalty is shown, never deducted. The sentence
 * under the clocks says finance withholds it on the payment certificate.
 */
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AppRole, ContractDetail, ContractExtension, ContractSection, DelayClock } from "@ecapital/shared";
import { canActivateDelay, canWriteContracts } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Table, type TableColumn } from "@/components/table";
import { formatDate, formatEUR, formatEURorDash, formatInt } from "@/lib/format";
import { ContractTabs } from "@/screens/s07-contract/ContractTabs";
import { ActivationForm, ExtensionForm, SectionForm } from "./DelayForms";
import type { ActivationFormValues, ExtensionFormValues, SectionFormValues } from "./schema";

export type DelayScreenState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface DelayProps {
  data?: ContractDetail;
  state: DelayScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  saving?: boolean;
  apiError?: string;
  onSaveSection?: (sectionId: string | null, values: SectionFormValues) => Promise<boolean>;
  onDeleteSection?: (sectionId: string) => Promise<boolean>;
  onSaveExtension?: (values: ExtensionFormValues) => Promise<boolean>;
  onDeleteExtension?: (extensionId: string) => Promise<boolean>;
  onActivate?: (sectionId: string | null, values: ActivationFormValues) => Promise<boolean>;
  /** Clears the screen's last API error when a panel opens or closes. */
  onClearError?: () => void;
}

type Panel =
  | { kind: "section"; id: string | null }
  | { kind: "extension" }
  | { kind: "activate"; clock: DelayClock }
  | null;

type ConfirmTarget = { kind: "section"; section: ContractSection } | { kind: "extension"; extension: ContractExtension } | null;

export function Delay({
  data,
  state,
  onRetry,
  noPermission,
  roles = [],
  saving = false,
  apiError,
  onSaveSection = async () => false,
  onDeleteSection = async () => false,
  onSaveExtension = async () => false,
  onDeleteExtension = async () => false,
  onActivate = async () => false,
  onClearError,
}: DelayProps) {
  const t = useTranslations();
  const [panel, setPanel] = useState<Panel>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget>(null);

  if (state === "noPermission") return <>{noPermission}</>;

  const offline = state === "offline";
  const canWrite = canWriteContracts(roles) && !offline;
  const canActivate = canActivateDelay(roles) && !offline;
  const sections = [...(data?.sections ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const extensions = [...(data?.extensions ?? [])].sort((a, b) =>
    a.approvedAt === b.approvedAt ? b.createdAt.localeCompare(a.createdAt) : b.approvedAt.localeCompare(a.approvedAt),
  );
  const delay = data?.delay;
  const clocks = delay?.clocks ?? [];
  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : offline ? "offline" : "default";

  function open(next: Panel) {
    onClearError?.();
    setPanel(next);
  }
  const sectionLabel = (id: string | null) => {
    const s = id ? sections.find((x) => x.id === id) : undefined;
    return s ? `${s.code} · ${s.titleEl}` : t("screens.s07h.extensions.wholeContract");
  };
  const clockLabel = (c: DelayClock) => (c.sectionCode ? `${c.sectionCode} · ${c.titleEl}` : c.titleEl || t("screens.s07h.contractClock"));

  const clockColumns: TableColumn<DelayClock>[] = [
    { id: "section", headerKey: "screens.s07h.columns.section", accessor: (c) => clockLabel(c), sortable: false },
    {
      id: "completion",
      headerKey: "screens.s07h.columns.completion",
      accessor: (c) => c.completionDate ?? "",
      numeric: true,
      sortable: false,
      cell: (c) => (c.completionDate ? formatDate(c.completionDate) : t("common.notAvailable")),
    },
    {
      id: "extensionDays",
      headerKey: "screens.s07h.columns.extensionDays",
      accessor: (c) => c.extensionDays,
      numeric: true,
      sortable: false,
      cell: (c) => formatInt(c.extensionDays),
    },
    {
      id: "due",
      headerKey: "screens.s07h.columns.due",
      accessor: (c) => c.dueDate ?? "",
      numeric: true,
      sortable: false,
      cell: (c) => (c.dueDate ? formatDate(c.dueDate) : t("common.notAvailable")),
    },
    {
      id: "handover",
      headerKey: "screens.s07h.columns.handover",
      accessor: (c) => c.handoverDate ?? "",
      numeric: true,
      sortable: false,
      cell: (c) => (c.handoverDate ? formatDate(c.handoverDate) : t("screens.s07h.sections.notHandedOver")),
    },
    {
      id: "daysLate",
      headerKey: "screens.s07h.columns.daysLate",
      accessor: (c) => c.daysLate,
      numeric: true,
      sortable: false,
      cell: (c) => <span className={c.daysLate > 0 ? "text-k-red" : undefined}>{formatInt(c.daysLate)}</span>,
    },
    {
      id: "rate",
      headerKey: "screens.s07h.columns.rate",
      accessor: (c) => c.ratePerDay ?? 0,
      numeric: true,
      sortable: false,
      cell: (c) => formatEURorDash(c.ratePerDay),
    },
    {
      id: "amount",
      headerKey: "screens.s07h.columns.amount",
      accessor: (c) => c.amount ?? 0,
      numeric: true,
      sortable: false,
      cell: (c) => formatEURorDash(c.amount),
    },
    {
      id: "activation",
      headerKey: "screens.s07h.columns.activation",
      accessor: (c) => c.activatedAt ?? "",
      sortable: false,
      cell: (c) =>
        c.activatedAt ? (
          <span className="num">{t("screens.s07h.activatedOn", { date: formatDate(c.activatedAt) })}</span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-s-2">
            <span className="text-k-text">{t("screens.s07h.notActivated")}</span>
            {canActivate && (
              <button
                type="button"
                onClick={() => open({ kind: "activate", clock: c })}
                aria-label={`${t("screens.s07h.activate")} — ${clockLabel(c)}`}
                className="rounded-k border border-k-grey px-s-2 py-s-1 text-fs-12 font-bold text-k-blue-deep"
              >
                {t("screens.s07h.activate")}
              </button>
            )}
          </span>
        ),
    },
  ];

  const sectionColumns: TableColumn<ContractSection>[] = [
    { id: "code", headerKey: "screens.s07h.sections.columns.code", accessor: (s) => s.code, sortable: false },
    { id: "title", headerKey: "screens.s07h.sections.columns.title", accessor: (s) => s.titleEl, sortable: false },
    {
      id: "completion",
      headerKey: "screens.s07h.sections.columns.completion",
      accessor: (s) => s.completionDate,
      numeric: true,
      sortable: false,
      cell: (s) => formatDate(s.completionDate),
    },
    {
      id: "handover",
      headerKey: "screens.s07h.sections.columns.handover",
      accessor: (s) => s.handoverDate ?? "",
      numeric: true,
      sortable: false,
      cell: (s) => (s.handoverDate ? formatDate(s.handoverDate) : t("screens.s07h.sections.notHandedOver")),
    },
    {
      id: "rate",
      headerKey: "screens.s07h.sections.columns.rate",
      accessor: (s) => s.liquidatedDamagesPerDay ?? 0,
      numeric: true,
      sortable: false,
      cell: (s) => (s.liquidatedDamagesPerDay === null ? t("screens.s07h.sections.contractRate") : formatEUR(s.liquidatedDamagesPerDay)),
    },
    ...(canWrite
      ? [
          {
            id: "actions",
            headerKey: "screens.s07h.sections.columns.actions",
            accessor: (s: ContractSection) => s.id,
            sortable: false,
            cell: (s: ContractSection) => (
              <span className="inline-flex gap-s-3">
                <button type="button" onClick={() => open({ kind: "section", id: s.id })} className="text-fs-14 text-k-blue-deep underline-offset-2 hover:underline">
                  {t("buttons.edit")}
                </button>
                <button type="button" onClick={() => setConfirm({ kind: "section", section: s })} className="text-fs-14 text-k-red underline-offset-2 hover:underline">
                  {t("screens.s07h.delete")}
                </button>
              </span>
            ),
          } satisfies TableColumn<ContractSection>,
        ]
      : []),
  ];

  const extensionColumns: TableColumn<ContractExtension>[] = [
    {
      id: "date",
      headerKey: "screens.s07h.extensions.columns.date",
      accessor: (e) => e.approvedAt,
      numeric: true,
      sortable: false,
      cell: (e) => formatDate(e.approvedAt),
    },
    { id: "days", headerKey: "screens.s07h.extensions.columns.days", accessor: (e) => e.days, numeric: true, sortable: false, cell: (e) => formatInt(e.days) },
    {
      id: "approver",
      headerKey: "screens.s07h.extensions.columns.approver",
      accessor: (e) => e.approver,
      sortable: false,
      cell: (e) => t(`extensionApprover.${e.approver}`),
    },
    { id: "name", headerKey: "screens.s07h.extensions.columns.name", accessor: (e) => e.approverNameEl, sortable: false },
    { id: "reason", headerKey: "screens.s07h.extensions.columns.reason", accessor: (e) => e.reasonEl, sortable: false },
    {
      id: "culpable",
      headerKey: "screens.s07h.extensions.columns.culpable",
      accessor: (e) => (e.contractorCulpable ? 1 : 0),
      sortable: false,
      cell: (e) => t("screens.s07h.extensions.culpableLabel", { value: e.contractorCulpable ? t("common.yes") : t("common.no") }),
    },
    {
      id: "section",
      headerKey: "screens.s07h.extensions.columns.section",
      accessor: (e) => e.sectionId ?? "",
      sortable: false,
      cell: (e) => sectionLabel(e.sectionId),
    },
    ...(canWrite
      ? [
          {
            id: "actions",
            headerKey: "screens.s07h.extensions.columns.actions",
            accessor: (e: ContractExtension) => e.id,
            sortable: false,
            cell: (e: ContractExtension) => (
              <button type="button" onClick={() => setConfirm({ kind: "extension", extension: e })} className="text-fs-14 text-k-red underline-offset-2 hover:underline">
                {t("screens.s07h.delete")}
              </button>
            ),
          } satisfies TableColumn<ContractExtension>,
        ]
      : []),
  ];

  const totals = delay
    ? {
        section: t("screens.s07h.totals"),
        extensionDays: formatInt(delay.extensionDays),
        daysLate: formatInt(delay.totalDaysLate),
        amount: formatEURorDash(delay.totalAmount),
      }
    : undefined;

  const addButton = (label: string, onClick: () => void) =>
    canWrite ? (
      <button type="button" onClick={onClick} className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k">
        {label}
      </button>
    ) : null;

  async function confirmDelete() {
    const target = confirm;
    setConfirm(null);
    if (!target) return;
    if (target.kind === "section") await onDeleteSection(target.section.id);
    else await onDeleteExtension(target.extension.id);
  }

  const editingSection = panel?.kind === "section" && panel.id ? sections.find((s) => s.id === panel.id) : undefined;

  return (
    <>
      <PageTitle
        eyebrow={data?.contractNo ?? ""}
        title={t("screens.s07h.title")}
        tabs={
          data ? (
            <ContractTabs
              contractId={data.id}
              active="delay"
              rfisOpenCount={data.rfisOpen}
              defectsOpenCount={data.defects?.filter((d) => d.status !== "CLOSED").length}
            />
          ) : undefined
        }
      />

      {offline && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {panel?.kind === "activate" && (
        <ActivationForm
          clockLabel={clockLabel(panel.clock)}
          saving={saving}
          apiError={apiError}
          onCancel={() => open(null)}
          onSave={(values) => void onActivate(panel.clock.sectionId, values).then((ok) => ok && setPanel(null))}
        />
      )}
      {panel?.kind === "section" && (
        <SectionForm
          section={editingSection}
          saving={saving}
          apiError={apiError}
          onCancel={() => open(null)}
          onSave={(values) => void onSaveSection(panel.id, values).then((ok) => ok && setPanel(null))}
        />
      )}
      {panel?.kind === "extension" && (
        <ExtensionForm
          sections={sections}
          saving={saving}
          apiError={apiError}
          onCancel={() => open(null)}
          onSave={(values) => void onSaveExtension(values).then((ok) => ok && setPanel(null))}
        />
      )}

      <section className="mb-s-8 flex flex-col gap-s-3" aria-label={t("screens.s07h.clocksTitle")}>
        <h2 className="text-fs-20">{t("screens.s07h.clocksTitle")}</h2>
        <Table<DelayClock>
          tableId="s07h-clocks"
          columns={clockColumns}
          rows={clocks}
          getRowId={(c) => c.sectionId ?? "contract"}
          captionKey="screens.s07h.clocksCaption"
          state={tableState === "default" && clocks.length === 0 ? "empty" : tableState}
          density="dense"
          totals={totals}
          onRetry={onRetry}
          emptyState={{ messageKey: "screens.s07h.clocksEmpty", actionLabelKey: "buttons.add" }}
        />
        {delay && (
          <>
            <p className="text-fs-14 text-k-text">{t("screens.s07h.asOf", { date: formatDate(delay.asOf) })}</p>
            <p className="text-fs-14 text-k-ink">{t("screens.s07h.reminder")}</p>
          </>
        )}
      </section>

      <section className="mb-s-8 flex flex-col gap-s-3" aria-label={t("screens.s07h.sections.title")}>
        <div className="flex flex-wrap items-center justify-between gap-s-3">
          <h2 className="text-fs-20">{t("screens.s07h.sections.title")}</h2>
          {addButton(t("screens.s07h.sections.add"), () => open({ kind: "section", id: null }))}
        </div>
        <Table<ContractSection>
          tableId="s07h-sections"
          columns={sectionColumns}
          rows={sections}
          getRowId={(s) => s.id}
          captionKey="screens.s07h.sections.caption"
          state={tableState === "default" && sections.length === 0 ? "empty" : tableState}
          density="dense"
          onRetry={onRetry}
          emptyState={{ messageKey: "screens.s07h.sections.empty", actionLabelKey: "buttons.add" }}
        />
      </section>

      <section className="flex flex-col gap-s-3" aria-label={t("screens.s07h.extensions.title")}>
        <div className="flex flex-wrap items-center justify-between gap-s-3">
          <h2 className="text-fs-20">{t("screens.s07h.extensions.title")}</h2>
          {addButton(t("screens.s07h.extensions.add"), () => open({ kind: "extension" }))}
        </div>
        <Table<ContractExtension>
          tableId="s07h-extensions"
          columns={extensionColumns}
          rows={extensions}
          getRowId={(e) => e.id}
          captionKey="screens.s07h.extensions.caption"
          state={tableState === "default" && extensions.length === 0 ? "empty" : tableState}
          density="dense"
          onRetry={onRetry}
          emptyState={{ messageKey: "screens.s07h.extensions.empty", actionLabelKey: "buttons.add" }}
        />
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "section"
            ? t("screens.s07h.sections.deleteTitle", { code: confirm.section.code })
            : t("screens.s07h.extensions.deleteTitle")
        }
        consequence={
          confirm?.kind === "section"
            ? t("screens.s07h.sections.deleteConsequence")
            : t("screens.s07h.extensions.deleteConsequence", { days: confirm?.kind === "extension" ? confirm.extension.days : 0 })
        }
        destructiveLabel={t("screens.s07h.delete")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
