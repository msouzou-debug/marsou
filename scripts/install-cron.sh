#!/usr/bin/env bash
# install-cron.sh: put eHire's scheduled jobs in the ehire user's crontab. Run as root on the server:
#   sudo bash install-cron.sh            install or refresh the jobs
#   sudo bash install-cron.sh --show     print the ehire crontab and change nothing
#   sudo bash install-cron.sh --remove   take eHire's jobs out again
# Safe to run again: it replaces only the block between its two marker lines and keeps any other line.
# Touches only the crontab of the user ehire, and makes sure ehire can write to its log and backup folders.
# No network. Does not start, stop or restart any service.
set -euo pipefail

MODE="${1:-install}"
BEGIN="# >>> eHire scheduled jobs (managed by install-cron.sh) >>>"
END="# <<< eHire scheduled jobs <<<"
CLI=/opt/ehire/current/scripts/ehire-cli.sh
LOGS=/var/log/ehire
BACKUPS=/var/backups/ehire
KEEP_DAYS=14

die() { printf 'install-cron.sh: %s\n' "$1" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run it with sudo"
id ehire >/dev/null 2>&1 || die "the user ehire does not exist: install eHire first"
command -v crontab >/dev/null 2>&1 || die "crontab is not installed on this server"

current="$(crontab -u ehire -l 2>/dev/null || true)"
others="$(printf '%s\n' "$current" | awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1;next} $0==e{skip=0;next} !skip')"

case "$MODE" in
  --show) printf '%s\n' "${current:-(the ehire user has no crontab)}"; exit 0 ;;
  --remove)
    if [ -n "$(printf '%s' "$others" | tr -d '[:space:]')" ]; then printf '%s\n' "$others" | crontab -u ehire -
    else crontab -u ehire -r 2>/dev/null || true; fi
    echo "eHire's scheduled jobs were removed."; exit 0 ;;
  install) ;;
  *) die "unknown option $MODE (use --show or --remove, or nothing)" ;;
esac

[ -x "$CLI" ] || die "$CLI is missing: install eHire first"
for d in "$LOGS" "$BACKUPS"; do
  [ -d "$d" ] || die "$d does not exist: install eHire first"
  if ! runuser -u ehire -- test -w "$d"; then
    chown ehire:ehire "$d" && chmod 750 "$d"
    echo "made $d writable by ehire"
  fi
done

# In a crontab a percent sign ends the command, so each one is written as \%.
block="$(cat <<JOBS
$BEGIN
# Reminders, escalations and automatic withdrawals: every hour 07:00 to 17:00, Monday to Friday.
0 7-17 * * 1-5  $CLI run-timers >> $LOGS/timers.log 2>&1
# Emails waiting in the outbox: every 5 minutes (they stay queued while the mail backend is outbox_only).
*/5 * * * *     $CLI send-mail >> $LOGS/mail.log 2>&1
# Deposits for eArchive: every 5 minutes (nothing is sent while the archive transport is none).
*/5 * * * *     $CLI send-archive >> $LOGS/archive.log 2>&1
# Cost centres from eFinance: nightly at 02:40 (skipped while the eFinance link is none).
40 2 * * *      $CLI sync-cost-centres >> $LOGS/efinance.log 2>&1
# Nightly backup at 01:30: the database first, then the documents, into one dated folder.
30 1 * * *      d=$BACKUPS/\$(date +\\%Y-\\%m-\\%dT\\%H\\%M) && mkdir -p "\$d" && $CLI backup-db "\$d/ehire.sqlite3" >> $LOGS/backup.log 2>&1 && tar -C /var/lib/ehire -czf "\$d/storage.tar.gz" storage >> $LOGS/backup.log 2>&1
# Nightly backups older than $KEEP_DAYS days are removed at 03:10. Only folders named like 2026-11-24T0130 are touched;
# the installer's own pre-upgrade backups (named <time>-pre-<version>) are kept.
10 3 * * *      find $BACKUPS -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9][0-5][0-9]' -mtime +$KEEP_DAYS -exec rm -rf {} + >> $LOGS/backup.log 2>&1
$END
JOBS
)"

{ if [ -n "$(printf '%s' "$others" | tr -d '[:space:]')" ]; then printf '%s\n' "$others"; fi; printf '%s\n' "$block"; } | crontab -u ehire -

echo "Installed. The ehire user's crontab is now:"
echo "------------------------------------------------------------"
crontab -u ehire -l
echo "------------------------------------------------------------"
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet cron 2>/dev/null || systemctl is-active --quiet crond 2>/dev/null; then echo "cron service: running"
  else echo "WARNING: the cron service does not look active. Check: systemctl status cron"; fi
fi
echo "First runs: mail and archive within 5 minutes, timers at the next full hour on a working day, backup tonight at 01:30."
echo "Logs: $LOGS/timers.log mail.log archive.log efinance.log backup.log"
