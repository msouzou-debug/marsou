import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { OfflineChip } from "./OfflineChip";

describe("OfflineChip — never hidden while anything is queued", () => {
  it("is hidden when online with nothing queued", () => {
    const { container } = renderWithIntl(<OfflineChip status="online" queued={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still shows the queued message when online but records remain queued", () => {
    renderWithIntl(<OfflineChip status="online" queued={2} />);
    expect(screen.getByText("Εκτός σύνδεσης — 2 εγγραφές σε αναμονή")).toBeInTheDocument();
  });

  it("shows the amber queued message while offline", () => {
    renderWithIntl(<OfflineChip status="offline" queued={3} />);
    expect(screen.getByText("Εκτός σύνδεσης — 3 εγγραφές σε αναμονή")).toBeInTheDocument();
  });

  it("shows the blue syncing message while flushing", () => {
    renderWithIntl(<OfflineChip status="syncing" queued={3} />);
    expect(screen.getByText("Συγχρονισμός…")).toBeInTheDocument();
  });

  it("shows the red failure message with a working retry link", async () => {
    const onRetry = vi.fn();
    renderWithIntl(<OfflineChip status="failed" queued={1} onRetry={onRetry} />);
    expect(screen.getByText("Αποτυχία συγχρονισμού — 1 εγγραφή")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Επανάληψη"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("omits the retry link when onRetry is not provided", () => {
    renderWithIntl(<OfflineChip status="failed" queued={1} />);
    expect(screen.queryByText("Επανάληψη")).toBeNull();
  });
});
