#!/usr/bin/env bash
# Checks that this server is ready to run eHR. Run it as the ehr system user before the first start and after
# every upgrade (after `upgrade-db`, before starting the service).
# Usage: scripts/preflight.sh [--env-file FILE] [--skip-port]
#   --skip-port   do not fail when the port is already in use (use it while the service is running)
# FAIL lines make the exit code non-zero. WARN lines do not.
# No sudo, no network (the port check talks to this machine only), touches no service.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${EHR_ENV_FILE:-/etc/ehr/ehr.env}"
SKIP_PORT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?--env-file needs a path}"; shift 2 ;;
    --skip-port) SKIP_PORT=1; shift ;;
    *) echo "usage: preflight.sh [--env-file FILE] [--skip-port]" >&2; exit 64 ;;
  esac
done

FAILS=0
WARNS=0
ok()   { echo "ok    $*"; }
warn() { echo "WARN  $*"; WARNS=$((WARNS + 1)); }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }

# --- environment file -------------------------------------------------------------------------------------------
if [ ! -r "$ENV_FILE" ]; then
  fail "environment file $ENV_FILE is missing or not readable"
  echo "preflight: $FAILS failure(s), $WARNS warning(s)"
  exit 1
fi
# shellcheck source=scripts/_env.sh
. "$APP_DIR/scripts/_env.sh"
load_env_file "$ENV_FILE"
ok "environment file $ENV_FILE"

mode="$(stat -c %a "$ENV_FILE" 2>/dev/null || echo 000)"
if [ $((8#$mode & 8#004)) -ne 0 ]; then warn "$ENV_FILE is readable by everyone (mode $mode); use 640"; fi

# --- Python -----------------------------------------------------------------------------------------------------
PY="$APP_DIR/.venv/bin/python"
[ -x "$PY" ] || PY="${EHR_VENV:-/opt/ehr/venv}/bin/python"
[ -x "$PY" ] || PY="$(command -v python3 || true)"
if [ -z "$PY" ] || [ ! -x "$PY" ]; then
  fail "no Python found (looked for .venv, \$EHR_VENV, python3)"
else
  ver="$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  if "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then ok "Python $ver ($PY)"; else fail "Python $ver is too old: 3.10 or newer needed"; fi
  if "$PY" -c 'import flask, flask_sqlalchemy, sqlalchemy, gunicorn, openpyxl' 2>/dev/null; then
    ok "required packages import"
  else
    fail "a required package is missing: pip install -r requirements.txt"
  fi
fi

# --- settings ---------------------------------------------------------------------------------------------------
secret="${EHR_SECRET_KEY:-}"
case "$secret" in
  ''|dev-only-change-me|change-me|changeme|CHANGE_ME|CHANGE-ME) fail "EHR_SECRET_KEY is empty or a default value" ;;
  *) if [ "${#secret}" -lt 32 ]; then fail "EHR_SECRET_KEY is shorter than 32 characters"; else ok "EHR_SECRET_KEY is set (${#secret} characters)"; fi ;;
esac

if [ "${EHR_ENV:-}" = "production" ]; then ok "EHR_ENV=production"; else fail "EHR_ENV is not production (it is '${EHR_ENV:-unset}')"; fi

db="${EHR_DATABASE_URI:-}"
case "$(echo "$db" | tr 'A-Z' 'a-z')" in
  '') fail "EHR_DATABASE_URI is not set" ;;
  sqlite*) fail "EHR_DATABASE_URI is SQLite, which production refuses" ;;
  *) ok "EHR_DATABASE_URI is set" ;;
esac

case "${EHR_BASE_URL:-}" in
  '') fail "EHR_BASE_URL is not set (the email button needs it)" ;;
  http://127.0.0.1*|http://localhost*) warn "EHR_BASE_URL points at this machine: emails will carry a link nobody else can open" ;;
  *) ok "EHR_BASE_URL ${EHR_BASE_URL}" ;;
esac
case "$(echo "${EHR_HTTPS:-}" | tr 'A-Z' 'a-z')" in
  1|true|yes|on) ok "EHR_HTTPS is on" ;;
  *) warn "EHR_HTTPS is off: the session cookie will not be marked Secure and no HSTS header is sent" ;;
esac

# --- storage ----------------------------------------------------------------------------------------------------
storage="${EHR_STORAGE_DIR:-$APP_DIR/instance/storage}"
if [ ! -d "$storage" ]; then
  fail "storage folder $storage does not exist"
else
  probe="$(mktemp -p "$storage" .preflight.XXXXXX 2>/dev/null || true)"
  if [ -n "$probe" ]; then
    rm -f -- "$probe"
    ok "storage folder $storage is writable"
  else
    fail "storage folder $storage is not writable by $(id -un)"
  fi
fi

# --- database and schema ----------------------------------------------------------------------------------------
if [ -n "$PY" ] && [ -x "$PY" ] && [ -n "$db" ]; then
  code=0
  out="$(cd "$APP_DIR" && "$PY" -m flask --app wsgi:app db-status 2>&1)" || code=$?
  line="$(echo "$out" | grep -E '^current=[0-9]+ latest=[0-9]+' | tail -n 1 || true)"
  if [ -z "$line" ]; then
    fail "the database is not reachable, or the app did not start: $(echo "$out" | tail -n 1)"
  elif [ "$code" -eq 0 ]; then
    ok "database reachable and up to date ($line)"
  else
    fail "database is behind the code ($line): run scripts/ehr-cli.sh upgrade-db"
  fi
fi

# --- LibreOffice ------------------------------------------------------------------------------------------------
soffice="${EHR_SOFFICE_BIN:-}"
if [ -z "$soffice" ]; then soffice="$(command -v soffice || command -v libreoffice || true)"; fi
if [ -n "$soffice" ] && [ -x "$soffice" ]; then
  ok "LibreOffice found ($soffice)"
else
  warn "LibreOffice (soffice) not found: Word and Excel files will download but show no preview"
fi

# --- port -------------------------------------------------------------------------------------------------------
bind="${EHR_BIND:-127.0.0.1:5006}"
host="${bind%:*}"
port="${bind##*:}"
case "$host" in ''|0.0.0.0|'[::]') host=127.0.0.1 ;; esac
if [ "$SKIP_PORT" -eq 1 ]; then
  ok "port check skipped"
elif (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
  fail "port $port on $host is already in use: another service (or a running ehr) is there"
else
  ok "port $port is free"
fi

# --- release record ---------------------------------------------------------------------------------------------
if [ -f "$APP_DIR/RELEASE-INFO" ]; then
  if grep -q '^tests: passed' "$APP_DIR/RELEASE-INFO"; then ok "release was built with a passing test suite"; else fail "RELEASE-INFO does not say the tests passed"; fi
else
  warn "no RELEASE-INFO: this is not a built release, so no test result is recorded"
fi

echo "preflight: $FAILS failure(s), $WARNS warning(s)"
[ "$FAILS" -eq 0 ]
