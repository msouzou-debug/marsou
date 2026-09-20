import { describe, expect, it, vi } from "vitest";
import type { ServerApi } from "@/data/server";
import { resolveScanTag } from "./scan";

describe("resolveScanTag", () => {
  // RULE (build brief item 5): signed out goes through the sign-in gate with `next=`.
  it("sends a signed-out visitor to sign-in with next= set to come back to this tag", async () => {
    const result = await resolveScanTag(null, "NGH-HVAC-0001");
    expect(result).toEqual({ kind: "signIn", href: "/sign-in?next=%2Fa%2FNGH-HVAC-0001" });
  });

  it("resolves a known tag to its asset id", async () => {
    const api: ServerApi = { token: "t", get: vi.fn().mockResolvedValue({ id: "asset-1", tag: "NGH-HVAC-0001" }) };
    const result = await resolveScanTag(api, "NGH-HVAC-0001");
    expect(result).toEqual({ kind: "found", assetId: "asset-1" });
  });

  // RULE (build brief item 5): unknown tag is the §6 not-found message, not a bare 404.
  it("is a not-found result, not a thrown error, for an unknown tag", async () => {
    const api: ServerApi = { token: "t", get: vi.fn().mockRejectedValue(new Error("404")) };
    const result = await resolveScanTag(api, "UNKNOWN-0001");
    expect(result).toEqual({ kind: "notFound" });
  });
});
