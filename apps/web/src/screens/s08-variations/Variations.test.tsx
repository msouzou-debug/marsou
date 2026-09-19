import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { buildContractDetail } from "../s07-contract/fixture";
import { Variations } from "./Variations";

const noPermission = <div>no permission</div>;
const noop = () => undefined;

// Nit 2: phone renders compact cards (number, description, value, status
// chip, decision line) next to the desktop Table — jsdom has no viewport, so
// both render in the DOM at once (the same `tablet:hidden`/`hidden
// tablet:block` split S02's own ProjectCards test relies on); this asserts
// the card content itself is there.
describe("Variations — nit 2, phone cards", () => {
  it("renders a compact card per variation with its number, description, value and status", () => {
    const data = buildContractDetail();
    renderWithIntl(
      <Variations data={data} state="default" noPermission={noPermission} roles={["estates_head"]} meUserId="user-admin" onSelect={vi.fn()} onSave={noop} onSubmit={noop} onDecide={noop} />,
    );

    const variation = data.variations[0];
    // The card's own number badge, e.g. "#1" — distinct from the table's
    // separate "Α/Α" column cell, which renders the bare digit.
    expect(screen.getByText(`#${variation.number}`)).toBeInTheDocument();
    // The description and the value both appear at least twice: once in the
    // table row, once in the card.
    expect(screen.getAllByText(variation.descriptionEl).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(formatEUR(variation.value).replace(/\s/g, " ")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Εγκρίθηκε").length).toBeGreaterThanOrEqual(1);
  });
});
