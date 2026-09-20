import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import type { TierScreen } from "@/help/list-screens-by-tier";
import { ScreenTierList } from "./ScreenTierList";

const dayOne: TierScreen[] = [{ id: "S01", title: "Χαρτοφυλάκιο έργων", persona: ["estates_head", "finance"] }];
const optional: TierScreen[] = [{ id: "S06", title: "Κίνδυνοι και θέματα", persona: ["estates_head"] }];

describe("ScreenTierList", () => {
  it("lists day-one screens under the day-one chip, with title and personas", () => {
    renderWithIntl(<ScreenTierList dayOne={dayOne} optional={[]} />, { locale: "el" });
    expect(screen.getByText("Ημέρα 1")).toBeInTheDocument();
    expect(screen.getByText("S01")).toBeInTheDocument();
    expect(screen.getByText("Χαρτοφυλάκιο έργων")).toBeInTheDocument();
    expect(screen.getByText("Προϊστάμενος Τεχνικών Υπηρεσιών, Οικονομική Διεύθυνση")).toBeInTheDocument();
  });

  it("lists optional screens under the optional chip", () => {
    renderWithIntl(<ScreenTierList dayOne={[]} optional={optional} />, { locale: "el" });
    expect(screen.getByText("Προαιρετικό")).toBeInTheDocument();
    expect(screen.getByText("S06")).toBeInTheDocument();
  });

  it("omits a group's heading entirely when that group is empty", () => {
    renderWithIntl(<ScreenTierList dayOne={dayOne} optional={[]} />, { locale: "el" });
    expect(screen.queryByText("Προαιρετικό")).not.toBeInTheDocument();
  });
});
