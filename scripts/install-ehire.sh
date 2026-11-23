#!/usr/bin/env bash
# install-ehire.sh: one command to install or upgrade eHire on the shared server.
#
#   sudo bash install-ehire.sh [options] ehire-<version>.tar.gz
#
# Copy three files to the server, in one folder: this script, the tarball and its .sha256 file. Run it as root
# from an SSH session. It guards, backs up, installs, restarts only ehire.service and checks. This script never
# calls sudo itself: it must BE root. Re-running is safe.
#
# Options:
#   --wheels DIR   offline install: pip install --no-index --find-links DIR (default: pip downloads from PyPI)
#   --dry-run      print every action, change nothing
#   --yes          do not ask for confirmation (needed when no terminal is attached)
#   --no-start     install, but do not start the service
#   --port N       port eHire listens on (default 5008; an existing settings file wins and must agree)
#   --root DIR     testing only: use DIR as the filesystem root, skip useradd, chown to other users and systemctl,
#                  and record what would have run in DIR/.actions.log. Refused for /.
#   -h, --help     this text
#
# Exit codes: 0 done or nothing to do | 1 a guard failed, nothing changed | 2 failed and rolled back (or nothing
# live was touched) | 3 failed and could not roll back cleanly: the message says what state it is in.
#
# No network except pip (when no --wheels is given) and 127.0.0.1 for the health check. Plain ASCII output.
# Touches only: /opt/ehire /etc/ehire /var/lib/ehire /var/log/ehire /var/backups/ehire, the user and group ehire,
# and ehire.service. Never another unit, nginx, apache or cron.
[ -n "${BASH_VERSION:-}" ] || { printf '%s\n' "install-ehire.sh: this script needs bash. Run: sudo bash install-ehire.sh ehire-<version>.tar.gz" >&2; exit 1; }
set -euo pipefail
set -E   # functions inherit the ERR trap below
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then printf '%s\n' "install-ehire.sh: bash 4 or newer is needed" >&2; exit 1; fi
umask 022

PROG="install-ehire.sh"
TOTAL=14
SERVICE="ehire"
SELF_DIR="."
if d="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)"; then SELF_DIR="$d"; fi

usage() { sed -n '2,/^# No network/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' | sed '$d'; }
usage_err() { printf '%s\n' "$PROG: $1" "Try: bash $PROG --help" >&2; exit 1; }

# ------------------------------------------------------------------------------------------------ options
WHEELS=""; DRY=0; YES=0; NO_START=0; ROOT_ARG=""; PORT=5008; PORT_EXPLICIT=0; TARBALL_ARG=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --wheels) [ "$#" -ge 2 ] || usage_err "--wheels needs a folder"; WHEELS="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --yes) YES=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --root) [ "$#" -ge 2 ] || usage_err "--root needs a folder"; ROOT_ARG="$2"; shift 2 ;;
    --port) [ "$#" -ge 2 ] || usage_err "--port needs a number"; PORT="$2"; PORT_EXPLICIT=1; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) usage_err "unknown option $1" ;;
    *) [ -z "$TARBALL_ARG" ] || usage_err "only one tarball can be given"; TARBALL_ARG="$1"; shift ;;
  esac
done
case "$PORT" in ''|*[!0-9]*) usage_err "--port must be a number" ;; esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then usage_err "--port must be between 1 and 65535"; fi
[ -n "$TARBALL_ARG" ] || usage_err "no tarball given. Usage: sudo bash $PROG [options] ehire-<version>.tar.gz"

ROOT=""
if [ -n "$ROOT_ARG" ]; then
  [ -d "$ROOT_ARG" ] || usage_err "--root: $ROOT_ARG is not a folder"
  ROOT="$(cd "$ROOT_ARG" && pwd -P)"
  [ "$ROOT" != "/" ] || usage_err "--root / is refused: it would be the real server. Use a test folder."
fi
# Test-only hooks. They are read only together with --root; without it these variables are ignored.
T_NOT_ROOT=""; T_HEALTH_URL=""; T_HEALTH_SECONDS=""; T_FREE_KB=""; T_FAST_VENV=""
if [ -n "$ROOT" ]; then
  T_NOT_ROOT="${EHIRE_INSTALL_TEST_NOT_ROOT:-}"
  T_HEALTH_URL="${EHIRE_INSTALL_TEST_HEALTH_URL:-}"
  T_HEALTH_SECONDS="${EHIRE_INSTALL_TEST_HEALTH_SECONDS:-}"
  T_FREE_KB="${EHIRE_INSTALL_TEST_FREE_KB:-}"
  T_FAST_VENV="${EHIRE_INSTALL_TEST_FAST_VENV:-}"
fi

# Resolve every path the user gave to an absolute one, then leave the current folder (it may hold anything).
abs_file() { local d; d="$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)" || return 1; printf '%s/%s' "$d" "$(basename "$1")"; }
TARBALL="$(abs_file "$TARBALL_ARG" || true)"
[ -n "$TARBALL" ] || TARBALL="$TARBALL_ARG"
if [ -n "$WHEELS" ] && d="$(cd "$WHEELS" 2>/dev/null && pwd -P)"; then WHEELS="$d"; fi
cd /

# ------------------------------------------------------------------------------------------------ paths
OPT="$ROOT/opt/ehire"
ETC="$ROOT/etc/ehire"
VAR="$ROOT/var/lib/ehire"
LOGD="$ROOT/var/log/ehire"
BAK="$ROOT/var/backups/ehire"
UNIT="$ROOT/etc/systemd/system/ehire.service"
ENVF="$ETC/ehire.env"
CUR="$OPT/current"
MARKER="$OPT/.install-incomplete"
SVC_STATE="$ROOT/.svc-state"
ACTIONS="$ROOT/.actions.log"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOGFILE="$LOGD/install-$STAMP.log"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/ehire-install.XXXXXX")"
BUF="$TMP/run.log"
: > "$BUF"
LOG_ON=0

# ------------------------------------------------------------------------------------------------ output
# say: one line to the screen and to the buffer that becomes /var/log/ehire/install-<time>.log. A closed terminal
# (dropped SSH session) must not stop an upgrade half way, so write errors are ignored.
say() { printf '%s\n' "$*" 2>/dev/null || true; printf '%s\n' "$*" >> "$BUF" 2>/dev/null || true; }
sayn() { printf '%s' "$*" 2>/dev/null || true; printf '%s' "$*" >> "$BUF" 2>/dev/null || true; }
block() { local l; while IFS= read -r l; do say "$l"; done; }

STEP_OPEN=0; NOTES=()
step() { NOTES=(); sayn "[$1/$TOTAL] $2 ... "; STEP_OPEN=1; }
note() { NOTES+=("$1"); }
flush_notes() { local n; if [ "${#NOTES[@]}" -gt 0 ]; then for n in "${NOTES[@]}"; do say "      $n"; done; fi; NOTES=(); }
step_ok() { say "${1:-ok}"; STEP_OPEN=0; flush_notes; }
step_fail_line() { if [ "$STEP_OPEN" = 1 ]; then say "FAILED: $1"; STEP_OPEN=0; else say "FAILED: $1"; fi; flush_notes; }

rec() { if [ -n "$ROOT" ] && [ "$DRY" != 1 ]; then printf '%s\n' "$*" >> "$ACTIONS" 2>/dev/null || true; fi; }
real() { local p="$1"; if [ -n "$ROOT" ]; then p="${p#"$ROOT"}"; fi; printf '%s' "${p:-/}"; }

cleanup() {
  local code=$?
  if [ "$LOG_ON" = 1 ] && [ -d "$LOGD" ]; then
    if cp "$BUF" "$LOGFILE" 2>/dev/null; then chmod 640 "$LOGFILE" 2>/dev/null || true; fi
    if [ -z "$ROOT" ]; then chown root:ehire "$LOGFILE" 2>/dev/null || true; else rec "chown root:ehire $(real "$LOGFILE")"; fi
  fi
  case "$TMP" in */ehire-install.??????) rm -rf -- "$TMP" ;; esac
  return "$code"
}
trap cleanup EXIT
trap '' HUP PIPE

# ------------------------------------------------------------------------------------------------ failure paths
PHASE="guard"          # guard -> prep -> live
MODE=""                # first | upgrade
VERSION=""; NAME=""; REL=""
OLD_VER=""; OLD_REL=""; OLD_LINK_TARGET=""
WAS_ACTIVE=0; STOPPED=0; LINK_SWITCHED=0; VENV_SWITCHED=0; DB_STARTED=0; UNIT_REPLACED=0; UNIT_CREATED=0
OLD_VENV_KIND="none"; OLD_VENV_TARGET=""; OLD_VENV_RENAMED=""
BKDIR=""; DBFILE=""; STORAGE=""; USER_CREATED=0; MISSING_VARS=""

# run a command that may fail without ending the script; keep its output for the log
OUTF="$TMP/cmd.out"
capture() { local rc=0; "$@" > "$OUTF" 2>&1 || rc=$?; return "$rc"; }
tail_notes() { local n="${1:-15}" l; while IFS= read -r l; do note "| $l"; done < <(tail -n "$n" "$OUTF" 2>/dev/null | cut -c1-200); }

fail() {
  local reason="$1" code=1
  trap - ERR; set +e
  trap '' INT TERM
  step_fail_line "$reason"
  case "$PHASE" in
    guard)
      say "Nothing was changed."
      code=1 ;;
    prep)
      if [ "$MODE" = upgrade ]; then
        say "The running release and its data were not touched. Files this run already made are listed below."
        list_made
        code=2
      else
        first_install_failed; code=3
      fi ;;
    live)
      if [ "$MODE" = upgrade ]; then
        if rollback; then code=2; else code=3; fi
      else
        first_install_failed; code=3
      fi ;;
  esac
  exit "$code"
}

list_made() {
  say "Left in place for inspection (nothing is deleted automatically):"
  [ -d "$OPT/staging" ] && say "  $(real "$OPT")/staging  (partial unpack folders, safe to delete)"
  [ -n "$REL" ] && [ -d "$REL" ] && say "  $(real "$REL")"
  [ -n "$BKDIR" ] && [ -d "$BKDIR" ] && say "  $(real "$BKDIR")  (backup, possibly incomplete)"
  return 0
}

first_install_failed() {
  say ""
  say "The first install did not finish."
  if [ "$UNIT_CREATED" = 1 ]; then
    svc stop || true
    svc disable || true
    say "The service ehire was stopped and disabled."
  fi
  say "Files are left in place for inspection. Nothing was deleted. What exists now:"
  local p
  for p in "$OPT" "$ETC" "$VAR" "$LOGD" "$BAK" "$UNIT"; do [ -e "$p" ] && say "  $(real "$p")"; done
  if [ "$USER_CREATED" = 1 ]; then say "  the system user and group ehire (created by this run)"; fi
  say "Fix the cause shown above and run the same command again: the install resumes."
  say "To remove everything this run made (this deletes the database and documents; only when you are sure):"
  say "  systemctl disable --now ehire"
  say "  rm -f /etc/systemd/system/ehire.service && systemctl daemon-reload"
  say "  rm -rf /opt/ehire /etc/ehire /var/lib/ehire /var/log/ehire /var/backups/ehire"
  say "  userdel ehire"
  say "Exit code 3: failed, nothing rolled back."
}

on_err() { trap - ERR; set +e; fail "unexpected error near line $1 of $PROG"; }
trap 'on_err $LINENO' ERR
on_signal() { trap '' INT TERM; fail "interrupted by a signal"; }
trap on_signal INT TERM

# ------------------------------------------------------------------------------------------------ small helpers
env_get() {  # env_get FILE NAME -> last value, one pair of quotes stripped
  local v
  v="$(grep -E "^$2=" "$1" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  case "$v" in \"*\") v="${v#\"}"; v="${v%\"}" ;; \'*\') v="${v#\'}"; v="${v%\'}" ;; esac
  printf '%s' "$v"
}
var_names() { grep -oE '^[A-Z][A-Z0-9_]*=' "$1" 2>/dev/null | tr -d = | LC_ALL=C sort -u || true; }

own_path() {  # refuse to change anything outside the paths this installer owns
  case "$1" in
    "$OPT"|"$OPT"/*|"$ETC"|"$ETC"/*|"$VAR"|"$VAR"/*|"$LOGD"|"$LOGD"/*|"$BAK"|"$BAK"/*|"$UNIT"|"$UNIT".bak) return 0 ;;
  esac
  say "internal error: refusing to change $1 (outside the eHire paths)"; exit 3
}
do_chmod() { own_path "$2"; chmod "$1" "$2"; rec "chmod $1 $(real "$2")"; }
do_chown() { own_path "$2"; if [ -z "$ROOT" ]; then chown "$1" "$2"; fi; rec "chown $1 $(real "$2")"; }
do_chown_R() { own_path "$2"; if [ -z "$ROOT" ]; then chown -R "$1" "$2"; fi; rec "chown -R $1 $(real "$2")"; }

mkd() {  # mkd OWNER MODE PATH: create when missing, then set owner and mode
  own_path "$3"
  [ -d "$3" ] || mkdir -p "$3"
  do_chown "$1" "$3"
  do_chmod "$2" "$3"
}

svc() {  # the only unit this script touches is ehire
  case "$1" in stop|start|enable|disable) ;; *) say "internal error: svc $1"; exit 3 ;; esac
  if [ -n "$ROOT" ]; then
    rec "systemctl $1 $SERVICE"
    case "$1" in start) echo active > "$SVC_STATE" ;; stop) echo inactive > "$SVC_STATE" ;; esac
    return 0
  fi
  systemctl "$1" "$SERVICE"
}
svc_reload() { if [ -n "$ROOT" ]; then rec "systemctl daemon-reload"; return 0; fi; systemctl daemon-reload; }
svc_active() {
  if [ -n "$ROOT" ]; then [ "$(cat "$SVC_STATE" 2>/dev/null || echo inactive)" = active ]; return; fi
  systemctl is-active --quiet "$SERVICE"
}

run_as_ehire() {  # commands that touch eHire data or code run as the ehire user, never as root
  local pre=(env "HOME=$OPT" "EHIRE_VENV=$OPT/venv" "EHIRE_ENV_FILE=$ENVF")
  if [ -n "$ROOT" ]; then rec "runuser -u ehire -- $*"; "${pre[@]}" "$@"; return; fi
  runuser -u ehire -- "${pre[@]}" "$@"
}
cli() {  # cli COMMAND [ARGS]: ehire-cli.sh of the CURRENT link, as the ehire user
  run_as_ehire bash "$CUR/scripts/ehire-cli.sh" --env-file "$ENVF" "$@"
}

show_journal() {  # the last 30 lines of the ehire unit's journal, as notes
  if [ -n "$ROOT" ]; then rec "journalctl -u $SERVICE -n 30 --no-pager"; return 0; fi
  capture journalctl -u "$SERVICE" -n 30 --no-pager || true
  tail_notes 30
}

switch_link() {  # switch_link TARGET LINK: atomic (new link, then rename over the old one)
  local t="$1" l="$2" tmp="$2.new.$$"
  own_path "$l"
  rm -f -- "$tmp"
  ln -s "$t" "$tmp" && mv -T "$tmp" "$l"
}

port_listener() {  # prints "name (pid N)" and returns 0 when something listens on TCP port $1
  local port="$1" line="" name="" pid="" hex inode="" path
  if command -v ss >/dev/null 2>&1; then
    line="$(ss -H -ltnp 2>/dev/null | awk -v suf=":$port" 'substr($4, length($4) - length(suf) + 1) == suf { print; exit }' || true)"
    if [ -n "$line" ]; then
      name="$(printf '%s' "$line" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p')"
      pid="$(printf '%s' "$line" | sed -n 's/.*pid=\([0-9]*\).*/\1/p')"
      printf '%s (pid %s)' "${name:-unknown process}" "${pid:-unknown}"; return 0
    fi
  fi
  hex="$(printf '%04X' "$port")"
  inode="$(awk -v hex="$hex" 'FNR > 1 && $4 == "0A" { n = split($2, a, ":"); if (a[n] == hex) { print $10; exit } }' /proc/net/tcp /proc/net/tcp6 2>/dev/null || true)"
  [ -n "$inode" ] || return 1
  path="$(find /proc -maxdepth 3 -path '/proc/[0-9]*/fd/*' -lname "socket:\\[$inode\\]" 2>/dev/null | head -n 1 || true)"
  if [ -n "$path" ]; then
    pid="${path#/proc/}"; pid="${pid%%/*}"
    name="$(cat "/proc/$pid/comm" 2>/dev/null || true)"
  fi
  printf '%s (pid %s)' "${name:-unknown process}" "${pid:-unknown}"
  return 0
}

health_ok() {  # does the URL answer {"status":"ok"}? No proxy is used.
  python3 -s -c '
import json, sys, urllib.request
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    data = json.loads(opener.open(sys.argv[1], timeout=3).read().decode("utf-8"))
    sys.exit(0 if data.get("status") == "ok" else 1)
except Exception:
    sys.exit(1)
' "$1" >/dev/null 2>&1
}
health_url() { if [ -n "$T_HEALTH_URL" ]; then printf '%s' "$T_HEALTH_URL"; else printf 'http://127.0.0.1:%s/healthz' "$PORT"; fi; }
wait_healthy() {  # wait_healthy SECONDS
  local secs="$1" i=0
  while [ "$i" -lt "$secs" ]; do
    if svc_active && health_ok "$(health_url)"; then
      if [ -z "$ROOT" ]; then sleep 2; svc_active || return 1; fi
      return 0
    fi
    sleep 1; i=$((i + 1))
  done
  return 1
}
HEALTH_SECS="${T_HEALTH_SECONDS:-30}"

nearest_existing() { local p="$1"; while [ ! -e "$p" ] && [ "$p" != "/" ]; do p="$(dirname "$p")"; done; printf '%s' "$p"; }

sqlite_path() {  # sqlite:////abs/file -> /abs/file ; anything else -> empty
  local u="$1"
  case "$u" in sqlite:////*) u="${u#sqlite:///}"; printf '%s' "${u%%\?*}" ;; esac
}

switch_venv() {  # switch_venv NEWNAME: make /opt/ehire/venv point at NEWNAME, remember how to go back
  local new="$1" venv="$OPT/venv" r n=1
  if [ -L "$venv" ]; then
    OLD_VENV_KIND=link; OLD_VENV_TARGET="$(readlink "$venv")"
  elif [ -d "$venv" ]; then
    OLD_VENV_KIND=dir; r="$OPT/venv-${OLD_VER:-old}"
    while [ -e "$r" ]; do n=$((n + 1)); r="$OPT/venv-${OLD_VER:-old}.$n"; done
    mv "$venv" "$r" || return 1; OLD_VENV_RENAMED="$r"
  else
    OLD_VENV_KIND=none
  fi
  switch_link "$new" "$venv" || return 1
  VENV_SWITCHED=1
}
restore_venv() {
  local venv="$OPT/venv"
  case "$OLD_VENV_KIND" in
    link) switch_link "$OLD_VENV_TARGET" "$venv" ;;
    dir) [ ! -L "$venv" ] || rm -f -- "$venv"; mv "$OLD_VENV_RENAMED" "$venv" ;;
    *) [ ! -L "$venv" ] || rm -f -- "$venv" ;;
  esac
}

# ------------------------------------------------------------------------------------------------ rollback
restore_data() {  # restore_data SIDEFOLDER: keep what is there, put the step-8 backup back
  local side="$1" f
  mkdir -p "$side" || return 1
  for f in "$DBFILE" "$DBFILE-wal" "$DBFILE-shm"; do
    if [ -e "$f" ]; then mv "$f" "$side/$(basename "$f")" || return 1; fi
  done
  if [ -e "$STORAGE" ]; then mv "$STORAGE" "$side/$(basename "$STORAGE")" || return 1; fi
  cp -p "$BKDIR/ehire.sqlite3" "$DBFILE" || return 1
  do_chown ehire:ehire "$DBFILE" || return 1
  do_chmod 600 "$DBFILE" || return 1
  run_as_ehire tar -C "$(dirname "$STORAGE")" -xzf "$BKDIR/storage.tar.gz" || return 1
  [ -s "$DBFILE" ] && [ -d "$STORAGE" ]
}
RB_LINES=()
rb() { RB_LINES+=("$1"); }
rollback() {  # upgrade only. Returns 0 when everything was put back.
  local bad=0 side l
  trap '' INT TERM
  step 13 "Roll back to ehire-${OLD_VER:-previous}"
  note "Rolling back. The database and documents are restored only if the migration had started."
  if [ "$STOPPED" = 1 ] || svc_active; then
    if svc stop; then rb "service ehire stopped"; else rb "COULD NOT STOP ehire"; bad=1; fi
  fi
  if [ "$LINK_SWITCHED" = 1 ]; then
    if switch_link "$OLD_LINK_TARGET" "$CUR"; then rb "current points at ehire-$OLD_VER again"; else rb "COULD NOT repoint $(real "$CUR") (it was $OLD_LINK_TARGET)"; bad=1; fi
  fi
  if [ "$VENV_SWITCHED" = 1 ]; then
    if restore_venv; then rb "venv points at the previous environment again"; else rb "COULD NOT restore the venv link (was $OLD_VENV_TARGET$OLD_VENV_RENAMED)"; bad=1; fi
  fi
  if [ "$UNIT_REPLACED" = 1 ]; then
    if [ -f "$UNIT.bak" ] && cp -p "$UNIT.bak" "$UNIT" && svc_reload; then rb "service file restored from ehire.service.bak"; else rb "COULD NOT restore the service file ($(real "$UNIT").bak)"; bad=1; fi
  fi
  if [ "$DB_STARTED" = 1 ]; then
    side="$BKDIR/failed-upgrade"
    if restore_data "$side"; then
      rb "database and documents restored from $(real "$BKDIR") (stale -wal and -shm files removed)"
      rb "the failed state was moved to $(real "$side")"
    else
      rb "COULD NOT restore data from $(real "$BKDIR"): do it by hand (deploy/README.md, Restore); moved files are in $(real "$side")"; bad=1
    fi
  else
    rb "database and documents were not touched, so they were not restored"
  fi
  if [ "$WAS_ACTIVE" = 1 ] && [ "$bad" = 0 ]; then
    if svc start && wait_healthy "$HEALTH_SECS"; then rb "service ehire started again and answers /healthz"; else rb "ehire was started again but does not answer /healthz: see journalctl -u ehire"; bad=1; fi
  elif [ "$WAS_ACTIVE" = 1 ]; then
    rb "ehire was NOT started again because a step above failed"
  fi
  if [ "$bad" = 0 ]; then step_ok "ok"; else step_fail_line "the rollback was not clean"; fi
  if [ "${#RB_LINES[@]}" -gt 0 ]; then for l in "${RB_LINES[@]}"; do say "  $l"; done; fi
  say ""
  if [ "$bad" = 0 ]; then
    say "Result: the upgrade to ehire-$VERSION FAILED and was rolled back to ehire-$OLD_VER. Exit code 2."
    say "Backup of this run: $(real "$BKDIR")"
  else
    say "Result: the upgrade to ehire-$VERSION FAILED and the rollback did not finish cleanly. Exit code 3."
    say "State: see the lines above. Backup of this run: $(real "$BKDIR"). Do not start other changes before looking at it."
  fi
  return "$bad"
}

# ================================================================================================ step 1: guards
step 1 "Check the server and the release"
uid="$(id -u)"
if [ -n "$T_NOT_ROOT" ]; then uid=1000; elif [ -n "$ROOT" ]; then uid=0; fi   # with --root, the folder owner is enough
[ "$uid" -eq 0 ] || fail "not root. This script never calls sudo: it must run as root, for example: sudo bash $PROG ehire-<version>.tar.gz"

[ -f "$TARBALL" ] || fail "the tarball $TARBALL_ARG does not exist"
TB_NAME="$(basename "$TARBALL")"; TB_DIR="$(dirname "$TARBALL")"
if [[ "$TB_NAME" =~ ^ehire-([A-Za-z0-9._-]+)\.tar\.gz$ ]]; then VERSION="${BASH_REMATCH[1]}"; else fail "the file name $TB_NAME is not ehire-<version>.tar.gz"; fi
NAME="ehire-$VERSION"
REL="$OPT/releases/$NAME"
[ -f "$TARBALL.sha256" ] || fail "$TB_NAME.sha256 is not next to the tarball. Copy it from the build machine into the same folder."
for tool in sha256sum tar awk sed grep find mktemp install; do command -v "$tool" >/dev/null 2>&1 || fail "the tool $tool is missing"; done
(cd "$TB_DIR" && sha256sum --quiet -c "$TB_NAME.sha256") >/dev/null 2>&1 || fail "the tarball does not match $TB_NAME.sha256. Do not install it. Copy it again and compare the checksum by a second route."

if [ -n "$WHEELS" ]; then [ -d "$WHEELS" ] || fail "--wheels: $WHEELS is not a folder"; fi
tar -tzf "$TARBALL" > "$TMP/list.txt" 2>/dev/null || fail "the tarball cannot be read"
tar -tvzf "$TARBALL" > "$TMP/listv.txt" 2>/dev/null || fail "the tarball cannot be read"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$TMP/list.txt"; then fail "the tarball holds absolute or .. paths"; fi
if cut -c1 "$TMP/listv.txt" | grep -q '[^-d]'; then fail "the tarball holds links or special files; a release holds only files and folders"; fi
WORK="$TMP/unpack"; mkdir -p "$WORK"
tar -xzf "$TARBALL" -C "$WORK" --no-same-owner 2>/dev/null || fail "the tarball cannot be unpacked"
[ -d "$WORK/$NAME" ] && [ "$(find "$WORK" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = 1 ] || fail "the tarball must hold exactly one folder, $NAME"

VERIFY="$SELF_DIR/verify-release.sh"
[ -f "$VERIFY" ] || VERIFY="$WORK/$NAME/scripts/verify-release.sh"
[ -f "$VERIFY" ] || fail "verify-release.sh is not next to this script and not inside the release"
if capture bash "$VERIFY" "$TARBALL"; then :; else tail_notes 8; fail "the release does not match its SHA256SUMS (verify-release.sh failed)"; fi

INFO="$WORK/$NAME/RELEASE-INFO"
[ -f "$INFO" ] || fail "the release has no RELEASE-INFO"
grep -qx "version: $VERSION" "$INFO" || fail "RELEASE-INFO names another version than the file name ($VERSION)"
grep -qx 'tests: passed' "$INFO" || fail "RELEASE-INFO does not say 'tests: passed'. A release built with --skip-tests is never installed."
for f in requirements.txt wsgi.py scripts/ehire-cli.sh scripts/preflight.sh scripts/verify-release.sh deploy/ehire.env.example deploy/ehire.service.example; do
  [ -f "$WORK/$NAME/$f" ] || fail "the release lacks $f"
done

command -v python3 >/dev/null 2>&1 || fail "python3 is not installed (3.10 or newer is needed)"
python3 -s -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || fail "python3 is older than 3.10: $(python3 -V 2>&1)"
python3 -s -c 'import venv, ensurepip' >/dev/null 2>&1 || fail "python3 has no venv module (on Ubuntu: apt install python3-venv)"
python3 -s -c 'import zoneinfo; zoneinfo.ZoneInfo("Europe/Nicosia")' >/dev/null 2>&1 || fail "the system time zone database is missing (on Ubuntu: apt install tzdata); eHire does not start without it"
if [ -z "$ROOT" ]; then
  command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] || fail "systemd is not running here (systemctl or /run/systemd/system is missing)"
  command -v runuser >/dev/null 2>&1 || fail "runuser is missing (part of util-linux); the app commands must run as the ehire user"
fi

free_kb() {
  if [ -n "$T_FREE_KB" ]; then printf '%s' "$T_FREE_KB"; return; fi
  df -Pk "$(nearest_existing "$1")" 2>/dev/null | awk 'NR == 2 { print $4 }'
}
for d in "$OPT" "$ROOT/var/lib"; do
  kb="$(free_kb "$d")"
  case "$kb" in ''|*[!0-9]*) fail "cannot read the free disk space for $(real "$d")" ;; esac
  [ "$kb" -ge 512000 ] || fail "less than 500 MB free for $(real "$d") ($((kb / 1024)) MB)"
done
if [ -z "${EHIRE_SOFFICE_BIN:-}" ] && ! command -v soffice >/dev/null 2>&1 && ! command -v libreoffice >/dev/null 2>&1; then
  note "warning: LibreOffice (soffice) not found. Word and Excel previews and the eArchive PDF need it."
fi
step_ok

# ================================================================================================ step 2: mode
step 2 "Decide install or upgrade"
if [ -e "$MARKER" ]; then
  MODE=first
  note "mode: FIRST INSTALL (resuming: an earlier first install did not finish)"
elif [ -L "$CUR" ]; then
  MODE=upgrade
  OLD_LINK_TARGET="$(readlink "$CUR")"
  case "$OLD_LINK_TARGET" in "$OPT"/releases/ehire-*) ;; *) fail "$(real "$CUR") points at $OLD_LINK_TARGET, which is not a release under $(real "$OPT")/releases. Fix it by hand first." ;; esac
  [ -d "$OLD_LINK_TARGET" ] || fail "$(real "$CUR") points at a folder that does not exist ($OLD_LINK_TARGET)"
  OLD_REL="$OLD_LINK_TARGET"; OLD_VER="$(basename "$OLD_REL")"; OLD_VER="${OLD_VER#ehire-}"
  note "mode: UPGRADE"
elif [ -e "$CUR" ]; then
  fail "$(real "$CUR") exists but is not a link. This installer does not touch it."
else
  MODE=first
  note "mode: FIRST INSTALL"
fi
note "installing: $VERSION"
[ "$MODE" = upgrade ] && note "currently linked: $OLD_VER"

if [ "$MODE" = upgrade ]; then
  [ -f "$ENVF" ] || fail "this is an upgrade but $(real "$ENVF") is missing"
  DBFILE="$(sqlite_path "$(env_get "$ENVF" EHIRE_DATABASE_URI)")"
  STORAGE="$(env_get "$ENVF" EHIRE_STORAGE_DIR)"; STORAGE="${STORAGE%/}"
  case "$DBFILE" in "$VAR"/*) ;; *) fail "EHIRE_DATABASE_URI in $(real "$ENVF") is not a SQLite file under $(real "$VAR"): this installer backs up only its own layout" ;; esac
  case "$STORAGE" in "$VAR"/*) ;; *) fail "EHIRE_STORAGE_DIR in $(real "$ENVF") is not under $(real "$VAR"): this installer backs up only its own layout" ;; esac
  ENV_BIND="$(env_get "$ENVF" EHIRE_BIND)"
  if [ -n "$ENV_BIND" ]; then
    env_port="${ENV_BIND##*:}"
    case "$env_port" in ''|*[!0-9]*) ;; *)
      if [ "$PORT_EXPLICIT" = 1 ] && [ "$env_port" != "$PORT" ]; then fail "--port $PORT, but EHIRE_BIND in $(real "$ENVF") says port $env_port. Omit --port or edit the file."; fi
      PORT="$env_port" ;;
    esac
  fi
  if [ "$OLD_VER" = "$VERSION" ]; then
    if svc_active && health_ok "$(health_url)"; then
      step_ok "ok"
      say "$NAME is already the current release and the service is healthy. Nothing to do."
      exit 0
    fi
    fail "$NAME is already the current release, but the service is not healthy. Nothing was changed. Look at: systemctl status ehire  and  journalctl -u ehire -n 50 (to start it: systemctl start ehire)"
  fi
  if [ -d "$REL" ] && [ "$YES" != 1 ]; then
    fail "$NAME is already unpacked but is not the current release (this may be an older release). Switching to it can need an older database. Run again with --yes to switch anyway."
  fi
else
  if [ ! -e "$MARKER" ] && [ -e "$VAR/ehire.sqlite3" ]; then
    fail "there is no current release, but a database already exists at $(real "$VAR")/ehire.sqlite3. This is not a clean first install. Move the database away or link $(real "$CUR") to the right release by hand."
  fi
  if [ -f "$ENVF" ]; then
    ENV_BIND="$(env_get "$ENVF" EHIRE_BIND)"; env_port="${ENV_BIND##*:}"
    case "$env_port" in ''|*[!0-9]*) ;; *)
      if [ "$PORT_EXPLICIT" = 1 ] && [ "$env_port" != "$PORT" ]; then fail "--port $PORT, but EHIRE_BIND in the existing $(real "$ENVF") says port $env_port"; fi
      PORT="$env_port" ;;
    esac
  fi
  if getent passwd ehire >/dev/null 2>&1 && [ -z "$ROOT" ] && [ "$(id -u ehire 2>/dev/null || echo 1)" = 0 ]; then fail "the user ehire exists with uid 0. Refusing."; fi
fi
step_ok

# ================================================================================================ step 3: port, plan, confirmation
step 3 "Check port $PORT and confirm the plan"
if [ "$MODE" = first ] || ! svc_active; then
  if lis="$(port_listener "$PORT")"; then
    fail "port $PORT is already in use by $lis, and this is not eHire's running service. Nothing was changed. Free the port, or choose another with --port (and EHIRE_BIND)."
  fi
fi
step_ok
say ""
if [ "$MODE" = first ]; then MODE_LABEL="FIRST INSTALL"; else MODE_LABEL="UPGRADE"; fi
say "Plan:"
say "  mode:       $MODE_LABEL"
say "  release:    $NAME$( [ "$MODE" = upgrade ] && echo " (now: ehire-$OLD_VER)" )"
say "  port:       $PORT"
if [ "$MODE" = upgrade ]; then say "  backup:     database and documents to /var/backups/ehire/<time>-pre-$VERSION, before anything is stopped"; fi
say "  service:    only $SERVICE.service is stopped, started or enabled$( [ "$NO_START" = 1 ] && echo '; it will NOT be started (--no-start)' )"
if [ -n "$WHEELS" ]; then say "  python:     offline, wheels from $WHEELS"; else say "  python:     pip downloads the packages"; fi
[ "$DRY" = 1 ] && say "  dry run:    nothing will be changed"
say ""
if [ "$DRY" != 1 ]; then
  if [ "$YES" = 1 ]; then
    :
  elif [ -t 0 ] && [ -t 1 ]; then
    sayn "Proceed? [y/N] "
    ans=""; read -r ans || ans=""
    printf '%s\n' "$ans" >> "$BUF"
    case "$ans" in y|Y|yes|YES) ;; *) say "Cancelled. Nothing was changed."; exit 1 ;; esac
  else
    say "No terminal is attached, so the plan cannot be confirmed. Add --yes to run without asking. Nothing was changed."
    exit 1
  fi
  LOG_ON=1
fi

# ================================================================================================ step 4: user and folders
PHASE=prep
step 4 "Create the user and folders"
if [ "$MODE" != first ]; then
  step_ok "skipped (upgrade)"
elif [ "$DRY" = 1 ]; then
  note "would: create the system user and group ehire if missing (useradd --system --home /opt/ehire --shell /usr/sbin/nologin)"
  note "would: create /opt/ehire/{releases,staging}, /etc/ehire (root:ehire 750), /var/lib/ehire/storage (ehire 750), /var/log/ehire, /var/backups/ehire"
  step_ok "dry run"
else
  if [ -z "$ROOT" ]; then
    if ! getent passwd ehire >/dev/null 2>&1; then
      shell=/usr/sbin/nologin; [ -x "$shell" ] || shell=/sbin/nologin; [ -x "$shell" ] || shell=/bin/false
      if getent group ehire >/dev/null 2>&1; then grp=(--gid ehire); else grp=(--user-group); fi
      mkdir -p "$(dirname "$OPT")"
      capture useradd --system "${grp[@]}" --home-dir /opt/ehire --no-create-home --shell "$shell" ehire || { tail_notes 5; fail "useradd failed"; }
      USER_CREATED=1
      note "created the system user and group ehire"
    else
      note "the user ehire already exists (home $(getent passwd ehire | cut -d: -f6), shell $(getent passwd ehire | cut -d: -f7)); it is reused as it is"
      getent group ehire >/dev/null 2>&1 || fail "the user ehire exists but there is no group ehire"
    fi
  else
    rec "useradd --system --home-dir /opt/ehire --no-create-home --shell /usr/sbin/nologin ehire"
  fi
  mkd root:root 755 "$OPT"
  mkd root:root 755 "$OPT/releases"
  mkd root:root 755 "$OPT/staging"
  mkd root:ehire 750 "$ETC"
  mkd ehire:ehire 750 "$VAR"
  mkd ehire:ehire 750 "$VAR/storage"
  mkd ehire:ehire 750 "$LOGD"
  mkd ehire:ehire 750 "$BAK"
  [ -d "$(dirname "$UNIT")" ] || mkdir -p "$(dirname "$UNIT")"
  printf '%s\n' "first install of $NAME started $STAMP" > "$MARKER"
  step_ok
fi

# ================================================================================================ step 5: unpack
step 5 "Unpack the release"
if [ "$DRY" = 1 ]; then
  note "would: unpack into $(real "$REL") (owner ehire, not writable by group or other), reusing the folder when it is identical"
  step_ok "dry run"
else
  [ -d "$OPT/staging" ] || mkd root:root 755 "$OPT/staging"
  [ -d "$OPT/releases" ] || mkd root:root 755 "$OPT/releases"
  if [ -d "$REL" ]; then
    if cmp -s "$WORK/$NAME/SHA256SUMS" "$REL/SHA256SUMS" && capture bash "$VERIFY" --dir "$REL"; then
      note "reusing the existing identical folder $(real "$REL")"
    else
      fail "$(real "$REL") already exists with different content. Not overwritten. Build a new version, or move that folder away."
    fi
  else
    stage="$OPT/staging/$NAME.$$"
    [ ! -e "$stage" ] || fail "$(real "$stage") already exists"
    cp -a "$WORK/$NAME" "$stage" || fail "copying the release failed (disk full?)"
    chmod -R u+rwX,go+rX,go-w "$stage"
    chmod 755 "$stage"/scripts/*.sh
    do_chown_R ehire:ehire "$stage"
    mv "$stage" "$REL" || fail "could not move the release into place"
  fi
  capture bash "$VERIFY" --dir "$REL" || { tail_notes 5; fail "the unpacked files do not match SHA256SUMS"; }
  step_ok
fi

# ================================================================================================ step 6: python environment
step 6 "Prepare the Python environment"
NEW_VENV=""          # name (under /opt/ehire) of a new venv that step 9 switches to, upgrade only
REQ_NEW="$WORK/$NAME/requirements.txt"
build_venv() {  # build_venv NAME: a complete venv with the release's requirements, owned by ehire
  local vdir="$OPT/$1" wheels_copy="" flags=() pipargs
  if [ -d "$vdir" ] && [ ! -e "$vdir/.ehire-venv-ok" ]; then
    mv "$vdir" "$vdir.incomplete-$STAMP" || return 1
    note "an unfinished environment $(real "$vdir") was moved to $(real "$vdir").incomplete-$STAMP"
  fi
  if [ -e "$vdir/.ehire-venv-ok" ]; then note "reusing the finished environment $(real "$vdir")"; return 0; fi
  [ -d "$vdir" ] || { mkdir -p "$vdir" && do_chown ehire:ehire "$vdir" && do_chmod 755 "$vdir"; } || return 1
  [ -z "$T_FAST_VENV" ] || flags=(--without-pip)
  if ! capture run_as_ehire python3 -m venv ${flags[@]+"${flags[@]}"} "$vdir"; then tail_notes 8; return 1; fi
  if [ -n "$T_FAST_VENV" ]; then
    rec "pip install${WHEELS:+ --no-index --find-links $WHEELS} -r $(real "$REL")/requirements.txt  (skipped in fast test mode)"
  else
    pipargs=(install --disable-pip-version-check --no-cache-dir -r "$REL/requirements.txt")
    if [ -n "$WHEELS" ]; then
      wheels_copy="$OPT/staging/wheels.$$"
      mkdir -p "$wheels_copy" && cp -R "$WHEELS"/. "$wheels_copy"/ && chmod -R a+rX "$wheels_copy" || return 1
      pipargs+=(--no-index --find-links "$wheels_copy")
    fi
    rec "pip ${pipargs[*]}"
    if ! capture run_as_ehire "$vdir/bin/python" -m pip "${pipargs[@]}"; then tail_notes 15; [ -z "$wheels_copy" ] || rm -rf -- "$wheels_copy"; return 1; fi
    [ -z "$wheels_copy" ] || rm -rf -- "$wheels_copy"
  fi
  : > "$vdir/.ehire-venv-ok"
  do_chown ehire:ehire "$vdir/.ehire-venv-ok"
  return 0
}
if [ "$DRY" = 1 ]; then
  if [ "$MODE" = first ]; then note "would: create /opt/ehire/venv-$VERSION, link /opt/ehire/venv to it, pip install -r requirements.txt${WHEELS:+ (offline from $WHEELS)}"
  elif cmp -s "$REQ_NEW" "$OLD_REL/requirements.txt" 2>/dev/null && [ -x "$OPT/venv/bin/python" ]; then note "would: keep the current venv (requirements.txt is unchanged)"
  else note "would: build /opt/ehire/venv-$VERSION and switch the venv link to it at step 9 (requirements changed)"; fi
  step_ok "dry run"
else
  if [ "$MODE" = first ]; then
    if [ -x "$OPT/venv/bin/python" ]; then
      # an earlier (manual or interrupted) install left a venv: bring it up to the requirements
      note "the existing venv $(real "$OPT")/venv is used and brought up to the requirements"
      if [ -z "$T_FAST_VENV" ]; then
        pipargs=(install --disable-pip-version-check --no-cache-dir -r "$REL/requirements.txt")
        wheels_copy=""
        if [ -n "$WHEELS" ]; then wheels_copy="$OPT/staging/wheels.$$"; mkdir -p "$wheels_copy"; cp -R "$WHEELS"/. "$wheels_copy"/; chmod -R a+rX "$wheels_copy"; pipargs+=(--no-index --find-links "$wheels_copy"); fi
        rec "pip ${pipargs[*]}"
        capture run_as_ehire "$OPT/venv/bin/python" -m pip "${pipargs[@]}" || { tail_notes 15; fail "pip install failed"; }
        [ -z "$wheels_copy" ] || rm -rf -- "$wheels_copy"
      fi
    else
      build_venv "venv-$VERSION" || fail "could not build the Python environment"
      [ -L "$OPT/venv" ] && rm -f -- "$OPT/venv"
      [ ! -e "$OPT/venv" ] || fail "$(real "$OPT")/venv exists but has no python. Move it away and run again."
      switch_link "venv-$VERSION" "$OPT/venv"
    fi
  elif cmp -s "$REQ_NEW" "$OLD_REL/requirements.txt" 2>/dev/null && [ -x "$OPT/venv/bin/python" ]; then
    note "requirements.txt is unchanged: the current venv stays in use"
  else
    build_venv "venv-$VERSION" || fail "could not build a new Python environment (the running one is untouched)"
    NEW_VENV="venv-$VERSION"
    note "requirements changed: the new environment $NEW_VENV is switched in at step 9; the old one is kept for rollback"
  fi
  step_ok
fi

# ================================================================================================ step 7: settings file
step 7 "Settings file"
EXAMPLE="$WORK/$NAME/deploy/ehire.env.example"
if [ -f "$ENVF" ]; then
  MISSING_VARS="$(comm -23 <(var_names "$EXAMPLE") <(var_names "$ENVF") | tr '\n' ' ' | sed 's/ $//')"
  note "$(real "$ENVF") exists and is not changed (not reordered, not rewritten)"
  if [ -n "$MISSING_VARS" ]; then note "variables the new example has and the file lacks (names only): $MISSING_VARS"; else note "it has every variable of the new example"; fi
  step_ok
elif [ "$DRY" = 1 ]; then
  note "would: create $(real "$ENVF") from deploy/ehire.env.example (root:ehire 640) with a new random EHIRE_SECRET_KEY, EHIRE_DATABASE_URI, EHIRE_STORAGE_DIR, EHIRE_BIND=0.0.0.0:$PORT, EHIRE_AD_ENABLED=false"
  step_ok "dry run"
else
  # The secret is made and written inside this one Python process: it is never in an argument, a variable or the output.
  python3 -s - "$EXAMPLE" "$ENVF" "$PORT" "sqlite:///$VAR/ehire.sqlite3" "$VAR/storage" <<'PY' || fail "could not write the settings file"
import os, re, secrets, sys
example, dest, port, uri, storage = sys.argv[1:6]
want = {
    "EHIRE_SECRET_KEY": secrets.token_urlsafe(48),
    "EHIRE_DATABASE_URI": uri,
    "EHIRE_STORAGE_DIR": storage,
    "EHIRE_BIND": "0.0.0.0:" + port,
    "EHIRE_AD_ENABLED": "false",
}
seen = set()
out = []
for line in open(example, encoding="utf-8").read().split("\n"):
    m = re.match(r"^([A-Z][A-Z0-9_]*)=", line)
    if m and m.group(1) in want:
        out.append("%s=%s" % (m.group(1), want[m.group(1)]))
        seen.add(m.group(1))
    else:
        out.append(line)
text = "\n".join(out)
if not text.endswith("\n"):
    text += "\n"
for key, value in want.items():
    if key not in seen:
        text += "%s=%s\n" % (key, value)
tmp = dest + ".new"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    fh.write(text)
os.rename(tmp, dest)
PY
  do_chown root:ehire "$ENVF"
  do_chmod 640 "$ENVF"
  note "created $(real "$ENVF") (root:ehire 640) with a new secret key (not shown). Values for sign-in, mail and eArchive come from IT: edit the file later."
  step_ok
fi

# ================================================================================================ step 8: backup (upgrade)
step 8 "Back up the database and the documents"
if [ "$MODE" != upgrade ]; then
  step_ok "skipped (first install)"
elif [ "$DRY" = 1 ]; then
  note "would: ehire-cli.sh backup-db /var/backups/ehire/<time>-pre-$VERSION/ehire.sqlite3 (from ehire-$OLD_VER, as ehire), then tar the storage folder into the same folder"
  step_ok "dry run"
else
  BKDIR="$BAK/$STAMP-pre-$VERSION"
  [ -d "$BAK" ] || mkd ehire:ehire 750 "$BAK"
  mkd ehire:ehire 750 "$BKDIR"
  if capture cli backup-db "$BKDIR/ehire.sqlite3"; then :; else tail_notes 6; fail "backup-db failed. The service was not stopped. Backup folder: $(real "$BKDIR")"; fi
  if capture run_as_ehire tar -C "$(dirname "$STORAGE")" -czf "$BKDIR/storage.tar.gz" "$(basename "$STORAGE")"; then :; else tail_notes 6; fail "archiving the storage folder failed. The service was not stopped. Backup folder: $(real "$BKDIR")"; fi
  [ -s "$BKDIR/ehire.sqlite3" ] || fail "the database backup is missing or empty ($(real "$BKDIR")/ehire.sqlite3)"
  [ -s "$BKDIR/storage.tar.gz" ] || fail "the storage backup is missing or empty ($(real "$BKDIR")/storage.tar.gz)"
  note "backup folder: $(real "$BKDIR")"
  step_ok
fi

# ================================================================================================ step 9: switch
step 9 "Switch to the new release and set up the database"
if [ "$DRY" = 1 ]; then
  [ "$MODE" = upgrade ] && note "would: systemctl stop ehire (only that unit)"
  note "would: point /opt/ehire/current at $NAME$( [ -n "$NEW_VENV" ] && echo ' and the venv link at the new environment' )"
  if [ "$MODE" = first ]; then note "would: ehire-cli.sh init-db, then check db-status"; else note "would: ehire-cli.sh upgrade-db, then db-status must show pending=0"; fi
  step_ok "dry run"
else
  PHASE=live
  if svc_active; then WAS_ACTIVE=1; fi
  if [ "$MODE" = upgrade ]; then
    svc stop || fail "systemctl stop ehire failed"
    STOPPED=1
  fi
  if [ "$MODE" = first ] && [ -L "$CUR" ]; then OLD_LINK_TARGET="$(readlink "$CUR")"; fi
  switch_link "$REL" "$CUR" || fail "could not point $(real "$CUR") at the new release"
  LINK_SWITCHED=1
  if [ -n "$NEW_VENV" ]; then switch_venv "$NEW_VENV" || fail "could not switch the venv link"; fi
  if [ "$MODE" = first ]; then
    capture cli init-db || { tail_notes 8; fail "init-db failed"; }
  else
    DB_STARTED=1
    capture cli upgrade-db || { tail_notes 8; fail "upgrade-db failed (the database was being changed: it is restored from the backup)"; }
  fi
  if capture cli db-status; then
    grep -q 'pending=0' "$OUTF" || { tail_notes 3; fail "db-status does not report pending=0"; }
  else
    if [ "$MODE" = first ]; then
      DB_STARTED=1
      capture cli upgrade-db || { tail_notes 8; fail "upgrade-db failed"; }
      if capture cli db-status && grep -q 'pending=0' "$OUTF"; then :; else tail_notes 3; fail "migrations are still pending after upgrade-db"; fi
    else
      tail_notes 3; fail "db-status says migrations are still pending after upgrade-db"
    fi
  fi
  note "$(tr '\n' ' ' < "$OUTF" | sed 's/ $//')"
  step_ok
fi

# ================================================================================================ step 10: preflight
step 10 "Run preflight"
if [ "$DRY" = 1 ]; then
  note "would: preflight.sh --env-file /etc/ehire/ehire.env --skip-port, as ehire; any FAIL stops the install"
  step_ok "dry run"
else
  if run_as_ehire bash "$CUR/scripts/preflight.sh" --env-file "$ENVF" --skip-port > "$OUTF" 2>&1; then
    while IFS= read -r l; do note "$l"; done < <(grep -E '^WARN' "$OUTF" | cut -c1-200 || true)
    step_ok
  else
    while IFS= read -r l; do note "$l"; done < <(grep -E '^(FAIL|preflight:)' "$OUTF" | cut -c1-200 || true)
    fail "preflight reported failures"
  fi
fi

# ================================================================================================ step 11: service file
step 11 "Install the service file"
EXAMPLE_UNIT="$REL/deploy/ehire.service.example"
if [ "$DRY" = 1 ]; then
  note "would: copy deploy/ehire.service.example to /etc/systemd/system/ehire.service if it differs (keeping ehire.service.bak), daemon-reload, enable ehire$( [ "$NO_START" = 1 ] || echo ', start ehire' )"
  step_ok "dry run"
else
  CHANGED_UNIT=0
  if [ ! -f "$UNIT" ]; then
    install -m 644 "$EXAMPLE_UNIT" "$UNIT" || fail "could not write $(real "$UNIT")"
    rec "chmod 644 $(real "$UNIT")"; CHANGED_UNIT=1
    note "service file created"
  elif ! cmp -s "$EXAMPLE_UNIT" "$UNIT"; then
    cp -p "$UNIT" "$UNIT.bak" || fail "could not keep $(real "$UNIT").bak"
    install -m 644 "$EXAMPLE_UNIT" "$UNIT" || fail "could not write $(real "$UNIT")"
    UNIT_REPLACED=1; CHANGED_UNIT=1
    note "service file replaced; the old one is kept as $(real "$UNIT").bak"
  else
    note "service file is already the release's version"
  fi
  if [ "$CHANGED_UNIT" = 1 ]; then svc_reload || fail "systemctl daemon-reload failed"; fi
  svc enable || fail "systemctl enable ehire failed"
  if [ "$MODE" = first ]; then UNIT_CREATED=1; fi
  if [ "$NO_START" = 1 ]; then
    note "not started (--no-start)"
  else
    svc start || { show_journal; fail "systemctl start ehire failed"; }
  fi
  step_ok
fi

# ================================================================================================ step 12: health
step 12 "Health check"
if [ "$DRY" = 1 ]; then
  note "would: poll $(health_url) for up to 30 s for {\"status\":\"ok\"}, and check that the unit is active"
  step_ok "dry run"
elif [ "$NO_START" = 1 ]; then
  step_ok "skipped (--no-start)"
else
  if wait_healthy "$HEALTH_SECS"; then
    note "$(health_url) answers ok and the unit is active"
    step_ok
  else
    show_journal
    fail "ehire did not answer {\"status\":\"ok\"} at $(health_url) within ${HEALTH_SECS} s, or the unit is not active"
  fi
fi

# ================================================================================================ step 13: rollback not needed
step 13 "Roll back"
step_ok "not needed"

# ================================================================================================ step 14: finish
step 14 "Finish"
if [ "$DRY" = 1 ]; then
  step_ok "dry run: nothing was changed"
  exit 0
fi
rm -f -- "$MARKER"
if svc_active; then STATE="active"; else STATE="not running"; fi
step_ok
say ""
say "Done."
say "  mode:     $MODE_LABEL"
say "  version:  $VERSION$( [ "$MODE" = upgrade ] && echo " (was $OLD_VER)" )"
[ -n "$BKDIR" ] && say "  backup:   $(real "$BKDIR")  (ehire.sqlite3 and storage.tar.gz)"
say "  service:  $STATE (enabled)"
say "  port:     $PORT"
say "  log:      $(real "$LOGFILE")"
[ -n "$MISSING_VARS" ] && say "  settings: the file lacks these variables of the new example: $MISSING_VARS"
BASE_URL="$(env_get "$ENVF" EHIRE_BASE_URL)"; [ -n "$BASE_URL" ] || BASE_URL="https://ehire.shso.online"
HOST_IP="$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)"; [ -n "$HOST_IP" ] || HOST_IP="<this-server-address>"
say ""
say "Check these three addresses:"
say "  1. http://127.0.0.1:$PORT/healthz   (from this server; should show {\"status\":\"ok\"})"
say "  2. http://$HOST_IP:$PORT/healthz   (this server's own address, as the tunnel sees it)"
say "  3. $BASE_URL/   (through the Cloudflare tunnel; the sign-in page)"
if [ "$NO_START" = 1 ]; then say ""; say "The service was not started (--no-start). Start only eHire: systemctl start ehire"; fi
say ""
say "Next steps (copy and paste; this script does not do them):"
NEXT=0
if [ "$MODE" = first ]; then
  NEXT=$((NEXT + 1))
  say "  $NEXT. Create the first administrator. It asks for a password, so run it yourself:"
  say "       sudo -u ehire /opt/ehire/current/scripts/ehire-cli.sh create-admin"
fi
NEXT=$((NEXT + 1))
say "  $NEXT. Firewall: let only the Cloudflare tunnel's machine reach port $PORT on this server (the port is plain HTTP). For example with ufw:"
say "       sudo ufw allow from <tunnel-machine-address> to any port $PORT proto tcp"
NEXT=$((NEXT + 1))
say "  $NEXT. Cron: put these five lines in the ehire user's crontab (open it with: sudo crontab -u ehire -e). This script does not install cron."
say "     The 02:40 line syncs cost centres from eFinance; it only prints 'skipped' until the eFinance link is switched on (docs/operations.md, eFinance link)."
block <<'EOF2'
       0 7-17 * * 1-5  /opt/ehire/current/scripts/ehire-cli.sh run-timers >> /var/log/ehire/timers.log 2>&1
       */5 * * * *     /opt/ehire/current/scripts/ehire-cli.sh send-mail >> /var/log/ehire/mail.log 2>&1
       */5 * * * *     /opt/ehire/current/scripts/ehire-cli.sh send-archive >> /var/log/ehire/archive.log 2>&1
       40 2 * * *      /opt/ehire/current/scripts/ehire-cli.sh sync-cost-centres >> /var/log/ehire/efinance.log 2>&1
       30 1 * * *  d=/var/backups/ehire/$(date +\%Y-\%m-\%dT\%H\%M) && mkdir -p "$d" && /opt/ehire/current/scripts/ehire-cli.sh backup-db "$d/ehire.sqlite3" && tar -C /var/lib/ehire -czf "$d/storage.tar.gz" storage >> /var/log/ehire/backup.log 2>&1
EOF2
NEXT=$((NEXT + 1))
say "  $NEXT. Values from IT go into /etc/ehire/ehire.env (AD server, domain, base DN and CA file; Graph tenant, client id, secret, sender; the eArchive token; the eFinance token)."
say "     After editing: sudo -u ehire /opt/ehire/current/scripts/preflight.sh --skip-port, then restart only eHire: sudo systemctl restart ehire"
NEXT=$((NEXT + 1))
say "  $NEXT. Copy last night's backup folder off this server (the host Marios names) and prune old ones (deploy/README.md, Backup and restore)."
exit 0
