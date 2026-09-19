#!/usr/bin/env bash
set -euo pipefail

# eCapital — first-time server setup, Ubuntu 22.04 (10.227.56.22).
#
# Run ONCE with sudo, on the server, after copying this deploy/ folder there
# (git clone, or `rsync -a deploy/ administrator@10.227.56.22:/tmp/ecapital-deploy/`).
# See docs/deploy/RUNBOOK-10.227.56.22.md for the full walkthrough.
#
#   ssh -t administrator@10.227.56.22 'cd /tmp/ecapital-deploy && sudo bash install.sh'
#
# This script does NOT deploy application code — that is deploy/release.sh,
# run afterwards from the operator's machine. It also does NOT touch
# PostgreSQL: 16.14 is already installed on this host at 127.0.0.1:5432,
# shared with BedMan and eArchive, and Marios (the host owner) creates the
# `ecapital` role and database by hand — see docs/deploy/RUNBOOK-
# 10.227.56.22.md §2.1 for the paste-ready SQL to hand him. This script
# prepares everything else: packages (Node only), the system user,
# directories, the systemd units (enabled, not started for api/web — there
# is nothing to start until the first release), logrotate, and the
# backup/restore-drill timers.
#
# Idempotent: safe to re-run. Existing env files are never overwritten.
#
# Following eFinance's own rule: this script is never a stand-in for a
# careful release. It sets the host up once; deploy/release.sh is what ships
# code, every time, file by file.

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this with sudo: sudo bash install.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_NAME="ecapital"
APP_USER="ecapital"
APP_DIR="/opt/${APP_NAME}"
RELEASES_DIR="/opt/${APP_NAME}-releases"
ETC_DIR="/etc/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
BACKUP_DIR="/var/backups/${APP_NAME}"
DB_NAME="ecapital"
DB_OWNER_ROLE="ecapital"
DB_APP_ROLE="ecapital_app"
OPERATOR_USER="administrator"

step() { echo; echo "=== $* ==="; }

# ---------------------------------------------------------------- packages --

step "[1/8] APT prerequisites"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg

step "[2/8] Node.js 22 (NodeSource) + corepack/pnpm 10"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
else
  echo "node $(node -v) already installed, skipping NodeSource setup"
fi
corepack enable
corepack prepare pnpm@10 --activate
echo "pnpm $(pnpm --version)"

# PostgreSQL is NOT installed here. 16.14 is already on this host at
# 127.0.0.1:5432, shared with BedMan and eArchive — installing our own
# would be a second cluster on a host that already has one. See step
# [6/8] below for what this script expects Marios to have already done.

# ---------------------------------------------------------- system user ----

step "[3/8] System user ${APP_USER}"
id -u "${APP_USER}" &>/dev/null || useradd -r -m -d "${APP_DIR}" -s /usr/sbin/nologin "${APP_USER}"

step "[4/8] Directories"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 "${APP_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 "${APP_DIR}/deploy"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 "${RELEASES_DIR}"
install -d -o root -g "${APP_USER}" -m 0750 "${ETC_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${LOG_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${BACKUP_DIR}"

# Ops scripts the systemd units call. Copied (not symlinked) so a release
# that only touches apps/ and packages/ cannot change what a privileged timer
# runs without a deliberate re-run of this script.
install -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${SCRIPT_DIR}/backup.sh" "${APP_DIR}/deploy/backup.sh"
install -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${SCRIPT_DIR}/restore-drill.sh" "${APP_DIR}/deploy/restore-drill.sh"
install -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${SCRIPT_DIR}/migrate.sh" "${APP_DIR}/deploy/migrate.sh"
install -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${SCRIPT_DIR}/install-deps.sh" "${APP_DIR}/deploy/install-deps.sh"
# These two run as root (via sudo, see the sudoers file below), so they are
# root-owned rather than ecapital-owned.
install -o root -g root -m 0750 "${SCRIPT_DIR}/sync-release.sh" "${APP_DIR}/deploy/sync-release.sh"
install -o root -g root -m 0750 "${SCRIPT_DIR}/rollback.sh" "${APP_DIR}/deploy/rollback.sh"

# ------------------------------------------------------------ env files ----

step "[5/8] /etc/ecapital env files"
if [[ ! -f "${ETC_DIR}/api.env" ]]; then
  install -o "${APP_USER}" -g "${APP_USER}" -m 0600 "${SCRIPT_DIR}/env/api.env.example" "${ETC_DIR}/api.env"
  echo "Wrote ${ETC_DIR}/api.env from the template — EDIT IT before starting ecapital-api."
else
  echo "${ETC_DIR}/api.env already exists, leaving it alone"
fi
if [[ ! -f "${ETC_DIR}/web.env" ]]; then
  install -o "${APP_USER}" -g "${APP_USER}" -m 0600 "${SCRIPT_DIR}/env/web.env.example" "${ETC_DIR}/web.env"
  echo "Wrote ${ETC_DIR}/web.env from the template — EDIT IT before starting ecapital-web."
else
  echo "${ETC_DIR}/web.env already exists, leaving it alone"
fi

# ------------------------------------------------------------- database ----

step "[6/8] PostgreSQL roles and database — NOT done by this script"
# PostgreSQL 16.14 on this host is shared with BedMan and eArchive. We are
# not its administrator: no superuser, no cluster-wide extensions without
# asking. Marios (the host owner) creates the role and database by hand,
# with the paste-ready SQL in docs/deploy/RUNBOOK-10.227.56.22.md §2.1:
#
#   CREATE ROLE ecapital LOGIN PASSWORD '<paste from api.env>';
#   CREATE DATABASE ecapital OWNER ecapital;
#
# and, once, inside the ecapital database only:
#
#   CREATE EXTENSION IF NOT EXISTS pgcrypto;
#   CREATE EXTENSION IF NOT EXISTS pg_trgm; -- from M2 onward
#
# This script cannot check or wait for that — it has no credential to the
# shared instance. Confirm it has happened, and that /etc/ecapital/api.env's
# DATABASE_URL / MIGRATION_DATABASE_URL passwords match, before running
# deploy/migrate.sh or deploy/release.sh.
cat <<NOTE

  ACTION NEEDED before the first migration:
  Ask Marios to run the paste-ready SQL in
  docs/deploy/RUNBOOK-10.227.56.22.md §2.1 (role ${DB_OWNER_ROLE}, database
  ${DB_NAME}, and the two CREATE EXTENSION statements inside it). Put the
  same password in ${ETC_DIR}/api.env's DATABASE_URL and
  MIGRATION_DATABASE_URL. This script does not and cannot do this step.

NOTE

# -------------------------------------------------------------- systemd ----

step "[7/8] systemd units, logrotate, sudoers"
install -m 0644 "${SCRIPT_DIR}/systemd/ecapital-api.service" /etc/systemd/system/ecapital-api.service
install -m 0644 "${SCRIPT_DIR}/systemd/ecapital-web.service" /etc/systemd/system/ecapital-web.service
install -m 0644 "${SCRIPT_DIR}/systemd/ecapital-backup.service" /etc/systemd/system/ecapital-backup.service
install -m 0644 "${SCRIPT_DIR}/systemd/ecapital-backup.timer" /etc/systemd/system/ecapital-backup.timer
install -m 0644 "${SCRIPT_DIR}/systemd/ecapital-restore-drill.service" /etc/systemd/system/ecapital-restore-drill.service
install -m 0644 "${SCRIPT_DIR}/systemd/ecapital-restore-drill.timer" /etc/systemd/system/ecapital-restore-drill.timer
systemctl daemon-reload

# api/web are enabled but NOT started: /opt/ecapital/apps does not exist
# until the first `deploy/release.sh` run. Starting them now would just
# crash-loop against a missing pnpm-workspace.yaml.
systemctl enable ecapital-api.service ecapital-web.service

# The backup and restore-drill timers only need Postgres, which is already
# up, so they are enabled and started now.
systemctl enable --now ecapital-backup.timer
systemctl enable --now ecapital-restore-drill.timer

# logrotate for the two flat log files the ops scripts write (backup.sh,
# restore-drill.sh). ecapital-api/web log to the journal, not to files here,
# so nothing else needs a stanza — see docs/deploy/RUNBOOK-10.227.56.22.md
# "Logs".
cat > /etc/logrotate.d/ecapital <<'EOF'
/var/log/ecapital/*.log {
    weekly
    rotate 12
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ecapital ecapital
}
EOF

# The narrowest sudo grant that gets a scripted release done without a typed
# password. eFinance's own rule (CLAUDE.md §6) is one line, just for
# `systemctl restart finance.service` — `administrator` is not in the app's
# group, so writing under /opt needs sudo one way or another. eCapital's
# release additionally needs to sync files into ecapital-owned directories
# and run two commands as the `ecapital` user, so this extends that same
# philosophy to a few more lines: every one of them names one fixed,
# absolute, root-owned script (or one fixed systemctl unit) — never a bare
# `ALL`, never a wildcard command, never a shell. Validated with visudo
# before it is installed.
SUDOERS_FILE=/etc/sudoers.d/ecapital-deploy
cat > "${SUDOERS_FILE}.tmp" <<EOF
# Installed by eCapital's deploy/install.sh. Do not broaden: every line below
# is one fixed script or one fixed systemctl target that deploy/release.sh
# or deploy/install.sh needs. See docs/deploy/RUNBOOK-10.227.56.22.md.
${OPERATOR_USER} ALL=(root) NOPASSWD: /opt/ecapital/deploy/sync-release.sh *
${OPERATOR_USER} ALL=(root) NOPASSWD: /opt/ecapital/deploy/rollback.sh *
${OPERATOR_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart ecapital-api.service
${OPERATOR_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart ecapital-web.service
${OPERATOR_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl is-active ecapital-api.service
${OPERATOR_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl is-active ecapital-web.service
${OPERATOR_USER} ALL=(${APP_USER}) NOPASSWD: /opt/ecapital/deploy/migrate.sh
${OPERATOR_USER} ALL=(${APP_USER}) NOPASSWD: /opt/ecapital/deploy/install-deps.sh
EOF
if visudo -cf "${SUDOERS_FILE}.tmp"; then
  install -m 0440 "${SUDOERS_FILE}.tmp" "${SUDOERS_FILE}"
  rm -f "${SUDOERS_FILE}.tmp"
  echo "Installed ${SUDOERS_FILE}"
else
  echo "Generated sudoers file failed visudo -c, NOT installed: ${SUDOERS_FILE}.tmp" >&2
  exit 1
fi

step "[8/8] Done"
cat <<SUMMARY

eCapital host setup complete.

Next steps (see docs/deploy/RUNBOOK-10.227.56.22.md):
  1. Ask Marios to run the paste-ready SQL in RUNBOOK §2.1: create the
     ecapital role and database, and the two CREATE EXTENSION statements
     inside it (pgcrypto now, pg_trgm from M2). This script did not do
     this — the Postgres instance is shared with BedMan and eArchive.
  2. Edit ${ETC_DIR}/api.env and ${ETC_DIR}/web.env — fill in every CHANGE-ME
     (the database password Marios set, LDAP details, SESSION_SECRET,
     EFINANCE_TOKEN).
  3. LDAP is BLOCKING as of 19/09/2026: ihcis.local does not resolve from
     this host and 389/636 do not answer. Get the DC address, LDAPS access
     on 636, and a read-only bind account from IT before go-live.
  4. Ask Marios for the nginx server block in RUNBOOK §2.2, and send the
     cloudflared request in deploy/cloudflared-request.md (pointed at
     nginx's port, not at 5013 directly), if not sent already.
  5. Run deploy/release.sh from the operator's machine to ship the first
     build and start ecapital-api / ecapital-web.

SUMMARY
