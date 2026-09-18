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

    DEV_AUTH: booleanish.default(false),
    DEV_AUTH_SECRET: z.string().min(16).default("ecapital-dev-auth-secret-not-for-production"),

    OIDC_ISSUER: z.string().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_AUDIENCE: z.string().optional(),
    OIDC_JWKS_URI: z.string().optional(),

    DEFAULT_LOCALE: z.enum(["el", "en"]).default("el"),
    CORS_ORIGINS: z.string().default("http://localhost:3000"),
  })
  .superRefine((env, ctx) => {
    // Production must not fall back to the stub, and it must know where the
    // tenant is. Getting either wrong is an access-control failure, so it is
    // a boot failure (R01).
    if (env.NODE_ENV === "production" && env.DEV_AUTH) {
      ctx.addIssue({
        code: "custom",
        path: ["DEV_AUTH"],
        message: "DEV_AUTH cannot be on in production",
      });
    }
    if (!env.DEV_AUTH && (!env.OIDC_ISSUER || !env.OIDC_AUDIENCE)) {
      ctx.addIssue({
        code: "custom",
        path: ["OIDC_ISSUER"],
        message: "OIDC_ISSUER and OIDC_AUDIENCE are required unless DEV_AUTH is on",
      });
    }
  });

export type AppConfig = Readonly<z.infer<typeof EnvSchema>> & {
  readonly migrationDatabaseUrl: string;
  readonly corsOrigins: string[];
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Environment is not usable:\n${lines.join("\n")}`);
  }
  const env = parsed.data;
  return Object.freeze({
    ...env,
    migrationDatabaseUrl: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
}

export const CONFIG = Symbol("ecapital.config");
