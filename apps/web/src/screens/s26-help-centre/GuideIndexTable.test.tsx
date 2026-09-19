import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import type { GuideEntry } from "@/help/load-guides-index";
import { GuideIndexTable } from "./GuideIndexTable";

const guides: GuideEntry[] = [
  {
    persona: "estates_head",
    lang: "el",
    file: "estates_head.el.pdf",
    personaLabel: "Προϊστάμενος Τεχνικών Υπηρεσιών",
    sections: 25,
    sizeBytes: 337_100,
    pages: 29,
    sha256: "a".repeat(64),
  },
  {
    persona: "estates_head",
    lang: "en",
    file: "estates_head.en.pdf",
    personaLabel: "Head of estates",
    sections: 25,
    sizeBytes: 309_497,
    pages: 28,
    sha256: "b".repeat(64),
  },
];

describe("GuideIndexTable", () => {
  it("lists every guide with its role, language, size and a download link", () => {
    renderWithIntl(<GuideIndexTable guides={guides} generatedAt="2026-03-14T00:00:00Z" />, { locale: "el" });

    expect(screen.getAllByText("Προϊστάμενος Τεχνικών Υπηρεσιών")).toHaveLength(2);
    // `uppercase` in the class list is a CSS text-transform; the DOM text is
    // the lowercase locale code.
    expect(screen.getByText("el")).toBeInTheDocument();
    expect(screen.getByText("en")).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: "Λήψη" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/guides/estates_head.el.pdf");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[1]).toHaveAttribute("href", "/guides/estates_head.en.pdf");
  });

  it("shows the last-updated date from the index for every row", () => {
    renderWithIntl(<GuideIndexTable guides={guides} generatedAt="2026-03-14T00:00:00Z" />, { locale: "el" });
    expect(screen.getAllByText("14/03/2026")).toHaveLength(2);
  });

  it("shows the empty state when no guides have been generated yet", () => {
    renderWithIntl(<GuideIndexTable guides={[]} generatedAt="" />, { locale: "el" });
    expect(
      screen.getByText("Οι οδηγοί PDF δεν έχουν δημιουργηθεί ακόμη για αυτή την εγκατάσταση. Δημιουργούνται σε κάθε έκδοση του eCapital."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
