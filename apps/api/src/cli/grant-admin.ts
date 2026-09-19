#!/usr/bin/env node
/**
 * `pnpm --filter @ecapital/api grant-admin -- --username <sAMAccountName>`
 *
 * How the first administrator exists on a fresh UAT or production database
 * (ADR-0020, runbook §5). The work is in ./grant-role.ts; this file is the
 * name an operator types.
 */
import { main } from "./grant-role";

if (require.main === module) {
  main("grant-admin", process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
