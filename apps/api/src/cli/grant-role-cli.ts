#!/usr/bin/env node
/**
 * `pnpm --filter @ecapital/api grant-role -- --username <sAMAccountName> --role <role>`
 *
 * The only way `auditor_readonly` is granted or revoked (CAPEX-01 §10,
 * ADR-0020). The work is in ./grant-role.ts.
 */
import { main } from "./grant-role";

if (require.main === module) {
  main("grant-role", process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
