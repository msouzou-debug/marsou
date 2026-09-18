import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { PermitBanner } from "./PermitBanner";

const BASE = { validFrom: "2026-03-01T00:00:00Z", validTo: "2026-06-01T00:00:00Z", icraClass: "IV" as const };

describe("PermitBanner", () => {
  it("renders the state label, dates and ICRA class", () => {
    renderWithIntl(<PermitBanner {...BASE} state="inForce" />);
    expect(screen.getByText("Σε ισχύ")).toBeInTheDocument();
    expect(screen.getByText("01/03/2026 – 01/06/2026")).toBeInTheDocument();
    expect(screen.getByText("IV")).toBeInTheDocument();
    expect(screen.getByText("Εκτύπωση")).toBeInTheDocument();
  });

  it("never renders a dismiss control while the permit is in force", () => {
    const onDismiss = vi.fn();
    renderWithIntl(<PermitBanner {...BASE} state="inForce" onDismiss={onDismiss} />);
    expect(screen.queryByLabelText("Κλείσιμο")).toBeNull();
  });

  it.each(["pendingApproval", "expired", "revoked"] as const)(
    "renders a working dismiss control for state=%s when onDismiss is provided",
    async (state) => {
      const onDismiss = vi.fn();
      renderWithIntl(<PermitBanner {...BASE} state={state} onDismiss={onDismiss} />);
      const dismiss = screen.getByLabelText("Κλείσιμο");
      await userEvent.click(dismiss);
      expect(onDismiss).toHaveBeenCalledOnce();
    },
  );

  it("does not render a dismiss control when onDismiss is not provided, even off-state", () => {
    renderWithIntl(<PermitBanner {...BASE} state="expired" />);
    expect(screen.queryByLabelText("Κλείσιμο")).toBeNull();
  });

  it("calls onPrint when the print link is used", async () => {
    const onPrint = vi.fn();
    renderWithIntl(<PermitBanner {...BASE} state="inForce" onPrint={onPrint} />);
    await userEvent.click(screen.getByText("Εκτύπωση"));
    expect(onPrint).toHaveBeenCalledOnce();
  });
});
