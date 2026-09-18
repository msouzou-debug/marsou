import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("without requireCode, the destructive button is enabled immediately", () => {
    renderWithIntl(
      <ConfirmDialog
        open
        title="Θέλετε να ακυρώσετε την εντολή εργασίας;"
        consequence="Η ενέργεια δεν αναιρείται."
        destructiveLabel="Ακύρωση εντολής"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Ακύρωση εντολής" })).toBeEnabled();
  });

  it("RULE: with requireCode, the destructive button stays disabled until the typed code matches exactly", async () => {
    const onConfirm = vi.fn();
    renderWithIntl(
      <ConfirmDialog
        open
        title="Θέλετε να διαγράψετε το κόστος PRJ-014;"
        consequence="Η διαγραφή αφαιρεί οριστικά τις καταχωρήσεις κόστους."
        destructiveLabel="Διαγραφή"
        requireCode="PRJ-014"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const destructiveButton = screen.getByRole("button", { name: "Διαγραφή" });
    const input = screen.getByPlaceholderText("Κωδικός καταχώρησης");
    expect(destructiveButton).toBeDisabled();

    await userEvent.type(input, "PRJ-01");
    expect(destructiveButton).toBeDisabled();

    await userEvent.type(input, "5");
    expect(destructiveButton).toBeDisabled(); // "PRJ-015" - close but not exact

    await userEvent.clear(input);
    await userEvent.type(input, "PRJ-014");
    expect(destructiveButton).toBeEnabled();

    await userEvent.click(destructiveButton);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Ακύρωση is pressed", async () => {
    const onCancel = vi.fn();
    renderWithIntl(
      <ConfirmDialog
        open
        title="Θέλετε να ακυρώσετε;"
        consequence="Η ενέργεια δεν αναιρείται."
        destructiveLabel="Ακύρωση εντολής"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ακύρωση" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
