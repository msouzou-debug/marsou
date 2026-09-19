"use client";

// S09 — R11

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PaymentCertCreate } from "@ecapital/shared";
import { PaymentCert as PaymentCertSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useContract } from "@/data/queries";
import { CertificateForm } from "./CertificateForm";
import type { CertificateFormValues } from "./schema";

export interface CertificateFormScreenProps {
  contractId: string;
}

export function CertificateFormScreen({ contractId }: CertificateFormScreenProps) {
  const router = useRouter();
  const contract = useContract(contractId);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  async function save(values: CertificateFormValues): Promise<void> {
    setSaving(true);
    setApiError(undefined);
    try {
      const body: PaymentCertCreate = {
        periodFrom: values.periodFrom,
        periodTo: values.periodTo,
        workDoneValue: values.workDoneValue,
        materialsOnSite: values.materialsOnSite,
      };
      const cert = await apiMutate(
        `/contracts/${encodeURIComponent(contractId)}/payment-certs`,
        "POST",
        body,
        PaymentCertSchema,
      );
      router.push(`/certificates/${encodeURIComponent(cert.id)}`);
    } catch (submitError) {
      setApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CertificateForm
      contractId={contractId}
      contractNo={contract.data?.contractNo}
      saving={saving}
      apiError={apiError}
      onSave={(values) => void save(values)}
      onCancel={() => router.push(`/contracts/${encodeURIComponent(contractId)}/certificates`)}
    />
  );
}
