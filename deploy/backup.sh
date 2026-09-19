#!/usr/bin/env bash
set -euo pipefail

# Nightly pg_dump of the eCapital database (CAPEX-01 §3: "nightly pg_dump...
# monthly test restore, logged"). Installed by deploy/install.sh to
# /opt/ecapital/deploy/backup.sh, run by ecapital-backup.timer as the
# `ecapital` system user. Always writes one line to LOG_FILE, success or
# failure — a silent night here is the failure mode eFinance's own heartbeat
# note (CLAUDE.md §7ζ) exists to catch, so we do not repeat it.

ENV_FILE=/etc/ecapital/api.env
BACKUP_DIR=/var/backups/ecapital
LOG_FILE=/var/log/ecapital/backup.log
KEEP_DAYS=30

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

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="$BACKUP_DIR/ecapital-$STAMP.dump"

if pg_dump --format=custom --file="$DUMP_FILE" "$MIGRATION_DATABASE_URL"; then
  SIZE=$(du -h "$DUMP_FILE" | cut -f1)
  log "OK: $DUMP_FILE ($SIZE)"
else
  rm -f "$DUMP_FILE"
  log "FAILED: pg_dump exited non-zero"
  exit 1
fi

# Keep 30 days. -print so the pruned filenames land in the log too.
find "$BACKUP_DIR" -maxdepth 1 -name 'ecapital-*.dump' -mtime "+${KEEP_DAYS}" -print -delete \
  >>"$LOG_FILE" 2>&1 || true
