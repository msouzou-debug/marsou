import type { Config } from "drizzle-kit";

// ADR-0008: drizzle-kit is here for `drizzle-kit check` and for generating a
// starting point when the schema changes. The migrations that ship are plain
// SQL in src/db/migrations, because RLS policies, grants and audit triggers
// have no Drizzle representation and must stay readable to a DBA.
export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  schemaFilter: ["ecapital"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/ecapital",
  },
} satisfies Config;
