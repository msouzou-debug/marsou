#!/bin/bash
# Double-click launcher (macOS). Starts the local board-pack server and opens it
# in your browser. First run installs dependencies (needs Python 3 + internet).
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Χρειάζεται Python 3. Εγκαταστήστε το από https://www.python.org και ξαναδοκιμάστε."
  read -r -p "Enter για κλείσιμο..."; exit 1
fi

echo "Έλεγχος/εγκατάσταση βιβλιοθηκών…"
python3 -m pip install --quiet --disable-pip-version-check -r requirements.txt
python3 -m playwright install chromium >/dev/null 2>&1 || true

echo "Ο server ξεκινά και ο browser θα ανοίξει αυτόματα…  (κλείστε αυτό το παράθυρο για τερματισμό)"
python3 serve.py --open
