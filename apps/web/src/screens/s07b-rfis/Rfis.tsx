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
 * | roles        | AppRole[]           | `canWriteRfis(roles)` — the «Προσθήκη», «Απάντηση», «Κλείσιμο αιτήματος» and «Επεξεργασία» gate; offline, none of them. |
 * | now          | Date?               | Injectable "now" for `SlaChip`'s tests and preview.                 |
 * | selectedId / onSelect / sheetSaving / sheetApiError / onCreate / onAnswer / onCloseRfi / onUpdate / onRetry | — | Wired by `RfisScreen`. |
 * | documents / onUpload / uploading / uploadError | — | The selected RFI's correspondence and its upload, wired by `RfisScreen`. |
 *
 * A row opens the sheet's read view on a click or on Enter (UAT 25/11/2026).
 * A new RFI's recipient starts from the contract's contractor's contact
 * (owner UAT 25/11/2026), and stays editable.
 * «Παραλήπτης» and «Αποστολή» are columns (owner decision 25/11/2026: the
 * RFI is sent from Outlook, and the table says to whom and when).
 *
 * RULE (ADR-0017): a breach is a state, never a block — nothing here checks
 * `slaState` before allowing an answer or a close.
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AppRole, ContractDetail, Rfi, RfiDocument } from "@ecapital/shared";
import { canWriteRfis } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { SlaChip } from "@/components/sla-chip";
import { Table, type TableColumn } from "@/components/table";
import { formatDate } from "@/lib/format";
import { ContractTabs } from "@/screens/s07-contract/ContractTabs";
import type { RfiAnswerFormValues, RfiEditFormValues, RfiFormValues } from "./schema";
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
  /** `POST .../answer`; resolves true once saved (owner, UAT 25/11/2026). */
  onAnswer: (values: RfiAnswerFormValues) => Promise<boolean> | void;
  /** `POST .../close` with the closing note; resolves true once closed. */
  onCloseRfi: (closingNote: string) => Promise<boolean> | void;
  /** UAT 25/11/2026: `PATCH .../rfis/:rid`; resolves true once saved. Omitted (or offline), no «Επεξεργασία». */
  onUpdate?: (values: RfiEditFormValues) => Promise<boolean>;
  /** The open RFI's correspondence; undefined while it loads. */
  documents?: RfiDocument[];
  /** `POST .../rfis/:rid/documents`; resolves true once filed. Omitted (or offline), no upload form. */
  onUpload?: (file: File, titleEl: string) => Promise<boolean>;
  uploading?: boolean;
  uploadError?: string;
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
  onUpdate,
  documents,
  onUpload,
  uploading = false,
  uploadError,
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
    {
      id: "recipient",
      headerKey: "screens.s07b.columns.recipient",
      accessor: (row) => row.recipientName ?? "",
      cell: (row) => row.recipientName ?? t("common.notAvailable"),
    },
    {
      id: "sentOn",
      headerKey: "screens.s07b.columns.sentOn",
      accessor: (row) => row.sentOn ?? "",
      numeric: true,
      cell: (row) => (row.sentOn ? formatDate(row.sentOn) : t("common.notAvailable")),
    },
    { id: "raisedBy", headerKey: "screens.s07b.columns.raisedBy", accessor: (row) => row.raisedByName },
    { id: "raisedAt", headerKey: "screens.s07b.columns.raisedAt", accessor: (row) => row.raisedAt, numeric: true, cell: (row) => formatDate(row.raisedAt) },
    {
      id: "due",
      headerKey: "screens.s07b.columns.due",
      accessor: (row) => row.slaDueAt,
      numeric: true,
      // RULE (ADR-0017): the clock stops at the answer — once ANSWERED or
      // CLOSED, the chip is replaced by the day the answer arrived in mono
      // (owner UAT 25/11/2026), or by the day it was closed when it closed
      // unanswered, never a chip drifting toward BREACHED for paperwork alone.
      cell: (row) => {
        if (row.status === "OPEN") return <SlaChip dueAt={row.slaDueAt} totalHours={row.slaHours} />;
        const stopped = row.answeredOn ?? row.answeredAt ?? row.closedAt;
        return <span className="num text-k-ink">{stopped ? formatDate(stopped) : t("common.notAvailable")}</span>;
      },
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
  // Owner UAT 25/11/2026: the contractor's contact, for the new form only.
  const contractorContact = contract?.contractor;
  const recipientDefaults =
    contractorContact && (contractorContact.contactName || contractorContact.contactEmail)
      ? {
          name: contractorContact.contactName
            ? `${contractorContact.contactName}, ${contractorContact.name}`
            : contractorContact.name,
          email: contractorContact.contactEmail ?? "",
        }
      : undefined;

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
        onRowOpen={(row) => onSelect(row.id)}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s07b.empty", actionLabelKey: "buttons.add", onAction: canWrite ? () => onSelect("new") : undefined }}
      />

      {sheetOpen && (
        <RfiSheet
          key={selectedId}
          open
          rfi={selectedRfi}
          canWrite={canWrite && state !== "offline"}
          saving={sheetSaving}
          apiError={sheetApiError}
          onClose={() => onSelect(null)}
          onCreate={onCreate}
          onAnswer={onAnswer}
          onCloseRfi={onCloseRfi}
          onUpdate={state === "offline" ? undefined : onUpdate}
          documents={documents}
          onUpload={state === "offline" ? undefined : onUpload}
          uploading={uploading}
          uploadError={uploadError}
          recipientDefaults={recipientDefaults}
        />
      )}
    </>
  );
}
