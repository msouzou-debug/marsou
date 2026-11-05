import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { SECURITY_HEADERS } from "./security-headers";

describe("security headers", () => {
  it("refuse framing by anyone, and the config puts them on every path", async () => {
    const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");

    const rules = await (nextConfig as { headers?: () => Promise<{ source: string; headers: unknown[] }[]> }).headers!();
    expect(rules).toEqual([{ source: "/(.*)", headers: [...SECURITY_HEADERS] }]);
  });
});
