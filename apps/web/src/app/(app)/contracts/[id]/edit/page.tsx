// S07a — R08

import { ContractDetail } from "@ecapital/shared";
import { NoPermission } from "@/components/app-shell";
import { serverApi } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { ContractFormScreen } from "@/screens/s07a-contract-form/ContractFormScreen";
import type { ContractFormValues } from "@/screens/s07a-contract-form/schema";

function toFormValues(contract: ContractDetail): ContractFormValues {
  return {
    contractNo: contract.contractNo,
    type: contract.type,
    awardDate: contract.awardDate,
    startDate: contract.startDate,
    completionDate: contract.completionDate,
    retentionPct: contract.retentionPct,
    performanceBondValue: contract.performanceBondValue,
    bondExpiry: contract.bondExpiry,
    liquidatedDamagesPerDay: contract.liquidatedDamagesPerDay,
    defectsLiabilityMonths: contract.defectsLiabilityMonths,
    sapPoNumber: contract.sapPoNumber,
  };
}

// Server Component: fetches the contract server-side so the form opens
// already filled in, same pattern as S02a's edit page. RULE (ADR-0010): the
// API's 404 covers "no such contract" and "not yours" alike; this route
// does not try to tell them apart, same `NoPermission` either way.
export default async function EditContractPage({ params }: PageProps<"/contracts/[id]/edit">) {
  const { id } = await params;
  const api = await serverApi();
  const contract = api ? await api.get(`/contracts/${encodeURIComponent(id)}`, ContractDetail).catch(() => null) : null;

  if (!contract) return <NoPermission />;

  return (
    <>
      <ContractFormScreen
        mode="edit"
        contractId={contract.id}
        initialValues={toFormValues(contract)}
        initialContractorName={contract.contractorName}
        initialOriginalValue={contract.originalValue}
      />
      <HelpSection route="/contracts/[id]/edit" />
    </>
  );
}
