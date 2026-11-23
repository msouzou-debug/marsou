import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { ApiError } from "@/data/client";
import { renderWithIntl } from "@/test/render";
import { ConnectorCard } from "./ConnectorCard";
import { connectorOutcome, postSapConnector } from "./connector";
import { Imports } from "./Imports";
import { UnmatchedQueue } from "./UnmatchedQueue";
import { buildCapexBatch, buildCapexQueue, buildImportBatch } from "./fixture";

const noop = () => undefined;
const noPermission = <div>δεν έχετε πρόσβαση</div>;

afterEach(() => vi.unstubAllGlobals());

describe("S10 upload select (ADR-0036)", () => {
  it("offers only the active reports, CAPEX_LINES first and selected", () => {
    renderWithIntl(<Imports data={[]} state="empty" noPermission={noPermission} roles={["finance"]} onRowOpen={noop} onUpload={noop} />);
    const select = document.getElementById("s10-report") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => [o.value, o.textContent]);
    expect(options).toEqual([
      ["CAPEX_LINES", "Γραμμές κεφαλαιουχικών δαπανών SAP"],
      ["FBL1N", "FBL1N"],
    ]);
    expect(select.value).toBe("CAPEX_LINES");
  });

  it("keeps showing the retired reports on old batches", () => {
    renderWithIntl(
      <Imports
        data={[buildImportBatch({ report: "ME2N", fileName: "old-me2n.csv" }), buildCapexBatch()]}
        state="default"
        noPermission={noPermission}
        roles={["finance"]}
        onRowOpen={noop}
        onUpload={noop}
      />,
    );
    const body = document.querySelector("tbody")!;
    expect(body.textContent).toContain("ME2N");
    expect(body.textContent).toContain("Γραμμές κεφαλαιουχικών δαπανών SAP");
  });
});

describe("S10 connector card (ADR-0036)", () => {
  it("defaults to the previous month of the current year and sends the numbers", () => {
    const onSubmit = vi.fn();
    renderWithIntl(<ConnectorCard canImport today="2026-11-23" onSubmit={onSubmit} />);
    expect(screen.getByLabelText("Οικονομικό έτος")).toHaveValue(2026);
    expect(screen.getByLabelText(/Περίοδος από/)).toHaveValue(10);
    expect(screen.getByLabelText(/Περίοδος έως/)).toHaveValue(10);
    fireEvent.click(screen.getByRole("button", { name: "Λήψη" }));
    expect(onSubmit).toHaveBeenCalledWith({ fiscalYear: 2026, periodFrom: 10, periodTo: 10 });
  });

  it("looks back to December of the year before in January", () => {
    renderWithIntl(<ConnectorCard canImport today="2027-01-05" onSubmit={noop} />);
    expect(screen.getByLabelText("Οικονομικό έτος")).toHaveValue(2026);
    expect(screen.getByLabelText(/Περίοδος από/)).toHaveValue(12);
  });

  it("refuses a period outside 1–16 without calling", () => {
    const onSubmit = vi.fn();
    renderWithIntl(<ConnectorCard canImport today="2026-11-23" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Περίοδος έως/), { target: { value: "17" } });
    fireEvent.click(screen.getByRole("button", { name: "Λήψη" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the not-configured sentence as an info notice, not an alert", () => {
    renderWithIntl(<ConnectorCard canImport today="2026-11-23" notice="Η σύνδεση με το SAP δεν έχει ρυθμιστεί ακόμη." onSubmit={noop} />);
    expect(screen.getByRole("status")).toHaveTextContent("Η σύνδεση με το SAP δεν έχει ρυθμιστεί ακόμη.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing for a role that cannot import", () => {
    renderWithIntl(<Imports data={[]} state="empty" noPermission={noPermission} roles={["project_engineer"]} onRowOpen={noop} onUpload={noop} onConnector={noop} />);
    expect(screen.queryByRole("button", { name: "Λήψη" })).toBeNull();
  });

  it("is on the S10 screen for finance", () => {
    renderWithIntl(<Imports data={[]} state="empty" noPermission={noPermission} roles={["finance"]} onRowOpen={noop} onUpload={noop} onConnector={noop} />);
    expect(screen.getByRole("heading", { name: "Λήψη από το SAP" })).toBeInTheDocument();
  });

  it("posts to /api/proxy/cost/imports/sap-connector with the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(buildCapexBatch()), { status: 201, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const batch = await postSapConnector({ fiscalYear: 2026, periodFrom: 10, periodTo: 10 });
    expect(batch.id).toBe("batch-capex-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/cost/imports/sap-connector");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ fiscalYear: 2026, periodFrom: 10, periodTo: 10, dryRun: false });
  });

  it("reads costSourceNotConfigured as a notice and any other failure as an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: "errors.costSourceNotConfigured", message: "Η σύνδεση δεν έχει ρυθμιστεί." }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const error = await postSapConnector({ fiscalYear: 2026, periodFrom: 1, periodTo: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(connectorOutcome(error)).toEqual({ kind: "notice", message: "Η σύνδεση δεν έχει ρυθμιστεί." });
    expect(connectorOutcome(new ApiError("Σφάλμα", 500, "errors.server")).kind).toBe("error");
  });
});

describe("S10 queue labels (ADR-0036)", () => {
  const props = {
    batch: buildCapexBatch(),
    state: "default" as const,
    noPermission,
    roles: ["finance" as const],
    focusedIndex: 0,
    selectedIds: new Set<string>(),
    onMoveFocus: noop,
    onAccept: noop,
    onSkip: noop,
    onToggleSelect: noop,
    onCommit: noop,
    pickerOpen: false,
    onBulkAssignOpen: noop,
    onBulkAssignClose: noop,
    onBulkAssign: noop,
    bulkAssignSearch: "",
    onBulkAssignSearchChange: noop,
    bulkAssignProjectResults: [],
    bulkAssignProjectId: null,
    onBulkAssignSelectProject: noop,
    bulkAssignContractOptions: [],
    bulkAssignContractId: null,
    onBulkAssignSelectContract: noop,
  };

  it("shows vendor number and contract reference in a mono line, and the match labels", () => {
    renderWithIntl(<UnmatchedQueue {...props} queue={buildCapexQueue()} />);
    const table = document.querySelector("table")!;
    const mono = within(table).getByText("100234 · CAP-2026-0012");
    expect(mono).toHaveClass("font-k-mono");
    expect(within(table).getByText("100871")).toBeInTheDocument();
    expect(within(table).getByText("Αναφορά σύμβασης")).toBeInTheDocument();
    expect(within(table).getByText("Τιμολόγιο eFinance")).toBeInTheDocument();
  });

  it("has the English labels", () => {
    renderWithIntl(<UnmatchedQueue {...props} queue={buildCapexQueue()} />, { locale: "en" });
    const table = document.querySelector("table")!;
    expect(within(table).getByText("Contract reference")).toBeInTheDocument();
    expect(within(table).getByText("eFinance invoice")).toBeInTheDocument();
  });
});
