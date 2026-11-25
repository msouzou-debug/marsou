import { describe, expect, it } from "vitest";
import { nicosiaDateOf } from "@ecapital/shared";
import { periodBackwards } from "@/screens/s22-scorecard/period";
import { CertificateFormSchema } from "@/screens/s09-payment-certs/schema";
import { ActivationFormSchema, SectionFormSchema, extensionFormSchema } from "./schema";

// Date sanity on the forms of «Προθεσμίες και ρήτρες», and the two period
// rules elsewhere that share the same helper.
const tomorrow = new Date(Date.parse(`${nicosiaDateOf()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

describe("date rules on the delay forms", () => {
  const section = { code: "Α", titleEl: "Τμήμα Α", completionDate: "2027-06-30", handoverDate: "", liquidatedDamagesPerDay: null };

  it("lets a contractual completion be in the future but not a handover", () => {
    expect(SectionFormSchema.safeParse(section).success).toBe(true);
    const handedOver = SectionFormSchema.safeParse({ ...section, handoverDate: tomorrow });
    expect(handedOver.error?.issues[0]).toMatchObject({ path: ["handoverDate"], message: "forms.dateInFuture" });
  });

  it("refuses an extension approved tomorrow or before the award", () => {
    const extension = {
      sectionId: "",
      days: 10,
      approvedAt: tomorrow,
      approver: "ENGINEER",
      approverNameEl: "Μηχανικός",
      reasonEl: "Καιρός",
      contractorCulpable: "no",
    };
    const schema = extensionFormSchema("2026-01-10");
    expect(schema.safeParse(extension).error?.issues[0]).toMatchObject({ path: ["approvedAt"], message: "forms.dateInFuture" });
    expect(schema.safeParse({ ...extension, approvedAt: "2025-12-01" }).error?.issues[0]).toMatchObject({
      path: ["approvedAt"],
      message: "forms.dateBeforeAward",
    });
    expect(schema.safeParse({ ...extension, approvedAt: "2026-02-01" }).success).toBe(true);
  });

  it("refuses an activation dated tomorrow", () => {
    const parsed = ActivationFormSchema.safeParse({ activatedAt: tomorrow, noteEl: "Ενεργοποίηση" });
    expect(parsed.error?.issues[0]).toMatchObject({ path: ["activatedAt"], message: "forms.dateInFuture" });
  });
});

describe("periods", () => {
  it("refuses a certificate period that ends before it starts", () => {
    const parsed = CertificateFormSchema.safeParse({
      periodFrom: "2026-10-01",
      periodTo: "2026-09-30",
      workDoneValue: 1,
      materialsOnSite: 0,
    });
    expect(parsed.error?.issues[0]).toMatchObject({ path: ["periodTo"], message: "forms.dateEndBeforeStart" });
  });

  it("reads a one-day report period as fine and a backwards one as not", () => {
    expect(periodBackwards("2026-10-01", "2026-10-01")).toBe(false);
    expect(periodBackwards("2026-10-01", "2026-09-30")).toBe(true);
  });
});
