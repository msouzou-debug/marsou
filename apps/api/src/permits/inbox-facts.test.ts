import { describe, expect, it } from "vitest";
import { I18nService } from "../common/i18n.service";
import {
  approvalRoleLabel,
  classAndSystemsFact,
  formatAreaList,
  formatPermitWindow,
  permitWhatEl,
} from "./inbox-facts";

/**
 * S14's three facts and the role suffix on `whatEl`, in both languages, with
 * no database in sight — `routing.test.ts`'s own reason for keeping this
 * kind of rule out of the service.
 */
describe("inbox-facts", () => {
  const i18n = new I18nService();

  describe("classAndSystemsFact", () => {
    it("reads «Κατηγορία IV · Ιατρικά αέρια» in Greek", () => {
      expect(classAndSystemsFact("IV", ["MEDICAL_GAS"], "el", i18n)).toBe(
        "Κατηγορία IV · Ιατρικά αέρια",
      );
    });

    it("reads «Class IV · Medical gases» in English", () => {
      expect(classAndSystemsFact("IV", ["MEDICAL_GAS"], "en", i18n)).toBe(
        "Class IV · Medical gases",
      );
    });

    it("joins several systems with «, »", () => {
      expect(classAndSystemsFact("III", ["ELECTRICAL", "IT"], "el", i18n)).toBe(
        "Κατηγορία III · Ηλεκτρικό, Δίκτυο (IT)",
      );
    });

    it("falls back to an em dash when the class is not yet known", () => {
      expect(classAndSystemsFact(null, ["WATER"], "en", i18n)).toBe("Class — · Water");
    });
  });

  describe("formatPermitWindow", () => {
    it("shows both dates when the window crosses a local day", () => {
      // Europe/Nicosia is UTC+3 in October (still on DST): 20:00Z is 23:00
      // local on the 3rd, 04:00Z is 07:00 local on the 4th.
      const start = new Date("2026-10-03T20:00:00.000Z");
      const end = new Date("2026-10-04T04:00:00.000Z");
      expect(formatPermitWindow(start, end)).toBe("03/10/2026 23:00 – 04/10/2026 07:00");
    });

    it("collapses to one date when the window opens and closes the same local day", () => {
      const start = new Date("2026-10-04T05:00:00.000Z"); // 08:00 local
      const end = new Date("2026-10-04T13:00:00.000Z"); // 16:00 local
      expect(formatPermitWindow(start, end)).toBe("04/10/2026 08:00 – 16:00");
    });

    it("rounds to whole hours without carrying seconds or milliseconds", () => {
      const start = new Date("2026-01-15T06:00:00.000Z"); // Europe/Nicosia is UTC+2 in January
      const end = new Date("2026-01-15T14:00:00.000Z");
      expect(formatPermitWindow(start, end)).toBe("15/01/2026 08:00 – 16:00");
    });
  });

  describe("formatAreaList", () => {
    it("joins up to three names with «, »", () => {
      expect(formatAreaList(["Α1", "Α2"])).toBe("Α1, Α2");
    });

    it("caps at three and counts the rest as «+N»", () => {
      expect(formatAreaList(["Α1", "Α2", "Α3", "Α4", "Α5"])).toBe("Α1, Α2, Α3 +2");
    });

    it("reads «—» for no areas at all", () => {
      expect(formatAreaList([])).toBe("—");
    });
  });

  describe("approvalRoleLabel and permitWhatEl", () => {
    it("labels INFECTION_CONTROL in both languages", () => {
      expect(approvalRoleLabel("INFECTION_CONTROL", "el", i18n)).toBe("Έλεγχος λοιμώξεων");
      expect(approvalRoleLabel("INFECTION_CONTROL", "en", i18n)).toBe("Infection control");
    });

    it("puts the role in parentheses after the reference and title, in Greek", () => {
      expect(
        permitWhatEl(
          "PTW-NGH-2026-001",
          "Διακοπή ιατρικών αερίων για αντικατάσταση βαλβίδων",
          "INFECTION_CONTROL",
          "el",
          i18n,
        ),
      ).toBe(
        "PTW-NGH-2026-001 — Διακοπή ιατρικών αερίων για αντικατάσταση βαλβίδων (ως Έλεγχος λοιμώξεων)",
      );
    });

    it("does the same in English", () => {
      expect(
        permitWhatEl(
          "PTW-NGH-2026-001",
          "Διακοπή ιατρικών αερίων για αντικατάσταση βαλβίδων",
          "INFECTION_CONTROL",
          "en",
          i18n,
        ),
      ).toBe(
        "PTW-NGH-2026-001 — Διακοπή ιατρικών αερίων για αντικατάσταση βαλβίδων (as Infection control)",
      );
    });

    it("falls back to the bare title when the permit has no reference yet", () => {
      expect(permitWhatEl(null, "Πρόχειρη αίτηση", "WARD_MANAGER", "el", i18n)).toBe(
        "Πρόχειρη αίτηση (ως Προϊστάμενος θαλάμου)",
      );
    });
  });
});
