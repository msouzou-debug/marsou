import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatDate } from "@/lib/format";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildRfis } from "./fixture";
import { Rfis } from "./Rfis";

const noPermission = <div>no permission</div>;
const contract = buildContractDetail();
const now = new Date("2026-09-19T09:00:00.000Z");

describe("Rfis — R09, ADR-0017", () => {
  it("shows the answered date in mono once an RFI is answered, replacing the SlaChip", () => {
    const rfis = buildRfis(now);
    renderWithIntl(
      <Rfis contract={contract} rfis={rfis} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />,
    );

    const closedRow = rfis.find((r) => r.status === "CLOSED")!;
    const closedRowElement = screen.getByText(closedRow.questionEl).closest("tr")!;
    // The answered date, not a chip — RfiSheet is not open so this is the
    // table's own Προθεσμία column.
    expect(closedRowElement.textContent).toContain(formatDate(closedRow.answeredAt!));

    const openRow = rfis.find((r) => r.status === "OPEN" && r.slaState === "GREEN")!;
    const openRowElement = screen.getByText(openRow.questionEl).closest("tr")!;
    // A live chip for the still-open one.
    expect(openRowElement.querySelector("[class*='rounded-k-chip']")).not.toBeNull();
  });

  it("counts open and breached RFIs in the mono summary line", () => {
    renderWithIntl(
      <Rfis contract={contract} rfis={buildRfis(now)} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />,
    );
    // 2 OPEN (one breached, one green), 1 CLOSED — 2 open, 1 breached.
    expect(screen.getByText("2 ανοιχτά · 1 εκπρόθεσμα")).toBeInTheDocument();
  });

  it("hides «Προσθήκη» for a role that may read but not write the log (technician)", () => {
    renderWithIntl(
      <Rfis contract={contract} rfis={buildRfis(now)} state="default" noPermission={noPermission} roles={["technician"]} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Προσθήκη" })).not.toBeInTheDocument();
  });

  it("renders noPermission verbatim", () => {
    renderWithIntl(<Rfis state="noPermission" noPermission={<div>ασχετο</div>} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />);
    expect(screen.getByText("ασχετο")).toBeInTheDocument();
  });
});
