#!/usr/bin/env bash
# The API, on a throwaway PostgreSQL 16 cluster, for the end-to-end run.
#
# M0's definition of done is an access-control claim ("their own unit's area
# tree and nothing else"), and access control is enforced by row policies in
# Postgres (ADR-0010). A mocked API would prove nothing about it, so the
# browser tests talk to the real one, seeded exactly like a developer's.
#
# Playwright owns this process (see playwright.config.ts `webServer`). The
# cluster is started here, torn down when this script exits, and lives in its
# own directory so it never collides with `pnpm --filter @ecapital/api test`.
set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$WEB_DIR/../.." && pwd)"
API_DIR="$ROOT/apps/api"
export ECAPITAL_TEST_DB_DIR="${ECAPITAL_TEST_DB_DIR:-$API_DIR/.tmp/e2e-db}"

API_PID=""
cleanup() {
  if [ -n "$API_PID" ]; then kill "$API_PID" 2>/dev/null || true; fi
  "$API_DIR/scripts/test-db.sh" stop >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# DATABASE_URL, MIGRATION_DATABASE_URL and PGPORT, straight from the script
# the API's own test suite uses.
set -a
eval "$("$API_DIR/scripts/test-db.sh" start)"
set +a

export NODE_ENV=development
export PORT=3001
export LOG_LEVEL=silent
export CORS_ORIGINS=http://localhost:3000
# ADR-0009: the local stub, so the browser can sign in without an Entra tenant.
export DEV_AUTH=1
export DEV_AUTH_SECRET=ecapital-e2e-secret-0123456789

pnpm --filter @ecapital/api migrate >/dev/null
pnpm --filter @ecapital/api seed >/dev/null

# Run the compiled API, not `pnpm --filter @ecapital/api start`.
# `start` goes through tsx, and esbuild — which tsx transpiles with — drops
# `emitDecoratorMetadata`, so Nest cannot resolve a provider that is injected
# by class token and every request fails inside the exception filter. The
# API's own suite hits this too, which is why it transpiles with SWC
# (apps/api/vitest.config.ts, ADR-0012). `tsc` keeps the metadata, so the
# build output runs correctly; it still goes through tsx because
# `@ecapital/shared` ships as TypeScript and node cannot load it directly.
# Left as a note for apps/api rather than fixed here — this brief does not
# touch that app.
pnpm --filter @ecapital/api build >/dev/null
"$API_DIR/node_modules/.bin/tsx" "$API_DIR/dist/apps/api/src/main.js" &
API_PID=$!
wait "$API_PID"
