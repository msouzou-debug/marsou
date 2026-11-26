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
  it("renders the five boxes and no acceptance checkbox (OWNER 26/11/2026)", () => {
    renderWithIntl(<CloseoutChecklist value={EMPTY} onChange={vi.fn()} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    expect(screen.getByText(/κλινικός υπεύθυνος/)).toBeInTheDocument();
  });

  it("reports each box the works side ticks", async () => {
    const onChange = vi.fn();
    renderWithIntl(<CloseoutChecklist value={EMPTY} onChange={onChange} />);
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ barriersRemoved: true }));
  });

  it("shows the submitted checklist read-only, with its note", () => {
    renderWithIntl(
      <CloseoutChecklist value={{ ...EMPTY, barriersRemoved: true, noteEl: "Καθαρό." }} onChange={vi.fn()} readOnly />,
    );
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Καθαρό.")).toBeInTheDocument();
  });
});
