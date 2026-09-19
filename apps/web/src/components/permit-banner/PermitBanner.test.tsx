import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { PermitBanner } from "./PermitBanner";

const BASE = { validFrom: "2026-03-01T00:00:00Z", validTo: "2026-06-01T00:00:00Z", icraClass: "IV" as const };

describe("PermitBanner", () => {
  it("renders the state label, the window and the ICRA class", () => {
    renderWithIntl(<PermitBanner {...BASE} state="inForce" />);
    expect(screen.getByText("Σε ισχύ")).toBeInTheDocument();
    // A permit window is hours, not just a date — different days, so both ends
    // print in full (formatDateTimeRange, R23).
    expect(screen.getByText(/01\/03\/2026\s*02:00 – 01\/06\/2026\s*03:00/)).toBeInTheDocument();
    expect(screen.getByText("IV")).toBeInTheDocument();
    expect(screen.getByText("Εκτύπωση")).toBeInTheDocument();
  });

  it("collapses the window to one date with two times when both ends fall on the same day", () => {
    renderWithIntl(
      <PermitBanner
        {...BASE}
        validFrom="2026-04-01T05:00:00Z"
        validTo="2026-04-01T13:00:00Z"
        state="inForce"
      />,
    );
    // Europe/Nicosia is UTC+3 on 1 April (EEST): 08:00 – 16:00.
    expect(screen.getByText(/01\/04\/2026\s*08:00 – 16:00/)).toBeInTheDocument();
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
