#!/usr/bin/env bash
set -euo pipefail

# Monthly restore drill (CAPEX-01 §3: "monthly test restore, logged").
# Installed by deploy/install.sh to /opt/ecapital/deploy/restore-drill.sh,
# run by ecapital-restore-drill.timer as the `ecapital` system user.
#
# Restores the latest nightly dump into a scratch database, counts the
# projects, compares against the live count, and always writes one line to
# LOG_FILE — success or failure. Never touches the live `ecapital` database.
# `integrity_check` alone would prove the file is a valid dump, not that it
# has real data in it (eFinance CLAUDE.md §7ζ made exactly that mistake
# once) — hence the row count, and a tolerance rather than a fixed number,
# so ordinary week-to-week growth is not read as a false alarm.

ENV_FILE=/etc/ecapital/api.env
BACKUP_DIR=/var/backups/ecapital
LOG_FILE=/var/log/ecapital/restore-drill.log
SCRATCH_DB=ecapital_restore_drill
TOLERANCE_PCT=10

log() { echo "$(date -Is) $*" >>"$LOG_FILE"; }

if [[ ! -r "$ENV_FILE" ]]; then
  log "FAILED: cannot read $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

if [[ -z "${MIGRATION_DATABASE_URL:-}" ]]; then
  log "FAILED: MIGRATION_DATABASE_URL not set in $ENV_FILE"
  exit 1
fi

LATEST=$(find "$BACKUP_DIR" -maxdepth 1 -name 'ecapital-*.dump' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2-)
if [[ -z "$LATEST" ]]; then
  log "FAILED: no dump found in $BACKUP_DIR"
  exit 1
fi

# Same server, same role, a scratch database instead of the live one.
MAINT_URL="${MIGRATION_DATABASE_URL%/*}/postgres"
SCRATCH_URL="${MIGRATION_DATABASE_URL%/*}/${SCRATCH_DB}"

cleanup() {
  psql "$MAINT_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${SCRATCH_DB};" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql "$MAINT_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${SCRATCH_DB};" >>"$LOG_FILE" 2>&1
psql "$MAINT_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${SCRATCH_DB} OWNER ecapital;" >>"$LOG_FILE" 2>&1

if ! pg_restore --no-owner --no-privileges --dbname="$SCRATCH_URL" "$LATEST" >>"$LOG_FILE" 2>&1; then
  log "FAILED: pg_restore of $LATEST into $SCRATCH_DB errored — see the lines above"
  exit 1
fi

RESTORED_COUNT=$(psql "$SCRATCH_URL" -tA -c "select count(*) from ecapital.project;" 2>>"$LOG_FILE") || RESTORED_COUNT=""
LIVE_COUNT=$(psql "$MIGRATION_DATABASE_URL" -tA -c "select count(*) from ecapital.project;" 2>>"$LOG_FILE") || LIVE_COUNT=""

if [[ -z "$RESTORED_COUNT" || -z "$LIVE_COUNT" ]]; then
  log "FAILED: could not count ecapital.project (restored='${RESTORED_COUNT}' live='${LIVE_COUNT}') from $LATEST"
  exit 1
fi

MIN_ACCEPTABLE=$(( LIVE_COUNT - (LIVE_COUNT * TOLERANCE_PCT / 100) ))

if (( RESTORED_COUNT < MIN_ACCEPTABLE )); then
  log "FAILED: restored dump has ${RESTORED_COUNT} projects, live has ${LIVE_COUNT} (more than ${TOLERANCE_PCT}% short) — dump=$LATEST"
  exit 1
fi

log "OK: restored $LATEST — ${RESTORED_COUNT} projects (live: ${LIVE_COUNT}) into ${SCRATCH_DB}, dropped after check"
