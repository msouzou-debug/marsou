import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { buildWorkOrderDetail, buildWorkOrderEvent } from "@/mocks/maintenance";
import { WorkOrderDetail, type WorkOrderDetailProps } from "./WorkOrderDetail";

function renderDetail(overrides: Partial<WorkOrderDetailProps> = {}) {
  const props: WorkOrderDetailProps = {
    order: buildWorkOrderDetail(),
    state: "default",
    noPermission: <p>no-permission-marker</p>,
    canWork: true,
    canManageBacklog: true,
    onTransition: vi.fn().mockResolvedValue(undefined),
    onPatch: vi.fn().mockResolvedValue(undefined),
    onNote: vi.fn().mockResolvedValue(undefined),
    onUpload: vi.fn().mockResolvedValue(undefined),
    onToBacklog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  renderWithIntl(<WorkOrderDetail {...props} />);
  return props;
}

function actionsCard() {
  return screen.getByRole("heading", { name: "Ενέργειες" }).closest("section")!;
}

function select(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("S18a WorkOrderDetail", () => {
  // RULE (WORK_ORDER_TRANSITIONS): ACKNOWLEDGED → START, CANCEL.
  it("offers exactly the transitions the order's status allows", () => {
    renderDetail();
    const buttons = within(actionsCard()).getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["Έναρξη", "Ακύρωση εντολής"]);
  });

  it("offers Παύση, Αποκατάσταση and Ολοκλήρωση on an order in progress", () => {
    renderDetail({ order: buildWorkOrderDetail({ status: "IN_PROGRESS" }) });
    const buttons = within(actionsCard()).getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["Παύση", "Αποκατάσταση", "Ολοκλήρωση"]);
  });

  it("offers no action, edit or note to a read-only role", () => {
    renderDetail({ canWork: false, canManageBacklog: false });
    expect(within(actionsCard()).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Βλέπετε την εντολή χωρίς δικαίωμα να την προχωρήσετε.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Εργασία και κόστος" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Εκτέλεση από κινητό/ })).not.toBeInTheDocument();
  });

  it("links to the phone run screen", () => {
    renderDetail();
    expect(screen.getByRole("link", { name: /Εκτέλεση από κινητό/ })).toHaveAttribute("href", "/maintenance/wo-1/run");
  });

  // RULE (ADR-0031 §6): a corrective order cannot complete without all three codes.
  it("keeps «Ολοκλήρωση» disabled until the three codes are picked, then sends them", async () => {
    const props = renderDetail({ order: buildWorkOrderDetail({ status: "RESTORED" }) });
    fireEvent.click(within(actionsCard()).getByRole("button", { name: "Ολοκλήρωση" }));
    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Ολοκλήρωση" });
    expect(submit).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Κωδικός βλάβης"), { target: { value: "CONTROL_FAULT" } });
    fireEvent.change(within(dialog).getByLabelText("Κωδικός αιτίας"), { target: { value: "WEAR" } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Κωδικός επέμβασης"), { target: { value: "REPLACE_PART" } });
    fireEvent.change(within(dialog).getByLabelText("Πραγματικό κόστος (€)"), { target: { value: "850,50" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(props.onTransition).toHaveBeenCalledTimes(1));
    expect(props.onTransition).toHaveBeenCalledWith(
      expect.objectContaining({ action: "COMPLETE", failureCode: "CONTROL_FAULT", causeCode: "WEAR", remedyCode: "REPLACE_PART", costActual: 850.5 }),
    );
  });

  it("completes a PM order without codes", async () => {
    const props = renderDetail({ order: buildWorkOrderDetail({ kind: "PM", status: "IN_PROGRESS", band: "CRITICAL", dueDate: "2026-10-15" }) });
    fireEvent.click(within(actionsCard()).getByRole("button", { name: "Ολοκλήρωση" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Κωδικός βλάβης")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Ολοκλήρωση" }));
    await waitFor(() => expect(props.onTransition).toHaveBeenCalledWith({ action: "COMPLETE" }));
  });

  // RULE (contract `WorkOrderStatus`): a cancel needs a reason.
  it("refuses a cancel without a reason and sends the reason as the note", async () => {
    const props = renderDetail();
    fireEvent.click(within(actionsCard()).getByRole("button", { name: "Ακύρωση εντολής" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ακύρωση εντολής" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Γράψτε γιατί ακυρώνεται η εντολή.");
    expect(props.onTransition).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Αιτιολογία ακύρωσης"), { target: { value: "Διπλή κλήση" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ακύρωση εντολής" }));
    await waitFor(() => expect(props.onTransition).toHaveBeenCalledWith({ action: "CANCEL", noteEl: "Διπλή κλήση" }));
  });

  it("shows the API's sentence when a transition is refused", async () => {
    renderDetail({ onTransition: vi.fn().mockRejectedValue(new Error("Η εντολή άλλαξε στο μεταξύ.")) });
    fireEvent.click(within(actionsCard()).getByRole("button", { name: "Έναρξη" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Έναρξη" }));
    expect(await screen.findByText("Η εντολή άλλαξε στο μεταξύ.")).toBeInTheDocument();
  });

  // RULE (R36): three corrective orders on one asset in twelve months.
  it("warns on the third failure in twelve months", () => {
    renderDetail({ order: buildWorkOrderDetail({ repeatCount: 3 }) });
    expect(screen.getByRole("status")).toHaveTextContent("Τρίτη βλάβη σε δώδεκα μήνες");
  });

  it("does not warn below three", () => {
    renderDetail({ order: buildWorkOrderDetail({ repeatCount: 2 }) });
    expect(screen.queryByText(/βλάβη σε δώδεκα μήνες/)).not.toBeInTheDocument();
  });

  // RULE (contract note 2): an extension is granted with a reason, and the hint gives the contract's 5/15.
  it("asks for a reason before saving an extension", async () => {
    const props = renderDetail();
    expect(screen.getByText(/5 εργάσιμες ημέρες για ανταλλακτικό/)).toHaveTextContent("15 για συμπιεστή ψύκτη");
    select("Παράταση αποκατάστασης (εργάσιμες ημέρες)", "5");
    expect(screen.getByText("Γράψτε γιατί δίνεται η παράταση.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Αποθήκευση" })).toBeDisabled();
    select("Αιτιολογία παράτασης", "Ανταλλακτικό από Ιταλία");
    fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() =>
      expect(props.onPatch).toHaveBeenCalledWith(expect.objectContaining({ extensionDays: 5, extensionReasonEl: "Ανταλλακτικό από Ιταλία" })),
    );
  });

  it("shows the three timers with their deadlines, and «Εντός χρόνου» for the met response", () => {
    renderDetail();
    const card = screen.getByRole("heading", { name: "Χρόνοι σύμβασης" }).closest("section")!;
    expect(within(card).getByText("Εντός χρόνου")).toBeInTheDocument();
    expect(within(card).getAllByText(/^Προθεσμία: /)).toHaveLength(3);
    expect(within(card).getByText("Έγινε: 06/10/2026 08:20")).toBeInTheDocument();
  });

  it("shows only the programme date for a PM order", () => {
    renderDetail({ order: buildWorkOrderDetail({ kind: "PM", status: "OPEN", dueDate: "2026-10-15", sla: { response: null, restore: "GREEN", report: null } }) });
    const card = screen.getByRole("heading", { name: "Χρόνοι σύμβασης" }).closest("section")!;
    expect(within(card).getByText("Ημερομηνία προγράμματος")).toBeInTheDocument();
    expect(within(card).getByText("Έως 15/10/2026")).toBeInTheDocument();
    expect(within(card).queryByText("Ανταπόκριση")).not.toBeInTheDocument();
  });

  it("builds the history from the events, newest first, and lists filed photos", () => {
    renderDetail({
      order: buildWorkOrderDetail({
        events: [
          buildWorkOrderEvent(),
          buildWorkOrderEvent({ id: "ev-9", at: "2026-10-06T07:00:00.000Z", kind: "NOTE", byName: "Α. Τεχνικού", noteEl: "Αναμονή ανταλλακτικού" }),
          buildWorkOrderEvent({ id: "ev-10", at: "2026-10-06T06:00:00.000Z", kind: "PHOTO", byName: "Α. Τεχνικού", documentId: "d-1", documentTitle: "Πίνακας.jpg" }),
        ],
      }),
    });
    expect(screen.getByText("πρόσθεσε σημείωση")).toBeInTheDocument();
    expect(screen.getByText("Αναμονή ανταλλακτικού")).toBeInTheDocument();
    expect(screen.getAllByText("Πίνακας.jpg").length).toBeGreaterThan(0);
  });

  it("sends a backlog item with the band and cost", async () => {
    const props = renderDetail();
    const card = screen.getByRole("heading", { name: "Στις εκκρεμότητες" }).closest("section")!;
    fireEvent.click(within(card).getByRole("button", { name: "Στις εκκρεμότητες" }));
    fireEvent.change(within(card).getByLabelText("Κατηγορία κινδύνου"), { target: { value: "HIGH" } });
    fireEvent.change(within(card).getByLabelText("Εκτίμηση κόστους (€)"), { target: { value: "180000" } });
    fireEvent.click(within(card).getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() =>
      expect(props.onToBacklog).toHaveBeenCalledWith(
        expect.objectContaining({ riskBand: "HIGH", costEstimate: 180000, sourceWorkOrderId: "wo-1", assetId: "asset-2" }),
      ),
    );
    expect(await within(card).findByText("Η εργασία καταχωρίστηκε στις εκκρεμότητες συντήρησης.")).toBeInTheDocument();
  });

  it("renders noPermission instead of the record", () => {
    renderDetail({ state: "noPermission", order: undefined });
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });
});
