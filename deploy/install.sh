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
# run afterwards from the operator's machine. This script only prepares the
# host: packages, the system user, directories, the database and its roles,
# the systemd units (enabled, not started for api/web — there is nothing to
# start until the first release), logrotate, and the backup/restore-drill
# timers (started immediately, since they only need Postgres).
#
# Idempotent: safe to re-run. Existing env files, roles and the database are
# never overwritten or dropped.
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

step "[1/9] APT prerequisites"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg

step "[2/9] Node.js 22 (NodeSource) + corepack/pnpm 10"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
else
  echo "node $(node -v) already installed, skipping NodeSource setup"
fi
corepack enable
corepack prepare pnpm@10 --activate
echo "pnpm $(pnpm --version)"

step "[3/9] PostgreSQL 16 (PGDG)"
if ! command -v psql >/dev/null 2>&1 || ! psql --version | grep -q ' 16\.'; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  . /etc/os-release
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq postgresql-16
else
  echo "PostgreSQL 16 already installed, skipping PGDG setup"
fi
systemctl enable --now postgresql
# The server listens on 5432 for eCapital only — no other app on this host
# uses Postgres. Default `listen_addresses = 'localhost'` is correct as-is;
# nothing here needs to change postgresql.conf.

# ---------------------------------------------------------- system user ----

step "[4/9] System user ${APP_USER}"
id -u "${APP_USER}" &>/dev/null || useradd -r -m -d "${APP_DIR}" -s /usr/sbin/nologin "${APP_USER}"

step "[5/9] Directories"
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

step "[6/9] /etc/ecapital env files"
if [[ ! -f "${ETC_DIR}/api.env" ]]; then
  install -o root -g "${APP_USER}" -m 0640 "${SCRIPT_DIR}/env/api.env.example" "${ETC_DIR}/api.env"
  echo "Wrote ${ETC_DIR}/api.env from the template — EDIT IT before starting ecapital-api."
else
  echo "${ETC_DIR}/api.env already exists, leaving it alone"
fi
if [[ ! -f "${ETC_DIR}/web.env" ]]; then
  install -o root -g "${APP_USER}" -m 0640 "${SCRIPT_DIR}/env/web.env.example" "${ETC_DIR}/web.env"
  echo "Wrote ${ETC_DIR}/web.env from the template — EDIT IT before starting ecapital-web."
else
  echo "${ETC_DIR}/web.env already exists, leaving it alone"
fi

# ------------------------------------------------------------- database ----

step "[7/9] PostgreSQL roles and database"
# Idempotent: only create what is missing, never touch an existing role's
# password or an existing database's contents.
#
# Both roles are created HERE, before the first migration ever runs, on
# purpose: migration 0001 also creates `ecapital_app` (`if not exists`), but
# only because the throwaway test cluster runs migrations as a superuser
# (ADR-0012). On this server `ecapital` (the migration role) has CREATEDB but
# not CREATEROLE, so if `ecapital_app` did not already exist, that `if not
# exists` block would try to CREATE ROLE and fail on a permission error.
# Creating it here first means the migration's own check finds it already
# there and skips straight past.
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_OWNER_ROLE}') THEN
    CREATE ROLE ${DB_OWNER_ROLE} LOGIN PASSWORD 'CHANGE-ME-OWNER' CREATEDB;
    RAISE NOTICE 'Created role ${DB_OWNER_ROLE} with a placeholder password — set a real one and update /etc/ecapital/*.env.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_APP_ROLE}') THEN
    CREATE ROLE ${DB_APP_ROLE} LOGIN PASSWORD 'CHANGE-ME-APP';
    RAISE NOTICE 'Created role ${DB_APP_ROLE} with a placeholder password — set a real one and update /etc/ecapital/*.env.';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_OWNER_ROLE};"
  echo "Created database ${DB_NAME}, owned by ${DB_OWNER_ROLE}"
else
  echo "Database ${DB_NAME} already exists, leaving it alone"
fi

# Note: the `ecapital` role owns the tables so it can run migrations; the
# schema's row-level-security policies are what actually keep `ecapital_app`
# — the role the running API connects as — from reading or writing outside
# what a caller's token allows (ADR-0010). GRANTs beyond CONNECT/USAGE on the
# schema are handled inside the migrations themselves, not here.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c \
  "GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_APP_ROLE};"

cat <<NOTE

  IMPORTANT — placeholder database passwords:
  If roles were just created above, set real passwords now and put them in
  BOTH /etc/ecapital/api.env (DATABASE_URL, MIGRATION_DATABASE_URL) and this
  database, for example:

    sudo -u postgres psql -c "ALTER ROLE ${DB_OWNER_ROLE} PASSWORD '<new password>';"
    sudo -u postgres psql -c "ALTER ROLE ${DB_APP_ROLE} PASSWORD '<new password>';"

NOTE

# -------------------------------------------------------------- systemd ----

step "[8/9] systemd units, logrotate, sudoers"
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

step "[9/9] Done"
cat <<SUMMARY

eCapital host setup complete.

Next steps (see docs/deploy/RUNBOOK-10.227.56.22.md):
  1. Edit ${ETC_DIR}/api.env and ${ETC_DIR}/web.env — fill in every CHANGE-ME
     (database passwords, LDAP details, SESSION_SECRET).
  2. Set real database passwords (see the NOTE printed above) if the roles
     were just created.
  3. Send the cloudflared request in deploy/cloudflared-request.md, if not
     sent already.
  4. Run deploy/release.sh from the operator's machine to ship the first
     build and start ecapital-api / ecapital-web.

SUMMARY
