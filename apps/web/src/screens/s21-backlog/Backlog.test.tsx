import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { buildBacklogItem, buildBacklogList, buildBacklogSummary } from "@/mocks/maintenance";
import { Backlog, NO_BACKLOG_FILTERS, type BacklogProps } from "./Backlog";
import { backlogExportHref } from "./BacklogScreen";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/maintenance/backlog",
  useSearchParams: () => new URLSearchParams(),
}));

function renderBacklog(overrides: Partial<BacklogProps> = {}) {
  const props: BacklogProps = {
    summary: buildBacklogSummary(),
    summaryState: "default",
    data: buildBacklogList(),
    state: "default",
    filters: NO_BACKLOG_FILTERS,
    orgUnits: [],
    onFilters: vi.fn(),
    canManage: true,
    canFund: true,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onPatch: vi.fn().mockResolvedValue(undefined),
    onToProject: vi.fn().mockResolvedValue({ projectId: "p-90", projectCode: "NGH-2026-044" }),
    onExport: vi.fn(),
    noPermission: <p>no-permission-marker</p>,
    ...overrides,
  };
  renderWithIntl(<Backlog {...props} />);
  return props;
}

const exact = (text: string) => (_: string, el: Element | null) => el?.textContent === text;

describe("S21 Backlog", () => {
  it("totals by unit and band, with the funded and unfunded split", () => {
    renderBacklog();
    const summary = screen.getByRole("table", { name: "Σύνολα ανά μονάδα και κατηγορία κινδύνου" });
    const row = within(summary).getByRole("rowheader", { name: "Γ.Ν. Λευκωσίας" }).closest("tr")!;
    expect(within(row).getByText(exact(`3 εργασίες · ${formatEUR(390_000)}`))).toBeInTheDocument();
    expect(within(row).getByText(exact(`χρηματοδοτημένες ${formatEUR(42_500)} · χωρίς χρηματοδότηση ${formatEUR(22_500)}`))).toBeInTheDocument();
    // The four band headers carry their names, not colour alone.
    for (const band of ["Υψηλή", "Σημαντική", "Μέτρια", "Χαμηλή"]) expect(within(summary).getByRole("columnheader", { name: band })).toBeInTheDocument();
  });

  it("shows the auto-draft reason and the source order on the row", () => {
    renderBacklog();
    expect(screen.getByText("Αυτόματη πρόταση: τρεις διορθωτικές εντολές σε δώδεκα μήνες")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "NGH-WO-2026-0042" })).toHaveAttribute("href", "/maintenance/wo-1");
    expect(screen.getByRole("link", { name: "NGH-2026-031" })).toHaveAttribute("href", "/projects/p-77");
  });

  it("downloads the Excel from the table's export button", () => {
    const props = renderBacklog();
    fireEvent.click(screen.getByRole("button", { name: /Εξαγωγή σε Excel/ }));
    expect(props.onExport).toHaveBeenCalled();
    expect(backlogExportHref("nicosia-general")).toBe("/api/proxy/backlog/export.xlsx?orgUnitId=nicosia-general");
  });

  // RULE (ADR-0031 §7): «Σε έργο» asks first, then links to the new project.
  it("turns an open item into a project after a confirmation, then links to it", async () => {
    const props = renderBacklog();
    fireEvent.click(screen.getByRole("button", { name: "Αντικατάσταση ανελκυστήρα Α3" }));
    const drawer = screen.getByRole("complementary");
    expect(within(drawer).getByText(/NGH-WO-2026-0011/)).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "Σε έργο" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Να γίνει έργο η εκκρεμότητα;")).toBeInTheDocument();
    expect(props.onToProject).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Σε έργο" }));
    await waitFor(() => expect(props.onToProject).toHaveBeenCalledWith("bl-1"));
    expect(await within(drawer).findByRole("link", { name: "Άνοιγμα έργου" })).toHaveAttribute("href", "/projects/p-90");
    expect(within(drawer).getByText(/Δημιουργήθηκε το έργο NGH-2026-044/)).toBeInTheDocument();
  });

  it("does not offer «Σε έργο» to an engineer", () => {
    renderBacklog({ canFund: false });
    fireEvent.click(screen.getByRole("button", { name: "Αντικατάσταση ανελκυστήρα Α3" }));
    expect(within(screen.getByRole("complementary")).queryByRole("button", { name: "Σε έργο" })).not.toBeInTheDocument();
  });

  it("does not offer «Σε έργο» on an item that is already funded", () => {
    renderBacklog({ data: { items: [buildBacklogItem({ status: "FUNDED", targetProjectId: "p-77", targetProjectCode: "NGH-2026-031" })], total: 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Αντικατάσταση ανελκυστήρα Α3" }));
    const drawer = screen.getByRole("complementary");
    expect(within(drawer).queryByRole("button", { name: "Σε έργο" })).not.toBeInTheDocument();
    expect(within(drawer).getByText("Χρηματοδοτείται από το έργο")).toBeInTheDocument();
  });

  it("edits an item's band and cost", async () => {
    const props = renderBacklog();
    fireEvent.click(screen.getByRole("button", { name: "Αντικατάσταση ανελκυστήρα Α3" }));
    const drawer = screen.getByRole("complementary");
    fireEvent.change(within(drawer).getByLabelText("Κατηγορία κινδύνου"), { target: { value: "SIGNIFICANT" } });
    fireEvent.change(within(drawer).getByLabelText("Εκτίμηση κόστους"), { target: { value: "150.000" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(props.onPatch).toHaveBeenCalledWith("bl-1", expect.objectContaining({ riskBand: "SIGNIFICANT", costEstimate: 150000 })));
  });

  it("hides «Προσθήκη» and the edit form for a read-only role", () => {
    renderBacklog({ canManage: false, canFund: false });
    expect(screen.queryByRole("button", { name: "Προσθήκη" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Αντικατάσταση ανελκυστήρα Α3" }));
    expect(within(screen.getByRole("complementary")).queryByRole("button", { name: "Αποθήκευση" })).not.toBeInTheDocument();
  });

  it("filters to auto-drafted items", () => {
    const props = renderBacklog();
    fireEvent.click(screen.getByRole("checkbox", { name: "Μόνο αυτόματες προτάσεις" }));
    expect(props.onFilters).toHaveBeenCalledWith(expect.objectContaining({ autoOnly: true }));
  });

  it("renders noPermission", () => {
    renderBacklog({ state: "noPermission", data: undefined });
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });
});
