import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

/**
 * ADR-0018 §5 — what the API refuses to start with.
 *
 * The ΟΚΥπΥ server runs three applications side by side and the wrong
 * variable on this one hands anybody who can reach the port a token for any
 * seeded account. Refusing the boot is louder than a warning in a log nobody
 * reads, and it fails at deployment rather than at the first audit.
 */
const BASE = {
  DATABASE_URL: "postgres://ecapital_app@localhost:5432/ecapital",
};

describe("boot refusal", () => {
  it("refuses DEV_AUTH in production", () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: "production", DEV_AUTH: "1" })).toThrow(
      /DEV_AUTH cannot be on in production/,
    );
  });

  it("refuses AUTH_MODE=dev in production too", () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: "production", AUTH_MODE: "dev" })).toThrow(
      /DEV_AUTH cannot be on in production/,
    );
  });

  it("lets it through, loudly, when somebody sets the escape hatch", () => {
    const config = loadConfig({
      ...BASE,
      NODE_ENV: "production",
      DEV_AUTH: "1",
      ALLOW_DEV_AUTH_IN_PRODUCTION: "1",
    });
    expect(config.authMode).toBe("dev");
    // The flag the service reads to shout about it on every boot.
    expect(config.devAuthForcedInProduction).toBe(true);
  });

  it("keeps DEV_AUTH=1 working in development, as every existing .env has it", () => {
    const config = loadConfig({ ...BASE, NODE_ENV: "development", DEV_AUTH: "1" });
    expect(config.authMode).toBe("dev");
  });

  it("means oidc when nothing says otherwise, and then wants a tenant", () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: "development" })).toThrow(/OIDC_ISSUER/);
  });

  it("wants somewhere to bind before it will run in ldap mode", () => {
    expect(() => loadConfig({ ...BASE, AUTH_MODE: "ldap" })).toThrow(
      /LDAP_URL, LDAP_BASE_DN and LDAP_DOMAIN/,
    );
    const config = loadConfig({
      ...BASE,
      AUTH_MODE: "ldap",
      LDAP_URL: "ldap://dc01.ihcis.local:389",
      LDAP_BASE_DN: "DC=ihcis,DC=local",
      LDAP_DOMAIN: "ihcis.local",
    });
    expect(config.authMode).toBe("ldap");
    expect(config.LDAP_UID_ATTRIBUTE).toBe("sAMAccountName");
    expect(config.LDAP_START_TLS).toBe(false);
  });

  it("signs the session with SESSION_SECRET, falling back to the old name", () => {
    const named = loadConfig({
      ...BASE,
      DEV_AUTH: "1",
      SESSION_SECRET: "a-session-secret-long-enough",
    });
    expect(named.sessionSecret).toBe("a-session-secret-long-enough");

    const legacy = loadConfig({ ...BASE, DEV_AUTH: "1", DEV_AUTH_SECRET: "the-old-name-0123456789" });
    expect(legacy.sessionSecret).toBe("the-old-name-0123456789");
  });

  it("keeps the hardening switches off unless the deployment turns them on", () => {
    const dev = loadConfig({ ...BASE, DEV_AUTH: "1" });
    expect(dev.BIND_HOST).toBeUndefined();
    expect(dev.TRUST_PROXY).toBe(false);

    const server = loadConfig({
      ...BASE,
      DEV_AUTH: "1",
      BIND_HOST: "127.0.0.1",
      TRUST_PROXY: "1",
      EMAP_URL: "https://map.shso.online",
      EFINANCE_URL: "https://finance.shso.online",
    });
    expect(server.BIND_HOST).toBe("127.0.0.1");
    expect(server.TRUST_PROXY).toBe(true);
    expect(server.EMAP_URL).toBe("https://map.shso.online");
  });
});
