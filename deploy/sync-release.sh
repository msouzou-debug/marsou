#!/usr/bin/env bash
set -euo pipefail

# Applies a release payload already staged on the server into /opt/ecapital.
# Installed by deploy/install.sh to /opt/ecapital/deploy/sync-release.sh,
# runs as root (via the sudoers rule deploy/release.sh uses), and is the only
# part of the release that touches /opt/ecapital/apps and
# /opt/ecapital/packages with --delete. It never touches /etc/ecapital and
# never touches the database.
#
# Usage: sync-release.sh <staging-dir> <backup-stamp>

STAGING="${1:?usage: sync-release.sh <staging-dir> <backup-stamp>}"
STAMP="${2:?usage: sync-release.sh <staging-dir> <backup-stamp>}"

APP_DIR=/opt/ecapital
RELEASES_DIR=/opt/ecapital-releases
APP_USER=ecapital

if [[ ! -d "${STAGING}/apps" ]]; then
  echo "No apps/ under ${STAGING} — refusing to sync an empty payload" >&2
  exit 1
fi

BACKUP_DIR="${RELEASES_DIR}/${STAMP}"
mkdir -p "${BACKUP_DIR}"

# Back up the previous release before touching anything. Skipped only on the
# very first release, when there is nothing yet at ${APP_DIR}/apps.
if [[ -d "${APP_DIR}/apps" ]]; then
  cp -a "${APP_DIR}/apps" "${BACKUP_DIR}/" 2>/dev/null || true
  [[ -d "${APP_DIR}/packages" ]] && cp -a "${APP_DIR}/packages" "${BACKUP_DIR}/" 2>/dev/null || true
  for f in package.json pnpm-lock.yaml pnpm-workspace.yaml; do
    [[ -f "${APP_DIR}/${f}" ]] && cp -a "${APP_DIR}/${f}" "${BACKUP_DIR}/" || true
  done
  echo "Backed up previous release to ${BACKUP_DIR}"
else
  echo "First release: nothing to back up"
fi

# The only two directories synced with --delete. Everything else this script
# touches is a handful of root-level manifest files, copied without --delete.
rsync -a --delete "${STAGING}/apps/" "${APP_DIR}/apps/"
[[ -d "${STAGING}/packages" ]] && rsync -a --delete "${STAGING}/packages/" "${APP_DIR}/packages/"

for f in package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc; do
  [[ -f "${STAGING}/${f}" ]] && rsync -a "${STAGING}/${f}" "${APP_DIR}/${f}"
done
shopt -s nullglob
for f in "${STAGING}"/tsconfig*.json; do
  rsync -a "$f" "${APP_DIR}/"
done
shopt -u nullglob

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/apps"
[[ -d "${APP_DIR}/packages" ]] && chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/packages"
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc; do
  [[ -f "${APP_DIR}/${f}" ]] && chown "${APP_USER}:${APP_USER}" "${APP_DIR}/${f}"
done
for f in "${APP_DIR}"/tsconfig*.json; do
  [[ -e "$f" ]] && chown "${APP_USER}:${APP_USER}" "$f"
done
chown -R "${APP_USER}:${APP_USER}" "${BACKUP_DIR}"

echo "Synced ${STAGING} -> ${APP_DIR} (backup: ${BACKUP_DIR})"
