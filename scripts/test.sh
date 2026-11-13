#!/usr/bin/env bash
# Runs the full suite quietly. Prints failures only.
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python -m pytest -q --no-header -x "$@" 2>&1 | tail -n 40
