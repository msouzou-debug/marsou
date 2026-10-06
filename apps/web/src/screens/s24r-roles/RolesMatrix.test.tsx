import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MATRIX_ROLES, type AppRole } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { canViewRoleMatrix } from "@/auth/roles";
import { RolesMatrix } from "./RolesMatrix";

function renderMatrix(props: Partial<Parameters<typeof RolesMatrix>[0]> = {}, locale: "el" | "en" = "el") {
  return renderWithIntl(
    <RolesMatrix state="default" onPrint={vi.fn()} noPermission={<div>Δεν έχετε πρόσβαση</div>} {...props} />,
    { locale },
  );
}

/** The cell of one role on the row whose header reads `rowName`, in the desktop table. */
function cell(rowName: string, role: AppRole): HTMLElement {
  const table = screen.getByTestId("s24r-table");
  const row = within(table).getByRole("rowheader", { name: rowName }).closest("tr")!;
  return row.querySelector<HTMLElement>(`td[data-role="${role}"]`)!;
}

function level(rowName: string, role: AppRole): string | null {
  return cell(rowName, role).querySelector("[data-level]")?.getAttribute("data-level") ?? null;
}

describe("S24r — who may open the page", () => {
  it("admits the administrator and the head of estates and nobody else", () => {
    expect(canViewRoleMatrix(["admin"])).toBe(true);
    expect(canViewRoleMatrix(["estates_head"])).toBe(true);
    expect(canViewRoleMatrix(["project_engineer"])).toBe(false);
    expect(canViewRoleMatrix(["auditor_readonly"])).toBe(false);
  });

  it("draws the NoPermission body it is handed", () => {
    renderMatrix({ state: "noPermission" });
    expect(screen.getByText("Δεν έχετε πρόσβαση")).toBeInTheDocument();
    expect(screen.queryByTestId("s24r-table")).toBeNull();
  });
});

describe("S24r — the table", () => {
  it("has the eight roles as columns, a short label on screen and the full one as the title", () => {
    renderMatrix();
    const headers = within(screen.getByTestId("s24r-table"))
      .getAllByRole("columnheader")
      .filter((th) => th.getAttribute("scope") === "col");
    expect(headers).toHaveLength(9);
    const technician = headers.find((th) => th.getAttribute("title") === "Τεχνίτης")!;
    expect(technician).toHaveTextContent("Τεχνίτης");
    const estates = headers.find((th) => th.getAttribute("title") === "Προϊστάμενος Τεχνικών Υπηρεσιών")!;
    expect(estates).toHaveTextContent("Προϊστάμενος");
  });

  it("answers «what does a Τεχνίτης get»: reads Έργα, writes asset condition and readings", () => {
    renderMatrix();
    expect(level("Μητρώο έργων, ορόσημα, κίνδυνοι", "technician")).toBe("READ");
    expect(cell("Μητρώο έργων, ορόσημα, κίνδυνοι", "technician")).toHaveTextContent("Βλέπει");
    expect(level("Φυσική κατάσταση και μετρήσεις παγίων", "technician")).toBe("WRITE");
    expect(cell("Φυσική κατάσταση και μετρήσεις παγίων", "technician")).toHaveTextContent("Γράφει");
  });

  it("answers «who approves a variation»: the head of estates and the administrator", () => {
    renderMatrix();
    const approvers = MATRIX_ROLES.filter((role) => level("Τροποποιήσεις: απόφαση", role) === "APPROVE");
    expect([...approvers].sort()).toEqual(["admin", "estates_head"]);
  });

  it("answers «who sees Κόστος»: the SAP import is finance and admin, the accruals five roles", () => {
    renderMatrix();
    const sap = MATRIX_ROLES.filter((role) => level("Εισαγωγή SAP και μη αντιστοιχισμένες κινήσεις", role) !== "NONE");
    expect([...sap].sort()).toEqual(["admin", "finance"]);
    expect(level("Δεδουλευμένα", "technician")).toBe("NONE");
    expect(cell("Δεδουλευμένα", "technician")).toHaveTextContent("Χωρίς πρόσβαση");
    expect(level("Δεδουλευμένα", "executive_readonly")).toBe("READ");
  });

  it("shows the units row: finance sees all units, a technician their own", () => {
    renderMatrix();
    expect(cell("Μονάδες", "finance")).toHaveTextContent("Όλες");
    expect(cell("Μονάδες", "technician")).toHaveTextContent("Οι δικές του");
  });

  it("groups the rows under a header per area of the nav", () => {
    renderMatrix();
    const groups = within(screen.getByTestId("s24r-table"))
      .getAllByRole("columnheader")
      .filter((th) => th.getAttribute("scope") === "colgroup")
      .map((th) => th.textContent);
    expect(groups).toEqual([
      "Χαρτοφυλάκιο",
      "Έργα",
      "Συμβάσεις",
      "Κόστος",
      "Διακοπές και άδειες",
      "Πάγια",
      "Συντήρηση",
      "Αναφορές",
      "Διαχείριση",
      "Ίχνος ελέγχου",
    ]);
  });

  it("highlights a role's column when its header is pressed, and clears it on a second press", async () => {
    const user = userEvent.setup();
    renderMatrix();
    const button = screen.getByRole("button", { name: "Τεχνίτης" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(cell("Μητρώο παγίων", "technician")).toHaveClass("bg-k-blue-bg");
    expect(cell("Μητρώο παγίων", "finance")).not.toHaveClass("bg-k-blue-bg");
    expect(screen.getByRole("status")).toHaveTextContent("Τονισμένη στήλη: Τεχνίτης");

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(cell("Μητρώο παγίων", "technician")).not.toHaveClass("bg-k-blue-bg");
  });

  it("RULE (UI §4): every chip carries an icon and a word, never colour alone", () => {
    renderMatrix();
    const chips = screen.getByTestId("s24r-table").querySelectorAll("[data-level]:not([data-level='NONE'])");
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.querySelector("svg")).not.toBeNull();
      expect(chip.textContent?.trim()).not.toBe("");
    }
  });

  it("never cuts a label short with an ellipsis", () => {
    const { container } = renderMatrix();
    expect(container.querySelector(".truncate, .text-ellipsis")).toBeNull();
  });

  it("prints through the «Εκτύπωση / PDF» button, landscape A4", async () => {
    const user = userEvent.setup();
    const onPrint = vi.fn();
    const { container } = renderMatrix({ onPrint });
    await user.click(screen.getByRole("button", { name: "Εκτύπωση / PDF" }));
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(container.querySelector("style")?.textContent).toContain("size: A4 landscape");
  });
});

describe("S24r — the legend, the cards and the notes", () => {
  it("explains the five levels above the table", () => {
    renderMatrix();
    const legend = screen.getByRole("heading", { name: "Υπόμνημα" }).closest("section")!;
    expect(within(legend).getAllByRole("listitem")).toHaveLength(5);
    expect(legend).toHaveTextContent("Κάνει τα πάντα στην ενότητα, μαζί και τις ρυθμίσεις της.");
    expect(legend).toHaveTextContent("Η ενότητα δεν εμφανίζεται για τον ρόλο.");
  });

  it("gives the phone one card per role, with the areas it has no access to in one line", () => {
    renderMatrix();
    const cards = within(screen.getByTestId("s24r-cards")).getAllByRole("article");
    expect(cards).toHaveLength(8);
    const technician = within(screen.getByTestId("s24r-cards")).getByRole("article", { name: "Τεχνίτης" });
    expect(technician).toHaveTextContent("Μονάδες: Οι δικές του");
    expect(within(technician).getByTestId("s24r-none")).toHaveTextContent("Αναφορές");
  });

  it("lists the notes for every role and the ones that hold for all", () => {
    renderMatrix();
    expect(screen.getByText(/Κανείς δεν εγκρίνει κάτι που υπέβαλε ο ίδιος/)).toBeInTheDocument();
    expect(screen.getByTestId("s24r-notes-auditor_readonly")).toHaveTextContent(
      "Διαβάζει ολόκληρο το ίχνος ελέγχου και δεν αλλάζει τίποτα.",
    );
    expect(screen.getByTestId("s24r-notes-clinical_approver")).toHaveTextContent(
      "Από τις διακοπές βλέπει μόνο όσες αγγίζουν τους χώρους του.",
    );
  });

  it("reads in English too", () => {
    renderMatrix({}, "en");
    expect(screen.getByRole("heading", { name: "Roles and permissions", level: 1 })).toBeInTheDocument();
    expect(cell("Asset condition and readings", "technician")).toHaveTextContent("Writes");
    expect(cell("Units", "finance")).toHaveTextContent("All units");
  });
});
