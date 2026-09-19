// S07c — R09

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildInstructions } from "./fixture";
import { Instructions } from "./Instructions";

const noPermission = <NoPermission />;
const instructions = buildInstructions();
const contract = buildContractDetail({
  variations: [
    {
      id: "variation-linked-1",
      contractId: "contract-1",
      number: 4,
      descriptionEl: "Μετατοπίστε τον ηλεκτρικό πίνακα μακριά από την είσοδο πλυντηρίου.",
      reason: "CLIENT_CHANGE",
      value: 0,
      timeImpactDays: 0,
      status: "DRAFT",
      raisedById: "user-engineer",
      raisedByName: "Ελένη Χριστοδούλου",
      raisedAt: "2026-07-10T09:00:00.000Z",
      decidedById: null,
      decidedByName: null,
      decidedAt: null,
      decisionCommentEl: null,
    },
  ],
  warnings: [
    {
      key: "instructionsWithoutVariation",
      sentenceEl: "Η σύμβαση ΤΥ/2026/031 έχει 1 οδηγία εργοταξίου με οικονομική επίπτωση χωρίς τροποποίηση.",
      sentenceEn: "Contract ΤΥ/2026/031 has 1 cost-impact site instruction with no variation.",
      amount: null,
    },
  ],
});
const noop = () => undefined;

const entry: PreviewEntry = {
  id: "s07c-instructions",
  title: "S07c Οδηγίες εργοταξίου",
  states: {
    default: () => (
      <Instructions
        contract={contract}
        instructions={instructions}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        onSelect={noop}
        onCreate={noop}
        onCreateVariation={noop}
      />
    ),
    loading: () => <Instructions state="loading" noPermission={noPermission} onSelect={noop} onCreate={noop} onCreateVariation={noop} />,
    empty: () => (
      <Instructions contract={contract} instructions={[]} state="empty" noPermission={noPermission} roles={["project_engineer"]} onSelect={noop} onCreate={noop} onCreateVariation={noop} />
    ),
    error: () => <Instructions state="error" noPermission={noPermission} onSelect={noop} onCreate={noop} onCreateVariation={noop} onRetry={noop} />,
    noPermission: () => <Instructions state="noPermission" noPermission={noPermission} onSelect={noop} onCreate={noop} onCreateVariation={noop} />,
    offline: () => (
      <Instructions
        contract={contract}
        instructions={instructions}
        state="offline"
        noPermission={noPermission}
        roles={["project_engineer"]}
        onSelect={noop}
        onCreate={noop}
        onCreateVariation={noop}
      />
    ),
  },
  notes:
    "One instruction with no cost impact (no button), one with cost impact and no variation yet (the " +
    "«Δημιουργία τροποποίησης» button — ADR-0017: only with cost impact) and one already linked (the link " +
    "to Τροποποίηση 4). The amber strip fires from the contract's own instructionsWithoutVariation warning.",
};

export default entry;
