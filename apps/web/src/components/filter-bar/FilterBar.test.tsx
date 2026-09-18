import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { FilterBar, type FilterItem, type SavedView } from "./FilterBar";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams("sort=name"),
}));

const filters: FilterItem[] = [{ key: "unit", label: "Μονάδα", value: "Λευκωσία" }];
const savedViews: SavedView[] = [
  { id: "v1", label: "Έργα σε καθυστέρηση", filters: [{ key: "status", label: "Κατάσταση", value: "delayed" }] },
];

beforeEach(() => {
  replace.mockClear();
});

describe("FilterBar", () => {
  it("removing a chip calls onChange and updates the URL query, keeping unrelated params", async () => {
    const onChange = vi.fn();
    renderWithIntl(
      <FilterBar filters={filters} onChange={onChange} savedViews={savedViews} onSaveView={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Αφαίρεση φίλτρου Μονάδα" }));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(replace).toHaveBeenCalledWith("/projects?sort=name");
  });

  it("empty state still renders the saved-views control", () => {
    renderWithIntl(<FilterBar filters={[]} onChange={() => {}} savedViews={savedViews} onSaveView={() => {}} />);
    expect(screen.getByText("Αποθηκευμένες προβολές")).toBeInTheDocument();
    expect(screen.queryByText("Καθαρισμός όλων")).not.toBeInTheDocument();
  });

  it("save view: typing a name and confirming calls onSaveView", async () => {
    const onSaveView = vi.fn();
    renderWithIntl(
      <FilterBar filters={filters} onChange={() => {}} savedViews={savedViews} onSaveView={onSaveView} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση προβολής" }));
    await userEvent.type(screen.getByPlaceholderText("Όνομα προβολής"), "Η δική μου προβολή");
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(onSaveView).toHaveBeenCalledWith("Η δική μου προβολή");
  });
});
