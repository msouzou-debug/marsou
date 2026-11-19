#!/usr/bin/env bash
# Checks that this server is ready to run eHire. Run it as the ehire system user before the first start and after
# every upgrade (after `upgrade-db`, before starting the service).
# Usage: scripts/preflight.sh [--env-file FILE] [--skip-port]
#   --skip-port   do not fail when the port is already in use (use it while the service is running)
# FAIL lines make the exit code non-zero. WARN lines do not.
# No sudo, no network (the port check talks to this machine only), touches no service.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${EHIRE_ENV_FILE:-/etc/ehire/ehire.env}"
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
[ -x "$PY" ] || PY="${EHIRE_VENV:-/opt/ehire/venv}/bin/python"
[ -x "$PY" ] || PY="$(command -v python3 || true)"
if [ -z "$PY" ] || [ ! -x "$PY" ]; then
  fail "no Python found (looked for .venv, \$EHIRE_VENV, python3)"
else
  ver="$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  if "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then ok "Python $ver ($PY)"; else fail "Python $ver is too old: 3.10 or newer needed"; fi
  if "$PY" -c 'import flask, flask_sqlalchemy, sqlalchemy, gunicorn, openpyxl, ldap3' 2>/dev/null; then
    ok "required packages import"
  else
    fail "a required package is missing: pip install -r requirements.txt"
  fi
fi

# --- time zone ----------------------------------------------------------------------------------------------------
# Times are stored in UTC and shown in EHIRE_TIMEZONE (default Europe/Nicosia). Without the system time zone database the
# app refuses to start, so say so here first.
if [ -n "$PY" ] && [ -x "$PY" ]; then
  tz="${EHIRE_TIMEZONE:-Europe/Nicosia}"
  if tzout="$("$PY" -c 'import sys, zoneinfo; zoneinfo.ZoneInfo(sys.argv[1])' "$tz" 2>&1)"; then
    ok "time zone $tz is known to this machine"
  else
    fail "time zone $tz cannot be loaded (install the tzdata package, or fix EHIRE_TIMEZONE): $(echo "$tzout" | tail -n 1)"
  fi
fi

# --- settings ---------------------------------------------------------------------------------------------------
secret="${EHIRE_SECRET_KEY:-}"
case "$secret" in
  ''|dev-only-change-me|change-me|changeme|CHANGE_ME|CHANGE-ME) fail "EHIRE_SECRET_KEY is empty or a default value" ;;
  *) if [ "${#secret}" -lt 32 ]; then fail "EHIRE_SECRET_KEY is shorter than 32 characters"; else ok "EHIRE_SECRET_KEY is set (${#secret} characters)"; fi ;;
esac

if [ "${EHIRE_ENV:-}" = "production" ]; then ok "EHIRE_ENV=production"; else fail "EHIRE_ENV is not production (it is '${EHIRE_ENV:-unset}')"; fi

db="${EHIRE_DATABASE_URI:-}"
sqlite_file=""
case "$(echo "$db" | tr 'A-Z' 'a-z')" in
  '') fail "EHIRE_DATABASE_URI is not set" ;;
  sqlite*)
    ok "EHIRE_DATABASE_URI is SQLite (the production engine)"
    if [ -n "$PY" ] && [ -x "$PY" ]; then
      sqlite_file="$("$PY" -c 'import sys; from sqlalchemy.engine import make_url; print(make_url(sys.argv[1]).database or "")' "$db" 2>/dev/null || true)"
    fi
    case "$sqlite_file" in
      '') fail "EHIRE_DATABASE_URI names no SQLite file (in-memory or unreadable URL): use sqlite:////var/lib/ehire/ehire.sqlite3" ;;
      /*) ok "SQLite file path is absolute ($sqlite_file)" ;;
      *) fail "SQLite file path is not absolute ($sqlite_file): use four slashes, sqlite:////var/lib/ehire/ehire.sqlite3"; sqlite_file="" ;;
    esac
    ;;
  *) ok "EHIRE_DATABASE_URI is set" ;;
esac

if [ -n "$sqlite_file" ]; then
  real_db="$(readlink -f -- "$sqlite_file" 2>/dev/null || echo "$sqlite_file")"
  real_app="$(readlink -f -- "$APP_DIR")"
  case "$real_db" in
    "$real_app"/*) fail "SQLite file $sqlite_file is inside the code folder $real_app: a release upgrade would replace it" ;;
    *) ok "SQLite file is outside the code folder" ;;
  esac
  db_dir="$(dirname -- "$real_db")"
  if [ ! -d "$db_dir" ]; then
    fail "SQLite folder $db_dir does not exist"
  else
    probe="$(mktemp -p "$db_dir" .preflight.XXXXXX 2>/dev/null || true)"
    if [ -n "$probe" ]; then
      rm -f -- "$probe"
      ok "SQLite folder $db_dir is writable (WAL needs it for the -wal and -shm files)"
    else
      fail "SQLite folder $db_dir is not writable by $(id -un): WAL cannot create its -wal and -shm files there"
    fi
  fi
  if [ ! -e "$real_db" ]; then
    warn "SQLite file $real_db does not exist yet (scripts/ehire-cli.sh init-db creates it)"
  elif [ ! -r "$real_db" ] || [ ! -w "$real_db" ]; then
    fail "SQLite file $real_db is not readable and writable by $(id -un)"
  elif [ -n "$PY" ] && [ -x "$PY" ]; then
    mode="$("$PY" -c 'import sqlite3, sys; print(sqlite3.connect(sys.argv[1], timeout=5).execute("PRAGMA journal_mode").fetchone()[0])' "$real_db" 2>/dev/null || echo unknown)"
    if [ "$mode" = "wal" ]; then ok "SQLite journal mode is WAL"; else fail "SQLite journal mode is '$mode', not wal (the app switches it on at its first connection: run scripts/ehire-cli.sh db-status)"; fi
  fi
  workers="${EHIRE_WORKERS:-1}"
  case "$workers" in
    ''|*[!0-9]*) fail "EHIRE_WORKERS is not a number ('$workers')" ;;
    *) if [ "$workers" -gt 1 ]; then fail "EHIRE_WORKERS=$workers on SQLite: SQLite allows one writer, set EHIRE_WORKERS=1"; else ok "one gunicorn worker (EHIRE_WORKERS=$workers)"; fi ;;
  esac
fi

# --- Active Directory (only when switched on) -------------------------------------------------------------------
case "$(echo "${EHIRE_AD_ENABLED:-}" | tr 'A-Z' 'a-z')" in
  1|true|yes|on)
    [ -n "${EHIRE_AD_SERVER:-}" ] && [ -n "${EHIRE_AD_DOMAIN:-}" ] && ok "Active Directory server and domain are set" || fail "EHIRE_AD_ENABLED is on but EHIRE_AD_SERVER or EHIRE_AD_DOMAIN is empty"
    case "$(echo "${EHIRE_AD_USE_SSL:-true}" | tr 'A-Z' 'a-z')" in
      1|true|yes|on) ok "Active Directory uses LDAPS" ;;
      *) fail "EHIRE_AD_USE_SSL is off: production uses LDAPS only" ;;
    esac
    if [ -n "${EHIRE_AD_CA_FILE:-}" ] && [ -r "${EHIRE_AD_CA_FILE}" ] && [ -f "${EHIRE_AD_CA_FILE}" ]; then
      ok "Active Directory CA file ${EHIRE_AD_CA_FILE} is readable"
    else
      fail "EHIRE_AD_CA_FILE is empty or not a readable file: IT supplies the organisation's CA certificate (PEM)"
    fi
    ;;
  *) ok "Active Directory sign-in is off (local accounts only)" ;;
esac

case "${EHIRE_BASE_URL:-}" in
  '') fail "EHIRE_BASE_URL is not set (the email button needs it)" ;;
  http://127.0.0.1*|http://localhost*) warn "EHIRE_BASE_URL points at this machine: emails will carry a link nobody else can open" ;;
  *) ok "EHIRE_BASE_URL ${EHIRE_BASE_URL}" ;;
esac
case "$(echo "${EHIRE_HTTPS:-}" | tr 'A-Z' 'a-z')" in
  1|true|yes|on) ok "EHIRE_HTTPS is on" ;;
  *) warn "EHIRE_HTTPS is off: the session cookie will not be marked Secure and no HSTS header is sent" ;;
esac

# --- storage ----------------------------------------------------------------------------------------------------
storage="${EHIRE_STORAGE_DIR:-$APP_DIR/instance/storage}"
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
    fail "database is behind the code ($line): run scripts/ehire-cli.sh upgrade-db"
  fi
fi

# --- LibreOffice ------------------------------------------------------------------------------------------------
soffice="${EHIRE_SOFFICE_BIN:-}"
if [ -z "$soffice" ]; then soffice="$(command -v soffice || command -v libreoffice || true)"; fi
if [ -n "$soffice" ] && [ -x "$soffice" ]; then
  ok "LibreOffice found ($soffice)"
else
  warn "LibreOffice (soffice) not found: Word and Excel files will download but show no preview"
fi

# --- eArchive drop folder -----------------------------------------------------------------------------------------
# Only matters when the archive_transport setting is "folder". Empty is fine: deposits then wait in the queue.
drop="${EHIRE_ARCHIVE_DROP_DIR:-}"
if [ -z "$drop" ]; then
  ok "no eArchive drop folder set (deposits wait in the queue until a transport is chosen)"
elif [ -d "$drop" ] && [ -w "$drop" ]; then
  ok "eArchive drop folder $drop is writable"
else
  warn "eArchive drop folder $drop does not exist or is not writable by this user"
fi

# --- eArchive http link ---------------------------------------------------------------------------------------------
# Only when the archive_transport setting is "http" the token matters; the setting lives in the database, so this
# checks what the environment file says: a set token needs a loopback http address, and a bad address stops the app.
arch_url="${EHIRE_ARCHIVE_URL:-http://127.0.0.1:5011}"
case "$arch_url" in
  http://127.0.0.1|http://127.0.0.1:*|http://localhost|http://localhost:*|http://\[::1\]|http://\[::1\]:*) arch_loop=1 ;;
  *) arch_loop=0 ;;
esac
if [ "$arch_loop" -eq 1 ]; then
  ok "eArchive address $arch_url is on this machine"
else
  fail "EHIRE_ARCHIVE_URL=$arch_url is not plain http on this machine (127.0.0.1, ::1 or localhost): the app will not start"
fi
arch_web="${EHIRE_ARCHIVE_WEB_URL:-}"
if [ -z "$arch_web" ]; then
  ok "no eArchive web address set (the protocol number is shown as text)"
else
  case "$arch_web" in
    http://?*|https://?*) case "$arch_web" in *[[:space:]]*|*\?*|*\#*|*@*) arch_web_bad=1 ;; *) arch_web_bad=0 ;; esac ;;
    *) arch_web_bad=1 ;;
  esac
  if [ "$arch_web_bad" -eq 0 ]; then
    ok "eArchive web address $arch_web (the protocol number links to <address>/protocols/<id>)"
  else
    fail "EHIRE_ARCHIVE_WEB_URL=$arch_web is not a plain http or https address: the app will not start"
  fi
fi
arch_transport="$(cd "$APP_DIR" && "$PY" -m flask --app wsgi:app archive-transport 2>/dev/null | sed -n 's/^archive_transport=//p' || true)"
if [ -n "${EHIRE_ARCHIVE_TOKEN:-}" ]; then
  ok "EHIRE_ARCHIVE_TOKEN is set (not shown)"
elif [ "$arch_transport" = "http" ]; then
  fail "the archive transport is http but EHIRE_ARCHIVE_TOKEN is empty: nothing can be sent (deploy/README.md, eArchive deposits)"
else
  warn "EHIRE_ARCHIVE_TOKEN is empty: deposits wait in the queue. Set it before 'archive-transport http' (deploy/README.md)"
fi

# --- port -------------------------------------------------------------------------------------------------------
bind="${EHIRE_BIND:-127.0.0.1:5008}"
host="${bind%:*}"
port="${bind##*:}"
bind_host="$host"
case "$host" in ''|0.0.0.0|'[::]') host=127.0.0.1 ;; esac
# A tunnel or proxy on another machine cannot reach an app that listens only on the loopback address.
case "$bind_host" in
  127.*|localhost|'[::1]')
    case "${EHIRE_BASE_URL:-}" in
      ''|http://127.*|http://localhost*) ok "eHire listens on $bind_host only" ;;
      *) warn "EHIRE_BIND is $bind (this machine only) but EHIRE_BASE_URL is ${EHIRE_BASE_URL}: a tunnel or proxy on another machine gets no answer (502). Use 0.0.0.0:$port unless the proxy runs on this server" ;;
    esac ;;
  *) ok "eHire listens on $bind_host: limit port $port in the firewall to the tunnel or proxy machine" ;;
esac
if [ "$SKIP_PORT" -eq 1 ]; then
  ok "port check skipped"
elif (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
  fail "port $port on $host is already in use: another service (or a running ehire) is there"
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
