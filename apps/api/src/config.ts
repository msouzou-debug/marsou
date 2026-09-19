import { AuthMode } from "@ecapital/shared";
import { z } from "zod";

// Every environment variable the API reads, in one place, validated at boot.
// A missing or malformed variable stops the process with a message naming it
// rather than failing later inside a request. apps/api/.env.example documents
// each one in a line.

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === "1" || v === "true")
  .pipe(z.boolean());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    DATABASE_URL: z.string().min(1),
    MIGRATION_DATABASE_URL: z.string().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    // ADR-0018. Left unset it is derived from DEV_AUTH, so every environment
    // written before ADR-0018 keeps working unchanged: DEV_AUTH=1 means dev,
    // anything else means oidc.
    AUTH_MODE: AuthMode.optional(),
    DEV_AUTH: booleanish.default(false),
    DEV_AUTH_SECRET: z.string().min(16).default("ecapital-dev-auth-secret-not-for-production"),
    // The key the session token is signed with in dev and ldap mode. Falls
    // back to DEV_AUTH_SECRET, which is what it used to be called.
    SESSION_SECRET: z.string().min(16).optional(),
    // Production hardening (ADR-0018 §5): the stub must not be reachable on
    // the ΟΚΥπΥ server. Refusing the boot is louder than a log line nobody
    // reads, and the escape hatch exists only for the hour after a migration
    // when somebody genuinely needs it.
    ALLOW_DEV_AUTH_IN_PRODUCTION: booleanish.default(false),

    OIDC_ISSUER: z.string().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_AUDIENCE: z.string().optional(),
    OIDC_JWKS_URI: z.string().optional(),

    // ADR-0018 — the ΟΚΥπΥ Active Directory, the same one eMAP and eFinance
    // bind against (ihcis.local, simple bind with the user's UPN).
    LDAP_URL: z.string().optional(),
    LDAP_BASE_DN: z.string().optional(),
    LDAP_DOMAIN: z.string().optional(),
    LDAP_START_TLS: booleanish.default(false),
    LDAP_UID_ATTRIBUTE: z.string().default("sAMAccountName"),
    LDAP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

    // ADR-0019 §4 — the sibling systems on the same server. Optional: with
    // neither set, the link-outs simply do not appear.
    EMAP_URL: z.string().optional(),
    EFINANCE_URL: z.string().optional(),
    // ADR-0022 §5 — the bearer token eFinance issues eCapital as its one
    // caller on the loopback contract. Only read by
    // `BudgetCodesService`/`EFinanceBudgetCodeReader` today, for
    // `POST /budget-codes/sync`; both EMAP_URL/EFINANCE_URL and this token
    // being set is what turns that route from the seed fallback to an actual
    // eFinance call (ADR-0025).
    EFINANCE_TOKEN: z.string().optional(),

    // Production hardening (ADR-0018 §5). Behind cloudflared the API is
    // reached only over the loopback, so it should not listen anywhere else.
    BIND_HOST: z.string().optional(),
    // Trust X-Forwarded-For / -Proto / -Host. On only behind a proxy that
    // sets them: trusting them on a directly reachable port lets a caller
    // write whatever address it likes into the audit log.
    TRUST_PROXY: booleanish.default(false),

    DEFAULT_LOCALE: z.enum(["el", "en"]).default("el"),
    CORS_ORIGINS: z.string().default("http://localhost:3000"),
  })
  .superRefine((env, ctx) => {
    const mode = env.AUTH_MODE ?? (env.DEV_AUTH ? "dev" : "oidc");

    // Production must not fall back to the stub, and whichever directory it
    // does use, it must know where that directory is. Getting either wrong is
    // an access-control failure, so it is a boot failure (R01, ADR-0018).
    if (env.NODE_ENV === "production" && (mode === "dev" || env.DEV_AUTH)) {
      if (!env.ALLOW_DEV_AUTH_IN_PRODUCTION) {
        ctx.addIssue({
          code: "custom",
          path: ["DEV_AUTH"],
          message:
            "DEV_AUTH cannot be on in production. Set AUTH_MODE=ldap (or oidc), or set ALLOW_DEV_AUTH_IN_PRODUCTION=1 if you really mean it.",
        });
      }
    }
    if (mode === "oidc" && (!env.OIDC_ISSUER || !env.OIDC_AUDIENCE)) {
      ctx.addIssue({
        code: "custom",
        path: ["OIDC_ISSUER"],
        message: "OIDC_ISSUER and OIDC_AUDIENCE are required when AUTH_MODE is oidc",
      });
    }
    if (mode === "ldap" && (!env.LDAP_URL || !env.LDAP_BASE_DN || !env.LDAP_DOMAIN)) {
      ctx.addIssue({
        code: "custom",
        path: ["LDAP_URL"],
        message: "LDAP_URL, LDAP_BASE_DN and LDAP_DOMAIN are required when AUTH_MODE is ldap",
      });
    }
  });

export type AppConfig = Readonly<z.infer<typeof EnvSchema>> & {
  readonly migrationDatabaseUrl: string;
  readonly corsOrigins: string[];
  /** dev | ldap | oidc, after the DEV_AUTH fallback has been applied. */
  readonly authMode: AuthMode;
  /** The key the dev and ldap session tokens are signed with. */
  readonly sessionSecret: string;
  /** True when DEV_AUTH is on in production because somebody insisted. */
  readonly devAuthForcedInProduction: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Environment is not usable:\n${lines.join("\n")}`);
  }
  const env = parsed.data;
  const authMode: AuthMode = env.AUTH_MODE ?? (env.DEV_AUTH ? "dev" : "oidc");
  return Object.freeze({
    ...env,
    migrationDatabaseUrl: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    authMode,
    sessionSecret: env.SESSION_SECRET ?? env.DEV_AUTH_SECRET,
    devAuthForcedInProduction:
      env.NODE_ENV === "production" &&
      (authMode === "dev" || env.DEV_AUTH) &&
      env.ALLOW_DEV_AUTH_IN_PRODUCTION,
  });
}

export const CONFIG = Symbol("ecapital.config");
