#!/usr/bin/env bash
# Takes every screenshot the manuals use, in Greek and in English.
#
# Usage: scripts/manuals/take-screenshots.sh [OUT_DIR]        (default: instance/manual-shots)
# Writes OUT_DIR/el/*.png and OUT_DIR/en/*.png with stable names; make-manuals.js reads the same folder.
#
# For each language it builds a new scratch database with the invented demo data (init-db, seed-demo,
# seed-cases, load-holidays) in a temporary folder, starts eHire on 127.0.0.1:5097, signs in as the demo users,
# takes the pictures and stops the app. It never touches the default database, another port or another service.
# Needs: .venv (requirements-dev.txt), node with the playwright package and its chromium.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/instance/manual-shots}"
PORT=5097
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ehire-shots.XXXXXX")"
PID=""
cleanup() { [ -n "$PID" ] && kill "$PID" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

if curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/healthz"; then
  echo "Something already answers on port $PORT. Stop it first." >&2; exit 1
fi
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
cd "$ROOT"

for LANG_CODE in el en; do
  DB="$WORK/$LANG_CODE"
  mkdir -p "$DB/storage" "$OUT/$LANG_CODE"
  export EHIRE_DATABASE_URI="sqlite:///$DB/manuals.sqlite3" EHIRE_STORAGE_DIR="$DB/storage" EHIRE_SECRET_KEY=x \
         EHIRE_BIND="127.0.0.1:$PORT"
  for cmd in init-db seed-demo seed-cases load-holidays; do .venv/bin/flask --app wsgi:app "$cmd" >/dev/null; done
  .venv/bin/gunicorn -c deploy/gunicorn.conf.py wsgi:app --error-logfile "$DB/gunicorn.log" &
  PID=$!
  for _ in $(seq 1 30); do curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/healthz" && break; sleep 0.5; done
  SHOT_PYTHON="$ROOT/.venv/bin/python" node scripts/manuals/shoot.js "$LANG_CODE" "$OUT/$LANG_CODE" "$DB"
  kill "$PID"; wait "$PID" 2>/dev/null || true; PID=""
done
echo "Screenshots in $OUT"
