import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MATRIX_ROLES, ROLE_MATRIX, columnOf, defaultRoleMatrix, type AppRole } from "@ecapital/shared";
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

describe("S24r — the administrator edits the matrix (ADR-0033)", () => {
  const BACKLOG = "Εκκρεμότητες συντήρησης";

  /** The chip button of an editable cell, or null when the cell is not one. */
  function chip(rowName: string, role: AppRole): HTMLButtonElement | null {
    return cell(rowName, role).querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  }

  /** Opens the cell's list and picks the option named `optionName`. */
  async function pick(user: ReturnType<typeof userEvent.setup>, rowName: string, role: AppRole, optionName: string) {
    await user.click(chip(rowName, role)!);
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: optionName }));
  }

  it("shows the stored matrix it is given, read only for anybody who is not the administrator", () => {
    const matrix = defaultRoleMatrix();
    matrix.backlog.technician = "WRITE";
    renderMatrix({ matrix });
    expect(level(BACKLOG, "technician")).toBe("WRITE");
    const table = screen.getByTestId("s24r-table");
    expect(table.querySelector("select")).toBeNull();
    expect(table.querySelector('button[aria-haspopup="listbox"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Επαναφορά προεπιλογών" })).toBeNull();
  });

  it("keeps the chips, makes every free one a button with a list and locks the guardrailed ones with the reason as a tooltip", async () => {
    const user = userEvent.setup();
    renderMatrix({ editable: true, onSave: vi.fn(), onReset: vi.fn() });
    expect(screen.getByTestId("s24r-table").querySelector("select")).toBeNull();
    expect(level(BACKLOG, "technician")).toBe("READ");
    expect(cell(BACKLOG, "technician")).toHaveTextContent("Βλέπει");
    expect(chip(BACKLOG, "technician")).toHaveAccessibleName("Εκκρεμότητες συντήρησης, Τεχνίτης");
    expect(chip(BACKLOG, "technician")).toHaveAttribute("aria-expanded", "false");

    // RULE: the administrator keeps MANAGE on users — one level, locked, not a button.
    const adminUsers = cell("Χρήστες, ρόλοι και εγκριτές διακοπών", "admin");
    expect(adminUsers.querySelector("button")).toBeNull();
    const locked = adminUsers.querySelector("[data-locked]")!;
    expect(locked.querySelector("svg")).not.toBeNull();
    expect(locked).toHaveAttribute("title", expect.stringContaining("πλήρη διαχείριση των χρηστών"));

    // RULE: the auditor is offered Χωρίς πρόσβαση and Βλέπει and nothing more.
    await user.click(chip("Ελλείψεις", "auditor_readonly")!);
    const list = screen.getByRole("listbox", { name: "Ελλείψεις, Ελεγκτής" });
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAccessibleName("Χωρίς πρόσβαση");
    expect(options[1]).toHaveAccessibleName("Βλέπει");
    expect(options[1]).toHaveAccessibleDescription("Βλέπει την ενότητα χωρίς να αλλάζει τίποτα.");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByTestId("s24r-guardrails")).getAllByRole("listitem")).toHaveLength(6);
  });

  it("collects the changes in one bar and saves each changed role's whole column", async () => {
    const user = userEvent.setup();
    const saved = defaultRoleMatrix();
    saved.backlog.technician = "WRITE";
    const onSave = vi.fn(async () => saved);
    renderMatrix({ editable: true, onSave, onReset: vi.fn() });

    await pick(user, BACKLOG, "technician", "Γράφει");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(level(BACKLOG, "technician")).toBe("WRITE");
    expect(chip(BACKLOG, "technician")).toHaveAttribute("data-changed", "true");
    expect(screen.getByTestId("s24r-savebar")).toHaveTextContent("1 αλλαγή δεν έχει αποθηκευτεί.");

    await user.click(within(screen.getByTestId("s24r-savebar")).getByRole("button", { name: "Αποθήκευση" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("technician", { ...columnOf(ROLE_MATRIX, "technician"), backlog: "WRITE" });
    expect(await screen.findByTestId("s24r-notice")).toHaveTextContent("Οι αλλαγές αποθηκεύτηκαν.");
    expect(screen.queryByTestId("s24r-savebar")).toBeNull();
    expect(level(BACKLOG, "technician")).toBe("WRITE");
    expect(chip(BACKLOG, "technician")).not.toHaveAttribute("data-changed");
  });

  it("works from the keyboard: Enter opens, the arrows move, Enter picks, Esc closes", async () => {
    const user = userEvent.setup();
    renderMatrix({ editable: true, onSave: vi.fn(), onReset: vi.fn() });
    chip(BACKLOG, "technician")!.focus();
    await user.keyboard("{Enter}");
    const list = screen.getByRole("listbox", { name: "Εκκρεμότητες συντήρησης, Τεχνίτης" });
    expect(list).toHaveFocus();
    expect(list.getAttribute("aria-activedescendant")).toBe(
      within(list).getByRole("option", { name: "Βλέπει" }).id,
    );
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(level(BACKLOG, "technician")).toBe("WRITE");
    expect(chip(BACKLOG, "technician")).toHaveFocus();

    await user.keyboard(" ");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(level(BACKLOG, "technician")).toBe("WRITE");
  });

  it("keeps at most one list open, and a click outside closes it", async () => {
    const user = userEvent.setup();
    renderMatrix({ editable: true, onSave: vi.fn(), onReset: vi.fn() });
    await user.click(chip(BACKLOG, "technician")!);
    expect(screen.getAllByRole("listbox")).toHaveLength(1);

    await user.click(chip("Ελλείψεις", "auditor_readonly")!);
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(screen.getByRole("listbox")).toHaveAccessibleName("Ελλείψεις, Ελεγκτής");
    expect(chip(BACKLOG, "technician")).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("heading", { name: "Υπόμνημα" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("«Ακύρωση» throws the draft away and saves nothing", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderMatrix({ editable: true, onSave, onReset: vi.fn() });
    await pick(user, BACKLOG, "technician", "Γράφει");
    await user.click(within(screen.getByTestId("s24r-savebar")).getByRole("button", { name: "Ακύρωση" }));
    expect(level(BACKLOG, "technician")).toBe("READ");
    expect(chip(BACKLOG, "technician")).not.toHaveAttribute("data-changed");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the API's sentence when a save is refused and keeps the draft", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {
      throw new Error("Ο ρόλος Τεχνίτης δεν μπορεί να πάρει αυτό το επίπεδο.");
    });
    renderMatrix({ editable: true, onSave, onReset: vi.fn() });
    await pick(user, BACKLOG, "technician", "Γράφει");
    await user.click(within(screen.getByTestId("s24r-savebar")).getByRole("button", { name: "Αποθήκευση" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("δεν μπορεί να πάρει αυτό το επίπεδο");
    expect(level(BACKLOG, "technician")).toBe("WRITE");
    expect(chip(BACKLOG, "technician")).toHaveAttribute("data-changed", "true");
  });

  it("«Επαναφορά προεπιλογών» asks first, then puts the defaults back", async () => {
    const user = userEvent.setup();
    const changed = defaultRoleMatrix();
    changed.backlog.technician = "WRITE";
    const onReset = vi.fn(async () => defaultRoleMatrix());
    renderMatrix({ editable: true, matrix: changed, onSave: vi.fn(), onReset });
    expect(level(BACKLOG, "technician")).toBe("WRITE");

    await user.click(screen.getByRole("button", { name: "Επαναφορά προεπιλογών" }));
    expect(screen.getByText("Να επανέλθουν όλοι οι ρόλοι στις προεπιλογές;")).toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();
    const dialog = screen.getByText("Να επανέλθουν όλοι οι ρόλοι στις προεπιλογές;").closest("dialog")!;
    await user.click(within(dialog).getByRole("button", { name: "Επαναφορά προεπιλογών" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("s24r-notice")).toHaveTextContent("Ο πίνακας επανήλθε στις προεπιλογές.");
    expect(level(BACKLOG, "technician")).toBe("READ");
  });
});
