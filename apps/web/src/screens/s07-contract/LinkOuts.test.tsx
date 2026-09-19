import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { LinkOuts, emapReference } from "./LinkOuts";
import { buildContractDetail } from "./fixture";

// ADR-0019 §4. The rule under test is that no link is ever guessed: every one
// of them needs both a base URL this deployment was given and a reference
// that actually belongs to the other system.
const LINKS = { emapUrl: "https://map.shso.online", efinanceUrl: "https://finance.shso.online" };

describe("LinkOuts", () => {
  it("shows nothing at all when the deployment knows of no sibling system", () => {
    const { container } = renderWithIntl(
      <LinkOuts contract={buildContractDetail({ emapRef: "CON-2026-0042" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the config came back with both URLs null", () => {
    const { container } = renderWithIntl(
      <LinkOuts
        contract={buildContractDetail({ emapRef: "CON-2026-0042" })}
        links={{ emapUrl: null, efinanceUrl: null }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers eMAP only when the contract carries an eMAP reference", () => {
    renderWithIntl(<LinkOuts contract={buildContractDetail({ emapRef: null })} links={LINKS} />);
    expect(screen.queryByRole("link", { name: /eMAP/ })).not.toBeInTheDocument();
    // eFinance does not depend on a reference: every contract has a `ref`.
    expect(screen.getByRole("link", { name: /eFinance/ })).toBeInTheDocument();
  });

  it("points eMAP at its own /contracts?q= with the eMAP reference", () => {
    renderWithIntl(
      <LinkOuts contract={buildContractDetail({ emapRef: "CON-2026-0042" })} links={LINKS} />,
    );
    const link = screen.getByRole("link", { name: "Άνοιγμα στο eMAP" });
    expect(link).toHaveAttribute("href", "https://map.shso.online/contracts?q=CON-2026-0042");
    // RULE (ADR-0019): a new tab, and no window handle back into this one.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("points eFinance at the eCapital reference, not at the contract number", () => {
    const contract = buildContractDetail();
    renderWithIntl(<LinkOuts contract={contract} links={LINKS} />);
    const link = screen.getByRole("link", { name: "Τιμολόγια στο eFinance" });
    expect(link).toHaveAttribute(
      "href",
      `https://finance.shso.online/invoices?contract_ref=${contract.ref}`,
    );
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("hides eFinance when only eMAP is configured", () => {
    renderWithIntl(
      <LinkOuts
        contract={buildContractDetail({ emapRef: "CON-2026-0042" })}
        links={{ emapUrl: "https://map.shso.online", efinanceUrl: null }}
      />,
    );
    expect(screen.getByRole("link", { name: /eMAP/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /eFinance/ })).not.toBeInTheDocument();
  });

  it("reads the links in English too", () => {
    renderWithIntl(
      <LinkOuts contract={buildContractDetail({ emapRef: "CON-2026-0042" })} links={LINKS} />,
      { locale: "en" },
    );
    expect(screen.getByRole("link", { name: "Open in eMAP" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Invoices in eFinance" })).toBeInTheDocument();
  });
});

describe("emapReference", () => {
  it("prefers the field somebody filled in on purpose", () => {
    expect(emapReference({ emapRef: "CON-2026-0042", contractNo: "CON-2025-0001" })).toBe(
      "CON-2026-0042",
    );
  });

  it("accepts a contract number that is already an eMAP reference", () => {
    // The contracts recorded before the field existed carry it here.
    expect(emapReference({ emapRef: null, contractNo: "CON-2026-0007" })).toBe("CON-2026-0007");
  });

  it("does not read an ordinary tender number as one", () => {
    expect(emapReference({ emapRef: null, contractNo: "ΤΥ/2026/031" })).toBeNull();
    expect(emapReference({ emapRef: null, contractNo: "CON-26-7" })).toBeNull();
  });
});
