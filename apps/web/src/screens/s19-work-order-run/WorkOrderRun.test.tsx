import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { WorkOrderDetail } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { buildWorkOrderDetail } from "@/mocks/maintenance";
import { runActions, WorkOrderRun, type WorkOrderRunProps } from "./WorkOrderRun";

function renderRun(overrides: Partial<WorkOrderRunProps> = {}) {
  const props: WorkOrderRunProps = {
    order: buildWorkOrderDetail({ status: "IN_PROGRESS" }),
    state: "default",
    unitName: "Γ.Ν. Λευκωσίας",
    canWork: true,
    noPermission: <p>no-permission-marker</p>,
    onTransition: vi.fn().mockResolvedValue(undefined),
    onUpload: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  renderWithIntl(<WorkOrderRun {...props} />);
  return props;
}

const bar = () => screen.getByRole("group", { name: "Ενέργειες εντολής" });
const barLabels = () => within(bar()).getAllByRole("button").map((b) => b.textContent);
const order = (o: Partial<WorkOrderDetail>) => buildWorkOrderDetail(o);

describe("S19 runActions", () => {
  // RULE (task S19): Έναρξη / Παύση / Ολοκλήρωση, Αποκατάσταση only on a corrective order in progress.
  it("shows only the valid next field actions", () => {
    expect(runActions(order({ status: "OPEN" }), true)).toEqual(["START"]);
    expect(runActions(order({ status: "ACKNOWLEDGED" }), true)).toEqual(["START"]);
    expect(runActions(order({ status: "IN_PROGRESS" }), true)).toEqual(["PAUSE", "RESTORE", "COMPLETE"]);
    expect(runActions(order({ status: "IN_PROGRESS", kind: "PM" }), true)).toEqual(["PAUSE", "COMPLETE"]);
    expect(runActions(order({ status: "PAUSED" }), true)).toEqual(["RESUME"]);
    expect(runActions(order({ status: "RESTORED" }), true)).toEqual(["COMPLETE"]);
    expect(runActions(order({ status: "COMPLETED" }), true)).toEqual([]);
    expect(runActions(order({ status: "IN_PROGRESS" }), false)).toEqual([]);
  });
});

describe("S19 WorkOrderRun", () => {
  it("leads with the asset at 24px, its tag and the location line", () => {
    renderRun();
    expect(screen.getByRole("heading", { level: 1, name: "Ανελκυστήρας Α3" })).toHaveClass("text-fs-24");
    expect(screen.getByText("NGH-LIFT-0003")).toBeInTheDocument();
    expect(screen.getByText("Γ.Ν. Λευκωσίας › Κεντρικός διάδρομος, ισόγειο")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Επιστροφή στην εντολή" })).toHaveAttribute("href", "/maintenance/wo-1");
  });

  // Phone: 64px action buttons, a 56px camera button that stays reachable.
  it("pins 64px buttons for the valid actions and a 56px camera button", () => {
    renderRun();
    expect(barLabels()).toEqual(["Παύση", "Αποκατάσταση", "Ολοκλήρωση"]);
    for (const button of within(bar()).getAllByRole("button")) expect(button.className).toContain("min-h-[64px]");
    expect(bar().className).toContain("fixed");
    const camera = screen.getAllByRole("button", { name: "Λήψη φωτογραφίας" }).find((b) => b.className.includes("fixed"))!;
    expect(camera.className).toContain("h-14");
    expect(camera.className).toContain("w-14");
  });

  it("does not offer Αποκατάσταση on a PM order", () => {
    renderRun({ order: order({ status: "IN_PROGRESS", kind: "PM" }) });
    expect(barLabels()).toEqual(["Παύση", "Ολοκλήρωση"]);
  });

  it("starts with one tap", async () => {
    const props = renderRun({ order: order({ status: "OPEN" }) });
    fireEvent.click(within(bar()).getByRole("button", { name: "Έναρξη" }));
    await waitFor(() => expect(props.onTransition).toHaveBeenCalledWith({ action: "START" }));
  });

  // RULE: Ολοκλήρωση opens the note and the codes; the phone sheet carries no cost or time fields.
  it("asks for the codes before completing a corrective order", async () => {
    const props = renderRun();
    fireEvent.click(within(bar()).getByRole("button", { name: "Ολοκλήρωση" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Πραγματικό κόστος (€)")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Πότε έγινε")).not.toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Ολοκλήρωση" });
    expect(submit).toBeDisabled();
    expect(submit.className).toContain("min-h-[64px]");
    fireEvent.change(within(dialog).getByLabelText("Κωδικός βλάβης"), { target: { value: "NO_OUTPUT" } });
    fireEvent.change(within(dialog).getByLabelText("Κωδικός αιτίας"), { target: { value: "WEAR" } });
    fireEvent.change(within(dialog).getByLabelText("Κωδικός επέμβασης"), { target: { value: "REPAIR" } });
    fireEvent.change(within(dialog).getByLabelText("Σημείωση (προαιρετικά)"), { target: { value: "Αλλαγή επαφών" } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(props.onTransition).toHaveBeenCalledWith({ action: "COMPLETE", noteEl: "Αλλαγή επαφών", failureCode: "NO_OUTPUT", causeCode: "WEAR", remedyCode: "REPAIR" }),
    );
  });

  it("ticks the checklist lines locally", () => {
    renderRun({ order: order({ kind: "PM", status: "IN_PROGRESS", checklistEl: "Έλεγχος πιέσεων\nΚαθαρισμός φίλτρων\n" }) });
    expect(screen.getByText("0 από 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Καθαρισμός φίλτρων" }));
    expect(screen.getByText("1 από 2")).toBeInTheDocument();
  });

  // RULE (ADR-0031 §12): no queue in M5 — the chip shows only offline, and writes wait for the network.
  it("shows the offline chip and disables the bar only when the browser is offline", () => {
    renderRun({ state: "offline" });
    expect(screen.getByText(/Εκτός σύνδεσης/)).toBeInTheDocument();
    for (const button of within(bar()).getAllByRole("button")) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Χρειάζεται σύνδεση. Η ενέργεια δεν αποθηκεύεται εκτός σύνδεσης.");
    }
  });

  it("shows no offline chip online", () => {
    renderRun();
    expect(screen.queryByText(/Εκτός σύνδεσης/)).not.toBeInTheDocument();
  });

  it("has no bar for a role that cannot work orders", () => {
    renderRun({ canWork: false });
    expect(screen.queryByRole("group", { name: "Ενέργειες εντολής" })).not.toBeInTheDocument();
    expect(screen.getByText("Βλέπετε την εντολή χωρίς δικαίωμα να την προχωρήσετε.")).toBeInTheDocument();
  });

  it("uploads a photo from the camera input", async () => {
    const props = renderRun();
    const file = new File(["x"], "panel.jpg", { type: "image/jpeg" });
    const input = screen.getAllByLabelText("Λήψη φωτογραφίας").find((el) => el.tagName === "INPUT")!;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(props.onUpload).toHaveBeenCalledWith(file, "panel.jpg"));
  });
});
