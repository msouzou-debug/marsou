#!/usr/bin/env bash
set -euo pipefail

# Runs the API's migrations as the `ecapital` system user, from the release
# tree. Installed by deploy/install.sh to /opt/ecapital/deploy/migrate.sh and
# invoked by deploy/release.sh through the sudoers rule set up for it —
# see docs/deploy/RUNBOOK-10.227.56.22.md. A fixed command with a fixed
# working directory is what makes that sudoers line safe to write narrowly:
#
#   administrator ALL=(ecapital) NOPASSWD: /opt/ecapital/deploy/migrate.sh
#
# The systemd units load /etc/ecapital/api.env through EnvironmentFile; a
# script run by hand through sudo gets no such thing, so this one loads the
# same file itself, the way backup.sh and restore-drill.sh already do. The
# first UAT release on 02/10/2026 stopped here with "DATABASE_URL: expected
# string, received undefined" for exactly this reason.
#
# pnpm --filter needs to run from the workspace root (where
# pnpm-workspace.yaml lives), not from apps/api — hence the cd.

ENV_FILE=/etc/ecapital/api.env
if [[ ! -r "$ENV_FILE" ]]; then
  echo "migrate.sh: $ENV_FILE is missing or not readable by $(id -un) — run deploy/install.sh and fill it in (runbook §3)" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a
if [[ -z "${DATABASE_URL:-}" || "${DATABASE_URL}" == *CHANGE-ME* ]]; then
  echo "migrate.sh: DATABASE_URL in $ENV_FILE is unset or still CHANGE-ME (runbook §3)" >&2
  exit 1
fi

cd /opt/ecapital
exec /usr/bin/pnpm --filter @ecapital/api migrate
