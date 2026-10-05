#!/usr/bin/env bash
# eCapital — set an account's eCapital password on the server (ADR-0030).
#
#   sudo ecapital-set-password <username> [--create-admin]
#
# Runs the API's `set-password` CLI as the `ecapital` user with the live
# settings from /etc/ecapital/api.env, which only root may read. The CLI asks
# for the password twice with the echo off and never prints it; nothing here
# touches the password at all. `--create-admin` makes the account with the
# administrator role when it does not exist yet (the first account on a
# server with no reachable directory).
#
# Installed by install.sh at /usr/local/sbin/ecapital-set-password, root
# owned, like the other root-run scripts. Refuses to run unless
# AUTH_MODE=local: anywhere else a stored password is a password nobody can
# sign in with.
set -euo pipefail

ENV_FILE=/etc/ecapital/api.env
APP_DIR=/opt/ecapital
APP_USER=ecapital

if [[ $EUID -ne 0 ]]; then
  echo "run with sudo: sudo ecapital-set-password <username> [--create-admin]" >&2
  exit 1
fi
if [[ $# -lt 1 || "${1}" == -* ]]; then
  echo "usage: sudo ecapital-set-password <username> [--create-admin]" >&2
  exit 1
fi
if [[ ! -r "${ENV_FILE}" ]]; then
  echo "${ENV_FILE} is missing; run install.sh first" >&2
  exit 1
fi
if ! grep -q '^AUTH_MODE=local$' "${ENV_FILE}"; then
  echo "AUTH_MODE is not local in ${ENV_FILE}. Set AUTH_MODE=local (api.env) and NEXT_PUBLIC_AUTH_MODE=local (web.env), restart both units, then run this again (runbook §5.0)." >&2
  exit 1
fi

USERNAME="${1}"
shift

cd "${APP_DIR}"
exec sudo -u "${APP_USER}" env $(grep -v '^#' "${ENV_FILE}" | grep -v '^$' | xargs) \
  /usr/bin/pnpm --filter @ecapital/api set-password -- --username "${USERNAME}" "$@"
