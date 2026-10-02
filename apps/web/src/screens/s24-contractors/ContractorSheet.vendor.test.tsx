import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { buildEFinanceVendorList } from "@/mocks/efinance";
import { ContractorSheet } from "./ContractorSheet";

describe("ContractorSheet — «Κωδικός SAP» (ADR-0029)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is the plain text input it always was when no search is wired", () => {
    renderWithIntl(<ContractorSheet open isAdmin={false} onClose={vi.fn()} onSave={vi.fn()} />);
    const field = screen.getByLabelText("Κωδικός SAP");
    expect(field).not.toHaveAttribute("role", "combobox");
    expect(screen.queryByText(/αναζήτηση στο eFinance/)).not.toBeInTheDocument();
  });

  it("becomes a vendor search when it is, and saves the picked vendor's code", async () => {
    const onSave = vi.fn();
    const search = vi.fn(async () => buildEFinanceVendorList().items);
    renderWithIntl(<ContractorSheet open isAdmin={false} onClose={vi.fn()} onSave={onSave} vendorSearch={search} />);

    fireEvent.change(screen.getByLabelText("Επωνυμία"), { target: { value: "Νέος Ανάδοχος Λτδ" } });
    const field = screen.getByLabelText("Κωδικός SAP");
    expect(field).toHaveAttribute("role", "combobox");
    fireEvent.change(field, { target: { value: "Κυρ" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.click(screen.getByRole("option", { name: /V-100101/ }));

    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: "Νέος Ανάδοχος Λτδ", sapVendorId: "V-100101" });
  });

  it("still saves a code typed by hand when eFinance lists nothing", async () => {
    const onSave = vi.fn();
    renderWithIntl(<ContractorSheet open isAdmin={false} onClose={vi.fn()} onSave={onSave} vendorSearch={async () => []} />);
    fireEvent.change(screen.getByLabelText("Επωνυμία"), { target: { value: "Άλλος Ανάδοχος" } });
    fireEvent.change(screen.getByLabelText("Κωδικός SAP"), { target: { value: "V-777" } });
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ sapVendorId: "V-777" });
  });

  it("saves an emptied field as null", async () => {
    const onSave = vi.fn();
    renderWithIntl(
      <ContractorSheet
        open
        isAdmin={false}
        onClose={vi.fn()}
        onSave={onSave}
        contractor={{ id: "c1", name: "Κάποιος", vatNumber: null, registrationNo: null, category: "BUILDING", sapVendorId: "V-1", blacklisted: false }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Κωδικός SAP"), { target: { value: "" } });
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].sapVendorId).toBeNull();
  });
});
