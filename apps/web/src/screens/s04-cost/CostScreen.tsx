"use client";

// S04 — R13, R14, R16, R17, R31
//
/**
 * CostScreen — the network-aware wrapper around `Cost`. Owns `useProjectCost`
 * (the main query the screen's state comes from), a light `useProjectDetail`
 * call for the page header's title/code only (never blocks the cost data —
 * same reasoning `ContractOverviewScreen` gives `useConfigLinks`), and every
 * M2 write this screen offers: `PUT .../forecast-inputs`,
 * `POST .../warnings/:id/dismiss`, `GET .../cashflow` and `PUT .../budget-lines`.
 * The export button navigates the browser to the proxy's own export route —
 * the proxy forwards the upstream's `Content-Disposition`
 * (`src/app/api/proxy/[...path]/route.ts`), so a plain link/`window.open`
 * triggers the browser's normal download, the same way every other export
 * button in this app is a stub waiting on its API route.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, BudgetLine, CashflowRow, CostWarning, ForecastInputs, ProjectCost } from "@ecapital/shared";
import {
  BudgetLine as BudgetLineSchema,
  CostWarning as CostWarningSchema,
  ForecastInputs as ForecastInputsSchema,
} from "@ecapital/shared";
import { z } from "zod";
import { ApiError, apiMutate } from "@/data/client";
import { useBudgetLines, useCashflow, useProjectCost, useProjectDetail } from "@/data/queries";
import type { BudgetLineDraftRow } from "./BudgetLinesEditor";
import type { CashflowSectionState } from "./CashflowSection";
import { Cost, type CostScreenState } from "./Cost";
import type { ForecastInputsFormValues } from "./schema";

export interface CostScreenProps {
  projectId: string;
  roles: AppRole[];
  noPermission: ReactNode;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

function currentYearRange(): { from: string; to: string } {
  const year = new Date().getFullYear();
  return { from: `${year}-01`, to: `${year}-12` };
}

export function CostScreen({ projectId, roles, noPermission }: CostScreenProps) {
  const { data, error, isLoading, refetch } = useProjectCost(projectId);
  const project = useProjectDetail(projectId);
  const online = useOnlineStatus();

  const [dismissingWarningId, setDismissingWarningId] = useState<string | undefined>(undefined);
  const [forecastSaving, setForecastSaving] = useState(false);
  const [forecastApiError, setForecastApiError] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);

  const initialRange = currentYearRange();
  const [cashflowFrom, setCashflowFrom] = useState(initialRange.from);
  const [cashflowTo, setCashflowTo] = useState(initialRange.to);
  const cashflow = useCashflow(projectId, cashflowFrom, cashflowTo);

  const [budgetYear, setBudgetYear] = useState(() => new Date().getFullYear());
  const budgetLines = useBudgetLines(projectId);
  const [budgetLinesSaving, setBudgetLinesSaving] = useState(false);
  const [budgetLinesApiError, setBudgetLinesApiError] = useState<string | undefined>(undefined);

  let state: CostScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else {
    state = "default";
  }

  const cashflowState: CashflowSectionState = cashflow.isLoading
    ? "loading"
    : cashflow.error
      ? "error"
      : (cashflow.data ?? []).length === 0
        ? "empty"
        : "default";

  async function dismissWarning(warningId: string): Promise<void> {
    setDismissingWarningId(warningId);
    try {
      const updated = await apiMutate<CostWarning>(
        `/projects/${encodeURIComponent(projectId)}/cost/warnings/${encodeURIComponent(warningId)}/dismiss`,
        "POST",
        undefined,
        CostWarningSchema,
      );
      // RULE (R31): replace this one warning in the cached ProjectCost with
      // the API's own answer (carrying dismissedByName/dismissedAt) rather
      // than removing it — WarningStrip then swaps its line for the 12px
      // "Απορρίφθηκε από …" note instead of the warning simply vanishing.
      // A full refetch would work too but would also reorder/repage the
      // whole ProjectCost for a change that touches one warning.
      await refetch();
      void updated;
    } finally {
      setDismissingWarningId(undefined);
    }
  }

  async function saveForecastInputs(values: ForecastInputsFormValues): Promise<void> {
    setForecastSaving(true);
    setForecastApiError(undefined);
    try {
      const body: ForecastInputs = {
        contingency: values.contingency,
        pendingVariationWeight: values.pendingVariationWeight,
        contingencyNoteEl: values.contingencyNoteEl.trim() === "" ? null : values.contingencyNoteEl,
      };
      await apiMutate(
        `/projects/${encodeURIComponent(projectId)}/cost/forecast-inputs`,
        "PUT",
        body,
        ForecastInputsSchema,
      );
      // RULE (R16): saving recalculates the forecast — refetch the whole
      // ProjectCost so the table's own Πρόβλεψη/Απόκλιση columns and the
      // CostBar's forecast marker reflect the new inputs immediately.
      await refetch();
    } catch (submitError) {
      setForecastApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setForecastSaving(false);
    }
  }

  async function saveBudgetLines(rows: BudgetLineDraftRow[]): Promise<void> {
    setBudgetLinesSaving(true);
    setBudgetLinesApiError(undefined);
    try {
      // RULE: every field the row does not expose (id, orgUnitId, vintageId)
      // is carried over from the stored line unchanged — only category,
      // sapGl, lineType and amount are ever edited here. A brand new row
      // (`original: null`) gets an empty id, so the API allocates one, and a
      // fabricated vintage id: `packages/shared/cost.ts` documents
      // `vintageId` only as "a system vintage" and gives this screen no
      // write-specific shape to build one from, so this is a flagged
      // best-effort rather than something the contract settles.
      const others = (budgetLines.data ?? []).filter((l) => l.budgetYear !== budgetYear);
      const thisYear = rows.map((row) => ({
        id: row.original?.id ?? "",
        orgUnitId: row.original?.orgUnitId ?? project.data?.orgUnit.id ?? "",
        projectId: row.original?.projectId ?? projectId,
        vintageId: row.original?.vintageId ?? `${budgetYear}-manual`,
        lineType: row.lineType,
        budgetYear,
        category: row.category.trim() === "" ? null : row.category,
        sapGl: row.sapGl.trim() === "" ? null : row.sapGl,
        amount: Number(row.amount) || 0,
      }));
      await apiMutate(
        `/projects/${encodeURIComponent(projectId)}/budget-lines`,
        "PUT",
        [...others, ...thisYear],
        z.array(BudgetLineSchema),
      );
      await budgetLines.refetch();
      await refetch();
    } catch (submitError) {
      setBudgetLinesApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setBudgetLinesSaving(false);
    }
  }

  function exportCost(): void {
    setExporting(true);
    // A real navigation (not `fetch`): the proxy streams the upstream's
    // bytes and `Content-Disposition` straight through
    // (`src/app/api/proxy/[...path]/route.ts`), so the browser's own
    // download handling takes it from here — no client-side blob juggling.
    window.location.href = `/api/proxy/projects/${encodeURIComponent(projectId)}/cost/export`;
    window.setTimeout(() => setExporting(false), 1500);
  }

  return (
    <Cost
      data={data}
      projectTitle={project.data?.titleEl}
      projectCode={project.data?.code}
      projectId={projectId}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      onDismissWarning={(id) => void dismissWarning(id)}
      dismissingWarningId={dismissingWarningId}
      onSaveForecastInputs={(values) => void saveForecastInputs(values)}
      forecastSaving={forecastSaving}
      forecastApiError={forecastApiError}
      onExport={exportCost}
      exporting={exporting}
      cashflowRows={cashflow.data}
      cashflowState={cashflowState}
      cashflowFrom={cashflowFrom}
      cashflowTo={cashflowTo}
      onCashflowRangeChange={(from, to) => {
        setCashflowFrom(from);
        setCashflowTo(to);
      }}
      budgetLines={budgetLines.data}
      budgetYear={budgetYear}
      onBudgetYearChange={setBudgetYear}
      onSaveBudgetLines={(rows) => void saveBudgetLines(rows)}
      budgetLinesSaving={budgetLinesSaving}
      budgetLinesApiError={budgetLinesApiError}
    />
  );
}

// Re-exported so nothing else needs to know the exact schemas this screen
// touches, matching the pattern `ScheduleScreen` sets for its own re-exports.
export type { ProjectCost, CashflowRow, BudgetLine };
