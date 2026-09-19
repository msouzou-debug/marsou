import { describe, expect, it } from "vitest";
import { signInMode } from "./auth-mode";

// ADR-0018. The screen has to draw the form this deployment's API will
// actually accept; anything else is a person typing into a field nobody
// reads.
describe("signInMode", () => {
  it("takes the mode it is given", () => {
    expect(signInMode("ldap", undefined)).toBe("ldap");
    expect(signInMode("dev", undefined)).toBe("dev");
    expect(signInMode("oidc", undefined)).toBe("oidc");
    expect(signInMode(" ldap ", undefined)).toBe("ldap");
  });

  it("falls back to what NEXT_PUBLIC_DEV_AUTH already said", () => {
    // Every .env.local written before ADR-0018 keeps behaving as it did.
    expect(signInMode(undefined, "1")).toBe("dev");
    expect(signInMode(undefined, undefined)).toBe("oidc");
  });

  it("ignores a value that is not one of the three", () => {
    expect(signInMode("ldaps", "1")).toBe("dev");
    expect(signInMode("", undefined)).toBe("oidc");
  });
});
