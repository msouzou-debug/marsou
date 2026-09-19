import { describe, expect, it } from "vitest";
import { isPublicPath, sessionCookieIsSecure } from "./cookies";

/**
 * ADR-0018 §5. On the ΟΚΥπΥ server the Next process speaks plain HTTP behind
 * a cloudflared box that terminates TLS, so `NODE_ENV === "production"` is
 * the wrong question: what decides `Secure` is the origin the browser used.
 */
describe("sessionCookieIsSecure", () => {
  it("is on behind an https origin", () => {
    expect(sessionCookieIsSecure("https://capital.shso.online")).toBe(true);
    expect(sessionCookieIsSecure("HTTPS://CAPITAL.SHSO.ONLINE")).toBe(true);
  });

  it("is off on a developer's plain-http origin", () => {
    // With `Secure` here the cookie is silently never stored and nobody can
    // sign in at all — a failure that looks like a broken password.
    expect(sessionCookieIsSecure("http://localhost:3000")).toBe(false);
  });

  it("is off when nobody said, which is the safe direction for a dev machine", () => {
    expect(sessionCookieIsSecure(undefined)).toBe(false);
    expect(sessionCookieIsSecure("  ")).toBe(false);
  });
});

describe("isPublicPath", () => {
  it("lets the sign-in screen through the gate and nothing else by accident", () => {
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/api/proxy/me")).toBe(true);
    expect(isPublicPath("/contracts")).toBe(false);
  });
});
