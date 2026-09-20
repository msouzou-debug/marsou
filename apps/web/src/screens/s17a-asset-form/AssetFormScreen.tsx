"use client";

// S17a — R26–R30, R45
//
// AssetFormScreen — the network-aware wrapper around `AssetForm`. The only
// place that calls `apiMutate` for an asset create or edit, the same split
// `s02a-project-form/ProjectFormScreen.tsx` documents.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Asset, type OrgUnit } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { AssetForm, type AssetFormSubmitValues } from "./AssetForm";
import type { AssetFormValues } from "./schema";

export interface AssetFormScreenProps {
  mode: "create" | "edit";
  orgUnits: OrgUnit[];
  defaultOrgUnitId?: string;
  assetId?: string;
  editOrgUnitId?: string;
  initialValues?: AssetFormValues;
  initialParentTag?: string;
  initialSourceProjectLabel?: string;
  initialSourceContractLabel?: string;
  readOnly: boolean;
}

export function AssetFormScreen({
  mode,
  orgUnits,
  defaultOrgUnitId,
  assetId,
  editOrgUnitId,
  initialValues,
  initialParentTag,
  initialSourceProjectLabel,
  initialSourceContractLabel,
  readOnly,
}: AssetFormScreenProps) {
  const t = useTranslations();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  async function handleSubmit(values: AssetFormSubmitValues) {
    setSubmitting(true);
    setApiError(undefined);
    try {
      const asset =
        mode === "create"
          ? await apiMutate("/assets", "POST", values, Asset)
          : await apiMutate(`/assets/${encodeURIComponent(assetId ?? "")}`, "PATCH", { ...values, orgUnitId: undefined }, Asset);
      router.push(`/assets/${encodeURIComponent(asset.id)}`);
      return;
    } catch (error) {
      setApiError(error instanceof ApiError ? error.message : t("states.error.generic"));
    }
    setSubmitting(false);
  }

  function handleCancel() {
    router.push(mode === "edit" && assetId ? `/assets/${encodeURIComponent(assetId)}` : "/assets");
  }

  return (
    <AssetForm
      mode={mode}
      orgUnits={orgUnits}
      defaultOrgUnitId={defaultOrgUnitId}
      editOrgUnitId={editOrgUnitId}
      initialValues={initialValues}
      initialParentTag={initialParentTag}
      initialSourceProjectLabel={initialSourceProjectLabel}
      initialSourceContractLabel={initialSourceContractLabel}
      readOnly={readOnly}
      submitting={submitting}
      apiError={apiError}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
}
