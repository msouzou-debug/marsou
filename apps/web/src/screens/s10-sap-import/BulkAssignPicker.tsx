"use client";

// S10 — R14
//
/**
 * BulkAssignPicker — the compact picker `Shift+A` opens for the selected
 * transactions: a project search, then (once a project is chosen) an
 * optional contract select (build brief §5 S10: "a compact picker … not a
 * full dialog"). Purely presentational — like `ContractsCard`'s own header
 * comment explains for the same reason, this never calls `useQuery` itself,
 * so `UnmatchedQueue.test.tsx` can render it without a `QueryClientProvider`;
 * `UnmatchedQueueScreen` runs `useProjects`/`useProjectContracts` and hands
 * the results down as plain props.
 *
 * | Prop            | Type                                    | Notes                                   |
 * |-----------------|-----------------------------------------|---------------------------------------------|
 * | open            | boolean                                 |                                              |
 * | selectedCount   | number                                  | Shown in the title.                          |
 * | search          | string                                  |                                              |
 * | onSearchChange  | (value: string) => void                 |                                              |
 * | projectResults  | Array<{id, code, titleEl}>              |                                              |
 * | projectId       | string \| null                          | The chosen project, or `null` (search view). |
 * | onSelectProject | (id: string \| null) => void            |                                              |
 * | contractOptions | Array<{id, ref, contractNo}>            | The chosen project's own contracts.          |
 * | contractId      | string \| null                          |                                              |
 * | onSelectContract| (id: string \| null) => void            |                                              |
 * | assigning       | boolean                                 |                                              |
 * | apiError        | string?                                 |                                              |
 * | onAssign        | (projectId, contractId \| null) => void |                                              |
 * | onClose         | () => void                              |                                              |
 */
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";

export interface BulkAssignProjectOption {
  id: string;
  code: string;
  titleEl: string;
}

export interface BulkAssignContractOption {
  id: string;
  ref: string;
  contractNo: string;
}

export interface BulkAssignPickerProps {
  open: boolean;
  selectedCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  projectResults: BulkAssignProjectOption[];
  projectId: string | null;
  onSelectProject: (id: string | null) => void;
  contractOptions: BulkAssignContractOption[];
  contractId: string | null;
  onSelectContract: (id: string | null) => void;
  assigning?: boolean;
  apiError?: string;
  onAssign: (projectId: string, contractId: string | null) => void;
  onClose: () => void;
}

export function BulkAssignPicker({
  open,
  selectedCount,
  search,
  onSearchChange,
  projectResults,
  projectId,
  onSelectProject,
  contractOptions,
  contractId,
  onSelectContract,
  assigning = false,
  apiError,
  onAssign,
  onClose,
}: BulkAssignPickerProps) {
  const t = useTranslations();

  if (!open) return null;

  const selectedProject = projectResults.find((p) => p.id === projectId);

  return (
    <div
      role="dialog"
      aria-label={t("screens.s10.queue.bulkAssignTitle")}
      className="fixed inset-x-0 bottom-0 z-30 rounded-t-k border border-k-grey bg-k-white p-s-4 shadow-k tablet:inset-x-auto tablet:bottom-auto tablet:right-s-4 tablet:top-1/4 tablet:w-[360px] tablet:rounded-k"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-fs-16 font-bold text-k-ink">
          {t("screens.s10.queue.bulkAssignTitle")} ({selectedCount})
        </h2>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-k p-s-1 text-k-text hover:bg-k-surface">
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      {!projectId ? (
        <div className="mt-s-3">
          <label htmlFor="bulk-assign-search" className="text-fs-12 text-k-text">
            {t("screens.s10.queue.bulkAssignProject")}
          </label>
          <input
            id="bulk-assign-search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("screens.s10.queue.bulkAssignSearchPlaceholder")}
            className="mt-s-1 h-11 w-full rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
          />
          <ul className="mt-s-2 max-h-[240px] overflow-auto">
            {projectResults.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => onSelectProject(project.id)}
                  className="flex w-full flex-col items-start rounded-k px-s-2 py-s-2 text-left text-fs-14 hover:bg-k-surface"
                >
                  <span className="font-bold text-k-ink">{project.code}</span>
                  <span className="text-k-text">{project.titleEl}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-s-3">
          <p className="text-fs-14 text-k-ink">{selectedProject?.code ?? projectId}</p>
          <button type="button" onClick={() => onSelectProject(null)} className="text-fs-12 text-k-blue-deep underline-offset-2 hover:underline">
            {t("buttons.cancel")}
          </button>

          <label htmlFor="bulk-assign-contract" className="mt-s-3 block text-fs-12 text-k-text">
            {t("screens.s10.queue.bulkAssignContract")}
          </label>
          <select
            id="bulk-assign-contract"
            value={contractId ?? ""}
            onChange={(e) => onSelectContract(e.target.value === "" ? null : e.target.value)}
            className="mt-s-1 h-11 w-full rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          >
            <option value="">{t("common.notAvailable")}</option>
            {contractOptions.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.ref} — {contract.contractNo}
              </option>
            ))}
          </select>

          {apiError && (
            <p role="alert" className="mt-s-3 text-fs-14 text-k-red">
              {apiError}
            </p>
          )}

          <button
            type="button"
            onClick={() => onAssign(projectId, contractId)}
            disabled={assigning}
            className="mt-s-4 flex h-11 w-full items-center justify-center gap-s-2 rounded-k bg-k-blue text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {assigning && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("buttons.save")}
          </button>
        </div>
      )}
    </div>
  );
}
