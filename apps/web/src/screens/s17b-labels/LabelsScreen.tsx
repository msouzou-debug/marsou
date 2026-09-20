"use client";

// S17b — R26–R30, R45 (M4 build brief item 4)
//
/**
 * LabelsScreen — `/assets/labels?ids=…`, under `(bare)` like S13's own print
 * route: no shell, a big «Εκτύπωση» button hidden in print, the sheet itself
 * built from `LabelSheet` (`@/components/label-sheet`).
 */
import { useTranslations } from "next-intl";
import { useAssetLabels } from "@/data/queries";
import { LabelSheet, type LabelSheetState } from "@/components/label-sheet";

export interface LabelsScreenProps {
  ids: string[];
}

export function LabelsScreen({ ids }: LabelsScreenProps) {
  const t = useTranslations();
  const { data, error, isLoading, refetch } = useAssetLabels(ids);

  let state: LabelSheetState;
  if (isLoading) state = "loading";
  else if (error) state = "error";
  else if (!data || data.length === 0) state = "empty";
  else state = "default";

  return (
    <div className="flex flex-col items-center gap-s-5 bg-k-surface p-s-6 print:bg-k-white print:p-0">
      <button
        type="button"
        onClick={() => window.print()}
        disabled={state !== "default"}
        className="rounded-k bg-k-blue px-s-5 py-s-3 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60 print:hidden"
      >
        {t("buttons.print")}
      </button>
      <div className="w-full max-w-[210mm]">
        <LabelSheet labels={data} state={state} onRetry={() => void refetch()} />
      </div>
    </div>
  );
}
