"use client";

// S07b — R09 (ADR-0017)
//
/**
 * Rfis — the pure S07b screen body: the contract tab strip, the open/overdue
 * summary line, the `Table` of RFIs and (when one is open) the `RfiSheet`.
 *
 * | Prop         | Type                | Notes                                                        |
 * |--------------|---------------------|-------------------------------------------------------------------|
 * | contract     | ContractDetail?     | For the eyebrow, the tab strip and its counts.                     |
 * | rfis         | Rfi[]?              | Ignored in `noPermission` \| `loading` \| `error`.                  |
 * | state        | RfisScreenState     | The five states (build brief §6).                                  |
 * | roles        | AppRole[]           | `canWriteRfis(roles)` — the «Προσθήκη», answer and «Ολοκλήρωση» gate. |
 * | now          | Date?               | Injectable "now" for `SlaChip`'s tests and preview.                 |
 * | selectedId / onSelect / sheetSaving / sheetApiError / onCreate / onAnswer / onCloseRfi / onRetry | — | Wired by `RfisScreen`. |
 *
 * RULE (ADR-0017): a breach is a state, never a block — nothing here checks
 * `slaState` before allowing an answer or a close.
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AppRole, ContractDetail, Rfi } from "@ecapital/shared";
import { canWriteRfis } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { SlaChip } from "@/components/sla-chip";
import { Table, type TableColumn } from "@/components/table";
import { formatDate } from "@/lib/format";
import { ContractTabs } from "@/screens/s07-contract/ContractTabs";
import type { RfiFormValues } from "./schema";
import { RfiSheet } from "./RfiSheet";

export type RfisScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface RfisProps {
  contract?: ContractDetail;
  rfis?: Rfi[];
  state: RfisScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  selectedId?: string | "new" | null;
  onSelect: (id: string | "new" | null) => void;
  sheetSaving?: boolean;
  sheetApiError?: string;
  onCreate: (values: RfiFormValues) => void;
  onAnswer: (answerEl: string) => void;
  onCloseRfi: () => void;
}

export function Rfis({
  contract,
  rfis,
  state,
  onRetry,
  noPermission,
  roles = [],
  selectedId,
  onSelect,
  sheetSaving = false,
  sheetApiError,
  onCreate,
  onAnswer,
  onCloseRfi,
}: RfisProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const canWrite = canWriteRfis(roles);
  const rows = rfis ?? [];
  const openCount = rows.filter((r) => r.status === "OPEN").length;
  const breachedCount = rows.filter((r) => r.status === "OPEN" && r.slaState === "BREACHED").length;

  const columns: TableColumn<Rfi>[] = [
    { id: "number", headerKey: "screens.s07b.columns.number", accessor: (row) => row.number, numeric: true },
    {
      id: "question",
      headerKey: "screens.s07b.columns.question",
      accessor: (row) => row.questionEl,
      cell: (row) => (
        <span className="block max-w-[320px] truncate" title={row.questionEl}>
          {row.questionEl}
        </span>
      ),
    },
    { id: "raisedBy", headerKey: "screens.s07b.columns.raisedBy", accessor: (row) => row.raisedByName },
    { id: "raisedAt", headerKey: "screens.s07b.columns.raisedAt", accessor: (row) => row.raisedAt, numeric: true, cell: (row) => formatDate(row.raisedAt) },
    {
      id: "due",
      headerKey: "screens.s07b.columns.due",
      accessor: (row) => row.slaDueAt,
      numeric: true,
      // RULE (ADR-0017): the clock stops at the answer — once ANSWERED or
      // CLOSED, the chip is replaced by the answered date in mono, never a
      // chip that would keep drifting toward BREACHED for paperwork alone.
      cell: (row) =>
        row.status === "OPEN" ? (
          <SlaChip dueAt={row.slaDueAt} totalHours={row.slaHours} />
        ) : (
          <span className="num text-k-ink">{row.answeredAt ? formatDate(row.answeredAt) : t("common.notAvailable")}</span>
        ),
    },
    {
      id: "status",
      headerKey: "screens.s07b.columns.status",
      accessor: (row) => row.status,
      cell: (row) => t(`rfiStatus.${row.status}`),
    },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";

  const selectedRfi = selectedId && selectedId !== "new" ? rows.find((r) => r.id === selectedId) : undefined;
  const sheetOpen = selectedId !== undefined && selectedId !== null;

  return (
    <>
      <PageTitle
        eyebrow={contract?.contractNo ?? ""}
        title={t("screens.s07b.title")}
        tabs={
          contract ? (
            <ContractTabs
              contractId={contract.id}
              active="rfis"
              rfisOpenCount={contract.rfisOpen}
              defectsOpenCount={contract.defects?.filter((d) => d.status !== "CLOSED").length}
            />
          ) : undefined
        }
        action={
          canWrite && state !== "offline" ? (
            <button type="button" onClick={() => onSelect("new")} className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k">
              {t("buttons.add")}
            </button>
          ) : undefined
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {(state === "default" || state === "offline") && (
        <p className="num mb-s-3 text-fs-14 text-k-text">{t("screens.s07b.summary", { open: openCount, breached: breachedCount })}</p>
      )}

      <Table<Rfi>
        tableId="s07b-rfis"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        captionKey="screens.s07b.caption"
        state={tableState}
        onExport={() => undefined}
        onRowOpen={(row) => onSelect(row.id)}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s07b.empty", actionLabelKey: "buttons.add", onAction: canWrite ? () => onSelect("new") : undefined }}
      />

      {sheetOpen && (
        <RfiSheet
          open
          rfi={selectedRfi}
          canWrite={canWrite}
          saving={sheetSaving}
          apiError={sheetApiError}
          onClose={() => onSelect(null)}
          onCreate={onCreate}
          onAnswer={onAnswer}
          onCloseRfi={onCloseRfi}
        />
      )}
    </>
  );
}
