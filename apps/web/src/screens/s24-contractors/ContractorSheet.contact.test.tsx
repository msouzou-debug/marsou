import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Contractor } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { ContractorSheet } from "./ContractorSheet";

/** Owner UAT 25/11/2026: who to write to at a contractor. */
const contractor: Contractor = {
  id: "c1",
  name: "Κυριάκου Τεχνικές Κατασκευές Λτδ",
  vatNumber: null,
  registrationNo: null,
  category: "BUILDING",
  sapVendorId: "100123",
  blacklisted: false,
  contactName: null,
  contactEmail: "info@kyriakou.example",
  contactPhone: "+357 22 123456",
  contactSource: "EFINANCE",
  contactSyncedAt: "2026-11-20T06:00:00.000Z",
};

describe("ContractorSheet — «Στοιχεία επικοινωνίας»", () => {
  it("shows the contact, says it came from eFinance, and saves a change", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithIntl(<ContractorSheet open isAdmin={false} contractor={contractor} onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByLabelText("Ηλεκτρονικό ταχυδρομείο")).toHaveValue("info@kyriakou.example");
    expect(screen.getByLabelText("Τηλέφωνο")).toHaveValue("+357 22 123456");
    expect(screen.getByText(/ήρθαν από το eFinance στις 20\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Δεν καταχωρίζονται τραπεζικά στοιχεία/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Υπεύθυνος επικοινωνίας"), "Μαρία Ιωάννου");
    await user.clear(screen.getByLabelText("Τηλέφωνο"));
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      contactName: "Μαρία Ιωάννου",
      contactEmail: "info@kyriakou.example",
      contactPhone: null,
    });
  });

  it("refuses an e-mail or a telephone that is not one", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithIntl(<ContractorSheet open isAdmin={false} onClose={vi.fn()} onSave={onSave} />);
    await user.type(screen.getByLabelText("Επωνυμία"), "Νέος Ανάδοχος");
    await user.type(screen.getByLabelText("Ηλεκτρονικό ταχυδρομείο"), "όχι διεύθυνση");
    await user.type(screen.getByLabelText("Τηλέφωνο"), "καλέστε");
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(await screen.findByText("Η διεύθυνση ηλεκτρονικού ταχυδρομείου δεν είναι έγκυρη.")).toBeInTheDocument();
    expect(screen.getByText(/Ο αριθμός τηλεφώνου δεν είναι έγκυρος/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
