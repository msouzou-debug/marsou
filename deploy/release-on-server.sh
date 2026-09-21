#!/usr/bin/env bash
set -euo pipefail
# eCapital — release script, SERVER-SIDE variant. Run ON 10.227.56.22 as
# `administrator` (never as root), from one SSH session. It exists for an
# operator whose own machine has no bash, rsync or Node toolchain: the build
# happens on the server, and from the staging directory onward it is the
# same sequence deploy/release.sh runs — the same sync-release.sh,
# install-deps.sh, migrate.sh and systemctl targets, through the same narrow
# sudoers file deploy/install.sh installed. Nothing here needs a sudo line
# that file does not already grant, and nothing here reads or writes
# /etc/ecapital or the database directly.
#
# Usage, as administrator on the server:
#
#   /opt/ecapital/deploy/release-on-server.sh --ref <branch|tag|sha> [--skip-guides]
#   /opt/ecapital/deploy/release-on-server.sh --zip <file.zip>        [--skip-guides]
#
#   --ref   Fetches that ref of the public repository into
#           ~/ecapital-src/tree over the host's proxy (git honours
#           https_proxy from /etc/environment). Branch, tag or commit.
#   --zip   Uses a GitHub "Download ZIP" of the branch instead, copied to the
#           server with scp beforehand. For when git cannot reach GitHub.
#   --repo  Overrides the repository URL for --ref.
#   --skip-guides
#           Ships without re-rendering the sixteen per-persona PDF guides
#           (R50). Rendering needs Playwright's Chromium on this host; see
#           the message printed when it is missing. Skipping is a documented
#           deviation to record in the deploy checklist, not the normal path.
#
# What it does, in order:
#   1. Gets the source: git fetch + detached checkout of --ref, or unzip.
#   2. Builds it as administrator: pnpm install --frozen-lockfile,
#      pnpm -r build, pnpm guides:build (unless --skip-guides).
#   3. rsyncs the built tree into ~/ecapital-release (the staging directory
#      deploy/release.sh also uses), with the same excludes.
#   4. sudo sync-release.sh (backup previous release, sync into /opt/ecapital),
#      sudo -u ecapital install-deps.sh, sudo -u ecapital migrate.sh.
#   5. Restarts both units and runs the same health checks as release.sh.
#   6. Prints md5 sums, staging vs. deployed, and the rollback command.
#
# The two curl rules from the runbook apply: `--noproxy '*'`, and an empty
# result means the command failed, never "everything matches".

REPO_URL="https://github.com/msouzou-debug/marsou.git"
REF=""
ZIP=""
SKIP_GUIDES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)  REF="${2:?--ref needs a value}"; shift 2 ;;
    --zip)  ZIP="${2:?--zip needs a file}"; shift 2 ;;
    --repo) REPO_URL="${2:?--repo needs a URL}"; shift 2 ;;
    --skip-guides) SKIP_GUIDES=1; shift ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if [[ -z "${REF}" && -z "${ZIP}" ]] || [[ -n "${REF}" && -n "${ZIP}" ]]; then
  echo "usage: $(basename "$0") (--ref <branch|tag|sha> | --zip <file.zip>) [--skip-guides]" >&2
  exit 2
fi
if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this as administrator, not root: the sudoers file grants exactly the steps it needs." >&2
  exit 2
fi

OPERATOR_HOME="${HOME}"
SRC_ROOT="${OPERATOR_HOME}/ecapital-src"
SRC="${SRC_ROOT}/tree"
STAGING_DIR="${OPERATOR_HOME}/ecapital-release"
APP_DIR="/opt/ecapital"
STAMP="$(date +%Y%m%d-%H%M%S)"

step() { echo; echo "=== $* ==="; }

for tool in pnpm node rsync; do
  command -v "${tool}" >/dev/null || { echo "${tool} not found — has deploy/install.sh been run on this host?" >&2; exit 1; }
done
[[ -x "${APP_DIR}/deploy/sync-release.sh" ]] || { echo "${APP_DIR}/deploy/sync-release.sh missing — run deploy/install.sh first." >&2; exit 1; }

# --------------------------------------------------------------- source --

step "[1/6] Source"
mkdir -p "${SRC_ROOT}"
if [[ -n "${ZIP}" ]]; then
  [[ -f "${ZIP}" ]] || { echo "no such file: ${ZIP}" >&2; exit 1; }
  command -v unzip >/dev/null || { echo "unzip is not installed. Ask for: sudo apt-get install -y unzip" >&2; exit 1; }
  rm -rf "${SRC}" "${SRC_ROOT}/.unpack"
  mkdir -p "${SRC_ROOT}/.unpack"
  unzip -q "${ZIP}" -d "${SRC_ROOT}/.unpack"
  # A GitHub archive has one top-level folder, <repo>-<branch>/.
  TOP="$(find "${SRC_ROOT}/.unpack" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  [[ -n "${TOP}" && -f "${TOP}/pnpm-workspace.yaml" ]] || { echo "${ZIP} does not look like an archive of this repository (no pnpm-workspace.yaml at its top level)" >&2; exit 1; }
  mv "${TOP}" "${SRC}"
  rm -rf "${SRC_ROOT}/.unpack"
  VERSION="zip:$(basename "${ZIP}")"
else
  command -v git >/dev/null || { echo "git is not installed. Ask for: sudo apt-get install -y git" >&2; exit 1; }
  if [[ -d "${SRC}/.git" ]]; then
    git -C "${SRC}" fetch --prune origin "${REF}"
  else
    rm -rf "${SRC}"
    git clone --no-checkout "${REPO_URL}" "${SRC}"
    git -C "${SRC}" fetch origin "${REF}"
  fi
  # Detached, forced: the tree on this host is never edited, only built.
  git -C "${SRC}" checkout --force --detach FETCH_HEAD
  git -C "${SRC}" clean -fdx -e node_modules -e apps/web/.next >/dev/null
  VERSION="$(git -C "${SRC}" rev-parse --short HEAD) (${REF})"
fi
echo "source: ${SRC}"
echo "version: ${VERSION}"

# ---------------------------------------------------------------- build --

step "[2/6] Build on this host (as $(id -un))"
cd "${SRC}"
pnpm install --frozen-lockfile
pnpm -r build
if [[ "${SKIP_GUIDES}" -eq 1 ]]; then
  echo "guides: SKIPPED by --skip-guides — record it in the deploy checklist"
else
  if ! pnpm guides:build; then
    cat >&2 <<'MSG'

guides:build failed. It renders the PDFs with Playwright's Chromium, which
this host may not have yet. One-time setup, then re-run this script:

  # as root (Marios types this): the browser's shared libraries
  sudo /usr/bin/pnpm --dir /home/administrator/ecapital-src/tree --filter @ecapital/web exec playwright install-deps chromium
  # as administrator: the browser itself, into ~/.cache/ms-playwright
  pnpm --filter @ecapital/web exec playwright install chromium

Or ship this release without fresh guides: add --skip-guides, and write
that down in the deploy checklist as a deviation from R50.
MSG
    exit 1
  fi
fi
LOCAL_API_MD5="$(md5sum apps/api/src/main.ts | cut -d' ' -f1)"
if [[ -f apps/web/.next/BUILD_ID ]]; then
  LOCAL_WEB_MD5="$(md5sum apps/web/.next/BUILD_ID | cut -d' ' -f1)"
else
  echo "apps/web/.next/BUILD_ID missing after build — is 'pnpm -r build' actually building @ecapital/web?" >&2
  exit 1
fi

# -------------------------------------------------------------- staging --

step "[3/6] Stage the built tree in ${STAGING_DIR}"
mkdir -p "${STAGING_DIR}"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '**/node_modules' \
  --exclude '.git' \
  --exclude '**/.tmp' \
  --exclude '**/test-results' \
  --exclude '**/playwright-report' \
  --exclude '**/e2e/screenshots' \
  --exclude 'coverage' \
  --exclude '**/coverage' \
  "${SRC}/apps" "${SRC}/packages" \
  "${SRC}/package.json" "${SRC}/pnpm-lock.yaml" "${SRC}/pnpm-workspace.yaml" \
  "${STAGING_DIR}/"
[[ -f "${SRC}/.npmrc" ]] && rsync -a "${SRC}/.npmrc" "${STAGING_DIR}/" || true
shopt -s nullglob
for f in "${SRC}"/tsconfig*.json; do rsync -a "$f" "${STAGING_DIR}/"; done
shopt -u nullglob

# ---------------------------------------------------------------- apply --

step "[4/6] Apply: backup, sync into ${APP_DIR}, install deps, migrate"
sudo "${APP_DIR}/deploy/sync-release.sh" "${STAGING_DIR}" "${STAMP}"
sudo -u ecapital "${APP_DIR}/deploy/install-deps.sh"
sudo -u ecapital "${APP_DIR}/deploy/migrate.sh"

step "[5/6] Restart and check"
sudo systemctl restart ecapital-api.service
sudo systemctl restart ecapital-web.service
echo "Waiting 8s for both units to come up..."
sleep 8

API_ACTIVE="$(sudo systemctl is-active ecapital-api.service || true)"
WEB_ACTIVE="$(sudo systemctl is-active ecapital-web.service || true)"
echo "ecapital-api: ${API_ACTIVE:-<empty — command failed, not necessarily inactive>}"
echo "ecapital-web: ${WEB_ACTIVE:-<empty — command failed, not necessarily inactive>}"
if [[ "${API_ACTIVE}" != "active" || "${WEB_ACTIVE}" != "active" ]]; then
  echo "One or both units are not active. Not rolling back automatically —" >&2
  echo "check 'journalctl -u ecapital-api -u ecapital-web --since -5min' first." >&2
fi

echo
echo "Journal, last 5 minutes, error/traceback lines (should be 0):"
journalctl -u ecapital-api -u ecapital-web --since '-5 min' --no-pager 2>/dev/null | grep -icE 'error|traceback|unhandled' || true

echo
echo "Route checks (curl --noproxy '*' — the corporate Squid gives fake 503s otherwise):"
curl -s --noproxy '*' -o /dev/null -w 'api /health  -> %{http_code}\n' http://127.0.0.1:5015/health || true
curl -s --noproxy '*' -o /dev/null -w 'web /sign-in -> %{http_code}\n' http://127.0.0.1:5013/sign-in || true

# ------------------------------------------------------------------ md5 --

step "[6/6] md5 — built vs. deployed"
REMOTE_API_MD5="$(md5sum "${APP_DIR}/apps/api/src/main.ts" 2>/dev/null | cut -d' ' -f1 || true)"
REMOTE_WEB_MD5="$(md5sum "${APP_DIR}/apps/web/.next/BUILD_ID" 2>/dev/null | cut -d' ' -f1 || true)"
printf '%-14s %-34s %-34s %s\n' "" "built" "deployed" "match"
printf '%-14s %-34s %-34s %s\n' "api main.ts" "${LOCAL_API_MD5}" "${REMOTE_API_MD5:-<empty: command failed>}" \
  "$([[ "${LOCAL_API_MD5}" == "${REMOTE_API_MD5}" ]] && echo YES || echo NO)"
printf '%-14s %-34s %-34s %s\n' "web BUILD_ID" "${LOCAL_WEB_MD5}" "${REMOTE_WEB_MD5:-<empty: command failed>}" \
  "$([[ "${LOCAL_WEB_MD5}" == "${REMOTE_WEB_MD5}" ]] && echo YES || echo NO)"
if [[ "${LOCAL_API_MD5}" != "${REMOTE_API_MD5}" || "${LOCAL_WEB_MD5}" != "${REMOTE_WEB_MD5}" ]]; then
  echo
  echo "MD5 MISMATCH — do not consider this release verified. An empty deployed" >&2
  echo "value means md5sum itself failed (permissions?), not that the file differs." >&2
fi

cat <<SUMMARY

Release ${STAMP} applied from ${VERSION}.
Backup of the previous release, if any:
  /opt/ecapital-releases/${STAMP}
Rollback (code only — read the warning rollback.sh prints about migrations):
  sudo ${APP_DIR}/deploy/rollback.sh ${STAMP}
Next: docs/deploy/RUNBOOK-10.227.56.22.md §7 smoke tests, and finish the
deploy checklist for this release.
SUMMARY
