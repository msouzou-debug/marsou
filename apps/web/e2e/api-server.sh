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

# `pnpm --filter @ecapital/api start` runs the source through @swc-node/register,
# which emits decorator metadata (tsx could not, and Nest's DI failed inside
# the exception filter). Same command a developer uses.
pnpm --filter @ecapital/api start &
API_PID=$!
wait "$API_PID"
