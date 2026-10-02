import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import type { EFinanceVendor } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { buildEFinanceVendor, buildEFinanceVendorList } from "@/mocks/efinance";
import { VendorPicker, vendorDisabledReason } from "./VendorPicker";

function Harness({
  search,
  initial = null,
  onValue,
}: {
  search?: (q: string) => Promise<EFinanceVendor[]>;
  initial?: string | null;
  onValue?: (value: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="vp">Κωδικός SAP</label>
      <VendorPicker
        id="vp"
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
        search={search}
      />
    </form>
  );
}

async function type(text: string) {
  fireEvent.change(screen.getByLabelText("Κωδικός SAP"), { target: { value: text } });
}

// Lets the debounce timer fire and the resolved promise settle.
async function settle(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("vendorDisabledReason", () => {
  it("lets an active, unblocked vendor through", () => {
    expect(vendorDisabledReason({ blocked: false, active: true })).toBeNull();
  });
  it("refuses a blocked vendor, and says blocked even when it is also inactive", () => {
    expect(vendorDisabledReason({ blocked: true, active: true })).toBe("blocked");
    expect(vendorDisabledReason({ blocked: true, active: false })).toBe("blocked");
  });
  it("refuses an inactive vendor", () => {
    expect(vendorDisabledReason({ blocked: false, active: false })).toBe("inactive");
  });
});

describe("VendorPicker — search", () => {
  it("debounces: one request for the final text, not one per keystroke", async () => {
    const search = vi.fn(async () => buildEFinanceVendorList().items);
    renderWithIntl(<Harness search={search} />);
    await type("Κυ");
    await settle(100);
    await type("Κυρ");
    await settle(100);
    await type("Κυριά");
    expect(search).not.toHaveBeenCalled();
    await settle(300);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("Κυριά");
  });

  it("does not search for a single character", async () => {
    const search = vi.fn(async () => []);
    renderWithIntl(<Harness search={search} />);
    await type("V");
    await settle(500);
    expect(search).not.toHaveBeenCalled();
  });

  it("does not search for an existing value that nobody typed", async () => {
    const search = vi.fn(async () => []);
    renderWithIntl(<Harness search={search} initial="V-100101" />);
    await settle(500);
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Κωδικός SAP")).toHaveValue("V-100101");
  });

  it("shows code and name, and the VAT number when there is one", async () => {
    renderWithIntl(<Harness search={async () => buildEFinanceVendorList().items} />);
    await type("Κυρ");
    await settle();
    const option = screen.getByRole("option", { name: /V-100101/ });
    expect(option).toHaveTextContent("Κυριάκου Τεχνικές Κατασκευές Λτδ");
    expect(option).toHaveTextContent("ΑΦΜ CY10231455X");
  });

  it("shows up to twenty results", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => buildEFinanceVendor({ vendorCode: `V-${200000 + i}`, name: `Προμηθευτής ${i}` }));
    renderWithIntl(<Harness search={async () => twenty} />);
    await type("Προ");
    await settle();
    expect(screen.getAllByRole("option")).toHaveLength(20);
  });
});

describe("VendorPicker — picking", () => {
  it("fills the field with the vendor's code and names the vendor", async () => {
    const onValue = vi.fn();
    renderWithIntl(<Harness search={async () => buildEFinanceVendorList().items} onValue={onValue} />);
    await type("Κυρ");
    await settle();
    fireEvent.click(screen.getByRole("option", { name: /V-100101/ }));
    expect(screen.getByLabelText("Κωδικός SAP")).toHaveValue("V-100101");
    expect(onValue).toHaveBeenLastCalledWith("V-100101");
    expect(screen.getByTestId("vendor-picked")).toHaveTextContent("Επιλέχθηκε: Κυριάκου Τεχνικές Κατασκευές Λτδ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  // RULE (ADR-0029): shown, with the reason, but not selectable.
  it("shows a blocked vendor with its reason and does not let it be picked", async () => {
    const onValue = vi.fn();
    renderWithIntl(<Harness search={async () => buildEFinanceVendorList().items} onValue={onValue} />);
    await type("Λευ");
    await settle();
    const blocked = screen.getByRole("option", { name: /V-100112/ });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveTextContent("Μπλοκαρισμένος στο eFinance: δεν μπορεί να επιλεγεί");
    onValue.mockClear();
    fireEvent.click(blocked);
    expect(onValue).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Κωδικός SAP")).toHaveValue("Λευ");
  });

  it("shows an inactive vendor with its reason and does not let it be picked", async () => {
    renderWithIntl(<Harness search={async () => buildEFinanceVendorList().items} />);
    await type("Μεσ");
    await settle();
    const inactive = screen.getByRole("option", { name: /V-100140/ });
    expect(inactive).toHaveAttribute("aria-disabled", "true");
    expect(inactive).toHaveTextContent("Ανενεργός στο eFinance");
    fireEvent.click(inactive);
    expect(screen.getByLabelText("Κωδικός SAP")).toHaveValue("Μεσ");
  });

  it("picks with the keyboard, skipping the blocked row, and Enter does not submit the form", async () => {
    const onValue = vi.fn();
    const items = [
      buildEFinanceVendor({ vendorCode: "V-1", name: "Αλφα", blocked: true }),
      buildEFinanceVendor({ vendorCode: "V-2", name: "Βήτα" }),
    ];
    renderWithIntl(<Harness search={async () => items} onValue={onValue} />);
    await type("Αλ");
    await settle();
    const input = screen.getByLabelText("Κωδικός SAP");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", expect.stringMatching(/-1$/));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValue).toHaveBeenLastCalledWith("V-2");
  });

  it("closes the list on Escape and keeps what was typed", async () => {
    renderWithIntl(<Harness search={async () => buildEFinanceVendorList().items} />);
    await type("Κυρ");
    await settle();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Κωδικός SAP"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Κωδικός SAP")).toHaveValue("Κυρ");
  });
});

describe("VendorPicker — the plain input is always the fallback", () => {
  it("is a plain text input with no listbox when no search is given", async () => {
    const onValue = vi.fn();
    renderWithIntl(<Harness onValue={onValue} />);
    const input = screen.getByLabelText("Κωδικός SAP");
    expect(input).not.toHaveAttribute("role", "combobox");
    await type("V-555");
    await settle(500);
    expect(onValue).toHaveBeenLastCalledWith("V-555");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps typing working when the search finds nothing, and says so", async () => {
    const onValue = vi.fn();
    renderWithIntl(<Harness search={async () => []} onValue={onValue} />);
    await type("V-999");
    await settle();
    expect(screen.getByText(/Δεν βρέθηκε προμηθευτής στο eFinance/)).toBeInTheDocument();
    expect(onValue).toHaveBeenLastCalledWith("V-999");
    expect(screen.getByLabelText("Κωδικός SAP")).toHaveValue("V-999");
  });

  it("keeps typing working when the search fails, and says so", async () => {
    renderWithIntl(<Harness search={() => Promise.reject(new Error("502"))} />);
    await type("V-999");
    await settle();
    expect(screen.getByText(/Η αναζήτηση στο eFinance δεν απάντησε/)).toBeInTheDocument();
    expect(screen.getByLabelText("Κωδικός SAP")).toHaveValue("V-999");
  });

  it("clears to null when the field is emptied", async () => {
    const onValue = vi.fn();
    renderWithIntl(<Harness search={async () => []} initial="V-1" onValue={onValue} />);
    await type("");
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it("ignores a slow answer for text that is no longer there", async () => {
    let resolveFirst: (items: EFinanceVendor[]) => void = () => undefined;
    const search = vi
      .fn<(q: string) => Promise<EFinanceVendor[]>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(async () => [buildEFinanceVendor({ vendorCode: "V-NEW", name: "Νέος" })]);
    renderWithIntl(<Harness search={search} />);
    await type("Παλ");
    await settle();
    await type("Νέο");
    await settle();
    await act(async () => resolveFirst([buildEFinanceVendor({ vendorCode: "V-OLD", name: "Παλιός" })]));
    expect(screen.queryByText("V-OLD")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /V-NEW/ })).toBeInTheDocument();
  });
});
