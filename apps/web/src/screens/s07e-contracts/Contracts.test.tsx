import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Contract } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { Contracts } from "./Contracts";
import { buildContractDetail } from "@/screens/s07-contract/fixture";

const noPermission = <div>no permission</div>;

function contract(overrides: Partial<Contract> = {}): Contract {
  const { project, contractor, boq, variations, warnings, ...rest } = buildContractDetail();
  void project;
  void contractor;
  void boq;
  void variations;
  void warnings;
  return { ...rest, ...overrides } as Contract;
}

describe("Contracts — ADR-0019's register", () => {
  it("shows the eCapital reference in mono, first on the row", () => {
    renderWithIntl(
      <Contracts items={[contract()]} state="default" noPermission={noPermission} />,
    );
    const ref = screen.getByText("CAP-2026-0031");
    expect(ref.className).toContain("num");
  });

  it("links each row through to the contract", () => {
    const one = contract();
    renderWithIntl(<Contracts items={[one]} state="default" noPermission={noPermission} />);
    expect(screen.getByRole("link", { name: one.contractorName })).toHaveAttribute(
      "href",
      `/contracts/${one.id}`,
    );
  });

  it("names the term that found nothing", () => {
    renderWithIntl(
      <Contracts items={[]} state="empty" q="CAP-2026-9999" noPermission={noPermission} />,
    );
    expect(screen.getByText("Καμία σύμβαση δεν ταιριάζει με «CAP-2026-9999».")).toBeInTheDocument();
  });

  it("says something different when there is nothing to list at all", () => {
    renderWithIntl(<Contracts items={[]} state="empty" noPermission={noPermission} />);
    expect(screen.getByText("Δεν υπάρχουν συμβάσεις στις μονάδες σας.")).toBeInTheDocument();
  });

  it("hands the typed term back to the screen, trimmed", async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(
      <Contracts items={[contract()]} state="default" onSearch={onSearch} noPermission={noPermission} />,
    );
    await user.type(screen.getByLabelText("Αναζήτηση σύμβασης"), "  CAP-2026-0031  ");
    await user.click(screen.getByRole("button", { name: "Αναζήτηση" }));
    expect(onSearch).toHaveBeenCalledWith("CAP-2026-0031");
  });

  it("draws the shell's own no-permission panel instead of an empty list", () => {
    renderWithIntl(<Contracts state="noPermission" noPermission={noPermission} />);
    expect(screen.getByText("no permission")).toBeInTheDocument();
    expect(screen.queryByTestId("contract-list")).not.toBeInTheDocument();
  });

  it("offers a retry when the list did not load", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<Contracts state="error" onRetry={onRetry} noPermission={noPermission} />);
    await user.click(screen.getByRole("button", { name: "Δοκιμάστε ξανά" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
