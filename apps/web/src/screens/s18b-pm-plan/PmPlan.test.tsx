import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { OrgUnit } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { buildMaintenanceContract, buildPmGenerationResult, buildPmSchedule, buildSlaImportResult, buildSlaSystems } from "@/mocks/maintenance";
import { parseCell, templateHref } from "./CatalogueSection";
import { PmPlan, type PmPlanProps } from "./PmPlan";

const UNITS: OrgUnit[] = [
  {
    id: "nicosia-general",
    code: "NGH",
    nameEl: "Γ.Ν. Λευκωσίας",
    nameEn: "Nicosia General",
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: null,
    entityCode: "NGH",
    efinanceCode: "NGH",
    timezone: "Europe/Nicosia",
  },
];

function renderPlan(overrides: Partial<PmPlanProps> = {}) {
  const props: PmPlanProps = {
    orgUnits: UNITS,
    unitId: "nicosia-general",
    onUnitChange: vi.fn(),
    state: "default",
    noPermission: <p>no-permission-marker</p>,
    agreement: buildMaintenanceContract(),
    contractors: [{ id: "ctr-1", name: "Δείγμα Η/Μ Συντήρηση Λτδ", vatNumber: null, registrationNo: null, category: "MECHANICAL", sapVendorId: null, blacklisted: false }],
    systems: buildSlaSystems(),
    systemsState: "default",
    schedules: [buildPmSchedule({ openWorkOrderId: "wo-2" })],
    schedulesState: "default",
    assets: [],
    canManage: true,
    onSaveAgreement: vi.fn().mockResolvedValue(undefined),
    onPatchSystem: vi.fn().mockResolvedValue(undefined),
    onImport: vi.fn().mockResolvedValue(buildSlaImportResult()),
    onSaveSchedule: vi.fn().mockResolvedValue(undefined),
    onGenerate: vi.fn().mockResolvedValue(buildPmGenerationResult()),
    ...overrides,
  };
  renderWithIntl(<PmPlan {...props} />);
  return props;
}

const section = (heading: string) => screen.getByRole("heading", { name: heading, level: 2 }).closest("section")!;

describe("S18b PmPlan", () => {
  it("shows the agreement card: contractor, ref, cover, normal hours, availability clause", () => {
    renderPlan();
    const card = section("Σύμβαση συντήρησης");
    expect(within(card).getByText("Δείγμα Η/Μ Συντήρηση Λτδ")).toBeInTheDocument();
    expect(within(card).getByText(/Α\.Ο 42\/24/)).toBeInTheDocument();
    expect(within(card).getByText("Όλο το 24ωρο, 7 ημέρες")).toBeInTheDocument();
    expect(within(card).getByText("07:30–15:00")).toBeInTheDocument();
    expect(within(card).getByText(/8\.600 ώρες τον χρόνο ανά σύστημα/)).toBeInTheDocument();
  });

  it("lets only head of estates and admin edit the agreement and run the programme", () => {
    renderPlan({ canManage: false });
    expect(within(section("Σύμβαση συντήρησης")).queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Έκδοση τώρα" })).not.toBeInTheDocument();
    expect(screen.queryByText("Εισαγωγή από Excel")).not.toBeInTheDocument();
  });

  // RULE (ADR-0031 §2): a null rate is «—», and the section says the rates are still to be confirmed.
  it("shows a missing rate as «—» with «Ρήτρες προς επιβεβαίωση»", () => {
    renderPlan();
    const card = section("Κατάλογος συστημάτων");
    expect(within(card).getByText("Ρήτρες προς επιβεβαίωση")).toBeInTheDocument();
    const row = within(card).getByText("Σύστημα κλιματισμού χειρουργείων και ΜΕΘ").closest("tr")!;
    expect(within(row).getAllByText("—")).toHaveLength(3);
    expect(within(row).getByText("30 λεπ")).toBeInTheDocument();
    expect(within(row).getByText("Μηνιαία, Εξαμηνιαία")).toBeInTheDocument();
  });

  it("drops the hint once every rate is known", () => {
    renderPlan({ systems: buildSlaSystems().filter((s) => s.code === "1.2.4") });
    expect(screen.queryByText("Ρήτρες προς επιβεβαίωση")).not.toBeInTheDocument();
  });

  it("imports the catalogue and shows the importer's result with its row errors", async () => {
    const props = renderPlan();
    const card = section("Κατάλογος συστημάτων");
    expect(within(card).getByRole("link", { name: "Λήψη υποδείγματος" })).toHaveAttribute("href", templateHref("mc-1"));
    const file = new File(["x"], "catalogue.xlsx");
    fireEvent.change(within(card).getByLabelText("Αρχείο .xlsx"), { target: { files: [file] } });
    fireEvent.click(within(card).getByRole("button", { name: "Υποβολή" }));
    await waitFor(() => expect(props.onImport).toHaveBeenCalledWith(file));
    expect(await within(card).findByText("Νέα: 2 · ενημερώθηκαν: 45 · παραλείφθηκαν: 1")).toBeInTheDocument();
    expect(within(card).getByText("Λείπει η ζώνη προτεραιότητας.")).toBeInTheDocument();
  });

  it("switches a system off from the catalogue", async () => {
    const props = renderPlan();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ενεργό σύστημα 1.3.2" }));
    await waitFor(() => expect(props.onPatchSystem).toHaveBeenCalledWith("sla-3", { active: false }));
  });

  // RULE (contract `PmSchedule`): re-running never doubles an order — the result says how many were skipped.
  it("issues the programme now and says what happened", async () => {
    const props = renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Έκδοση τώρα" }));
    await waitFor(() => expect(props.onGenerate).toHaveBeenCalled());
    expect(await screen.findByText("Εκδόθηκαν 4 εντολές. 2 γραμμές είχαν ήδη ανοιχτή εντολή. Κλιμακώσεις: 1.")).toBeInTheDocument();
  });

  it("lists a schedule with its frequency, next date and open order link", () => {
    renderPlan();
    const card = section("Πρόγραμμα");
    const row = within(card).getByText("Μηνιαίος έλεγχος ψύκτη").closest("tr")!;
    expect(within(row).getByText("Μηνιαία")).toBeInTheDocument();
    expect(within(row).getByText("15/10/2026")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Άνοιγμα εντολής" })).toHaveAttribute("href", "/maintenance/wo-2");
  });

  it("adds a schedule line", async () => {
    const props = renderPlan();
    const card = section("Πρόγραμμα");
    fireEvent.click(within(card).getByRole("button", { name: "Προσθήκη" }));
    fireEvent.change(within(card).getByRole("combobox", { name: "Σύστημα" }), { target: { value: "sla-2" } });
    fireEvent.change(within(card).getByRole("textbox", { name: "Τίτλος" }), { target: { value: "Μηνιαίος έλεγχος ανελκυστήρων" } });
    fireEvent.change(within(card).getByLabelText("Επόμενη ημερομηνία", { selector: "input[type='date']" }), { target: { value: "2026-11-01" } });
    fireEvent.click(within(card).getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() =>
      expect(props.onSaveSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ slaSystemId: "sla-2", titleEl: "Μηνιαίος έλεγχος ανελκυστήρων", nextDue: "2026-11-01", frequency: "MONTHLY", leadDays: 5, assetId: null }),
        undefined,
      ),
    );
  });

  it("says when a unit has no agreement and offers to add one", () => {
    renderPlan({ agreement: null });
    expect(screen.getByText("Η μονάδα δεν έχει καταχωρισμένη σύμβαση συντήρησης.")).toBeInTheDocument();
    expect(within(section("Σύμβαση συντήρησης")).getByRole("button", { name: "Προσθήκη" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Κατάλογος συστημάτων" })).not.toBeInTheDocument();
  });

  it("asks for a unit first", () => {
    renderPlan({ unitId: "" });
    expect(screen.getByText("Επιλέξτε μονάδα για να δείτε τη σύμβαση και το πρόγραμμά της.")).toBeInTheDocument();
  });

  it("renders noPermission", () => {
    renderPlan({ state: "noPermission" });
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });
});

describe("parseCell", () => {
  it("reads Greek decimals and empties as null", () => {
    expect(parseCell("0,5")).toBe(0.5);
    expect(parseCell("24")).toBe(24);
    expect(parseCell("")).toBeNull();
    expect(parseCell("—")).toBeNull();
    expect(parseCell("12,50 €")).toBe(12.5);
    expect(parseCell("abc")).toBeNaN();
  });
});
