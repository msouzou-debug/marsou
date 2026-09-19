// S07a — R08

import { z } from "zod";
import { Contractor } from "@ecapital/shared";
import { HelpSection } from "@/help/HelpSection";
import { serverApi } from "@/data/server";
import { ContractFormScreen } from "@/screens/s07a-contract-form/ContractFormScreen";

// Server Component: resolves the contractor register once, server-side, the
// same way S02a's own `new` page resolves the caller's org units — so the
// Ανάδοχος select opens already populated rather than the client re-fetching
// what a Server Component could get in the same request. A role that may
// not create a contract (`@/auth/roles`'s `canWriteContracts`) never sees a
// live link to this route from S03 (its «Προσθήκη» is hidden), but nothing
// here re-checks that: opening the URL directly still renders the form, and
// a submit gets the API's own 403 like any other write it refuses.
export default async function NewContractPage({ params }: PageProps<"/projects/[id]/contracts/new">) {
  const { id } = await params;
  const api = await serverApi();
  const contractors = api ? await api.get("/contractors", z.array(Contractor)).catch(() => []) : [];

  return (
    <>
      <ContractFormScreen mode="create" projectId={id} contractors={contractors} />
      <HelpSection route="/projects/[id]/contracts/new" />
    </>
  );
}
