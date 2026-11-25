import { afterEach, describe, expect, it, onTestFinished, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  // UAT 25/11/2026: with no `onExport`, the button exports what the table
  // shows through `POST /exports/table` instead of doing nothing.
  it("exports what it shows through the generic route when no onExport is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["xlsx"]), {
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": "attachment; filename=\"x.xlsx\"; filename*=UTF-8''%CE%9A%CF%8C%CF%83%CF%84%CE%BF%CF%82-2026-11-25.xlsx",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // jsdom has no object URLs; give it two for this test only.
    const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn().mockReturnValue("blob:export");
    URL.revokeObjectURL = vi.fn();
    onTestFinished(() => {
      URL.createObjectURL = saved.create;
      URL.revokeObjectURL = saved.revoke;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderTable();
    // Sorted on screen by forecast, descending: the export follows the screen.
    const forecastHeader = screen.getByRole("button", { name: /Πρόβλεψη/ });
    await userEvent.click(forecastHeader);
    expect(forecastHeader.closest("th")).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(screen.getByRole("button", { name: /Εξαγωγή σε Excel/ }));

    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/exports/table");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.title).toBe("Κόστος ανά κατηγορία — Ανακαίνιση χειρουργείων Γ.Ν. Λάρνακας");
    expect(body.columns).toEqual([
      { header: "Κατηγορία κόστους", numeric: false, kind: "text" },
      { header: "Πρόβλεψη τελικού κόστους", numeric: true, kind: "money" },
    ]);
    expect(body.rows).toEqual([
      ["Οικοδομικές εργασίες", 1_260_000],
      ["Ηλεκτρομηχανολογικές εγκαταστάσεις", 790_000],
      ["Μελέτες και επίβλεψη", 178_000],
    ]);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe("Κόστος-2026-11-25.xlsx");
    expect(screen.getByRole("button", { name: /Εξαγωγή σε Excel/ })).toBeEnabled();
  });

  it("leaves a hidden column out of the generic export and says so when the export fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: "errors.tableExportNotValid", message: "Η εξαγωγή δεν έγινε." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderTable();
    await userEvent.click(screen.getByText("Στήλες"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Κατηγορία κόστους" }));
    await userEvent.click(screen.getByRole("button", { name: /Εξαγωγή σε Excel/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Η εξαγωγή δεν έγινε.");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.columns.map((c: { header: string }) => c.header)).toEqual(["Πρόβλεψη τελικού κόστους"]);
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

  it("opens a row on a click too, but not a click on a control inside it (UAT 25/11/2026)", async () => {
    const onRowOpen = vi.fn();
    renderTable({ onRowOpen, selectable: true });

    const bodyRows = screen.getAllByRole("row").slice(1);
    await userEvent.click(bodyRows[2].querySelectorAll("td")[1]);
    expect(onRowOpen).toHaveBeenCalledWith(rows[2]);

    onRowOpen.mockClear();
    await userEvent.click(within(bodyRows[0]).getByRole("checkbox"));
    expect(onRowOpen).not.toHaveBeenCalled();
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

  // M6 reports: the totals row sits under the rows and never sorts in with them.
  it("keeps the totals row last whatever the sort", async () => {
    renderTable({ totals: { category: "Σύνολο-δείγμα", forecast: "2.228.000" } });
    const lastRow = () => {
      const all = screen.getAllByRole("row");
      return all[all.length - 1];
    };
    expect(lastRow()).toHaveTextContent("Σύνολο-δείγμα2.228.000");
    await userEvent.click(screen.getByRole("button", { name: /Πρόβλεψη τελικού κόστους/ }));
    expect(lastRow()).toHaveTextContent("Σύνολο-δείγμα");
    await userEvent.click(screen.getByRole("button", { name: /Πρόβλεψη τελικού κόστους/ }));
    expect(lastRow()).toHaveTextContent("Σύνολο-δείγμα");
  });

  it("draws no totals row while loading or empty", () => {
    const { unmount } = renderTable({ state: "loading", totals: { category: "Σύνολο-δείγμα" } });
    expect(screen.queryByText("Σύνολο-δείγμα")).not.toBeInTheDocument();
    unmount();
    renderTable({ rows: [], totals: { category: "Σύνολο-δείγμα" } });
    expect(screen.queryByText("Σύνολο-δείγμα")).not.toBeInTheDocument();
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
