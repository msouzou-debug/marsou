"use client";

// S07a — R08
//
/**
 * ContractFormScreen — the network-aware wrapper around `ContractForm` (same
 * Screen/pure split as every other screen). The only place that calls
 * `apiMutate` for a contract create or edit.
 *
 * `mode: "create"` posts to `POST /projects/:id/contracts` and lands on the
 * new contract's own page (`/contracts/<id>`) — the id the API allocates.
 * `mode: "edit"` patches `PATCH /contracts/:id` and returns to the same
 * contract's overview.
 *
 * | Prop                  | Type                | Notes                                            |
 * |-----------------------|---------------------|---------------------------------------------------|
 * | mode                  | "create" \| "edit"  |                                                     |
 * | projectId             | string?             | Required in "create" — the project this contract belongs to. |
 * | contractId            | string?             | Required in "edit" — the id being patched.         |
 * | contractors           | Contractor[]        | Required in "create" — the register for the Ανάδοχος select. |
 * | initialValues         | ContractFormValues? | Required in "edit"; prefills the form.             |
 * | initialContractorName | string?             | "edit" only — the read-only Ανάδοχος fact.         |
 * | initialOriginalValue  | number?             | "edit" only — the read-only Αρχική αξία fact.      |
 *
 * ADR-0025: `values.budgetCode` arrives from the form as `""` (unpicked, or
 * cleared) or a code; this file is what turns `""` into `null` before either
 * request goes out, the same job it already does nowhere else because every
 * other nullable field on this form is a text input that is `null` from
 * `blankToNull` well before `handleSubmit` sees it.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ContractDetail, type Contractor } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useBudgetCodes } from "@/data/queries";
import { ContractForm } from "./ContractForm";
import type { ContractCreateFormValues, ContractFormValues } from "./schema";

export interface ContractFormScreenProps {
  mode: "create" | "edit";
  projectId?: string;
  contractId?: string;
  contractors?: Contractor[];
  initialValues?: ContractFormValues;
  initialContractorName?: string;
  initialOriginalValue?: number;
}

export function ContractFormScreen({
  mode,
  projectId,
  contractId,
  contractors = [],
  initialValues,
  initialContractorName,
  initialOriginalValue,
}: ContractFormScreenProps) {
  const t = useTranslations();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);
  // ADR-0025: fed by its own query rather than a server-fetched prop, unlike
  // `contractors` above — the register is short and worth caching for the
  // whole session (`useBudgetCodes`'s own `staleTime`), and both S07a routes
  // (create and edit) need it equally.
  const budgetCodesQuery = useBudgetCodes();

  async function handleSubmit(values: ContractCreateFormValues) {
    setSubmitting(true);
    setApiError(undefined);
    // ADR-0025: "" is the form's own "nothing picked / cleared" value; the
    // API's `budgetCode` is `string | null`.
    const budgetCode = values.budgetCode.trim() === "" ? null : values.budgetCode;
    try {
      const contract =
        mode === "create"
          ? await apiMutate(
              `/projects/${encodeURIComponent(projectId ?? "")}/contracts`,
              "POST",
              { ...values, budgetCode, projectId },
              ContractDetail,
            )
          : await apiMutate(
              `/contracts/${encodeURIComponent(contractId ?? "")}`,
              "PATCH",
              // `contractorId`/`originalValue` never reach `PATCH` — see
              // `schema.ts`'s header comment for why they cannot change.
              { ...values, budgetCode, contractorId: undefined, originalValue: undefined },
              ContractDetail,
            );
      router.push(`/contracts/${encodeURIComponent(contract.id)}`);
      return;
    } catch (error) {
      // Every failure the API can send here already carries its own sentence
      // (422 errors.contractorBlacklisted / errors.projectNotAwarded, 403 for
      // a role that cannot write contracts, a network failure) — the general
      // strip, same as S02a's own form.
      if (error instanceof ApiError) {
        setApiError(error.message);
      } else {
        setApiError(t("states.error.generic"));
      }
    }
    setSubmitting(false);
  }

  function handleCancel() {
    if (mode === "edit" && contractId) router.push(`/contracts/${encodeURIComponent(contractId)}`);
    else if (projectId) router.push(`/projects/${encodeURIComponent(projectId)}`);
    else router.push("/projects");
  }

  return (
    <ContractForm
      mode={mode}
      contractors={contractors}
      budgetCodes={budgetCodesQuery.data ?? []}
      initialValues={initialValues}
      initialContractorName={initialContractorName}
      initialOriginalValue={initialOriginalValue}
      submitting={submitting}
      apiError={apiError}
      onSubmit={(values) => void handleSubmit(values)}
      onCancel={handleCancel}
    />
  );
}
