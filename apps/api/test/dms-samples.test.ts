import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DmsMetaBody } from "../src/documents/earchive-contract";

/**
 * `docs/integration/ecapital-dms-samples/` is what eArchive is handed when
 * they ask what eCapital will send them. A sample that no longer matches the
 * schema the API validates against is worse than no sample at all: somebody
 * builds against it. So the samples are parsed by the same strict schema the
 * upload uses, here, and the suite fails when they drift.
 */
const SAMPLES = join(__dirname, "..", "..", "..", "docs", "integration", "ecapital-dms-samples");

describe("the samples handed to eArchive", () => {
  const files = readdirSync(SAMPLES).filter((f) => f.endsWith(".json"));

  it("has one per item type eCapital files today", () => {
    expect(files.sort()).toEqual([
      "award.meta.json",
      "business_case.meta.json",
      "variation.meta.json",
    ]);
  });

  it.each(files)("%s is valid against the strict meta schema", (file) => {
    const raw = JSON.parse(readFileSync(join(SAMPLES, file), "utf8")) as Record<string, unknown>;
    // `outbox_id` and `sent_at` are facts about the sending; the samples show
    // them because a reader needs to see the whole part, and the body schema
    // is what the rest of the object has to satisfy.
    expect(typeof raw.outbox_id).toBe("string");
    expect(String(raw.sent_at)).toMatch(/[+-]\d{2}:\d{2}$/);
    const body = { ...raw };
    delete body.outbox_id;
    delete body.sent_at;
    const parsed = DmsMetaBody.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  // NO PATIENT DATA, and no personal data of any kind. The samples are what
  // somebody outside eCapital reads first; they must not suggest otherwise.
  it.each(files)("%s claims no personal data", (file) => {
    const raw = JSON.parse(readFileSync(join(SAMPLES, file), "utf8")) as Record<string, unknown>;
    expect(raw.personal_data).toBe(false);
    expect(raw.personal_data_category).toBeUndefined();
  });

  /**
   * The token is generated on the server and written into
   * /etc/ecapital/api.env and eArchive's configuration by hand; it never
   * travels through this repository (RUNBOOK §11.2). These samples are the
   * most likely place for one to be pasted «just to show the shape», so the
   * suite says no.
   */
  it("carries no token, anywhere", () => {
    for (const file of [...files, "README.md"]) {
      const text = readFileSync(join(SAMPLES, file), "utf8");
      expect(text, file).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{16,}/);
      // Every long hex string in here is a sha256 of a file that does not
      // exist. Anything else of that shape would be a secret.
      const withoutHashes = text.replace(/"sha256":\s*"[0-9a-f]{64}"/g, '"sha256": ""');
      expect(withoutHashes, file).not.toMatch(/[0-9a-f]{32,}/);
    }
  });
});
