#!/usr/bin/env bash
# Idempotent installer for the OKYpY apps: creates/updates the shared venv and
# installs both apps' requirements. Run from anywhere; installs next to the
# repo clone (expected layout: /opt/okypy/app = repo, /opt/okypy/venv = venv).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$(dirname "$REPO_DIR")/venv"
PY="${PYTHON:-python3.11}"

command -v "$PY" >/dev/null || PY=python3
echo "repo:  $REPO_DIR"
echo "venv:  $VENV_DIR ($($PY --version))"

[ -d "$VENV_DIR" ] || "$PY" -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install -q -r "$REPO_DIR/vendor-cleanup/requirements.txt"
"$VENV_DIR/bin/pip" install -q -r "$REPO_DIR/invoice-agent/requirements.txt"

for tool in tesseract pdftoppm; do
    command -v "$tool" >/dev/null || \
        echo "WARNING: $tool not found — install tesseract-ocr tesseract-ocr-ell poppler-utils (OCR path degrades to the review queue without it)"
done

echo "OK. Configure the two settings.yaml files and /opt/okypy/env, then enable the systemd units in deploy/."
