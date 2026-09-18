import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render";
import { FALLBACK_ORG_UNITS } from "./fallback-org-units";
import { NAV_ITEMS } from "./nav-items";
import { NavRail } from "./NavRail";
import { UnitSwitcher } from "./UnitSwitcher";

// NavRail and UnitSwitcher are the two client islands that hold the rules
// this file exists to guard. AppShell itself is an async server component
// (it awaits getTranslations) and composes an async TopBar underneath it —
// React's client renderer, which is what @testing-library/react drives here,
// cannot render async function components directly, only Next's real RSC
// pipeline can. That full composition is exercised by Playwright instead;
// here we test the islands that carry the business rules directly.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("UnitSwitcher", () => {
  // RULE: the org unit switcher is labelled «Μονάδα», never «Νοσοκομείο»
  // (UI instructions §2; CAPEX-02 §7) — hospital names are values only.
  it("is labelled «Μονάδα» in Greek, never «Νοσοκομείο»", () => {
    renderWithIntl(<UnitSwitcher orgUnits={FALLBACK_ORG_UNITS} />, { locale: "el" });
    const select = document.querySelector("select");
    expect(select).toBeTruthy();
    const label = select?.getAttribute("aria-label");
    expect(label).toBe("Μονάδα");
    expect(label).not.toContain("Νοσοκομείο");
  });

  it("lists every seeded org unit as an option", () => {
    renderWithIntl(<UnitSwitcher orgUnits={FALLBACK_ORG_UNITS} />, { locale: "el" });
    expect(document.querySelectorAll("option")).toHaveLength(FALLBACK_ORG_UNITS.length);
    expect(FALLBACK_ORG_UNITS.length).toBe(11);
  });
});

describe("NavRail", () => {
  it("renders all nine nav groups", () => {
    renderWithIntl(<NavRail />, { locale: "el" });
    const nav = document.querySelector("nav");
    expect(nav).toBeTruthy();
    expect(nav?.querySelectorAll("a")).toHaveLength(9);
    expect(NAV_ITEMS).toHaveLength(9);
  });

  it("shows the approvals count as a badge", () => {
    renderWithIntl(<NavRail approvalsCount={7} />, { locale: "el" });
    // The visible pill next to the icon:
    expect(document.body.textContent).toContain("7");
    // The screen-reader text that survives icon-only (tablet) mode:
    expect(document.body.textContent).toContain("7 εγκρίσεις σε αναμονή");
  });

  it("hides the badge when there are no approvals waiting", () => {
    renderWithIntl(<NavRail approvalsCount={0} />, { locale: "el" });
    expect(document.body.textContent).not.toContain("εγκρίσεις σε αναμονή");
  });
});
