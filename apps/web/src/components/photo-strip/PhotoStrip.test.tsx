import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { PhotoStrip, type Photo } from "./PhotoStrip";

const photos: Photo[] = [
  { id: "1", url: "/a.jpg", caption: "Πριν την επισκευή", timestamp: "2026-03-14T10:00:00Z" },
  { id: "2", url: "/b.jpg", caption: "Μετά την επισκευή", timestamp: "2026-03-14T11:00:00Z", gps: "35.17,33.36" },
];

describe("PhotoStrip", () => {
  it("always shows the capture button first, before any thumbnails", () => {
    renderWithIntl(<PhotoStrip photos={photos} onCapture={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveAccessibleName("Λήψη φωτογραφίας");
  });

  it("calls onCapture when the capture button is pressed", async () => {
    const onCapture = vi.fn();
    renderWithIntl(<PhotoStrip photos={photos} onCapture={onCapture} />);
    await userEvent.click(screen.getByRole("button", { name: "Λήψη φωτογραφίας" }));
    expect(onCapture).toHaveBeenCalledOnce();
  });

  it("empty state renders only the capture button, no other thumbnails", () => {
    renderWithIntl(<PhotoStrip photos={[]} onCapture={() => {}} />);
    expect(screen.getAllByRole("button", { hidden: true })).toHaveLength(1);
  });

  it("opens the lightbox with caption, timestamp and GPS for the tapped photo", async () => {
    renderWithIntl(<PhotoStrip photos={photos} onCapture={() => {}} />);
    await userEvent.click(screen.getByAltText("Μετά την επισκευή"));
    expect(screen.getByText("Μετά την επισκευή")).toBeInTheDocument();
    expect(screen.getByText(/35.17,33.36/)).toBeInTheDocument();
  });
});
