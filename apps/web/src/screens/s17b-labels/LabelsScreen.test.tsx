import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithIntl } from "@/test/render";
import { LabelsScreen } from "./LabelsScreen";

function withQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("LabelsScreen", () => {
  it("shows the empty sentence and disables «Εκτύπωση» with no ids", () => {
    renderWithIntl(withQuery(<LabelsScreen ids={[]} />));
    expect(screen.getByText("Δεν έχουν επιλεγεί πάγια για εκτύπωση ετικέτας.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Εκτύπωση" })).toBeDisabled();
  });
});
