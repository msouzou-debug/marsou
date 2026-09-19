#!/usr/bin/env bash
set -euo pipefail

# Restores a previous release backed up by sync-release.sh. Installed by
# deploy/install.sh to /opt/ecapital/deploy/rollback.sh, runs as root (via
# the same sudoers rule release.sh uses). Restores CODE only — see the
# warning it prints about migrations.
#
# Usage: rollback.sh <backup-stamp>

STAMP="${1:?usage: rollback.sh <backup-stamp>}"

APP_DIR=/opt/ecapital
RELEASES_DIR=/opt/ecapital-releases
APP_USER=ecapital
SRC="${RELEASES_DIR}/${STAMP}"

if [[ ! -d "${SRC}/apps" ]]; then
  echo "No backup at ${SRC} — check 'ls ${RELEASES_DIR}' for valid stamps" >&2
  exit 1
fi

rsync -a --delete "${SRC}/apps/" "${APP_DIR}/apps/"
[[ -d "${SRC}/packages" ]] && rsync -a --delete "${SRC}/packages/" "${APP_DIR}/packages/"
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml; do
  [[ -f "${SRC}/${f}" ]] && rsync -a "${SRC}/${f}" "${APP_DIR}/${f}"
done

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/apps"
[[ -d "${APP_DIR}/packages" ]] && chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/packages"
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml; do
  [[ -f "${APP_DIR}/${f}" ]] && chown "${APP_USER}:${APP_USER}" "${APP_DIR}/${f}"
done

cat <<EOF

Restored ${SRC} -> ${APP_DIR}.

Still needed, by hand:
  1. sudo -u ${APP_USER} ${APP_DIR}/deploy/install-deps.sh   # node_modules for the restored lockfile
  2. sudo systemctl restart ecapital-api.service ecapital-web.service

NOT done by this script, and this is deliberate: migrations are forward-only
(ADR-0008 — hand-written SQL, no down scripts). Rolling back code does not
undo a schema change. If the release you are rolling back from ran a
migration, restoring the old code against the new schema may not work —
check what changed before assuming the rollback alone fixes things. When in
doubt, restore the matching database backup into a scratch database first
(deploy/restore-drill.sh shows how) and compare.
EOF
