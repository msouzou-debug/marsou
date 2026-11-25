import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { MaintenanceAgreementQuery } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { formatEUR, formatInt } from "@/lib/format";
import { buildMaintenanceAgreementList } from "@/mocks/maintenance";
import { orgUnits } from "@/mocks/org-units";
import {
  agreementDetailHref,
  agreementsQueryToSearchParams,
  filterItemsToAgreementsQuery,
  parseAgreementsQuery,
} from "./agreements-query";
import { AgreementsDashboard, type AgreementsDashboardProps } from "./AgreementsDashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/maintenance/plan",
  useSearchParams: () => new URLSearchParams(),
}));

const NO_FILTERS = MaintenanceAgreementQuery.parse({});

function renderDashboard(overrides: Partial<AgreementsDashboardProps> = {}) {
  const props: AgreementsDashboardProps = {
    data: buildMaintenanceAgreementList(),
    state: "default",
    query: NO_FILTERS,
    orgUnits,
    onQueryChange: vi.fn(),
    onOpen: vi.fn(),
    noPermission: <p>no-permission-marker</p>,
    ...overrides,
  };
  renderWithIntl(<AgreementsDashboard {...props} />);
  return props;
}

const exact = (text: string) => (_: string, el: Element | null) => el?.textContent === text && el.children.length === 0;
const tile = (label: string) => screen.getByText(label, { selector: "p.eyebrow" }).closest("[data-state]") as HTMLElement;
const rowOf = (ref: string) => screen.getByRole("link", { name: ref }).closest("tr") as HTMLElement;

describe("S18b AgreementsDashboard", () => {
  it("counts the rows in the five tiles: in force, ending, ended, value, PM this month", () => {
    renderDashboard();
    expect(within(tile("Συμβάσεις σε ισχύ")).getByText("2")).toBeInTheDocument();
    expect(within(tile("Συμβάσεις σε ισχύ")).getByText("από 3 συνολικά")).toBeInTheDocument();
    expect(within(tile("Λήγουν μέσα σε 90 ημέρες")).getByText("1")).toBeInTheDocument();
    expect(within(tile("Έληξαν")).getByText("1")).toBeInTheDocument();
    // Only agreements in force count; the expired Paphos one has no value anyway.
    expect(within(tile("Αξία συμβάσεων σε ισχύ")).getByText(exact(formatEUR(6_850_000)))).toBeInTheDocument();
    expect(within(tile("Προληπτικές του μήνα")).getByText("6")).toBeInTheDocument();
    expect(within(tile("Προληπτικές του μήνα")).getByText("Εκπρόθεσμες: 3")).toBeInTheDocument();
  });

  it("lists every agreement with its hospital, equipment, dates, expiry chip and counts", () => {
    renderDashboard();
    const larnaca = rowOf("Α.Ο 17/25");
    expect(within(larnaca).getByText("Γενικό Νοσοκομείο Λάρνακας")).toBeInTheDocument();
    expect(within(larnaca).getByText("Δείγμα Ψυκτικά Λτδ")).toBeInTheDocument();
    expect(within(larnaca).getByText("04/01/2027")).toBeInTheDocument();
    expect(within(larnaca).getByText("40")).toBeInTheDocument();
    expect(within(larnaca).getByText("Λήγει σε ≤ 90 ημέρες")).toBeInTheDocument();
    expect(within(larnaca).getByText(exact(formatEUR(850_000)))).toBeInTheDocument();

    const paphos = rowOf("Α.Ο 19/22");
    expect(within(paphos).getByText("Έληξε", { selector: "span" })).toBeInTheDocument();
    expect(within(paphos).getByText(formatInt(-56))).toBeInTheDocument();
    expect(within(rowOf("Α.Ο 42/24")).getByText("Σε ισχύ")).toBeInTheDocument();
  });

  it("opens the agreement's own view from its reference, and with Enter on the row", () => {
    const props = renderDashboard();
    expect(screen.getByRole("link", { name: "Α.Ο 17/25" })).toHaveAttribute("href", "/maintenance/plan?view=agreement&unit=larnaca-general&agreement=mc-2");
    const row = rowOf("Α.Ο 17/25");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "mc-2" }));
  });

  it("filters by hospital and equipment type from their checklists", () => {
    const props = renderDashboard();
    fireEvent.click(screen.getByText("Νοσοκομείο", { selector: "summary" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Γενικό Νοσοκομείο Λάρνακας" }));
    expect(props.onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ orgUnitId: ["larnaca-general"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ιατρικά αέρια" }));
    expect(props.onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ assetClass: ["MEDICAL_GAS"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Λήγει σε ≤ 90 ημέρες" }));
    expect(props.onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ band: ["EXPIRING"] }));
    // The contractor options are the API's, every visible agreement's.
    fireEvent.click(screen.getByRole("checkbox", { name: "Δείγμα Ψυκτικά Λτδ" }));
    expect(props.onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ contractorId: ["ctr-2"] }));
  });

  it("shows active filters as chips and drops one hospital without the others", () => {
    const query = MaintenanceAgreementQuery.parse({ orgUnitId: ["larnaca-general", "paphos-general"], assetClass: ["HVAC"] });
    const props = renderDashboard({ query });
    expect(screen.getByText("Τύπος εξοπλισμού: Κλιματισμός και αερισμός (HVAC)")).toBeInTheDocument();
    expect(screen.getByText("Νοσοκομείο: Γενικό Νοσοκομείο Πάφου")).toBeInTheDocument();
    // The second hospital chip is Paphos; FilterBar names each remove button after its facet.
    fireEvent.click(screen.getAllByRole("button", { name: "Αφαίρεση φίλτρου Νοσοκομείο" })[1]);
    expect(props.onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ orgUnitId: ["larnaca-general"], assetClass: ["HVAC"] }));
  });

  it("searches after the typing stops", () => {
    vi.useFakeTimers();
    try {
      const props = renderDashboard();
      fireEvent.change(screen.getByRole("searchbox", { name: "Αναζήτηση" }), { target: { value: "17/25" } });
      expect(props.onQueryChange).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(450));
      expect(props.onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ q: "17/25" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when nothing matches, and renders noPermission", () => {
    renderDashboard({ data: buildMaintenanceAgreementList({ items: [] }), state: "empty" });
    expect(screen.getByText("Καμία σύμβαση δεν ταιριάζει με τα φίλτρα.")).toBeInTheDocument();
  });

  it("renders noPermission", () => {
    renderDashboard({ state: "noPermission" });
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });
});

describe("agreements URL", () => {
  it("round-trips the filters with repeated parameters and drops unknown values", () => {
    const query = parseAgreementsQuery(new URLSearchParams("orgUnitId=a&orgUnitId=b&assetClass=HVAC&assetClass=ROCKET&band=EXPIRED&q=%CE%91.%CE%9F"));
    expect(query).toEqual({ orgUnitId: ["a", "b"], assetClass: ["HVAC"], contractorId: [], band: ["EXPIRED"], q: "Α.Ο" });
    expect(agreementsQueryToSearchParams(query).toString()).toBe("orgUnitId=a&orgUnitId=b&assetClass=HVAC&band=EXPIRED&q=%CE%91.%CE%9F");
  });

  it("rebuilds the query from FilterBar's chips", () => {
    expect(
      filterItemsToAgreementsQuery([
        { key: "orgUnitId__a", label: "", value: "" },
        { key: "band__OK", label: "", value: "" },
        { key: "q", label: "", value: "θέρμανση" },
      ]),
    ).toEqual({ orgUnitId: ["a"], assetClass: [], contractorId: [], band: ["OK"], q: "θέρμανση" });
  });

  it("links a row to the per-unit view on that agreement", () => {
    expect(agreementDetailHref({ id: "mc-9", orgUnitId: "paphos-general" })).toBe("/maintenance/plan?view=agreement&unit=paphos-general&agreement=mc-9");
  });
});
