import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";

describe("local account passwords (ADR-0030)", () => {
  it("verifies the password it hashed and nothing else", () => {
    const stored = hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("correct horse batterу", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password never hashes the same way twice", () => {
    expect(hashPassword("admin123")).not.toBe(hashPassword("admin123"));
  });

  it("treats a stored value it cannot read as a wrong password, not a crash", () => {
    expect(verifyPassword("anything", "")).toBe(false);
    expect(verifyPassword("anything", "plain-text-password")).toBe(false);
    expect(verifyPassword("anything", "scrypt$x$8$1$AAAA$BBBB")).toBe(false);
    expect(verifyPassword("anything", "bcrypt$10$abc$def$ghi")).toBe(false);
  });

  it("never verifies against the dummy hash", () => {
    expect(verifyPassword("", DUMMY_HASH)).toBe(false);
    expect(verifyPassword("admin123", DUMMY_HASH)).toBe(false);
  });
});
