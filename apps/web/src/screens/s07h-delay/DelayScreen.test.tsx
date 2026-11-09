import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "../s07-contract/fixture";
import { DelayScreen } from "./DelayScreen";

const refetch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/queries", () => ({
  useContract: () => ({ data: buildContractDetail(), error: null, isLoading: false, refetch }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  refetch.mockClear();
});

describe("DelayScreen", () => {
  it("posts a new extension to /contracts/:id/extensions through the proxy and refetches", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(buildContractDetail()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithIntl(<DelayScreen contractId="contract-1" roles={["project_engineer"]} noPermission={<div />} />);
    await userEvent.click(screen.getByRole("button", { name: "Προσθήκη παράτασης" }));
    const dialog = screen.getByRole("dialog", { name: "Νέα παράταση" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Τμήμα"), "section-b");
    await userEvent.type(within(dialog).getByLabelText("Ημέρες παράτασης"), "5");
    await userEvent.type(within(dialog).getByLabelText("Ημερομηνία έγκρισης"), "2026-11-05");
    await userEvent.selectOptions(within(dialog).getByLabelText("Έγκριση από"), "ENGINEER");
    await userEvent.type(within(dialog).getByLabelText("Όνομα εγκρίνοντος"), "Γιώργος Ιωάννου");
    await userEvent.type(within(dialog).getByLabelText("Αιτιολογία"), "Καιρός");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Όχι" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/contracts/contract-1/extensions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      sectionId: "section-b",
      days: 5,
      approvedAt: "2026-11-05",
      approver: "ENGINEER",
      approverNameEl: "Γιώργος Ιωάννου",
      reasonEl: "Καιρός",
      contractorCulpable: false,
    });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("shows the API's sentence when the write is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: "errors.sectionCodeTaken", message: "Ο κωδικός τμήματος υπάρχει ήδη." }), { status: 409 })),
    );
    renderWithIntl(<DelayScreen contractId="contract-1" roles={["estates_head"]} noPermission={<div />} />);
    await userEvent.click(screen.getByRole("button", { name: "Προσθήκη τμήματος" }));
    const dialog = screen.getByRole("dialog", { name: "Προσθήκη τμήματος" });
    await userEvent.type(within(dialog).getByLabelText("Κωδικός"), "Α");
    await userEvent.type(within(dialog).getByLabelText("Τίτλος"), "Διπλό");
    await userEvent.type(within(dialog).getByLabelText("Συμβατική ολοκλήρωση"), "2026-12-01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    expect(await screen.findByText("Ο κωδικός τμήματος υπάρχει ήδη.")).toBeInTheDocument();
  });
});
