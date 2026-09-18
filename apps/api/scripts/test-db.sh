#!/usr/bin/env bash
# A throwaway PostgreSQL 16 cluster for the API tests.
#
# There is no Docker daemon in the build environment, so the tests bring up a
# real cluster from the PostgreSQL binaries instead: initdb into a temp
# directory, listen on a free port over a unix socket, run, then stop and
# delete everything (ADR-0012).
#
#   ./scripts/test-db.sh start   prints DATABASE_URL and MIGRATION_DATABASE_URL
#   ./scripts/test-db.sh stop    stops the cluster and removes its directory
#
# The state directory is .tmp/test-db under apps/api, or $ECAPITAL_TEST_DB_DIR.
#
# PostgreSQL refuses to run as root. When this script is root (containers
# often are) it drops to $ECAPITAL_TEST_DB_USER, or the first unprivileged
# account it finds, for every server command. On a CI runner, which is not
# root, nothing is dropped.

set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${ECAPITAL_TEST_DB_DIR:-$API_DIR/.tmp/test-db}"
DATA_DIR="$STATE_DIR/data"
SOCK_DIR="$STATE_DIR/sock"
PORT_FILE="$STATE_DIR/port"
LOG_FILE="$STATE_DIR/postgres.log"
DB_NAME="ecapital_test"
APP_ROLE="ecapital_app"

die() { echo "test-db: $*" >&2; exit 1; }

# --- running the server as somebody who is not root -----------------------
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  for candidate in ${ECAPITAL_TEST_DB_USER:-} postgres ubuntu nobody; do
    if id "$candidate" >/dev/null 2>&1; then RUN_AS="$candidate"; break; fi
  done
  [ -n "$RUN_AS" ] || die "running as root and no unprivileged account to drop to (set ECAPITAL_TEST_DB_USER)"
fi

pg() {
  if [ -n "$RUN_AS" ]; then
    runuser -u "$RUN_AS" -- "$@"
  else
    "$@"
  fi
}

find_free_port() {
  "${PYTHON:-python3}" - <<'PY' 2>/dev/null || node -e 'const n=require("net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p))})'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

start() {
  [ -x "$PGBIN/initdb" ] || die "no PostgreSQL 16 binaries at $PGBIN (set PGBIN)"

  if [ -f "$PORT_FILE" ] && pg "$PGBIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
    emit "$(cat "$PORT_FILE")"
    return 0
  fi

  rm -rf "$STATE_DIR"
  mkdir -p "$DATA_DIR" "$SOCK_DIR"
  if [ -n "$RUN_AS" ]; then chown -R "$RUN_AS" "$STATE_DIR"; fi

  # trust auth on a unix socket in a private directory: the cluster is
  # unreachable over the network and lives only for the length of the run.
  pg "$PGBIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust --encoding=UTF8 \
    --locale=C --no-sync >"$STATE_DIR/initdb.log" 2>&1 || {
      cat "$STATE_DIR/initdb.log" >&2; die "initdb failed"; }

  local port
  port="$(find_free_port)"
  [ -n "$port" ] || die "could not find a free port"
  echo "$port" >"$PORT_FILE"

  # fsync off and a tiny buffer: this data is thrown away either way.
  pg "$PGBIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" -w -t 60 \
    -o "-p $port -k $SOCK_DIR -c listen_addresses=127.0.0.1 -c fsync=off -c full_page_writes=off -c synchronous_commit=off -c timezone=UTC" \
    start >/dev/null 2>&1 || { cat "$LOG_FILE" >&2; die "pg_ctl start failed"; }

  pg "$PGBIN/psql" -h 127.0.0.1 -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<SQL
create database $DB_NAME;
SQL

  emit "$port"
}

emit() {
  local port="$1"
  echo "DATABASE_URL=postgres://$APP_ROLE@127.0.0.1:$port/$DB_NAME"
  echo "MIGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:$port/$DB_NAME"
  echo "PGPORT=$port"
}

stop() {
  if [ -d "$DATA_DIR" ]; then
    pg "$PGBIN/pg_ctl" -D "$DATA_DIR" -m immediate -w -t 30 stop >/dev/null 2>&1 || true
  fi
  rm -rf "$STATE_DIR"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) die "usage: test-db.sh start|stop" ;;
esac
