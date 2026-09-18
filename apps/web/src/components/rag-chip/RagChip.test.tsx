import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { RagChip } from "./RagChip";

describe("RagChip", () => {
  it("renders the label text for each RAG value", () => {
    renderWithIntl(<RagChip value="green" />);
    expect(screen.getByText("Εντός ορίων")).toBeInTheDocument();
    renderWithIntl(<RagChip value="amber" />);
    expect(screen.getByText("Σε κίνδυνο")).toBeInTheDocument();
    renderWithIntl(<RagChip value="red" />);
    expect(screen.getByText("Παράβαση")).toBeInTheDocument();
  });

  it("always renders exactly one icon alongside the text (never colour alone)", () => {
    const { container } = renderWithIntl(<RagChip value="red" />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByText("Παράβαση")).toBeInTheDocument();
  });

  it("count variant shows the number and keeps the full label for assistive tech", () => {
    renderWithIntl(<RagChip value="amber" variant="count" count={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByLabelText("Σε κίνδυνο")).toBeInTheDocument();
  });
});
