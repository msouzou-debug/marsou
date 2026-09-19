import { describe, expect, it } from "vitest";
import {
  buildAwardMeta,
  buildBusinessCaseMeta,
  buildVariationMeta,
  vendorCounterparty,
} from "./dms-meta";
import {
  type DmsFile,
  DmsMetaBody,
  backoffMinutes,
  isAllowedMime,
  isoWithOffset,
  moneyInText,
} from "./earchive-contract";

/**
 * The eArchive contract, checked against the brief of 19/09/2026 rather than
 * against the code that implements it. Everything here is somebody else's
 * decision: a change to one of these numbers or one of these Greek words is a
 * change to what ΟΚΥπΥ's registry will accept, and should be as hard to make
 * by accident as a change to a money formula.
 */

const ORIGIN = "https://capital.shso.online";

const MAIN: DmsFile = {
  kind: "MAIN",
  part_name: "file_main",
  filename: "apofasi.pdf",
  mime: "application/pdf",
  size: 12_345,
  sha256: "a".repeat(64),
};

const CONTRACTOR = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Δοκιμαστική Εργοληπτική Λτδ",
  vatNumber: "CY10000001X",
  registrationNo: "HE 100001",
  sapVendorId: "0000512345",
};

const UNIT = { code: "NGH", nameEl: "Γενικό Νοσοκομείο Λευκωσίας" };

function award(overrides: Partial<Parameters<typeof buildAwardMeta>[0]> = {}) {
  return buildAwardMeta(
    {
      contractId: "22222222-2222-2222-2222-222222222222",
      ref: "CAP-2026-0007",
      contractNo: "ΤΥ/2026/141",
      awardDate: "2026-03-11",
      originalValue: 1_234.56,
      projectTitleEl: "Αντικατάσταση ψυκτικών μονάδων",
      unit: UNIT,
      contractor: CONTRACTOR,
      approvals: [
        {
          name: "Ανδρέας Παπαδόπουλος",
          role: "Προϊστάμενος Τεχνικών Υπηρεσιών",
          action: "recorded",
          at: new Date("2026-03-12T08:30:00Z"),
        },
      ],
      ...overrides,
    },
    [MAIN],
    ORIGIN,
  );
}

describe("the money spelling", () => {
  // Errata, 19/09/2026: eFinance's format wins everywhere, «1.234,56 €».
  it("writes money the way the errata settled", () => {
    expect(moneyInText(1234.56)).toBe("1.234,56 €");
    expect(moneyInText(84_000)).toBe("84.000,00 €");
    expect(moneyInText(0)).toBe("0,00 €");
    expect(moneyInText(1_234_567.891)).toBe("1.234.567,89 €");
  });
});

describe("the MIME whitelist", () => {
  it("takes what eArchive takes", () => {
    for (const mime of ["application/pdf", "image/jpeg", "message/rfc822", "text/csv"]) {
      expect(isAllowedMime(mime), mime).toBe(true);
    }
  });

  // The brief says it twice: no DWG and no ZIP.
  it("refuses a drawing and a bundle", () => {
    for (const mime of [
      "application/zip",
      "image/vnd.dwg",
      "application/acad",
      "application/octet-stream",
      "video/mp4",
    ]) {
      expect(isAllowedMime(mime), mime).toBe(false);
    }
  });
});

describe("the backoff", () => {
  // 1 min, 5, 15, 60, then hourly, never dropped.
  it("is 1, 5, 15, 60 and then hourly", () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMinutes)).toEqual([1, 5, 15, 60, 60, 60]);
  });
});

describe("timestamps", () => {
  it("carries an offset, because eArchive refuses a naked one", () => {
    expect(isoWithOffset(new Date("2026-03-12T08:30:00Z"))).toBe("2026-03-12T08:30:00+00:00");
  });
});

describe("the award decision's meta", () => {
  it("is what the brief describes, field for field", () => {
    const meta = award();
    expect(meta.schema_version).toBe(1);
    expect(meta.source_system).toBe("eCapital");
    expect(meta.source_module).toBe("award");
    expect(meta.source_ref).toBe("award:22222222-2222-2222-2222-222222222222");
    expect(meta.source_url).toBe(`${ORIGIN}/contracts/22222222-2222-2222-2222-222222222222`);
    expect(meta.doc_type).toBe("Απόφαση κατακύρωσης");
    expect(meta.direction).toBe("INTERNAL");
    expect(meta.registry_hint).toBe("ΤΥ");
    expect(meta.sender_name).toBe("Τεχνικές Υπηρεσίες ΟΚΥπΥ");
    expect(meta.category).toBe("Συμβάσεις");
    expect(meta.classification).toBe("BUSINESS");
    expect(meta.retention_class_hint).toBe("rc-capital");
    expect(meta.letter_date).toBe("2026-03-11");
    expect(meta.currency).toBe("EUR");
    // A JSON number, not a 2-decimal string: the brief is explicit.
    expect(meta.amount).toBe(1234.56);
    expect(typeof meta.amount).toBe("number");
  });

  it("writes a subject a clerk could have written, money and all", () => {
    expect(award().subject).toBe(
      "Απόφαση κατακύρωσης — CAP-2026-0007 — Αντικατάσταση ψυκτικών μονάδων — Δοκιμαστική Εργοληπτική Λτδ — 1.234,56 €",
    );
  });

  /** ADR-0024: the site code is the unit's own code, with nothing between. */
  it("hints the folder with the unit's code and nothing translated", () => {
    expect(award().folder_hints).toEqual([
      { hospital: "NGH", title: "Γενικό Νοσοκομείο Λευκωσίας" },
    ]);
  });

  it("keys the vendor by SAP's id, then the registrar's, then its own", () => {
    expect(vendorCounterparty(CONTRACTOR).code).toBe("0000512345");
    expect(vendorCounterparty({ ...CONTRACTOR, sapVendorId: null }).code).toBe("HE 100001");
    expect(
      vendorCounterparty({ ...CONTRACTOR, sapVendorId: null, registrationNo: null }).code,
    ).toBe("ecapital:11111111-1111-1111-1111-111111111111");
    expect(vendorCounterparty(CONTRACTOR).vat).toBe("CY10000001X");
  });

  it("carries the approvals with an offset on every timestamp", () => {
    expect(award().approvals).toEqual([
      {
        actor_name: "Ανδρέας Παπαδόπουλος",
        role: "Προϊστάμενος Τεχνικών Υπηρεσιών",
        action: "Καταχώριση",
        at: "2026-03-12T08:30:00+00:00",
      },
    ]);
  });

  // NO PATIENT DATA, and no personal data of any kind on these three items.
  it("never claims personal data", () => {
    expect(award().personal_data).toBe(false);
    expect(award().personal_data_category).toBeUndefined();
  });
});

describe("the business case's meta", () => {
  const meta = buildBusinessCaseMeta(
    {
      projectId: "33333333-3333-3333-3333-333333333333",
      code: "NGH-2026-002",
      titleEl: "Επέκταση ΤΑΕΠ",
      approvedBudget: 90_000,
      letterDate: "2026-02-02",
      unit: UNIT,
      approvals: [],
    },
    [MAIN],
    ORIGIN,
  );

  it("files under Διοίκηση, not Συμβάσεις", () => {
    expect(meta.category).toBe("Διοίκηση");
    expect(meta.source_module).toBe("business_case");
    expect(meta.source_ref).toBe("business_case:NGH-2026-002");
  });

  it("has no counterparty, because there is no contract yet", () => {
    expect(meta.counterparties).toEqual([]);
    expect(meta.subject).toBe("Μελέτη σκοπιμότητας — NGH-2026-002 — Επέκταση ΤΑΕΠ — 90.000,00 €");
  });
});

describe("the variation's meta", () => {
  function variation(version = 1) {
    return buildVariationMeta(
      {
        contractId: "22222222-2222-2222-2222-222222222222",
        contractRef: "CAP-2026-0007",
        number: 2,
        descriptionEl: "Πρόσθετες εργασίες στεγανοποίησης",
        value: 20_000,
        letterDate: "2026-05-04",
        unit: UNIT,
        contractor: CONTRACTOR,
        approvals: [
          {
            name: "Ανδρέας Παπαδόπουλος",
            role: "Προϊστάμενος Τεχνικών Υπηρεσιών",
            action: "submitted",
            at: new Date("2026-05-01T09:00:00Z"),
          },
          {
            name: "Μαρία Γεωργίου",
            role: "Διαχειριστής",
            action: "approved",
            at: new Date("2026-05-04T11:15:00Z"),
            comment: "Εγκρίνεται εντός του αποθεματικού.",
          },
        ],
      },
      [MAIN],
      ORIGIN,
      version,
    );
  }

  /** The brief: an approved variation always points back at its award. */
  it("relates back to the award decision", () => {
    expect(variation().related).toEqual([
      { source_ref: "award:22222222-2222-2222-2222-222222222222", relation: "RELATED" },
    ]);
    expect(variation().source_ref).toBe("variation:CAP-2026-0007:2");
  });

  it("carries R10's two people, the decision comment included", () => {
    const approvals = variation().approvals;
    expect(approvals.map((a) => a.action)).toEqual(["Υποβολή", "Έγκριση"]);
    expect(approvals[1].comment).toBe("Εγκρίνεται εντός του αποθεματικού.");
  });

  /**
   * The brief: a corrected document is a NEW item with a NEW source_ref and a
   * SUPERSEDES relation, never an edit of one already protocolled.
   */
  it("supersedes the version before it when it is a correction", () => {
    const corrected = variation(2);
    expect(corrected.source_ref).toBe("variation:CAP-2026-0007:2:v2");
    expect(corrected.related).toContainEqual({
      source_ref: "variation:CAP-2026-0007:2",
      relation: "SUPERSEDES",
    });
    expect(corrected.related).toContainEqual({
      source_ref: "award:22222222-2222-2222-2222-222222222222",
      relation: "RELATED",
    });
  });
});

describe("the meta schema", () => {
  /**
   * eArchive is strict: a field it does not know makes the whole request a
   * 400 SCHEMA_INVALID. So a field nobody agreed cannot be smuggled in here.
   */
  it("refuses a field nobody agreed", () => {
    const withExtra = { ...award(), patient_name: "όχι" };
    expect(DmsMetaBody.safeParse(withExtra).success).toBe(false);
  });

  it("refuses a sha256 that is not lowercase hex", () => {
    const meta = { ...award(), files: [{ ...MAIN, sha256: "A".repeat(64) }] };
    expect(DmsMetaBody.safeParse(meta).success).toBe(false);
  });

  it("refuses a request without exactly one MAIN file", () => {
    const none = { ...award(), files: [{ ...MAIN, kind: "ATTACHMENT" as const }] };
    expect(DmsMetaBody.safeParse(none).success).toBe(false);
    const two = {
      ...award(),
      files: [MAIN, { ...MAIN, part_name: "file_2" }],
    };
    expect(DmsMetaBody.safeParse(two).success).toBe(false);
  });

  it("refuses two files under the same multipart part name", () => {
    const meta = {
      ...award(),
      files: [MAIN, { ...MAIN, kind: "ATTACHMENT" as const }],
    };
    expect(DmsMetaBody.safeParse(meta).success).toBe(false);
  });

  it("refuses a file over 50 MB", () => {
    const meta = { ...award(), files: [{ ...MAIN, size: 51 * 1024 * 1024 }] };
    expect(DmsMetaBody.safeParse(meta).success).toBe(false);
  });

  it("refuses a category eArchive does not have", () => {
    expect(DmsMetaBody.safeParse({ ...award(), category: "Τεχνικά" }).success).toBe(false);
  });

  it("refuses personal_data without a category, and a category without the flag", () => {
    expect(DmsMetaBody.safeParse({ ...award(), personal_data: true }).success).toBe(false);
    expect(
      DmsMetaBody.safeParse({ ...award(), personal_data_category: "Δεδομένα υγείας" }).success,
    ).toBe(false);
  });
});
