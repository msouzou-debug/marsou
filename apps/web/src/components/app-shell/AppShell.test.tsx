import { describe, expect, it, vi } from "vitest";
import type { OrgUnit } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { orgUnits } from "@/mocks/org-units";
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
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push }),
}));

// The switcher now renders whatever `GET /org-units` gave the server; there is
// no fallback list any more (see AppShell's header comment). These fixtures
// stand in for that response.
const visible: OrgUnit[] = orgUnits;

describe("UnitSwitcher", () => {
  // RULE: the org unit switcher is labelled «Μονάδα», never «Νοσοκομείο»
  // (UI instructions §2; CAPEX-02 §7) — hospital names are values only.
  it("is labelled «Μονάδα» in Greek, never «Νοσοκομείο»", () => {
    renderWithIntl(<UnitSwitcher orgUnits={visible} />, { locale: "el" });
    const select = document.querySelector("select");
    expect(select).toBeTruthy();
    const label = select?.getAttribute("aria-label");
    expect(label).toBe("Μονάδα");
    expect(label).not.toContain("Νοσοκομείο");
  });

  // RULE (R01, ADR-0010): the options are exactly what the API returned for
  // this caller. A caller with one unit gets one option — not twelve with
  // eleven of them disabled, and not a seeded fallback.
  it("lists only the units it was given", () => {
    const own = visible.slice(0, 1);
    renderWithIntl(<UnitSwitcher orgUnits={own} />, { locale: "el" });
    const options = document.querySelectorAll("option");
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toBe(own[0]!.nameEl);
  });

  it("disables itself when the caller has no visible units", () => {
    renderWithIntl(<UnitSwitcher orgUnits={[]} />, { locale: "el" });
    expect(document.querySelector("select")?.disabled).toBe(true);
  });

  // RULE: Central Administration sees every unit (R01, ADR-0010). Owner
  // decisions of 19/09/2026 made that twelve with HQ and then eleven again
  // with the Ambulance Service out of ΟΚΥπΥ (ADR-0024).
  it("lists all eleven units for a Central Administration caller", () => {
    renderWithIntl(<UnitSwitcher orgUnits={visible} />, { locale: "el" });
    const options = document.querySelectorAll("option");
    expect(options).toHaveLength(11);
    const names = Array.from(options).map((o) => o.textContent);
    expect(names).toContain("Κεντρικά Γραφεία");
    expect(names).not.toContain("Υπηρεσία Ασθενοφόρων");
  });
});

describe("NavRail", () => {
  // M2 added «Κόστος» as the tenth nav group, gated by role rather than
  // always shown — see the two tests below.
  it("defines all ten nav groups, one of them role-gated", () => {
    expect(NAV_ITEMS).toHaveLength(10);
  });

  it("hides the role-gated «Κόστος» item for a caller with no role that reaches it", () => {
    renderWithIntl(<NavRail />, { locale: "el" });
    const nav = document.querySelector("nav");
    expect(nav).toBeTruthy();
    expect(nav?.querySelectorAll("a")).toHaveLength(9);
    expect(document.body.textContent).not.toContain("Κόστος");
  });

  // RULE (`canViewCostNav`, `@/auth/roles`): visible to a caller who can
  // reach either S10 (Εισαγωγή SAP) or S09a (Δεδουλευμένα).
  it("shows «Κόστος» for a finance caller", () => {
    renderWithIntl(<NavRail roles={["finance"]} />, { locale: "el" });
    const nav = document.querySelector("nav");
    expect(nav?.querySelectorAll("a")).toHaveLength(10);
    expect(document.body.textContent).toContain("Κόστος");
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
