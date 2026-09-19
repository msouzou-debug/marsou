import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CloseoutChecklist as CloseoutChecklistValue } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { CloseoutChecklist } from "./CloseoutChecklist";

const EMPTY: CloseoutChecklistValue = {
  barriersRemoved: false,
  areaCleaned: false,
  airBalanceRestored: false,
  systemsTestedAndReturned: false,
  fireSystemsReenabled: false,
  noteEl: null,
  clinicalAcceptanceById: null,
  clinicalAcceptanceByName: null,
  clinicalAcceptanceAt: null,
};

describe("CloseoutChecklist", () => {
  it("renders the five boxes plus the clinical acceptance checkbox", () => {
    renderWithIntl(
      <CloseoutChecklist value={EMPTY} onChange={vi.fn()} isClinicalOwner approverName="Μ. Ιωάννου" approverId="u1" />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  it("disables the clinical-acceptance checkbox for a non-clinical-owner caller", () => {
    renderWithIntl(
      <CloseoutChecklist value={EMPTY} onChange={vi.fn()} isClinicalOwner={false} approverName="" approverId="" />,
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[boxes.length - 1]).toBeDisabled();
  });

  it("signs with the approver's own id and name when a clinical owner ticks it", async () => {
    const onChange = vi.fn();
    renderWithIntl(
      <CloseoutChecklist value={EMPTY} onChange={onChange} isClinicalOwner approverName="Μ. Ιωάννου" approverId="u1" />,
    );
    const boxes = screen.getAllByRole("checkbox");
    await userEvent.click(boxes[boxes.length - 1]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ clinicalAcceptanceById: "u1", clinicalAcceptanceByName: "Μ. Ιωάννου" }),
    );
  });
});
