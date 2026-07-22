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

# OCR stack — REQUIRED in production: Cyta/EAC and other utility bills are
# scanned or carry garbled text layers and only extract through tesseract.
# Install automatically when possible (root or passwordless sudo), else warn.
if ! command -v tesseract >/dev/null || ! command -v pdftoppm >/dev/null \
   || ! tesseract --list-langs 2>/dev/null | grep -q '^ell$'; then
    APT="apt-get install -y tesseract-ocr tesseract-ocr-ell poppler-utils"
    if [ "$(id -u)" = 0 ]; then
        $APT
    elif command -v sudo >/dev/null && sudo -n true 2>/dev/null; then
        sudo $APT
    else
        echo "WARNING: OCR stack missing (tesseract + ell + poppler). Run as root:"
        echo "         $APT"
        echo "         Until then, scanned/garbled bills land in the review queue."
    fi
fi
tesseract --list-langs 2>/dev/null | grep -q '^ell$' \
    && echo "OCR stack OK: $(tesseract --version 2>&1 | head -1), Greek data present" \
    || echo "OCR stack NOT ready — see warning above"

echo "OK. Configure the two settings.yaml files and /opt/okypy/env, then enable the systemd units in deploy/."
