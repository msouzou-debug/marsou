// S07e — R08, ADR-0019

// Server Component glue (ADR-0004, same pattern as `Projects.preview.tsx`):
// resolves the shell's `NoPermission` once and hands the element down to the
// pure screen, which needs nothing else from the network.

import type { Contract } from "@ecapital/shared";
import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { buildContractDetail } from "@/screens/s07-contract/fixture";
import { Contracts } from "./Contracts";

const noPermission = <NoPermission />;

function row(ref: string, contractNo: string, contractorName: string, value: number): Contract {
  const { project, contractor, boq, variations, warnings, ...rest } = buildContractDetail();
  void project;
  void contractor;
  void boq;
  void variations;
  void warnings;
  return { ...rest, id: ref, ref, contractNo, contractorName, currentValue: value } as Contract;
}

const items = [
  row("CAP-2026-0031", "ΤΥ/2026/031", "Κυριάκου Τεχνικές Κατασκευές Λτδ", 2_400_000),
  row("CAP-2026-0018", "ΤΥ/2026/018", "Αδελφοί Χαραλάμπους Λτδ", 860_000),
  row("CAP-2025-0104", "CON-2025-0104", "Meditek Βιοϊατρικός Εξοπλισμός Λτδ", 415_000),
];

const entry: PreviewEntry = {
  id: "s07e-contracts",
  title: "S07e Συμβάσεις",
  states: {
    default: () => <Contracts items={items} state="default" noPermission={noPermission} />,
    loading: () => <Contracts state="loading" noPermission={noPermission} />,
    empty: () => <Contracts items={[]} state="empty" q="CAP-2026-9999" noPermission={noPermission} />,
    error: () => <Contracts state="error" noPermission={noPermission} />,
    noPermission: () => <Contracts state="noPermission" noPermission={noPermission} />,
  },
  notes:
    "Three obviously fake contracts. The third carries an eMAP reference as its contract number, " +
    "which is what the older records on the real register look like (ADR-0019). \"empty\" is the " +
    "search case — the sentence names the term — rather than the register being genuinely empty; " +
    "the screen says something different for that. \"offline\" is skipped: the register has no " +
    "cached-and-still-usable state of its own, so a failure to reach the API is the error state, " +
    "and \"submitting\" does not apply because nothing here writes.",
};

export default entry;
