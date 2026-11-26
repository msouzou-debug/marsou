import { describe, expect, it } from "vitest";
import { safeFilename } from "./object-store";

// Owner request 26/11/2026: the letters ΟΚΥπΥ files are called in Greek, with
// spaces. The name on disk is ASCII; the original stays in the database.
describe("safeFilename", () => {
  it("keeps a plain ASCII name as it is", () => {
    expect(safeFilename("RFI-1.msg")).toBe("RFI-1.msg");
    expect(safeFilename("apofasi_v2.pdf")).toBe("apofasi_v2.pdf");
  });

  it("writes a Greek name or a space as `_` and keeps the extension", () => {
    expect(safeFilename("Επιστολή προς ανάδοχο.pdf")).toBe("document.pdf");
    expect(safeFilename("ΤΥ 2026 Επιστολή 26-11.pdf")).toBe("2026_26-11.pdf");
    expect(safeFilename("site report final.docx")).toBe("site_report_final.docx");
    expect(safeFilename("café menu.pdf")).toBe("cafe_menu.pdf");
  });

  it("never yields a path, a hidden file or an empty name", () => {
    expect(safeFilename("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFilename(".hidden")).toBe("document.hidden");
    expect(safeFilename("")).toBe("document");
    expect(safeFilename("   ")).toBe("document");
    for (const name of ["Επιστολή.pdf", "a b c", "x/y\\z.eml", "\u0000bad.msg"]) {
      expect(safeFilename(name)).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    }
  });
});
