#!/usr/bin/env bash
# Runs a `flask` command of eHire with the settings from the environment file. For cron and for the operator.
# Usage: scripts/ehire-cli.sh [--env-file FILE] COMMAND [ARGS...]      e.g.  scripts/ehire-cli.sh run-timers
# Defaults: env file /etc/ehire/ehire.env (or $EHIRE_ENV_FILE). Run it as the ehire system user, never as root.
# No sudo, no network, touches no service.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${EHIRE_ENV_FILE:-/etc/ehire/ehire.env}"
if [ "${1:-}" = "--env-file" ]; then
  ENV_FILE="${2:?--env-file needs a path}"
  shift 2
fi
[ "$#" -ge 1 ] || { echo "usage: ehire-cli.sh [--env-file FILE] COMMAND [ARGS...]" >&2; exit 64; }
[ -r "$ENV_FILE" ] || { echo "cannot read the environment file $ENV_FILE" >&2; exit 1; }

# shellcheck source=scripts/_env.sh
. "$APP_DIR/scripts/_env.sh"
load_env_file "$ENV_FILE"

PY="$APP_DIR/.venv/bin/python"
[ -x "$PY" ] || PY="${EHIRE_VENV:-/opt/ehire/venv}/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"

cd "$APP_DIR"
exec "$PY" -m flask --app wsgi:app "$@"
