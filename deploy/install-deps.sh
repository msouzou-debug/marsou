#!/usr/bin/env bash
set -euo pipefail

# Installs the workspace's node_modules on the server, as the `ecapital`
# system user, from the lockfile release.sh just shipped. Installed by
# deploy/install.sh to /opt/ecapital/deploy/install-deps.sh and invoked by
# deploy/release.sh through the same narrow sudoers rule as migrate.sh.
#
# Deliberately a full install, not `--prod`: apps/api's `start` script runs
# `node -r @swc-node/register src/main.ts` (apps/api/README.md "Notes" —
# packaging to a plain dist/ build is still open M1 work), and
# @swc-node/register is a devDependency. Stripping devDependencies here would
# leave the API unable to boot.

cd /opt/ecapital
exec /usr/bin/pnpm install --frozen-lockfile
