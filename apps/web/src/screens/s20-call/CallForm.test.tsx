import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { addHours, type AssetListRow, type OrgUnit } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { localInputToIsoInstant } from "@/lib/datetime";
import { formatDateTime } from "@/lib/format";
import { buildMaintenanceContract, buildSlaSystems } from "@/mocks/maintenance";
import { CallForm, type CallFormProps } from "./CallForm";

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

const LIFT: AssetListRow = {
  id: "asset-2",
  tag: "NGH-LIFT-0003",
  nameEl: "Ανελκυστήρας Α3",
  assetClass: "LIFT",
  criticality: 2,
  condition: "C",
  status: "IN_SERVICE",
  replacementYear: 2030,
  warrantyEnd: null,
  orgUnitId: "nicosia-general",
  areaId: "area-1",
  areaNameEl: "Κεντρικός διάδρομος",
  orgUnitNameEl: "Γ.Ν. Λευκωσίας",
  priorityRank: 4,
};

const CALLED = "2026-10-06T08:00";

function renderForm(overrides: Partial<CallFormProps> = {}) {
  const props: CallFormProps = {
    orgUnits: UNITS,
    unitId: "nicosia-general",
    onUnitChange: vi.fn(),
    assets: [LIFT],
    agreement: buildMaintenanceContract(),
    systems: buildSlaSystems(),
    defaultSource: "TECHNICAL_SERVICES",
    initialCalledAt: CALLED,
    readOnly: false,
    submitting: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  renderWithIntl(<CallForm {...props} />);
  return props;
}

describe("S20 CallForm", () => {
  it("asks for a system before showing deadlines", () => {
    renderForm();
    expect(screen.getByText("Επιλέξτε σύστημα για να δείτε τις προθεσμίες.")).toBeInTheDocument();
  });

  // RULE (ADR-0031 §3): every deadline counts from the call — addHours on the chosen system.
  it("previews the three deadlines from the call time before saving", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Σύστημα σύμβασης"), { target: { value: "sla-1" } });
    const called = localInputToIsoInstant(CALLED);
    expect(screen.getByTestId("deadline-response").textContent).toBe(formatDateTime(addHours(called, 0.5)));
    expect(screen.getByTestId("deadline-restore").textContent).toBe(formatDateTime(addHours(called, 2)));
    expect(screen.getByTestId("deadline-report").textContent).toBe(formatDateTime(addHours(called, 24)));
    expect(screen.getByText("Ανταπόκριση 30 λεπ · αποκατάσταση 2 ω · έκθεση 24 ω")).toBeInTheDocument();
  });

  it("moves the deadlines when the call time is set earlier", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Σύστημα σύμβασης"), { target: { value: "sla-2" } });
    fireEvent.change(screen.getByLabelText("Ώρα κλήσης"), { target: { value: "2026-10-06T06:00" } });
    expect(screen.getByTestId("deadline-restore").textContent).toBe(formatDateTime(addHours(localInputToIsoInstant("2026-10-06T06:00"), 24)));
  });

  it("finds an asset by tag, brings its area, and picks the only system of its class", async () => {
    const props = renderForm();
    fireEvent.change(screen.getByPlaceholderText("Αναζήτηση με κωδικό ή όνομα παγίου"), { target: { value: "lift" } });
    fireEvent.click(screen.getByRole("button", { name: /NGH-LIFT-0003/ }));
    expect((screen.getByLabelText("Σύστημα σύμβασης") as HTMLSelectElement).value).toBe("sla-2");
    fireEvent.change(screen.getByLabelText("Τι συμβαίνει"), { target: { value: "Σταματά ανάμεσα σε ορόφους" } });
    fireEvent.click(screen.getByRole("button", { name: "Υποβολή" }));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "CORRECTIVE",
        source: "TECHNICAL_SERVICES",
        orgUnitId: "nicosia-general",
        assetId: "asset-2",
        areaId: "area-1",
        slaSystemId: "sla-2",
        titleEl: "Σταματά ανάμεσα σε ορόφους",
        calledAt: localInputToIsoInstant(CALLED),
      }),
    );
  });

  it("logs a call with no asset", () => {
    const props = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Χωρίς πάγιο" }));
    fireEvent.change(screen.getByLabelText("Τι συμβαίνει"), { target: { value: "Διαρροή νερού στον διάδρομο" } });
    fireEvent.click(screen.getByRole("button", { name: "Υποβολή" }));
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assetId: null, slaSystemId: null }));
  });

  it("refuses a title shorter than three characters", () => {
    const props = renderForm();
    fireEvent.change(screen.getByLabelText("Τι συμβαίνει"), { target: { value: "Ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Υποβολή" }));
    expect(screen.getByText("Γράψτε τουλάχιστον τρεις χαρακτήρες.")).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  // RULE (task S20): the nursing side is the default source for a clinical approver.
  it("starts on the source the page chose", () => {
    renderForm({ defaultSource: "NURSING" });
    expect((screen.getByLabelText("Ποιος ειδοποίησε") as HTMLSelectElement).value).toBe("NURSING");
  });

  it("says when the unit has no active agreement", () => {
    renderForm({ agreement: null, systems: [] });
    expect(screen.getByText(/δεν έχει ενεργή σύμβαση συντήρησης/)).toBeInTheDocument();
  });

  it("offers no submit to a role that cannot raise a call", () => {
    renderForm({ readOnly: true });
    expect(screen.queryByRole("button", { name: "Υποβολή" })).not.toBeInTheDocument();
    expect(screen.getByText(/Ο ρόλος σας δεν καταγράφει κλήσεις/)).toBeInTheDocument();
  });

  // Phone: the submit and the choices are thumb-sized.
  it("keeps every control at least 44px tall", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Υποβολή" }).className).toContain("min-h-[56px]");
    expect(screen.getByRole("button", { name: "Διορθωτική" }).className).toContain("min-h-[48px]");
    expect(screen.getByLabelText("Τι συμβαίνει").className).toContain("min-h-[48px]");
  });
});
