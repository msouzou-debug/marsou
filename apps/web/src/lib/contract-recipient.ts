import type { ContractDetail } from "@ecapital/shared";

/** The contract and its project, as an RFI's or an instruction's message names them. */
export interface ContractMailFacts {
  contractNo: string;
  contractorName?: string | null;
  projectCode?: string | null;
  projectTitle?: string | null;
}

export function contractFactsOf(contract: ContractDetail): ContractMailFacts {
  return {
    contractNo: contract.contractNo,
    contractorName: contract.contractorName,
    projectCode: contract.project?.code,
    projectTitle: contract.project?.titleEl,
  };
}

/**
 * Owner UAT 25/11/2026: a new RFI's recipient starts from the contract's
 * contractor contact, and stays editable; owner request 26/11/2026: a new
 * site instruction's too. «Person, Contractor» when there is a person; the
 * contractor's name alone when there is only an address. Undefined when the
 * contractor has neither.
 */
export function recipientDefaultsOf(contract: ContractDetail | undefined): { name: string; email: string } | undefined {
  const contractor = contract?.contractor;
  if (!contractor || !(contractor.contactName || contractor.contactEmail)) return undefined;
  return {
    name: contractor.contactName ? `${contractor.contactName}, ${contractor.name}` : contractor.name,
    email: contractor.contactEmail ?? "",
  };
}
