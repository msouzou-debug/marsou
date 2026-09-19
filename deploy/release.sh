#!/usr/bin/env bash
set -euo pipefail

# eCapital — release script. Run on the OPERATOR's machine, with the
# WireGuard tunnel to 10.227.56.22 up. Requires deploy/install.sh to have
# been run on the server at least once (system user, directories, database,
# systemd units, sudoers).
#
# What it does, in order:
#   1. Builds the monorepo locally (pnpm install --frozen-lockfile, pnpm -r build).
#   2. rsyncs the built tree, file by file, to a staging directory the
#      operator already owns on the server (no root needed for this hop).
#   3. Over one ssh -t session, as root (via the narrow sudoers rule
#      deploy/install.sh installed), backs up the previous release, syncs
#      the staging tree into /opt/ecapital/apps and /opt/ecapital/packages
#      (--delete only inside those two directories — /etc/ecapital and the
#      database are never touched), installs node_modules and runs the
#      migration as the `ecapital` user, restarts the two units, and checks
#      them.
#   4. Prints md5 sums of the entry points on both sides and a ready-to-paste
#      rollback command.
#
# Not symlink-based: the previous release is preserved as a real backup
# under /opt/ecapital-releases/<stamp> and restored in place by
# deploy/rollback.sh, rather than kept as a second live directory a symlink
# flips between. In-place-with-a-backup is what eFinance's own manual
# deploy path already does (CLAUDE.md §6: timestamped `cp -a` before
# touching anything), so this follows the pattern the operator already
# knows instead of introducing a second one for eCapital alone. The cost is
# a restart on every release either way (no atomic symlink swap), which is
# already true of eFinance and eMAP on this server.
#
# eFinance's two curl/proxy rules apply here too: `--noproxy '*'`, because
# the corporate Squid proxy answers with a fake 503 otherwise, and treat an
# empty result as "the command failed", never as "everything differs".

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HOST="10.227.56.22"
SSH_USER="administrator"
SSH_TARGET="${SSH_USER}@${SERVER_HOST}"
STAGING_DIR="/home/${SSH_USER}/ecapital-release"
APP_DIR="/opt/ecapital"

STAMP="$(date +%Y%m%d-%H%M%S)"

step() { echo; echo "=== $* ==="; }

# ------------------------------------------------------------------ build --

step "[1/6] Local build"
cd "${REPO_ROOT}"
pnpm install --frozen-lockfile
pnpm -r build

LOCAL_API_MD5="$(md5sum apps/api/src/main.ts | cut -d' ' -f1)"
if [[ -f apps/web/.next/BUILD_ID ]]; then
  LOCAL_WEB_MD5="$(md5sum apps/web/.next/BUILD_ID | cut -d' ' -f1)"
else
  echo "apps/web/.next/BUILD_ID missing after build — is 'pnpm -r build' actually building @ecapital/web?" >&2
  exit 1
fi

# -------------------------------------------------------------- transfer --

step "[2/6] rsync build to staging on the server (${STAGING_DIR})"
ssh "${SSH_TARGET}" "mkdir -p ${STAGING_DIR}"
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude '**/node_modules' \
  --exclude '.git' \
  --exclude '**/.tmp' \
  --exclude '**/test-results' \
  --exclude '**/playwright-report' \
  --exclude '**/e2e/screenshots' \
  --exclude 'coverage' \
  --exclude '**/coverage' \
  -e ssh \
  "${REPO_ROOT}/apps" "${REPO_ROOT}/packages" \
  "${REPO_ROOT}/package.json" "${REPO_ROOT}/pnpm-lock.yaml" "${REPO_ROOT}/pnpm-workspace.yaml" \
  "${SSH_TARGET}:${STAGING_DIR}/"
[[ -f "${REPO_ROOT}/.npmrc" ]] && rsync -az "${REPO_ROOT}/.npmrc" "${SSH_TARGET}:${STAGING_DIR}/" || true
for f in "${REPO_ROOT}"/tsconfig*.json; do
  [[ -e "$f" ]] && rsync -az "$f" "${SSH_TARGET}:${STAGING_DIR}/"
done

# ---------------------------------------------------------------- apply --

step "[3/6] Apply on the server: backup, sync, install deps, migrate"
ssh -t "${SSH_TARGET}" "sudo ${APP_DIR}/deploy/sync-release.sh '${STAGING_DIR}' '${STAMP}'"
ssh -t "${SSH_TARGET}" "sudo -u ecapital ${APP_DIR}/deploy/install-deps.sh"
ssh -t "${SSH_TARGET}" "sudo -u ecapital ${APP_DIR}/deploy/migrate.sh"

step "[4/6] Restart"
ssh -t "${SSH_TARGET}" "sudo systemctl restart ecapital-api.service"
ssh -t "${SSH_TARGET}" "sudo systemctl restart ecapital-web.service"
echo "Waiting 8s for both units to come up..."
sleep 8

# ----------------------------------------------------------------- checks --

step "[5/6] Health checks"
API_ACTIVE="$(ssh "${SSH_TARGET}" 'sudo systemctl is-active ecapital-api.service' || true)"
WEB_ACTIVE="$(ssh "${SSH_TARGET}" 'sudo systemctl is-active ecapital-web.service' || true)"
echo "ecapital-api: ${API_ACTIVE:-<empty — command failed, not necessarily inactive>}"
echo "ecapital-web: ${WEB_ACTIVE:-<empty — command failed, not necessarily inactive>}"
if [[ "${API_ACTIVE}" != "active" || "${WEB_ACTIVE}" != "active" ]]; then
  echo "One or both units are not active. Not rolling back automatically —" >&2
  echo "check 'journalctl -u ecapital-api -u ecapital-web --since -5min' on the server first." >&2
fi

echo
echo "Journal, last 5 minutes, error/traceback lines (should be empty):"
ssh "${SSH_TARGET}" \
  "journalctl -u ecapital-api -u ecapital-web --since '-5 min' --no-pager 2>/dev/null | grep -icE 'error|traceback|unhandled' || true"

echo
echo "Route checks (curl --noproxy '*' — the corporate Squid gives fake 503s otherwise):"
ssh "${SSH_TARGET}" \
  "curl -s --noproxy '*' -o /dev/null -w 'api /health -> %{http_code}\n' http://127.0.0.1:5015/health"
ssh "${SSH_TARGET}" \
  "curl -s --noproxy '*' -o /dev/null -w 'web /sign-in -> %{http_code}\n' http://127.0.0.1:5013/sign-in"

# --------------------------------------------------------------------- md5 --

step "[6/6] md5 — local vs. deployed"
REMOTE_API_MD5="$(ssh "${SSH_TARGET}" "md5sum ${APP_DIR}/apps/api/src/main.ts 2>/dev/null | cut -d' ' -f1" || true)"
REMOTE_WEB_MD5="$(ssh "${SSH_TARGET}" "md5sum ${APP_DIR}/apps/web/.next/BUILD_ID 2>/dev/null | cut -d' ' -f1" || true)"

printf '%-14s %-34s %-34s %s\n' "" "local" "remote" "match"
printf '%-14s %-34s %-34s %s\n' "api main.ts" "${LOCAL_API_MD5}" "${REMOTE_API_MD5:-<empty: command failed>}" \
  "$([[ "${LOCAL_API_MD5}" == "${REMOTE_API_MD5}" ]] && echo YES || echo NO)"
printf '%-14s %-34s %-34s %s\n' "web BUILD_ID" "${LOCAL_WEB_MD5}" "${REMOTE_WEB_MD5:-<empty: command failed>}" \
  "$([[ "${LOCAL_WEB_MD5}" == "${REMOTE_WEB_MD5}" ]] && echo YES || echo NO)"

if [[ "${LOCAL_API_MD5}" != "${REMOTE_API_MD5}" || "${LOCAL_WEB_MD5}" != "${REMOTE_WEB_MD5}" ]]; then
  echo
  echo "MD5 MISMATCH — do not consider this release verified. An empty remote" >&2
  echo "value usually means the ssh command itself failed, not that the file" >&2
  echo "differs; re-run the md5sum by hand before concluding anything." >&2
fi

cat <<SUMMARY

Release ${STAMP} applied. Backup of the previous release, if any:
  ${APP_DIR}-releases/${STAMP}

Rollback, if needed:
  ssh -t ${SSH_TARGET} "sudo ${APP_DIR}/deploy/rollback.sh ${STAMP}"

Next: run the smoke tests in docs/deploy/RUNBOOK-10.227.56.22.md, then
archive this release's checklist at docs/deploy/releases/<tag>.md
(docs/deploy-checklist.md).
SUMMARY
