import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { PaymentCerts } from "./PaymentCerts";
import { buildPaymentCert } from "./fixture";

const noPermission = <div>δεν έχετε πρόσβαση</div>;
const noop = () => undefined;

describe("PaymentCerts (S09)", () => {
  // RULE (build brief §5 S09): retention held is its own column, never folded into net payable.
  it("shows retention held and net payable as separate columns", () => {
    const cert = buildPaymentCert();
    renderWithIntl(
      <PaymentCerts data={[cert]} contractId="contract-1" state="default" noPermission={noPermission} roles={["project_engineer"]} onAdd={noop} onRowOpen={noop} />,
    );
    expect(document.body.textContent).toContain(formatEUR(cert.retentionHeld));
    expect(document.body.textContent).toContain(formatEUR(cert.netPayable));
  });

  it("shows «Νέο πιστοποιητικό» only for a role that can create one", () => {
    renderWithIntl(
      <PaymentCerts data={[]} contractId="contract-1" state="empty" noPermission={noPermission} roles={["project_engineer"]} onAdd={noop} onRowOpen={noop} />,
    );
    expect(document.body.textContent).toContain("Προσθήκη");
  });

  it("hides «Νέο πιστοποιητικό» for finance", () => {
    renderWithIntl(
      <PaymentCerts data={[]} contractId="contract-1" state="empty" noPermission={noPermission} roles={["finance"]} onAdd={noop} onRowOpen={noop} />,
    );
    expect(document.body.textContent).not.toContain("Προσθήκη");
  });

  it("fires onRowOpen with the clicked certificate", () => {
    const onRowOpen = vi.fn();
    const cert = buildPaymentCert();
    renderWithIntl(
      <PaymentCerts data={[cert]} contractId="contract-1" state="default" noPermission={noPermission} roles={["finance"]} onAdd={noop} onRowOpen={onRowOpen} />,
    );
    const row = document.querySelector("tbody tr") as HTMLElement;
    row.focus();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onRowOpen).toHaveBeenCalledWith(cert);
  });
});
