import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { Table, type TableColumn } from "./Table";

interface Row {
  id: string;
  category: string;
  forecast: number;
}

const rows: Row[] = [
  { id: "c1", category: "Μελέτες και επίβλεψη", forecast: 178_000 },
  { id: "c2", category: "Οικοδομικές εργασίες", forecast: 1_260_000 },
  { id: "c3", category: "Ηλεκτρομηχανολογικές εγκαταστάσεις", forecast: 790_000 },
];

const columns: Array<TableColumn<Row>> = [
  { id: "category", headerKey: "components.table.sample.category", accessor: (row) => row.category },
  {
    id: "forecast",
    headerKey: "components.costBar.forecast",
    accessor: (row) => row.forecast,
    numeric: true,
    editable: true,
  },
];

function renderTable(props: Partial<ComponentProps<typeof Table<Row>>> = {}) {
  return renderWithIntl(
    <Table<Row>
      tableId="test"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      captionKey="components.table.sample.caption"
      {...props}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("Table", () => {
  it("always renders the export button and disables it while loading", async () => {
    const onExport = vi.fn();
    const { unmount } = renderTable({ state: "loading", onExport });

    const loadingButton = screen.getByRole("button", { name: /Εξαγωγή σε Excel/ });
    expect(loadingButton).toBeDisabled();
    unmount();

    renderTable({ state: "default", onExport });
    const button = screen.getByRole("button", { name: /Εξαγωγή σε Excel/ });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("keeps the export button rendered but disabled when offline, with the reason in the title", () => {
    renderTable({ state: "offline" });
    const button = screen.getByRole("button", { name: /Εξαγωγή σε Excel/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("Εκτός σύνδεσης"));
  });

  it("saves an inline edit on Enter", async () => {
    const onCellEdit = vi.fn();
    renderTable({ onCellEdit });

    await userEvent.dblClick(screen.getByText("178000"));
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "185000{Enter}");

    expect(onCellEdit).toHaveBeenCalledWith(rows[0], "forecast", "185000");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("cancels an inline edit on Esc and leaves the stored value alone", async () => {
    const onCellEdit = vi.fn();
    renderTable({ onCellEdit });

    await userEvent.dblClick(screen.getByText("178000"));
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "999999{Escape}");

    expect(onCellEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("178000")).toBeInTheDocument();
  });

  it("moves row focus with the arrow keys and opens the focused row on Enter", async () => {
    const onRowOpen = vi.fn();
    renderTable({ onRowOpen });

    const bodyRows = screen.getAllByRole("row").slice(1);
    act(() => bodyRows[0].focus());
    expect(bodyRows[0]).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(bodyRows[1]).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(bodyRows[2]).toHaveFocus();

    // Stops at the last row rather than wrapping.
    await userEvent.keyboard("{ArrowDown}");
    expect(bodyRows[2]).toHaveFocus();

    await userEvent.keyboard("{ArrowUp}");
    expect(bodyRows[1]).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(onRowOpen).toHaveBeenCalledWith(rows[1]);
  });

  it("does not start an inline edit while offline", async () => {
    const onCellEdit = vi.fn();
    renderTable({ state: "offline", onCellEdit });

    await userEvent.dblClick(screen.getByText("178000"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("persists the density choice under the table's own key", async () => {
    renderTable({ tableId: "s04-cost" });
    await userEvent.click(screen.getByRole("button", { name: "Άνετη" }));
    expect(window.localStorage.getItem("ecapital.table.s04-cost.density")).toBe("comfortable");
  });

  it("marks numeric headers as sortable columns and announces the sort state", async () => {
    renderTable();
    const header = screen.getByRole("columnheader", { name: /Πρόβλεψη τελικού κόστους/ });
    expect(header).toHaveAttribute("aria-sort", "none");

    // TanStack sorts money columns descending first; either direction is a
    // correct announcement, what matters is that the header stops saying "none".
    await userEvent.click(screen.getByRole("button", { name: /Πρόβλεψη τελικού κόστους/ }));
    expect(header.getAttribute("aria-sort")).toMatch(/^(ascending|descending)$/);

    await userEvent.click(screen.getByRole("button", { name: /Πρόβλεψη τελικού κόστους/ }));
    expect(header.getAttribute("aria-sort")).toMatch(/^(ascending|descending)$/);
  });

  it("shows one sentence and one action in the empty state", () => {
    const onAction = vi.fn();
    renderTable({
      state: "empty",
      rows: [],
      emptyState: {
        messageKey: "components.table.sample.emptyMessage",
        actionLabelKey: "buttons.add",
        onAction,
      },
    });
    expect(
      screen.getByText("Δεν έχουν καταχωριστεί κατηγορίες κόστους για αυτό το έργο."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Προσθήκη" })).toBeInTheDocument();
  });

  // RULE: a caller without the role to act omits `onAction` rather than
  // wiring a button that would only ever come back 403 (`@/auth/roles`'s
  // own convention) — the sentence still has to render on its own.
  it("shows the empty sentence with no action button when the caller may not act", () => {
    renderTable({
      state: "empty",
      rows: [],
      emptyState: { messageKey: "components.table.sample.emptyMessage", actionLabelKey: "buttons.add" },
    });
    expect(screen.getByText("Δεν έχουν καταχωριστεί κατηγορίες κόστους για αυτό το έργο.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Προσθήκη" })).not.toBeInTheDocument();
  });

  it("offers a retry in the error state and says who to ask in the no-permission state", async () => {
    const onRetry = vi.fn();
    const { unmount } = renderTable({ state: "error", onRetry });
    await userEvent.click(screen.getByRole("button", { name: "Δοκιμάστε ξανά" }));
    expect(onRetry).toHaveBeenCalledOnce();
    unmount();

    renderTable({ state: "noPermission" });
    expect(screen.getByText("Δεν έχετε πρόσβαση σε αυτή τη σελίδα.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("reports the selected row ids when selectable", async () => {
    const onSelectionChange = vi.fn();
    renderTable({ selectable: true, onSelectionChange });

    await userEvent.click(screen.getAllByRole("checkbox", { name: "Επιλογή γραμμής" })[1]);
    expect(onSelectionChange).toHaveBeenLastCalledWith(["c2"]);
  });
});
