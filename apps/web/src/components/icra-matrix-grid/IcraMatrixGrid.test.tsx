import { describe, expect, it } from "vitest";
import { renderWithIntl } from "@/test/render";
import { IcraMatrixGrid } from "./IcraMatrixGrid";

const CELLS = [
  { activityType: "B" as const, riskGroup: "MEDIUM" as const, icraClass: "III" as const, controls: [] },
  { activityType: "C" as const, riskGroup: "HIGH" as const, icraClass: "IV" as const, controls: [] },
];

describe("IcraMatrixGrid", () => {
  it("highlights only the producing cell", () => {
    const { container } = renderWithIntl(<IcraMatrixGrid cells={CELLS} activityType="C" riskGroup="HIGH" />);
    const highlighted = container.querySelectorAll('[aria-current="true"]');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]?.textContent).toBe("IV");
  });

  it("never uses --k-purple — that colour is reserved for IcraBadge and PermitBanner", () => {
    const { container } = renderWithIntl(<IcraMatrixGrid cells={CELLS} activityType="C" riskGroup="HIGH" />);
    expect(container.innerHTML).not.toMatch(/k-purple/);
  });
});
