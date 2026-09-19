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
# pnpm --filter needs to run from the workspace root (where
# pnpm-workspace.yaml lives), not from apps/api — hence the cd.

cd /opt/ecapital
exec /usr/bin/pnpm --filter @ecapital/api migrate
