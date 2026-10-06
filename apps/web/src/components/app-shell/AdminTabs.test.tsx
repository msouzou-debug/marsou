import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { AdminTabs } from "./AdminTabs";

let pathname = "/admin/users";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

describe("AdminTabs — the Διαχείριση tab strip", () => {
  it("has four tabs, «Ρόλοι και δικαιώματα» second, after «Χρήστες»", () => {
    pathname = "/admin/users";
    renderWithIntl(<AdminTabs />);
    const nav = screen.getByRole("navigation", { name: "Ενότητες διαχείρισης" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Χρήστες", "/admin/users"],
      ["Ρόλοι και δικαιώματα", "/admin/roles"],
      ["Ανάδοχοι", "/admin/contractors"],
      ["eFinance", "/admin/efinance"],
    ]);
  });

  it("marks the tab you are on", () => {
    pathname = "/admin/roles";
    renderWithIntl(<AdminTabs />);
    expect(screen.getByRole("link", { name: "Ρόλοι και δικαιώματα" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Χρήστες" })).not.toHaveAttribute("aria-current");
  });
});
