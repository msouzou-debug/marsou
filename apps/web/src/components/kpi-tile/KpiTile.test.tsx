import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { KpiTile } from "./KpiTile";

describe("KpiTile", () => {
  it("renders the label, value and comparator", () => {
    renderWithIntl(
      <KpiTile label="Δαπάνες" value="€ 1.234.567" comparator="% έτους που έχει παρέλθει: 62 %" />,
    );
    expect(screen.getByText("Δαπάνες")).toBeInTheDocument();
    expect(screen.getByText("€ 1.234.567")).toBeInTheDocument();
    expect(screen.getByText("% έτους που έχει παρέλθει: 62 %")).toBeInTheDocument();
  });

  it("renders a trend arrow only when a trend is given", () => {
    // Two separate renders, not `rerender`: renderWithIntl wraps each `ui` in
    // its own NextIntlClientProvider, and testing-library's `rerender` would
    // swap that wrapped tree for a bare, unwrapped element.
    const without = renderWithIntl(<KpiTile label="Δαπάνες" value="€ 100" comparator="σταθερό" />);
    expect(without.container.querySelector("svg")).toBeNull();

    const withTrend = renderWithIntl(
      <KpiTile label="Δαπάνες" value="€ 100" comparator="σταθερό" trend="up" />,
    );
    expect(withTrend.container.querySelector("svg")).not.toBeNull();
  });

  it("shows a skeleton and hides the value while loading", () => {
    renderWithIntl(<KpiTile label="Δαπάνες" value="€ 100" state="loading" />);
    expect(screen.queryByText("€ 100")).toBeNull();
    expect(screen.getByText("Φόρτωση")).toBeInTheDocument(); // sr-only, still queryable by text
  });

  it("shows the error message and hides the value on error", () => {
    renderWithIntl(<KpiTile label="Δαπάνες" value="€ 100" state="error" />);
    expect(screen.queryByText("€ 100")).toBeNull();
    expect(screen.getByText("Η τιμή δεν φορτώθηκε.")).toBeInTheDocument();
  });

  it("calls onRetry when the retry link is clicked", async () => {
    const onRetry = vi.fn();
    renderWithIntl(<KpiTile label="Δαπάνες" value="€ 100" state="error" onRetry={onRetry} />);
    await userEvent.click(screen.getByText("Δοκιμάστε ξανά"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
