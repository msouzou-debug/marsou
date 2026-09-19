import { describe, expect, it, vi } from "vitest";
import type { CostWarning } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { WarningStrip } from "./WarningStrip";

function warning(overrides: Partial<CostWarning> = {}): CostWarning {
  return {
    id: "w-1",
    key: "forecastOverApproved",
    projectId: "p-1",
    contractId: null,
    sentenceEl: "Η πρόβλεψη υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά € 84.000",
    sentenceEn: "The forecast exceeds the approved budget by € 84,000",
    amount: 84000,
    firedAt: "2026-09-01T10:00:00.000Z",
    dismissedById: null,
    dismissedByName: null,
    dismissedAt: null,
    ...overrides,
  };
}

describe("WarningStrip", () => {
  it("renders nothing when there are no warnings", () => {
    const { container } = renderWithIntl(<WarningStrip warnings={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the plain Greek sentence with the amount for a live warning", () => {
    renderWithIntl(<WarningStrip warnings={[warning()]} onDismiss={vi.fn()} />);
    expect(document.body.textContent).toContain("Η πρόβλεψη υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά € 84.000");
  });

  it("fires onDismiss with the warning id when «Απόρριψη» is clicked", () => {
    const onDismiss = vi.fn();
    renderWithIntl(<WarningStrip warnings={[warning()]} onDismiss={onDismiss} />);
    document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledWith("w-1");
  });

  // RULE (R31): once dismissed, the line is replaced — never removed — by a
  // 12px "Απορρίφθηκε από {name}, {date time}" line, and the dismiss link
  // disappears with it.
  it("replaces a dismissed warning's line with a 12px dismissed-by note, and drops the link", () => {
    const dismissed = warning({ dismissedById: "u-1", dismissedByName: "Α. Παπά", dismissedAt: "2026-09-02T08:15:00.000Z" });
    renderWithIntl(<WarningStrip warnings={[dismissed]} onDismiss={vi.fn()} />);
    expect(document.querySelector("button")).toBeNull();
    const note = document.querySelector("p.text-fs-12");
    expect(note?.textContent).toContain("Α. Παπά");
    expect(document.body.textContent).not.toContain(dismissed.sentenceEl);
  });

  it("never disables the dismiss control on some outside 'saving' condition — R31 is warn-and-flag, not a gate", () => {
    renderWithIntl(<WarningStrip warnings={[warning()]} onDismiss={vi.fn()} />);
    expect(document.querySelector("button")?.hasAttribute("disabled")).toBe(false);
  });

  it("hides the dismiss link (not the sentence) for a caller who cannot dismiss", () => {
    renderWithIntl(<WarningStrip warnings={[warning()]} canDismiss={false} onDismiss={vi.fn()} />);
    expect(document.querySelector("button")).toBeNull();
    expect(document.body.textContent).toContain("€ 84.000");
  });

  it("shows the English sentence in the en locale", () => {
    renderWithIntl(<WarningStrip warnings={[warning()]} onDismiss={vi.fn()} />, { locale: "en" });
    expect(document.body.textContent).toContain("The forecast exceeds the approved budget by € 84,000");
  });
});
