import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { CertificateDetail } from "./CertificateDetail";
import { buildPaymentCert } from "./fixture";

const noPermission = <div>δεν έχετε πρόσβαση</div>;
const noop = () => undefined;

describe("CertificateDetail (S09)", () => {
  // RULE: retention held is its own line, never folded into net payable — and
  // net payable is always shown exactly as the API sent it, never recomputed.
  it("shows retention held on its own line, separate from net payable", () => {
    const cert = buildPaymentCert({ retentionHeld: 24_600, netPayable: 67_400 });
    renderWithIntl(<CertificateDetail cert={cert} state="default" noPermission={noPermission} roles={["finance"]} onTransition={noop} />);
    expect(document.body.textContent).toContain(formatEUR(24_600));
    expect(document.body.textContent).toContain(formatEUR(67_400));
    // The two never appear pre-combined into one figure.
    expect(document.body.textContent).not.toContain(formatEUR(24_600 + 67_400));
  });

  // RULE (R11, same pattern as S08/ADR-0015): the creator cannot approve their own certificate.
  it("disables «Έγκριση μηχανικού» for the certificate's own creator", () => {
    const cert = buildPaymentCert({ status: "DRAFT", createdById: "user-1" });
    renderWithIntl(
      <CertificateDetail cert={cert} state="default" noPermission={noPermission} roles={["project_engineer"]} meUserId="user-1" onTransition={noop} />,
    );
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Έγκριση μηχανικού"));
    expect(button?.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain("Δεν εγκρίνετε πιστοποίηση που καταχωρίσατε εσείς");
  });

  it("enables «Έγκριση μηχανικού» for a different engineer", () => {
    const onTransition = vi.fn();
    const cert = buildPaymentCert({ status: "DRAFT", createdById: "user-1" });
    renderWithIntl(
      <CertificateDetail cert={cert} state="default" noPermission={noPermission} roles={["estates_head"]} meUserId="user-2" onTransition={onTransition} />,
    );
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Έγκριση μηχανικού"));
    expect(button?.hasAttribute("disabled")).toBe(false);
    button?.click();
    expect(onTransition).toHaveBeenCalledWith("ENGINEER_APPROVED", {});
  });

  it("hides every transition button from a role that cannot act on this status", () => {
    const cert = buildPaymentCert({ status: "DRAFT" });
    renderWithIntl(<CertificateDetail cert={cert} state="default" noPermission={noPermission} roles={["finance"]} onTransition={noop} />);
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });

  it("requires a SAP invoice ref before «Παραλαβή από Οικονομικές» is enabled", () => {
    const cert = buildPaymentCert({ status: "ENGINEER_APPROVED" });
    renderWithIntl(<CertificateDetail cert={cert} state="default" noPermission={noPermission} roles={["finance"]} onTransition={noop} />);
    const button = document.querySelector("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  // RULE (R31): the retention-release warning is a warning, never a block —
  // «Εξόφληση» stays enabled once a paid date is typed, regardless.
  it("shows the retention-release warning when DLP has not ended, but never disables «Εξόφληση»", () => {
    const cert = buildPaymentCert({ status: "FINANCE_RECEIVED" });
    renderWithIntl(
      <CertificateDetail cert={cert} state="default" noPermission={noPermission} roles={["finance"]} dlpEnded={false} onTransition={noop} />,
    );
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.click();
    expect(document.body.textContent).toContain("Η περίοδος εγγύησης της σύμβασης δεν έχει λήξει ακόμη");
    const dateInput = document.getElementById("cert-paid-date") as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-09-19" } });
    const payButton = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Εξόφληση"));
    expect(payButton?.hasAttribute("disabled")).toBe(false);
  });

  it("shows no transition controls once PAID (final)", () => {
    const cert = buildPaymentCert({ status: "PAID", paidDate: "2026-07-01", sapInvoiceRef: "INV-1" });
    renderWithIntl(<CertificateDetail cert={cert} state="default" noPermission={noPermission} roles={["finance"]} onTransition={noop} />);
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });

  it("returns just the noPermission node for the noPermission state", () => {
    renderWithIntl(<CertificateDetail state="noPermission" noPermission={noPermission} onTransition={noop} />);
    expect(document.body.textContent).toBe("δεν έχετε πρόσβαση");
  });
});
