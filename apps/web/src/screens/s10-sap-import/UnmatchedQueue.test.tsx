import { describe, expect, it, vi } from "vitest";
import type { AppRole } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { UnmatchedQueue } from "./UnmatchedQueue";
import { buildImportBatch, buildUnmatchedQueue } from "./fixture";

const noPermission = <div>δεν έχετε πρόσβαση</div>;
const noop = () => undefined;

const baseProps = {
  batch: buildImportBatch(),
  state: "default" as const,
  noPermission,
  roles: ["finance"] as AppRole[],
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

describe("UnmatchedQueue (S10)", () => {
  it("shows the 20px mono «Απομένουν N από M» counter", () => {
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={buildUnmatchedQueue(3)} />);
    const counter = document.querySelector("p.font-k-mono.text-fs-20");
    expect(counter?.textContent).toContain("Απομένουν 3 από 47");
  });

  it("shows the suggestion panel for the focused row", () => {
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={buildUnmatchedQueue(3)} focusedIndex={0} />);
    expect(document.body.textContent).toContain("Υψηλή αντιστοιχία");
  });

  // RULE (build brief §5 S10): Enter accepts the top suggestion.
  it("Enter accepts the top suggestion for the focused row", () => {
    const onAccept = vi.fn();
    const queue = buildUnmatchedQueue(3);
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={queue} focusedIndex={0} onAccept={onAccept} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onAccept).toHaveBeenCalledWith(queue.items[0]!.txn.id, 0);
  });

  it("digit 1 picks the first numbered suggestion", () => {
    const onAccept = vi.fn();
    const queue = buildUnmatchedQueue(3);
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={queue} focusedIndex={1} onAccept={onAccept} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
    expect(onAccept).toHaveBeenCalledWith(queue.items[1]!.txn.id, 0);
  });

  it("'s' skips the focused row", () => {
    const onSkip = vi.fn();
    const queue = buildUnmatchedQueue(3);
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={queue} focusedIndex={2} onSkip={onSkip} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    expect(onSkip).toHaveBeenCalledWith([queue.items[2]!.txn.id]);
  });

  it("Space toggles the focused row's selection", () => {
    const onToggleSelect = vi.fn();
    const queue = buildUnmatchedQueue(3);
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={queue} focusedIndex={0} onToggleSelect={onToggleSelect} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(onToggleSelect).toHaveBeenCalledWith(queue.items[0]!.txn.id);
  });

  it("Shift+A opens the bulk-assign picker", () => {
    const onBulkAssignOpen = vi.fn();
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={buildUnmatchedQueue(3)} onBulkAssignOpen={onBulkAssignOpen} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "A", shiftKey: true }));
    expect(onBulkAssignOpen).toHaveBeenCalledOnce();
  });

  // RULE: the keyboard is inert while the bulk-assign picker is open.
  it("does not accept via Enter while the bulk-assign picker is open", () => {
    const onAccept = vi.fn();
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={buildUnmatchedQueue(3)} onAccept={onAccept} pickerOpen />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("shows the done message once every transaction is matched", () => {
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={buildUnmatchedQueue(0)} />);
    expect(document.body.textContent).toContain("Όλες οι κινήσεις αντιστοιχίστηκαν");
  });

  it("shows a read-only list at phone width markup (tablet:hidden branch) with no checkboxes", () => {
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={buildUnmatchedQueue(2)} />);
    const phoneBranch = document.querySelector(".tablet\\:hidden");
    expect(phoneBranch?.querySelector("input[type=checkbox]")).toBeNull();
  });

  // RULE (screenshot review 19/09/2026, build brief §5 S10): «Κέντρο
  // κόστους» starts hidden so the left pane's more useful columns (WBS, PO)
  // are not squeezed off screen, and can be switched back on.
  it("hides «Κέντρο κόστους» by default and shows it once switched on", () => {
    const queue = buildUnmatchedQueue(1);
    renderWithIntl(<UnmatchedQueue {...baseProps} queue={queue} />);
    const desktopPane = document.querySelector(".hidden.tablet\\:block") as HTMLElement;
    expect(desktopPane.querySelector("th[scope=col]")?.parentElement?.textContent).not.toContain("Κέντρο κόστους");

    const toggle = desktopPane.querySelector("input[type=checkbox]:not([aria-label])") as HTMLInputElement;
    toggle.click();
    expect(desktopPane.textContent).toContain("Κέντρο κόστους");
  });

  it("returns just the noPermission node for the noPermission state", () => {
    renderWithIntl(<UnmatchedQueue {...baseProps} state="noPermission" />);
    expect(document.body.textContent).toBe("δεν έχετε πρόσβαση");
  });
});
