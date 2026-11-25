import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Contract, OrgUnit } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { Contracts } from "./Contracts";
import { buildContractDetail } from "@/screens/s07-contract/fixture";
import { contractsApiPath, contractsFilterToSearchParams, parseContractsFilter } from "./query";

// FilterBar reads and writes the URL itself.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/contracts",
  useSearchParams: () => new URLSearchParams(),
}));

const noPermission = <div>no permission</div>;

function unit(id: string, nameEl: string): OrgUnit {
  return {
    id,
    code: id.toUpperCase(),
    nameEl,
    nameEn: nameEl,
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: null,
    entityCode: null,
    efinanceCode: null,
    timezone: "Europe/Nicosia",
  } as OrgUnit;
}

const orgUnits = [unit("ngh", "Γενικό Νοσοκομείο Λευκωσίας"), unit("lgh", "Γενικό Νοσοκομείο Λάρνακας")];
const projects = [
  { id: "p-1", code: "NGH-2026-001", titleEl: "Ανακαίνιση χειρουργείων", orgUnitId: "ngh" },
  { id: "p-2", code: "LGH-2026-004", titleEl: "Νέα ΜΕΘ", orgUnitId: "lgh" },
];

function contract(overrides: Partial<Contract> = {}): Contract {
  const { project, contractor, boq, variations, warnings, ...rest } = buildContractDetail();
  void project;
  void contractor;
  void boq;
  void variations;
  void warnings;
  return { ...rest, ...overrides } as Contract;
}

describe("Contracts — ADR-0019's register", () => {
  it("shows the eCapital reference in mono, first on the row", () => {
    renderWithIntl(
      <Contracts items={[contract()]} state="default" noPermission={noPermission} />,
    );
    const ref = screen.getByText("CAP-2026-0031");
    expect(ref.className).toContain("num");
  });

  it("links each row through to the contract", () => {
    const one = contract();
    renderWithIntl(<Contracts items={[one]} state="default" noPermission={noPermission} />);
    expect(screen.getByRole("link", { name: one.contractorName })).toHaveAttribute(
      "href",
      `/contracts/${one.id}`,
    );
  });

  it("names the term that found nothing", () => {
    renderWithIntl(
      <Contracts items={[]} state="empty" q="CAP-2026-9999" noPermission={noPermission} />,
    );
    expect(screen.getByText("Καμία σύμβαση δεν ταιριάζει με «CAP-2026-9999».")).toBeInTheDocument();
  });

  it("says something different when there is nothing to list at all", () => {
    renderWithIntl(<Contracts items={[]} state="empty" noPermission={noPermission} />);
    expect(screen.getByText("Δεν υπάρχουν συμβάσεις στις μονάδες σας.")).toBeInTheDocument();
  });

  it("hands the typed term back to the screen, trimmed", async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(
      <Contracts items={[contract()]} state="default" onSearch={onSearch} noPermission={noPermission} />,
    );
    await user.type(screen.getByLabelText("Αναζήτηση σύμβασης"), "  CAP-2026-0031  ");
    await user.click(screen.getByRole("button", { name: "Αναζήτηση" }));
    expect(onSearch).toHaveBeenCalledWith("CAP-2026-0031");
  });

  it("draws the shell's own no-permission panel instead of an empty list", () => {
    renderWithIntl(<Contracts state="noPermission" noPermission={noPermission} />);
    expect(screen.getByText("no permission")).toBeInTheDocument();
    expect(screen.queryByTestId("contract-list")).not.toBeInTheDocument();
  });

  it("offers a retry when the list did not load", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<Contracts state="error" onRetry={onRetry} noPermission={noPermission} />);
    await user.click(screen.getByRole("button", { name: "Δοκιμάστε ξανά" }));
    expect(onRetry).toHaveBeenCalled();
  });

  // ADR-0025: the budget code is hidden by default, and shown on request.
  describe("the budget code column", () => {
    it("is off by default", () => {
      renderWithIntl(<Contracts items={[contract()]} state="default" noPermission={noPermission} />);
      expect(screen.queryByText(/Κωδικός προϋπολογισμού: 7402/)).not.toBeInTheDocument();
    });

    it("shows the code once the checkbox is switched on", async () => {
      const user = userEvent.setup();
      renderWithIntl(<Contracts items={[contract()]} state="default" noPermission={noPermission} />);

      await user.click(screen.getByLabelText("Εμφάνιση κωδικού προϋπολογισμού"));

      expect(screen.getByText("Κωδικός προϋπολογισμού: 7402")).toBeInTheDocument();
    });

    it("shows the dash for a contract that has none", async () => {
      const user = userEvent.setup();
      renderWithIntl(
        <Contracts items={[contract({ budgetCode: null })]} state="default" noPermission={noPermission} />,
      );

      await user.click(screen.getByLabelText("Εμφάνιση κωδικού προϋπολογισμού"));

      expect(screen.getByText("Κωδικός προϋπολογισμού: —")).toBeInTheDocument();
    });
  });

  // «Μονάδα» and «Έργο», in the URL like every other list's filters.
  describe("the unit and project filters", () => {
    it("adds a unit and keeps a project that is in it", async () => {
      const onFilterChange = vi.fn();
      const user = userEvent.setup();
      renderWithIntl(
        <Contracts
          items={[contract()]}
          state="default"
          noPermission={noPermission}
          orgUnits={orgUnits}
          projects={projects}
          filter={{ unit: [], project: "p-1" }}
          onFilterChange={onFilterChange}
        />,
      );
      const filters = screen.getByTestId("contract-filters");
      await user.click(within(filters).getByText("Μονάδα"));
      await user.click(within(filters).getByLabelText("Γενικό Νοσοκομείο Λευκωσίας"));
      expect(onFilterChange).toHaveBeenCalledWith({ unit: ["ngh"], project: "p-1" });
    });

    it("drops a chosen project that is in none of the units chosen", async () => {
      const onFilterChange = vi.fn();
      const user = userEvent.setup();
      renderWithIntl(
        <Contracts
          items={[contract()]}
          state="default"
          noPermission={noPermission}
          orgUnits={orgUnits}
          projects={projects}
          filter={{ unit: [], project: "p-2" }}
          onFilterChange={onFilterChange}
        />,
      );
      const filters = screen.getByTestId("contract-filters");
      await user.click(within(filters).getByLabelText("Γενικό Νοσοκομείο Λευκωσίας"));
      expect(onFilterChange).toHaveBeenCalledWith({ unit: ["ngh"], project: "" });
    });

    it("picks a project from the list it is given and shows both filters as chips", async () => {
      const onFilterChange = vi.fn();
      const user = userEvent.setup();
      renderWithIntl(
        <Contracts
          items={[contract()]}
          state="default"
          noPermission={noPermission}
          orgUnits={orgUnits}
          projects={projects}
          filter={{ unit: ["lgh"], project: "p-2" }}
          onFilterChange={onFilterChange}
        />,
      );
      expect(screen.getByText("Μονάδα: Γενικό Νοσοκομείο Λάρνακας")).toBeInTheDocument();
      expect(screen.getByText("Έργο: LGH-2026-004 — Νέα ΜΕΘ")).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Έργο"), "p-1");
      expect(onFilterChange).toHaveBeenLastCalledWith({ unit: ["lgh"], project: "p-1" });

      await user.click(screen.getByRole("button", { name: "Αφαίρεση φίλτρου Μονάδα" }));
      expect(onFilterChange).toHaveBeenLastCalledWith({ unit: [], project: "p-2" });
    });

    it("says the filters found nothing, and clears them", async () => {
      const onFilterChange = vi.fn();
      const user = userEvent.setup();
      renderWithIntl(
        <Contracts
          items={[]}
          state="empty"
          noPermission={noPermission}
          orgUnits={orgUnits}
          filter={{ unit: ["lgh"], project: "" }}
          onFilterChange={onFilterChange}
        />,
      );
      expect(screen.getByText("Καμία σύμβαση δεν ταιριάζει με τα φίλτρα που επιλέξατε.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Καθαρισμός φίλτρων" }));
      expect(onFilterChange).toHaveBeenCalledWith({ unit: [], project: "" });
    });

    it("round-trips through the URL and builds the API's path", () => {
      const filter = parseContractsFilter(new URLSearchParams("unit=ngh&unit=lgh&project=p-1"));
      expect(filter).toEqual({ unit: ["ngh", "lgh"], project: "p-1" });
      expect(contractsFilterToSearchParams(filter).toString()).toBe("unit=ngh&unit=lgh&project=p-1");
      expect(contractsApiPath(filter)).toBe("/contracts?unit=ngh&unit=lgh&project=p-1");
      expect(contractsApiPath()).toBe("/contracts");
    });
  });
});
