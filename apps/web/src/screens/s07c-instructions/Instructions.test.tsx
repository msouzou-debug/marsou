import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildInstructions } from "./fixture";
import { Instructions } from "./Instructions";

const noPermission = <div>no permission</div>;
const instructions = buildInstructions();

const contractWithVariation = buildContractDetail({
  variations: [
    {
      id: "variation-linked-1",
      contractId: "contract-1",
      number: 4,
      descriptionEl: "x",
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
});

describe("Instructions — R09, ADR-0017", () => {
  it("shows no create-variation button for an instruction without cost impact", () => {
    renderWithIntl(
      <Instructions contract={contractWithVariation} instructions={instructions} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    const noCostImpactRow = instructions.find((i) => !i.costImpactFlag)!;
    const row = screen.getByText(noCostImpactRow.textEl).closest("tr")!;
    expect(row.querySelector("button")).toBeNull();
  });

  it("shows the create-variation button for a cost-impact instruction with no variation yet", () => {
    renderWithIntl(
      <Instructions contract={contractWithVariation} instructions={instructions} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    const unlinkedRow = instructions.find((i) => i.costImpactFlag && !i.variationId)!;
    const row = screen.getByText(unlinkedRow.textEl).closest("tr")!;
    expect(row.querySelector("button")).not.toBeNull();
    expect(row.textContent).toContain("Δημιουργία τροποποίησης");
  });

  it("shows the link to the variation for a linked instruction, not the create button", () => {
    renderWithIntl(
      <Instructions contract={contractWithVariation} instructions={instructions} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    const linkedRow = instructions.find((i) => i.variationId)!;
    const row = screen.getByText(linkedRow.textEl).closest("tr")!;
    expect(row.querySelector("a")).not.toBeNull();
    expect(row.textContent).toContain("Τροποποίηση 4");
    expect(row.querySelector("button")).toBeNull();
  });

  it("shows the amber strip when the contract carries the instructionsWithoutVariation warning", () => {
    const withWarning = buildContractDetail({
      warnings: [
        { key: "instructionsWithoutVariation", sentenceEl: "Προσοχή στις οδηγίες.", sentenceEn: "Watch the instructions.", amount: null },
      ],
    });
    renderWithIntl(
      <Instructions contract={withWarning} instructions={instructions} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    expect(screen.getByText("Προσοχή στις οδηγίες.")).toBeInTheDocument();
  });

  it("hides «Προσθήκη» for a role that cannot write the log", () => {
    renderWithIntl(
      <Instructions contract={contractWithVariation} instructions={instructions} state="default" noPermission={noPermission} roles={["technician"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Προσθήκη" })).not.toBeInTheDocument();
  });
});
