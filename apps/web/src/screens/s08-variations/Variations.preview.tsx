// S08 — R10 (ADR-0015)

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { buildContractDetail } from "../s07-contract/fixture";
import { Variations } from "./Variations";
import { buildVariation } from "./fixture";

const noPermission = <NoPermission />;

const data = buildContractDetail({
  variations: [
    buildVariation({ id: "v1", number: 1, status: "APPROVED", decidedByName: "Μαρία Κωνσταντίνου", decidedAt: "2026-03-05T09:00:00.000Z" }),
    buildVariation({ id: "v2", number: 2, status: "SUBMITTED", value: 30_000, decisionCommentEl: null }),
    buildVariation({ id: "v3", number: 3, status: "RETURNED", value: -8_000, decisionCommentEl: "Στείλτε αναλυτική προμέτρηση." }),
    buildVariation({ id: "v4", number: 4, status: "REJECTED", decisionCommentEl: "Καλύπτεται από άλλη σύμβαση." }),
  ],
});

const noop = () => undefined;

const entry: PreviewEntry = {
  id: "s08-variations",
  title: "S08 Τροποποιήσεις σύμβασης",
  states: {
    default: () => (
      <Variations
        data={data}
        state="default"
        noPermission={noPermission}
        roles={["estates_head"]}
        meName="user-admin"
        onSelect={noop}
        onSave={noop}
        onSubmit={noop}
        onDecide={noop}
      />
    ),
    loading: () => <Variations state="loading" noPermission={noPermission} onSelect={noop} onSave={noop} onSubmit={noop} onDecide={noop} />,
    empty: () => (
      <Variations
        data={buildContractDetail({ variations: [] })}
        state="empty"
        noPermission={noPermission}
        roles={["project_engineer"]}
        onSelect={noop}
        onSave={noop}
        onSubmit={noop}
        onDecide={noop}
      />
    ),
    error: () => (
      <Variations state="error" noPermission={noPermission} onSelect={noop} onSave={noop} onSubmit={noop} onDecide={noop} onRetry={noop} />
    ),
    noPermission: () => (
      <Variations state="noPermission" noPermission={noPermission} onSelect={noop} onSave={noop} onSubmit={noop} onDecide={noop} />
    ),
  },
  notes:
    "One row per status: APPROVED, SUBMITTED (bold, inbox-style), RETURNED with its comment and REJECTED " +
    "(final). Row-open opens VariationSheet — not previewed here as its own gallery entry since its five " +
    "branches (new/edit/decide/awaiting/final) are covered by VariationSheet.test.tsx instead.",
};

export default entry;
