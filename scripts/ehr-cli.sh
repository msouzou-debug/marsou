#!/usr/bin/env bash
# Runs a `flask` command of eHR with the settings from the environment file. For cron and for the operator.
# Usage: scripts/ehr-cli.sh [--env-file FILE] COMMAND [ARGS...]      e.g.  scripts/ehr-cli.sh run-timers
# Defaults: env file /etc/ehr/ehr.env (or $EHR_ENV_FILE). Run it as the ehr system user, never as root.
# No sudo, no network, touches no service.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${EHR_ENV_FILE:-/etc/ehr/ehr.env}"
if [ "${1:-}" = "--env-file" ]; then
  ENV_FILE="${2:?--env-file needs a path}"
  shift 2
fi
[ "$#" -ge 1 ] || { echo "usage: ehr-cli.sh [--env-file FILE] COMMAND [ARGS...]" >&2; exit 64; }
[ -r "$ENV_FILE" ] || { echo "cannot read the environment file $ENV_FILE" >&2; exit 1; }

# shellcheck source=scripts/_env.sh
. "$APP_DIR/scripts/_env.sh"
load_env_file "$ENV_FILE"

PY="$APP_DIR/.venv/bin/python"
[ -x "$PY" ] || PY="${EHR_VENV:-/opt/ehr/venv}/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"

cd "$APP_DIR"
exec "$PY" -m flask --app wsgi:app "$@"
