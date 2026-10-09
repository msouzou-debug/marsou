import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { buildMaintenanceSummary, buildWorkOrderList } from "@/mocks/maintenance";
import { NO_WORK_ORDER_FILTERS, WorkOrders, type WorkOrdersProps } from "./WorkOrders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/maintenance",
  useSearchParams: () => new URLSearchParams(),
}));

function renderList(overrides: Partial<WorkOrdersProps> = {}) {
  const props: WorkOrdersProps = {
    summary: buildMaintenanceSummary(),
    summaryState: "default",
    data: buildWorkOrderList(),
    state: "default",
    filters: NO_WORK_ORDER_FILTERS,
    orgUnits: [],
    onFilters: vi.fn(),
    canRaise: true,
    canViewScorecard: true,
    noPermission: <p>no-permission-marker</p>,
    ...overrides,
  };
  renderWithIntl(<WorkOrders {...props} />);
  return props;
}

/** The table's own copy of a row (the phone cards render the ref too). */
function tableRow(ref: string): HTMLTableRowElement {
  return screen
    .getAllByText(ref)
    .map((el) => el.closest("tr"))
    .find((tr): tr is HTMLTableRowElement => tr !== null)!;
}

function cellUnder(row: HTMLTableRowElement, header: string): HTMLElement {
  const th = screen.getByRole("columnheader", { name: new RegExp(`^${header}`) });
  const index = Array.from(th.parentElement!.children).indexOf(th);
  return row.children[index] as HTMLElement;
}

describe("S18 WorkOrders", () => {
  it("shows the six summary tiles, the unfunded backlog as money", () => {
    renderList();
    for (const label of [
      "Ανοιχτές εντολές",
      "Εκπρόθεσμη ανταπόκριση",
      "Εκπρόθεσμη αποκατάσταση",
      "Προληπτικές του μήνα",
      "Εκπρόθεσμες προληπτικές",
      "Εκκρεμότητες χωρίς χρηματοδότηση",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // The thin space inside «412.500 €» is whitespace to the default normalizer, so match the raw text.
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === formatEUR(412_500))).toBeInTheDocument();
  });

  it("keeps the export button while loading", () => {
    renderList({ data: undefined, state: "loading", summary: undefined, summaryState: "loading" });
    expect(screen.getByRole("button", { name: /Εξαγωγή/ })).toBeInTheDocument();
  });

  // RULE (ADR-0031 §3): a PM order has one deadline, the programme date, in the restore slot.
  it("shows a PM order's due date only, and dashes for its response and report", () => {
    renderList();
    const row = tableRow("NGH-WO-2026-0043");
    expect(within(cellUnder(row, "Αποκατάσταση")).getByText("Έως 15/10/2026")).toBeInTheDocument();
    expect(cellUnder(row, "Ανταπόκριση").textContent).toBe("—");
    expect(cellUnder(row, "Γραπτή έκθεση").textContent).toBe("—");
  });

  it("shows a met response timer as «Εντός χρόνου» instead of a countdown", () => {
    renderList();
    const row = tableRow("NGH-WO-2026-0042");
    expect(cellUnder(row, "Ανταπόκριση").textContent).toBe("Εντός χρόνου");
  });

  // RULE (ADR-0031 §4): escalation is a visible flag with a word, not colour alone.
  it("marks an escalated order in its own column", () => {
    renderList();
    expect(cellUnder(tableRow("NGH-WO-2026-0039"), "Κλιμάκωση").textContent).toBe("Κλιμάκωση");
    expect(cellUnder(tableRow("NGH-WO-2026-0042"), "Κλιμάκωση").textContent).toBe("");
  });

  it("offers «Νέα κλήση» only to a role that may raise a call", () => {
    renderList({ canRaise: false });
    expect(screen.queryByRole("link", { name: "Νέα κλήση" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Πρόγραμμα προληπτικής" })).toHaveAttribute("href", "/maintenance/plan");
    expect(screen.getByRole("link", { name: "Εκκρεμότητες" })).toHaveAttribute("href", "/maintenance/backlog");
  });

  it("links «Νέα κλήση» to S20 and «Αξιολόγηση» to S22", () => {
    renderList();
    expect(screen.getByRole("link", { name: "Νέα κλήση" })).toHaveAttribute("href", "/maintenance/new");
    expect(screen.getByRole("link", { name: "Αξιολόγηση" })).toHaveAttribute("href", "/maintenance/scorecard");
  });

  it("hides «Αξιολόγηση» when the scorecard is not for the caller", () => {
    renderList({ canViewScorecard: false });
    expect(screen.queryByRole("link", { name: "Αξιολόγηση" })).not.toBeInTheDocument();
  });

  it("picks one status at a time, and a second press on it clears the filter", () => {
    const onFilters = vi.fn();
    renderList({ onFilters, filters: { ...NO_WORK_ORDER_FILTERS, status: ["OPEN"] } });
    fireEvent.click(screen.getByRole("button", { name: "Σε παύση" }));
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ status: ["PAUSED"] }));
    fireEvent.click(screen.getByRole("button", { name: "Ανοιχτή" }));
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ status: [] }));
    expect(screen.getByRole("button", { name: "Ανοιχτή" })).toHaveAttribute("aria-pressed", "true");
  });

  // Phone (390px): cards, each one link at least 44px tall; the table is for tablet and up.
  it("renders phone cards next to the table, each a 44px link to S18a", () => {
    renderList();
    const cards = screen.getByRole("list", { name: "Οι εντολές εργασίας" });
    expect(cards.parentElement).toHaveClass("tablet:hidden");
    expect(screen.getByRole("table").closest(".hidden")).toHaveClass("tablet:block");
    const links = within(cards).getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links) expect(link.className).toContain("min-h-[44px]");
    expect(links[0]).toHaveAttribute("href", "/maintenance/wo-1");
  });

  it("renders noPermission instead of the list", () => {
    renderList({ state: "noPermission", data: undefined });
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", () => {
    renderList({ state: "empty", data: { items: [], total: 0 } });
    expect(screen.getByText("Δεν υπάρχουν εντολές εργασίας με αυτά τα κριτήρια.")).toBeInTheDocument();
  });
});
